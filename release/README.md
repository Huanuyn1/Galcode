# Galcode Windows 双击版

下载 `Galcode-windows.exe` 后直接双击即可。

第一次运行需要联网。它会自动下载 Galcode 项目文件、准备便携 Node.js、安装 npm/WebGAL 依赖，然后启动 Galcode GUI。录制视频仍然需要 FFmpeg。

如果网络访问 GitHub 不稳定，请使用完整项目包，或把 `Galcode-windows.exe` 放在 Galcode 项目根目录/项目根目录下的 `release` 文件夹里再双击；新版启动器会优先寻找本地项目，找不到时才在线下载。

如果 Windows 提示“未知发布者”，请选择“更多信息”再继续运行。

如果双击后没有出现 GUI，请先查看 exe 同目录的 `Galcode-launcher.log`；新版启动器失败时也会尝试自动用记事本打开日志。备用日志目录是 `%LOCALAPPDATA%\Galcode\logs`。
