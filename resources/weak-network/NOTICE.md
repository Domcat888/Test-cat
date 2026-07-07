# Test cat 弱网手机端组件

本目录的 `sockstun-agent.apk` 来自 SocksTun 7.0 官方发布包：

- 项目：https://github.com/heiher/sockstun
- 作者：hev 及项目贡献者
- 许可证：MIT（见 `LICENSE.sockstun.txt`）
- 原始文件名：`hev.sockstun-7.0-release.apk`
- SHA-256：`ce24ff0a284e44031277f16fb81d6e08036b871565033aeeb3148442f6ba490c`

Test cat 使用该组件在 Android `VpnService` 中将 TCP 流量转发到当前电脑上的本地弱网引擎。组件首次启动时，Android 会要求用户确认 VPN 权限。
