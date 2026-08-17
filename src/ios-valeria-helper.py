#!/usr/bin/env python3
"""Stream Valeria H.264 access units to Test cat over stdout.

Wire format: one byte message type followed by a four-byte big-endian payload
length. Type 1 is UTF-8 JSON stream configuration; type 2 is Annex-B H.264.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import signal
import struct
import sys


def _install_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load {filename}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _load_valeria(vendor_root: str):
    import pymobiledevice3.exceptions as errors

    base = getattr(errors, "PyMobileDevice3Exception", Exception)
    for name in (
        "BackendUnavailableError",
        "MultipleDevicesError",
        "ScreenRecordingPermissionError",
    ):
        if not hasattr(errors, name):
            setattr(errors, name, type(name, (base,), {}))

    services = os.path.join(vendor_root, "pymobiledevice3", "services")
    valeria = _install_module(
        "pymobiledevice3.services.valeria", os.path.join(services, "valeria.py")
    )
    _install_module(
        "pymobiledevice3.services.valeria_cmio",
        os.path.join(services, "valeria_cmio.py"),
    )
    return valeria


def _send(kind: int, payload: bytes) -> None:
    packet = bytes((kind,)) + struct.pack(">I", len(payload)) + payload
    view = memoryview(packet)
    while view:
        written = os.write(sys.stdout.fileno(), view)
        view = view[written:]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--udid", required=True)
    parser.add_argument("--vendor-root", required=True)
    args = parser.parse_args()

    valeria = _load_valeria(os.path.abspath(args.vendor_root))
    capture = valeria.ValeriaScreenCapture.create(udid=args.udid, backend="cmio")
    stopped = False

    def stop_handler(_signum, _frame):
        nonlocal stopped
        stopped = True
        try:
            capture.stop()
        except Exception:
            pass

    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)
    capture.start()
    active_config = None

    def consume() -> None:
        nonlocal active_config
        for frame in capture.frames():
            if stopped:
                break
            if frame.sps and len(frame.sps) >= 4:
                config = {
                    "codec": f"avc1.{frame.sps[1]:02x}{frame.sps[2]:02x}{frame.sps[3]:02x}",
                    "width": frame.width or capture.width,
                    "height": frame.height or capture.height,
                }
                config_key = (config["codec"], config["width"], config["height"])
                if config_key != active_config:
                    _send(1, json.dumps(config, separators=(",", ":")).encode("utf-8"))
                    active_config = config_key
            data = frame.to_annex_b()
            if data:
                _send(2, data)

    try:
        capture.run(consume)
    finally:
        capture.stop()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(0)
    except Exception as exc:
        print(f"Valeria capture failed: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
