# Test cat 更新日志

软件“设置 → 关于 → 更新日志”只保留当前最新版内容。

## v0.9.1 - 2026-08-10

- 同步发布 mac universal 通用包、macOS Catalina Intel 兼容包和 Windows x64 包。
- `build:mac` 显式构建 universal 产物，并同时准备 arm64 / x64 的 macOS 运行时资源。
- mac universal 包覆盖 Apple Silicon 与 Intel 主流机型，Catalina 兼容包使用独立 Electron 运行时适配旧版 macOS。
- Windows 包同时提供安装版和便携版，方便不同测试环境分发。
- 打包流程会自动准备 Android Platform Tools 与 iOS 性能采集运行时，并随安装包携带。
- 各平台安装包只携带对应系统的运行时资源，减少无关平台文件进入安装包。
- 更新关于页、README 和软件内更新日志到 v0.9.1，方便 GitHub Releases 检查更新正确匹配。
