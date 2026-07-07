import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { AdbServerClient } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_1 } from '@yume-chan/adb-scrcpy';
import { DefaultServerPath } from '@yume-chan/scrcpy';

const server = new AdbServerClient(new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 }));
const devices = await server.getDevices();
const device = devices.find((item) => item.state === 'device');
if (!device) throw new Error('No authorized Android device found');

const adb = await server.createAdb({ serial: device.serial });
let scrcpy;
try {
  const file = Readable.toWeb(createReadStream('resources/scrcpy/scrcpy-server-v3.3.1'));
  await AdbScrcpyClient.pushServer(adb, file, DefaultServerPath);
  scrcpy = await AdbScrcpyClient.start(adb, DefaultServerPath, new AdbScrcpyOptions3_3_1({
    video: true,
    audio: false,
    control: true,
    tunnelForward: true,
    videoCodec: 'h264',
    maxSize: 720,
    maxFps: 30,
    videoBitRate: 2_000_000,
    logLevel: 'info'
  }));
  const video = await scrcpy.videoStream;
  const reader = video.stream.getReader();
  const packets = [];
  for (let index = 0; index < 4; index += 1) {
    const result = await reader.read();
    if (result.done) break;
    packets.push({ type: result.value.type, bytes: result.value.data.byteLength });
  }
  await reader.cancel();
  console.log(JSON.stringify({
    device: { serial: device.serial, model: device.model },
    video: { codec: video.metadata.codec, width: video.width, height: video.height },
    packets
  }, null, 2));
} finally {
  await scrcpy?.close().catch(() => {});
  await adb.close().catch(() => {});
}
