import argparse
import asyncio
import json
import posixpath
import sys
from datetime import date, datetime
from typing import Any

from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.crash_reports import CrashReportsManager
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.services.dvt.instruments.graphics import Graphics
from pymobiledevice3.tunneld.api import get_tunneld_device_by_udid


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
    parser.add_argument("mode", nargs="?", default="graphics", choices=("graphics", "device-info", "crash-list", "crash-read"))
    parser.add_argument("--udid", required=True)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--remote-path", default="")
    parser.add_argument("--max-bytes", type=int, default=2 * 1024 * 1024)
    args = parser.parse_args()
    try:
        print(json.dumps(asyncio.run(run(args)), separators=(",", ":")), flush=True)
        return 0
    except Exception as error:
        print(f"iOS helper failed: {error}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
