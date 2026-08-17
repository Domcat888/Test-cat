import argparse
import asyncio
import dataclasses
import json
import os
import posixpath
import signal
import sys
from datetime import date, datetime
from typing import Any

from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.crash_reports import CrashReportsManager
from pymobiledevice3.services.diagnostics import DiagnosticsService
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.services.dvt.instruments.graphics import Graphics
from pymobiledevice3.services.dvt.instruments.sysmontap import Sysmontap
from pymobiledevice3.tunneld.api import get_tunneld_device_by_udid


PAGE_SIZE = 16 * 1024


def json_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_value(item) for item in value]
    return str(value)


async def graphics_sample(udid: str, timeout: float) -> dict[str, float]:
    try:
        remote_device = await get_tunneld_device_by_udid(udid)
    except Exception:
        remote_device = None
    lockdown = None
    provider_source = remote_device
    if provider_source is None:
        lockdown = await create_using_usbmux(serial=udid)
        provider_source = lockdown

    try:
        async with DvtProvider(provider_source) as dvt, Graphics(dvt) as graphics:
            deadline = asyncio.get_running_loop().time() + timeout
            latest = None
            first_valid_at = None
            iterator = graphics.__aiter__()
            while asyncio.get_running_loop().time() < deadline:
                remaining = deadline - asyncio.get_running_loop().time()
                try:
                    sample = await asyncio.wait_for(anext(iterator), timeout=remaining)
                except (TimeoutError, StopAsyncIteration):
                    break
                if not isinstance(sample, dict):
                    continue
                if "CoreAnimationFramesPerSecond" not in sample or "Device Utilization %" not in sample:
                    continue
                latest = {
                    "CoreAnimationFramesPerSecond": sample["CoreAnimationFramesPerSecond"],
                    "Device Utilization %": sample["Device Utilization %"],
                }
                now = asyncio.get_running_loop().time()
                if first_valid_at is None:
                    first_valid_at = now
                elif now - first_valid_at >= 1.0:
                    return latest
            if latest is not None:
                return latest
            raise RuntimeError("Graphics service returned no valid sample")
    finally:
        if lockdown is not None:
            await lockdown.close()


def _number(value: Any) -> float | None:
    try:
        result = float(value)
        return result if result == result else None
    except (TypeError, ValueError):
        return None


def _normalize_system(system: dict[str, Any]) -> dict[str, Any]:
    total_load = _number(system.get("CPU_TotalLoad"))
    cores = _number(first_value(system.get("EnabledCPUs"), system.get("CPUCount")))
    cpu_usage = max(0.0, min(100.0, total_load / cores)) if total_load is not None and cores and cores > 0 else None
    used = _number(system.get("vmUsedCount"))
    free = _number(system.get("vmFreeCount"))
    external = _number(system.get("vmExtPageCount"))
    memory_used = memory_total = None
    if used is not None and free is not None and external is not None and min(used, free, external) >= 0 and external <= used:
        memory_used = (used - external) * PAGE_SIZE
        memory_total = (used + free) * PAGE_SIZE
        if memory_total <= 0 or memory_used > memory_total:
            memory_used = memory_total = None
    return {
        "cpuUsage": cpu_usage,
        "enabledCpuCount": cores,
        "memoryUsed": memory_used,
        "memoryTotal": memory_total,
    }


def _find_process(rows: list[dict[str, Any]], executable: str) -> dict[str, Any] | None:
    expected = os.path.basename(executable or "").lower()
    if not expected:
        return None
    for row in rows:
        names = [row.get(key) for key in ("name", "execName", "executable", "processName", "command")]
        normalized = [os.path.basename(str(value)).lower() for value in names if value]
        if expected in normalized:
            return {
                "cpuUsage": _number(row.get("cpuUsage")),
                "memoryUsed": _number(row.get("physFootprint")),
            }
    return None


async def monitor_performance(udid: str, interval_ms: int, metrics: set[str], executable: str) -> None:
    """Keep one DVT session alive and emit one normalized NDJSON sample per interval."""
    remote_device = None
    try:
        remote_device = await get_tunneld_device_by_udid(udid)
    except Exception:
        pass
    dvt_lockdown = None
    provider = remote_device
    if provider is None:
        dvt_lockdown = await create_using_usbmux(serial=udid)
        provider = dvt_lockdown

    battery_lockdown = None
    latest_graphics: dict[str, Any] = {}
    latest_thermal: dict[str, Any] = {}
    latest_system: dict[str, Any] = {}
    latest_processes: list[dict[str, Any]] = []
    seen_cpu_usage = False

    async def graphics_loop(dvt: DvtProvider) -> None:
        while True:
            try:
                async with Graphics(dvt) as graphics:
                    async for payload in graphics:
                        if not isinstance(payload, dict):
                            continue
                        if "CoreAnimationFramesPerSecond" in payload:
                            latest_graphics.clear()
                            latest_graphics.update({
                                "fps": _number(payload.get("CoreAnimationFramesPerSecond")),
                                "gpuUsage": _number(payload.get("Device Utilization %")),
                            })
            except asyncio.CancelledError:
                raise
            except Exception as error:
                latest_graphics.clear()
                latest_graphics["_error"] = str(error)
                await asyncio.sleep(2)

    async def thermal_loop() -> None:
        nonlocal battery_lockdown
        while True:
            try:
                battery_lockdown = await create_using_usbmux(serial=udid)
                async with DiagnosticsService(lockdown=battery_lockdown) as diagnostics:
                    battery = await diagnostics.get_battery()
                    if isinstance(battery, dict):
                        latest_thermal.clear()
                        latest_thermal.update(json_value(battery))
                await battery_lockdown.close()
                battery_lockdown = None
            except asyncio.CancelledError:
                raise
            except Exception as error:
                latest_thermal.clear()
                latest_thermal["_error"] = str(error)
                if battery_lockdown is not None:
                    await battery_lockdown.close()
                    battery_lockdown = None
            await asyncio.sleep(10)

    async def sysmon_loop(sysmon: Sysmontap) -> None:
        nonlocal latest_processes, seen_cpu_usage
        async for row in sysmon:
            if not isinstance(row, dict):
                continue
            if "System" in row:
                try:
                    latest_system.update(dataclasses.asdict(sysmon.system_attributes_cls(*row["System"])))
                except Exception:
                    pass
            if "Processes" in row:
                rows = []
                for process_info in row["Processes"].values():
                    try:
                        rows.append(dataclasses.asdict(sysmon.process_attributes_cls(*process_info)))
                    except Exception:
                        continue
                latest_processes = rows
            if "SystemCPUUsage" not in row:
                continue
            if not seen_cpu_usage:
                seen_cpu_usage = True
                continue
            latest_system.update(row["SystemCPUUsage"])
            latest_system["CPUCount"] = row.get("CPUCount")
            latest_system["EnabledCPUs"] = row.get("EnabledCPUs")
            output = {"timestamp": int(datetime.now().timestamp() * 1000)}
            if "cpu" in metrics or "memory" in metrics:
                output["system"] = _normalize_system(latest_system)
            if "graphics" in metrics:
                output["graphics"] = dict(latest_graphics)
            if "thermal" in metrics:
                output["thermal"] = dict(latest_thermal)
            if "app" in metrics:
                output["app"] = _find_process(latest_processes, executable)
            print(json.dumps(json_value(output), separators=(",", ":")), flush=True)

    try:
        async with DvtProvider(provider) as dvt:
            sysmon = await Sysmontap.create(dvt, interval=interval_ms)
            async with sysmon:
                tasks = [asyncio.create_task(sysmon_loop(sysmon))]
                if "graphics" in metrics:
                    tasks.append(asyncio.create_task(graphics_loop(dvt)))
                if "thermal" in metrics:
                    tasks.append(asyncio.create_task(thermal_loop()))
                try:
                    await asyncio.gather(*tasks)
                finally:
                    for task in tasks:
                        task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        if battery_lockdown is not None:
            await battery_lockdown.close()
        if dvt_lockdown is not None:
            await dvt_lockdown.close()


async def get_domain(lockdown, domain: str | None = None) -> dict[str, Any]:
    try:
        result = await lockdown.get_value(domain=domain)
        return result if isinstance(result, dict) else {}
    except Exception:
        return {}


def first_value(*values: Any) -> Any:
    return next((value for value in values if value is not None and value != ""), None)


async def device_info(udid: str) -> dict[str, Any]:
    lockdown = await create_using_usbmux(serial=udid)
    try:
        main, battery, disk, wireless = await asyncio.gather(
            get_domain(lockdown),
            get_domain(lockdown, "com.apple.mobile.battery"),
            get_domain(lockdown, "com.apple.disk_usage"),
            get_domain(lockdown, "com.apple.mobile.wireless_lockdown"),
        )
        battery_level = first_value(
            battery.get("BatteryCurrentCapacity"), battery.get("CurrentCapacity"), main.get("BatteryCurrentCapacity")
        )
        charging = first_value(battery.get("IsCharging"), battery.get("ExternalConnected"))
        device_timestamp = first_value(main.get("TimeIntervalSince1970"), main.get("TimeIntervalSince1970Key"))
        result = {
            "udid": first_value(main.get("UniqueDeviceID"), udid),
            "name": first_value(main.get("DeviceName"), "iPhone"),
            "productType": main.get("ProductType"),
            "productVersion": main.get("ProductVersion"),
            "buildVersion": main.get("BuildVersion"),
            "serialNumber": main.get("SerialNumber"),
            "deviceClass": main.get("DeviceClass"),
            "cpuArchitecture": main.get("CPUArchitecture"),
            "hardwareModel": main.get("HardwareModel"),
            "timeZone": first_value(main.get("TimeZone"), main.get("TimeZoneOffsetFromUTC")),
            "deviceTimestamp": device_timestamp,
            "wifiAddress": main.get("WiFiAddress"),
            "bluetoothAddress": main.get("BluetoothAddress"),
            "wirelessCapable": bool(main.get("WiFiAddress") or wireless),
            "wifiConnectionsEnabled": first_value(
                wireless.get("EnableWifiConnections"), wireless.get("EnableWifiDebugging"), wireless.get("WirelessHosts")
            ),
            "paired": True,
            "passwordProtected": main.get("PasswordProtected"),
            "batteryLevel": battery_level,
            "charging": charging,
            "totalDiskCapacity": first_value(disk.get("TotalDiskCapacity"), disk.get("TotalDataCapacity")),
            "freeDiskCapacity": first_value(
                disk.get("AmountDataAvailable"), disk.get("TotalDataAvailable"), disk.get("TotalDiskAvailable")
            ),
            "totalDataCapacity": disk.get("TotalDataCapacity"),
            "raw": {"battery": battery, "disk": disk, "wireless": wireless},
        }
        return json_value(result)
    finally:
        await lockdown.close()


async def crash_list(udid: str) -> list[dict[str, Any]]:
    lockdown = await create_using_usbmux(serial=udid)
    try:
        async with CrashReportsManager(lockdown) as manager:
            try:
                await asyncio.wait_for(manager.flush(), timeout=8)
            except Exception:
                pass
            entries = await manager.ls("/", depth=3)
            result = []
            for entry in entries:
                try:
                    stat = await manager.afc.stat(entry)
                except Exception:
                    continue
                if stat.get("st_ifmt") != "S_IFREG":
                    continue
                modified = stat.get("st_mtime")
                result.append({
                    "path": entry,
                    "name": posixpath.basename(entry),
                    "size": stat.get("st_size"),
                    "modifiedAt": modified.isoformat() if hasattr(modified, "isoformat") else str(modified or ""),
                })
            return result
    finally:
        await lockdown.close()


async def crash_read(udid: str, remote_path: str, max_bytes: int) -> dict[str, Any]:
    normalized = posixpath.normpath("/" + remote_path.lstrip("/"))
    if normalized == "/" or normalized.startswith("/../"):
        raise ValueError("Invalid remote crash report path")
    lockdown = await create_using_usbmux(serial=udid)
    try:
        async with CrashReportsManager(lockdown) as manager:
            stat = await manager.afc.stat(normalized)
            size = int(stat.get("st_size") or 0)
            if size <= 0:
                raise ValueError("Crash report is empty")
            if size > max_bytes:
                raise ValueError(f"Crash report exceeds {max_bytes} bytes")
            content = await manager.afc.get_file_contents(normalized)
            if len(content) > max_bytes:
                raise ValueError(f"Crash report exceeds {max_bytes} bytes")
            return {"path": normalized, "size": len(content), "content": content.decode("utf-8", errors="replace")}
    finally:
        await lockdown.close()


async def run(args: argparse.Namespace) -> Any:
    if args.mode == "monitor":
        metrics = {item for item in args.metrics.split(",") if item}
        await monitor_performance(args.udid, args.interval_ms, metrics, args.app_executable)
        return None
    if args.mode == "graphics":
        return await graphics_sample(args.udid, args.timeout)
    if args.mode == "device-info":
        return await device_info(args.udid)
    if args.mode == "crash-list":
        return await crash_list(args.udid)
    if args.mode == "crash-read":
        return await crash_read(args.udid, args.remote_path, args.max_bytes)
    raise ValueError(f"Unknown mode: {args.mode}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", default="graphics", choices=("monitor", "graphics", "device-info", "crash-list", "crash-read"))
    parser.add_argument("--udid", required=True)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--interval-ms", type=int, default=2000)
    parser.add_argument("--metrics", default="cpu,memory,thermal,graphics")
    parser.add_argument("--app-executable", default="")
    parser.add_argument("--remote-path", default="")
    parser.add_argument("--max-bytes", type=int, default=2 * 1024 * 1024)
    args = parser.parse_args()
    try:
        result = asyncio.run(run(args))
        if args.mode != "monitor":
            print(json.dumps(result, separators=(",", ":")), flush=True)
        return 0
    except Exception as error:
        print(f"iOS helper failed: {type(error).__name__}: {error!r}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
