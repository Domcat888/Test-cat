# Test cat

Test cat 是一个面向测试工程师的跨平台桌面工具框架。当前版本支持工具卡片拖拽排序、模块管理、测试任务清单，以及浅色、深色、紫色护眼三种主题。

## 本地更新

关于页支持从 GitHub Releases 检查更新，更新源为 `Domcat888/Test-cat`。软件会根据当前系统自动选择 mac universal、Windows x64 或 macOS Catalina Intel 兼容包；发现新版本后，可一键下载到系统下载目录并打开安装包。

## 安卓投屏模块

首个内置工具支持 Android USB 设备检测、一键部署 scrcpy 服务、独立投屏窗口、鼠标触控、键盘输入、返回/主页/最近任务、旋转、截图、全屏与关闭手机屏幕。竖屏画面会完整等比显示，进入横屏游戏时自动跟随画面方向并重新适配。投屏运行时可以继续在 Test cat 主窗口使用其他测试工具，也可以开启“窗口置顶”让手机画面保持在其他软件上方。

设备连接后可以直接打开“设备信息”，读取手机型号、Android 版本、系统构建、分辨率、CPU、物理内存、电量、温度、网络、ADB 连接方式，以及当前前台 App 的包名、版本号和 versionCode。检测结果会整理成正式的缺陷环境文案，可一键复制到缺陷单；也支持手动填写指定 App 包名后重新读取。

使用前请安装 Android Platform Tools，并在手机上开启“开发者选项 → USB 调试”。连接数据线后进入“安卓投屏”，点击“一键部署并投屏”。

## iOS 投屏模块

iOS 投屏以独立窗口运行，只读取已信任 iPhone 的屏幕画面，不发送点击、滑动、按键或文字输入。模块优先使用免费的 `libimobiledevice` 工具链（`idevice_id`、`ideviceinfo`、`idevicescreenshot`），也支持安装 Python `tidevice` 后自动回退到 `tidevice screenshot`。

macOS 和 Windows 均可使用。Windows 需要安装 Apple Mobile Device Support（随 iTunes 或 Apple Devices 提供）以及 `libimobiledevice` 或 `tidevice`，并将对应命令加入 PATH；macOS 可通过 Homebrew 安装 `libimobiledevice`。首次连接时请在 iPhone 上点“信任”，再打开“iOS 投屏”刷新设备并开始投屏。

当前实现采用 USB PNG 截图轮询，画面更新速度取决于设备和命令行工具，适合查看与录制测试现场，不等同于高帧率 H.264 视频流。

## iOS 性能监控模块

“iOS 性能监控”是独立于只读投屏的性能测试窗口，Windows 和 macOS 提供相同功能。它通过内置的 Python 3.10 与 `pymobiledevice3 10.3.1` 调用 Apple DVT，采集真实的 CPU、内存、设备 FPS、GPU 利用率、电池温度、电量和充电状态；选择用户 App 后，还可以采集 App 进程 CPU 与 `physFootprint` 内存。设备未公开的指标会显示为不可用，不生成模拟数据。

正式安装包会携带与系统架构匹配的采集引擎，用户不需要安装 Python、`pymobiledevice3` 或配置环境变量。源码开发、预览和打包会先执行 `npm run prepare:ios-runtime`：Windows 使用官方 Python embeddable，macOS 使用对应 Apple Silicon/Intel 架构的 python-build-standalone，并将固定版本依赖安装到 `resources/ios-performance-runtime`。生成文件不提交到 Git，由目标系统在构建时准备。

连接 iPhone 后仍需要点击“信任”并开启开发者模式。Windows 需要系统中存在 Apple Mobile Device 驱动（安装 Apple Devices 或 iTunes 时由 Apple 提供），这是 Windows 识别 iPhone 的必要条件，不需要安装 Python 或其他采集命令。开始测试时模块会自动尝试挂载 DeveloperDiskImage，并在需要 FPS/GPU 时自动检测和启动性能桥接；Windows 会显示 UAC 授权，macOS 在普通权限不足时会自动显示系统管理员授权。

性能采集优先使用 DVT tunnel；旧版 iOS 或 tunnel 不可用时，CPU/内存和 App 进程会尝试回退到 USB lockdown 路径。FPS/GPU 需要 DVT Graphics 服务，无法访问时只标记该指标不可用，不影响其他指标。采样任务互不重叠，单项失败也不会中断其他指标。

设备信息页可以读取设备名称、ProductType、iOS 版本、系统构建、序列号、UDID、电量、充电状态、总/可用存储、设备时间、时区和 Wi-Fi 状态。诊断日志页只读手机中的最新 Crash、Jetsam 和 Performance 日志，每类最多导入最新一份，单文件限制 2 MiB，不删除手机原件，并按设备 UDID 与原始路径去重。

停止测试后报告会自动保存在 Test cat 本机数据目录，支持 JSON 导入、JSON/离线 HTML 导出、两份报告的平均值/峰值/变化比例对比。实时监控最多保留 24 小时原始采样，绘图时使用最小值/最大值分桶压缩，因此长时间测试不会为了页面流畅而提前丢弃原始波峰。

该模块面向 Windows/macOS，Linux 暂不提供 iOS DVT 性能采集。iOS 性能指标属于设备级或 App 进程级口径，系统 FPS/GPU 不等同于游戏引擎内部 FPS/GPU。

## 计算器与测试待办

首页内置计算器使用统一的猫和老鼠卡通图标，并会在独立小窗口中打开，支持鼠标、键盘、四则运算、括号和取余。首页全部工具卡片都可以拖拽调整顺序，排序结果会保存在本机。

侧边栏“测试待办”用于记录测试任务，可设置高、普通、低优先级，并按全部、待完成、已完成筛选。任务支持设置闹钟时间，Test cat 会在还差 30 分钟、10 分钟、5 分钟时通过桌面宠物提醒；如果宠物处于关闭状态，会临时出现提醒并在提醒结束后自动回窝。

## 安卓性能监控模块

第三个内置工具以独立窗口运行，可自由多选 CPU、内存、GPU、网络、磁盘、应用和设备指标，并以实时曲线展示 Android 设备数据。应用包名支持一键读取当前前台应用；开始测试时可自动识别，并可在测试中跟随切换后的游戏或被测 App。填写包名后可测量冷启动耗时，并补充应用内存、FPS、卡顿和崩溃指标。

Windows 和 macOS 正式安装包会内置 Google 官方 Android SDK Platform Tools，用户不需要额外安装 ADB 或配置 `ADB_PATH`。源码预览和打包会先执行 `npm run prepare:android-runtime`，在目标系统下载并校验对应运行环境；生成文件不提交 Git。Windows 当前交付架构为 x64，macOS 分别准备 Apple Silicon 和 Intel 运行环境。

结束测试时会弹出报告命名窗口。报告独立保存在 Test cat 数据目录，最多保留 250 份；旧版页面存储中的报告会自动迁移。每份报告最多保存 86,400 个原始采样点，实时曲线采用保留最小值/最大值的压缩绘制，因此长时间测试不会为了页面流畅提前丢弃波峰。

报告支持 JSON、离线 HTML 和真实 `.xlsx` 工作簿导出，两份历史报告可以比较平均值与变化比例。统计结果包含平均值、最小/最大值以及 P50、P90、P95、P99；App 前后台变化、前台 App 切换、冷启动、Crash、ANR 和自动性能预警会按时间保存到报告。部分 GPU、显存、功耗指标依赖手机厂商是否开放相应系统节点，不支持时界面会明确显示“设备不支持”，不会生成模拟值。

## 文件对比模块

文件对比以独立窗口运行，支持文本、代码、JSON、XML、CSV、XLSX、图片、二进制和整个文件夹。CSV/XLSX 会以左右双栏的真实工作表网格展示，能够识别公式变化并还原百分比、日期等常见显示格式；差异直接标记在原单元格位置，左右支持同步滚动和差异跳转。“只显示差异”会保留包含差异的原始行列。文本差异支持逐处双向合并、缩略导航和大文件插入/删除对齐；文件夹支持扩展名过滤、排除目录、内容哈希判断和带二次确认的单项同步。全部差异均可导出为 HTML 或 Excel 可见报告，最近记录只保存在本机。

## 日志分析模块

日志分析以独立窗口运行，通过真实 ADB logcat 实时读取 Android 日志。支持“整机日志”和“指定 App 日志”两种范围：整机日志用于查看设备完整 logcat，指定 App 日志用于按包名聚焦被测应用。筛选支持日志级别、普通关键字、接口名和玩家 ID 组合过滤，也可以一键识别当前前台 App。Crash、ANR、Exception、Error 和错误堆栈会自动高亮并汇总到异常事件列表。

监听过程中可以暂停页面刷新、保持自动滚动或清空页面；后台日志采集不会因为暂停显示而中断。复制和导出会跟随当前范围与筛选条件，支持全部日志或当前筛选结果，可生成原始 `.log` 文件或带异常颜色标记的 HTML 可视化报告。

## 安装包管理、数据与效率工具

安装包管理支持 APK / IPA 基础信息解析、签名与权限查看、Android 多设备安装、卸载、清除数据和历史版本对比。详情页会展示包名、应用名称、版本号、内部版本号、Min SDK / Target SDK、权限列表、文件大小、文件 MD5 / SHA1 / SHA256，以及 APK 证书 MD5 等信息。针对部分厂商 ROM 禁止 ADB 清除数据的情况，界面会给出明确原因；debug 包会尝试使用 `run-as` 兜底清理应用私有目录。

Mock 数据生成器支持常用测试数据批量生成和 CSV 导出。时间戳转换工具支持秒、毫秒、微秒、纳秒和日期时间互转。公式运算工具支持自定义变量词、公式模板、代入计算、历史记录，以及公式 / 变量词导入导出。

## AI 测试助手

AI 测试助手以独立窗口运行，支持测试用例生成、报错解释、Bug 单生成和日志总结 4 个场景。每个场景都提供小白快速模板，粘贴需求、报错、现象、logcat 或拖入文件后即可生成结果；测试用例支持 Excel / XMind 导出，其他 AI 结果支持复制和 Excel 导出。使用前需要在设置中填写模型服务配置。

## 直接预览与调试（无需打包）

- macOS：双击 `本地预览.command`
- Windows：双击 `本地预览.bat`
- 软件打开后按 `F12` 可打开或关闭开发者工具。

也可以在终端运行 `npm run preview`；如需启动时自动打开开发者工具，运行 `npm run dev`。

## 本地运行

开发环境需要 Node.js 22.12.0 或更高版本。

```bash
npm install
npm run preview
```

## 打包

```bash
# macOS（生成 DMG 与 ZIP）
npm run build:mac

# Windows（建议在 Windows 机器上执行，生成安装版与便携版）
npm run build:win
```

输出文件位于 `release/`。未签名的安装包在首次打开时可能触发系统安全提示；正式分发时应配置 Apple Developer ID 与 Windows 代码签名证书。

## 后续接入模块

当前“模块”是保存在浏览器本地存储中的入口数据。后续接入真实工具时，可以在 `src/main.js` 增加受控的主进程能力，再通过 preload 脚本向 `src/renderer/app.js` 暴露最小化接口。请保持 `contextIsolation` 与 `sandbox` 开启，不要直接在页面中启用 Node.js。
