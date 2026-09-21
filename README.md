# SillyTavern Resource Library

SillyTavern Resource Library（SRL）是一个面向 SillyTavern 使用场景的本地优先资源管理工具，用于整理、预览、搜索、备份和管理角色卡、世界书、预设、正则、美化、快速回复、脚本及其他相关资源。

本仓库为可自行部署的本地版本，不需要 SRL 账号或登录，也不依赖作者提供的账号系统、管理后台、反馈服务或官方云端服务。

> [!WARNING]
> **关于本文档**
>
> 本 README 由 AI 辅助生成，并经过项目维护者整理与修改。由于项目仍在持续迭代，文档内容可能存在遗漏、表述不准确或未及时同步最新实现的情况。
>
> 功能行为请以当前版本源码和实际运行结果为准；涉及许可证、第三方代码及再分发要求时，请以仓库中的 `LICENSE`、`NOTICE` 及相关上游项目条款为准。
>
> README 中关于安全、隐私、兼容性和数据处理方式的说明主要用于帮助理解项目设计，不应视为正式的安全审计、法律意见或绝对安全保证。

## 主要功能

SRL 目前主要支持：

- 角色卡 PNG / JSON 导入与管理
- 世界书、预设、正则、快速回复、脚本等资源管理
- SillyTavern 备份识别与导入
- GitHub 链接资源导入
- 分类、标签、文件夹、收藏、搜索与批量管理
- 资源详情、历史版本与重复资源处理
- 本地导入、导出与备份恢复
- GitHub 私有仓库直连备份
- 用户自建 ImgBed 图床
- 用户自行配置的 AI API 与图像生成服务
- 第三方 APP / 扩展资源管理
- 本机 SillyTavern 资源互传
- HTML / CSS / JavaScript 内容预览
- TavernHelper 相关内容兼容
- 前端工作台（Frontend Workshop）
- PWA 与离线使用

具体功能会随着项目更新继续调整。

## 本地优先

SRL 的核心数据默认保存在当前设备。

包括但不限于：

- 角色卡
- 世界书
- 预设
- 正则
- 文件夹与标签
- 前端工作台项目
- 应用设置
- 历史记录

Web 版本主要使用 IndexedDB 等浏览器本地存储能力保存数据。

SRL 不会因为打开页面而自动把资源上传到作者服务器。

## 外部服务

部分功能需要用户主动配置第三方服务，例如：

- GitHub 私有仓库备份
- 自建 ImgBed 图床
- GPT / OpenAI Provider（支持 OpenAI-compatible Endpoint）
- NovelAI Provider（支持自定义 Endpoint）
- 其他用户自行配置的 AI 服务

这些连接只会在用户主动配置并使用对应功能时发生。

相关数据如何存储和处理，同时受对应第三方服务的隐私政策、权限设置和安全策略影响。

请妥善保管 API Key、GitHub Token 和其他访问凭据。

## 安全说明

角色卡、HTML、JavaScript、第三方 APP、插件及远程资源都可能包含来自第三方的内容。

SRL 默认限制部分高风险能力，并提供相应开关。

启用远程资源或 JavaScript 前，请确认内容来源可信。

角色卡预览中的 JavaScript 在隔离 iframe 中执行，不获得 SRL 主页面的同源权限。

第三方内容本身的安全性不由 SRL 保证。

## 本机 SillyTavern 互传

SRL 支持与 SillyTavern 进行本机资源互传。

Public 版本不会通过作者服务器建立互传连接。

互传主要通过：

- SillyTavern 页面扩展与当前窗口通信
- 用户自己运行的本机 SillyTavern 服务插件
- `127.0.0.1` 本地连接

完成。

相关扩展与安装说明可在 SRL 的酒馆互传功能中查看。

## 快速开始

### 环境要求

- Node.js 22 或更高版本
- pnpm

### 安装依赖

```bash
pnpm install
```

### 本地开发

```bash
pnpm dev
```

需要允许局域网其他设备访问时：

```bash
pnpm dev:lan
```

### 构建

```bash
pnpm build
```

构建产物位于：

```text
dist/
```

可将 `dist` 部署到支持静态网页的 Web Server。

### 本地预览构建结果

```bash
pnpm preview
```

## 开发检查

提交修改前建议执行：

```bash
pnpm format:check
pnpm lint
pnpm test
pnpm build
```

也可以直接运行：

```bash
pnpm check
```

项目包含 Public Release Guard，用于防止正式站账号、管理后台和其他作者服务端代码意外进入本地公开版本。

## 项目结构

```text
src/
├─ components/    Vue 页面与组件
├─ composables/   页面状态与交互逻辑
├─ core/          应用核心、容器与基础设施
├─ services/      导入、备份、AI、图床等业务逻辑
├─ parser/        SillyTavern 与资源格式解析
├─ storage/       IndexedDB 与本地数据存储
├─ types/         TypeScript 类型定义
├─ utils/         兼容、转换、安全和辅助工具
├─ styles/        页面样式
├─ workers/       浏览器 Web Worker
└─ templates/     Frontend Workshop 模板
```

`.test.ts` 等测试文件通常与对应业务模块放在一起，不会因此进入生产构建产物。

## 二次开发

想修改某个功能但不知道从哪里开始？  
请查看 [二次开发导航](docs/MODDING_GUIDE.md)。

需要了解项目整体架构，请查看  
[架构说明](docs/ARCHITECTURE.md)。

两份开发文档按当前仓库源码维护；如果文档与代码不一致，请以代码为准。

## SillyTavern / TavernHelper 兼容说明

本项目针对 SillyTavern 与 TavernHelper 的部分资源格式和使用方式提供兼容支持。

这种兼容关系不表示 SRL 与 SillyTavern、TavernHelper 或其开发者存在隶属、授权、赞助或官方合作关系。

`src/utils/RichContentPreview.ts` 中包含经过修改的 TavernHelper / JS-Slash-Runner 4.8.19 相关代码。

具体来源与修改说明请参阅：

- [NOTICE](NOTICE)

## License

Copyright (C) 2026 jixiangruyi117

本项目按照 Aladdin Free Public License Version 9（AFPL v9）发布。

AFPL v9 包含关于修改、分发、源代码提供和商业分发等方面的要求，并不是 OSI 定义下的开源许可证。

在修改、重新分发或以其他方式使用本项目源码前，请完整阅读：

- [LICENSE](LICENSE)
- [NOTICE](NOTICE)

使用、修改或分发本项目即表示相关行为需要遵守适用的许可证条款。
