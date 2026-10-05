# TokenPulse

TokenPulse 是一个 Windows 桌面工具，用于查看 Claude Code 和 Codex 的 Token 用量、估算费用、额度与任务执行情况。当前版本：**2.10.0**。

## 下载与使用

在仓库的 Releases 页面下载 Windows x64 版本：

- `TokenPulse.Setup.2.10.0.exe`：安装版，可选择安装目录。
- `TokenPulse-2.10.0-portable.exe`：便携版，直接运行。

应用会读取本机 Claude Code 与 Codex 的会话日志。运行任务需要对应的 CLI 已安装并登录；额度来源、额外日志目录和通知渠道可在设置中调整。

## 功能模块

### 用量概览
- 切换 Claude Code、Codex 或合并视图，查看 Token、费用、缓存收益和用量趋势。
- 展示实时活动、用量分析、预算与异常消耗提醒，支持美元和人民币显示。

### 额度与守卫
- 查看用量窗口与重置时间；Claude Code 支持用量接口、状态栏桥接和本地估算。
- 支持额度提醒、Claude Code 任务暂停与恢复，以及允许自动续跑的时间段设置。

### 任务队列
- 调用 Claude Code 或 Codex 执行任务，支持立即、手动、指定时间与额度重置后运行。
- 支持按工具与工作目录调度、会话续接、依赖任务、重试、备用模型、超时和验证命令。
- 支持任务终端窗口、日志查看，以及按百分比或 Token 数设置上下文自动压缩阈值。

### 会话与历史
- 浏览会话、提示词和对话，按项目查看费用与用量。
- 本地归档用量记录，提供缓存诊断和报告能力。

### 成就与星空
- 将用量里程碑、会话与项目映射为成就、恒星和行星。
- 提供星空视图、流星与天象信息，以及与用量相关的视觉效果。

### 定价
- 提供模型价格与费用计算，支持内置价格、Markdown 定价资料与 LiteLLM 数据。

### 桌面与外观
- 提供托盘、悬浮窗、灵动岛、大屏与桌面壁纸模式。
- 支持浅色、深色、主题包、动态背景、昼夜切换、动效强度、音效和快捷操作搜索。

### 通知与设置
- 提供预算、额度、异常消耗、成就与任务通知。
- 可配置 Telegram 推送、日报和远程指令，以及开机启动与全局快捷键。

## 本地开发

需要 Node.js 与 npm。Windows 下双击根目录 `start.bat`，或运行：

```powershell
npm ci
npm run dev
```

常用检查与打包命令：

```powershell
npm run typecheck
npm test
npm run build
npm run dist -- --publish never
```

打包结果位于 `dist/`。源码结构：`src/main/` 为 Electron 主进程，`src/preload/` 为桌面接口桥接，`src/renderer/` 为界面，`src/shared/` 为共享类型与工具，`src/bridge/` 为 CLI 桥接脚本，`tests/` 为测试。

本地日志、依赖、构建产物、环境变量文件与私钥不提交到 Git。请使用占位符记录配置示例。

## v2.10.0 更新

### 发布
- 将当前 2.10.0 源码作为 GitHub 发布快照，提供 Windows x64 安装版与便携版。
- 补齐功能说明、开发与打包步骤、MIT 许可证和 Windows 一键启动脚本。
- 完善 Git 忽略规则，排除本地环境变量、私钥与 TypeScript 构建缓存。

## 许可证

[MIT](LICENSE)
