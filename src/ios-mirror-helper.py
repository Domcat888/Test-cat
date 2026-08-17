import argparse
import asyncio
import struct
import sys

from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.services.dvt.instruments.screenshot import Screenshot
from pymobiledevice3.tunneld.api import get_tunneld_device_by_udid


async def stream(udid: str) -> None:
    device = await get_tunneld_device_by_udid(udid)
    if device is None:
        raise RuntimeError("selected iPhone is not available through tunneld")
    try:
        async with DvtProvider(device) as dvt, Screenshot(dvt) as screenshots:
            output = sys.stdout.buffer
            pending = {asyncio.create_task(screenshots.get_screenshot()) for _ in range(4)}
            while True:
                completed, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                for task in completed:
                    frame = task.result()
                    pending.add(asyncio.create_task(screenshots.get_screenshot()))
                    if frame:
                        output.write(struct.pack(">I", len(frame)))
                        output.write(frame)
                        output.flush()
    finally:
        await device.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--udid", required=True)
    args = parser.parse_args()
    try:
        asyncio.run(stream(args.udid))
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        print(f"iOS mirror stream failed: {error}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
