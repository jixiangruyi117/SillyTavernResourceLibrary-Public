# 项目架构说明

> [!NOTE]
> 本文档由 AI 辅助整理，并按当前仓库源码核对。它描述的是当前 Public 本地版架构，不是历史版本设计。
>
> 如果本文档与源码冲突，请以源码为准。

## 1. 当前定位

Public 版是一个本地优先的 Vue + TypeScript 单页应用。

核心数据以浏览器本地存储为主；GitHub、自建 ImgBed、AI API 和本机 SillyTavern 都是用户主动配置或主动使用的外围能力。

Public 版不依赖作者账号系统、管理后台、反馈服务或作者正式云端 API。

## 2. 启动链

当前入口：

```text
index.html
    ↓
src/Main.ts
    ↓
src/RootApp.vue
    ↓
src/App.vue
```

职责：

- `Main.ts`：安装运行时、全局错误处理、Safe Startup 等应用级能力。
- `RootApp.vue`：初始化本机凭据服务、首次说明、主题和主应用异步加载。
- `App.vue`：资源库主界面和主要业务页面。

Public 版启动不经过账号 session 或 access-policy gate。

## 3. 功能桌面

功能注册真源：

```text
src/core/FeatureAppRegistry.ts
```

当前注册的内置功能包括：

- 抽了么
- 外观
- 收藏柜
- 云备份
- 酒馆互传
- 缝了么
- 前端了么
- AI 生图
- 生图相册
- 用户人设
- 配了么
- 扩展

页面挂载：

```text
FeatureHub.vue
    ↕
UseFeatureHub.ts
    ↓
各功能 APP
```

`FeatureHub.vue` 负责根据 `activePage` 挂载对应组件；`UseFeatureHub.ts` 负责桌面分页、收藏、最近使用、页面切换和恢复状态。

## 4. 核心服务组装

主要依赖组装文件：

```text
src/core/AppContainer.ts
```

当前这里创建或连接的核心 Owner 包括：

- ResourceService
- CategoryService
- BrowserStorageService
- CloudBackupService
- ExportService / RestoreService
- HistoryService
- RecycleBinService
- MainApiService
- ExternalAppService
- UserPersonaService
- CharacterDrawService
- AiTaggingService

因此，当你想确认“某个全局服务到底用了哪个 storage / parser / dependency”时，应先看 `AppContainer.ts`，不要仅凭类名推测。

Frontend Workshop 有独立的服务组装：

```text
src/core/FrontendWorkshopContainer.ts
```

## 5. 资源导入与本地存储

资源导入的大致链路：

```text
File
 ↓
ResourceService
 ↓
ImportPipeline
 ↓
ResourceParserRegistry
 ├─ PersonalResourceParser
 ├─ PngResourceParser
 ├─ JsonResourceParser
 └─ TextBeautificationParser
 ↓
ResourceStorage
 ↓
IndexedDB
```

`ResourceParserRegistry` 的当前实际注册列表在 `AppContainer.ts`。

Web 端主要资源存储：

- `src/storage/IndexedDbResourceStorage.ts`
- `src/storage/IndexedDbCategoryStorage.ts`
- `src/storage/IndexedDbArchiveStorage.ts`
- `src/storage/IndexedDbExternalAppStorage.ts`
- `src/storage/IndexedDbGeneratedImageAlbumStorage.ts`

数据库实例：

- `src/core/AppDatabaseInstance.ts`
- `src/database/`

资源主存储外层还存在 `NativeMirroredResourceStorage`，用于兼容原生运行环境的资源镜像能力。

## 6. UI、Composable、Service 的边界

项目普遍采用下面的分层：

```text
Vue Component
    ↓
Composable
    ↓
Service
    ↓
Storage / Parser / External API
```

但这不是硬性规定。

例如 `ResourceBundleApp.vue` 本身就直接管理一部分本地套装状态；因此修改前应先查看该组件实际 imports，而不是假定每个页面一定有一一对应的 Service。

## 7. GitHub 云备份

当前 Public 版只有 GitHub Provider。

```text
CloudBackupCenter
 ↓
UseCloudBackupCenter
 ↓
CloudBackupService
 ↓
CloudBackupTransport
 ↓
CloudBackupGitHubTransport
 ↓
GitHub API
```

配置和凭据由：

- `CloudBackupConfiguration.ts`
- `CloudCredentialStore.ts`

负责。

备份内容本身会复用资源导出、结构化快照和恢复相关服务。

## 8. 外部 AI 与生图

主文本 AI 配置：

- `src/services/MainApiService.ts`

图像生成：

```text
ImageGenerationApp
 ↓
UseImageGenerationApp
 ↓
ImageGenerationContainer
 ↓
FrontendWorkshopImageGenerationService
 ├─ OpenAiImageRequest
 └─ NovelAiImageRequest / NovelAiImageResponse
```

Provider 只有 GPT / OpenAI 与 NovelAI。两者都允许用户编辑 Endpoint、API Key 和模型，并可恢复对应的官方默认地址；OpenAI Provider 也可使用 OpenAI-compatible Endpoint，能力按当前 Endpoint 与模型证据决定。

API Key 等凭据由本机凭据存储体系保存，不应为了方便改成普通 localStorage 明文。

## 9. 图片相册与自建图床

本地相册：

```text
GeneratedImageAlbumApp
 ↓
GeneratedImageAlbumService
 ↓
IndexedDbGeneratedImageAlbumStorage
```

自建图床：

```text
FrontendWorkshopImageHostingService
 ↓
SelfHostedImageTransport
 ↓
用户自己的 ImgBed
```

Public 版不包含作者共享图床上传通道。

## 10. 酒馆互传

互传有两类主要路径：

```text
A. 页面扩展 / 窗口通信
B. 用户自己运行的本机酒馆插件
```

主要 Owner：

- `TavernBridgeService.ts`
- `TavernConnectionStore.ts`
- `TavernBridgeProtocol.ts`
- `TavernHttpRelayPort.ts`
- `LanDirectService.ts`

本机直传固定信任边界为 `http://127.0.0.1:8000`，对应 SillyTavern 服务端插件。

Public 版不通过作者服务器建立 `/api/bridge/join` 会话。

## 11. Frontend Workshop

当前“前端了么”不是旧状态栏生成器，而是 Source / Workbench 架构。

入口：

```text
FrontendWorkshopApp
 ↓
FrontendWorkshopSourceAiShell
 ↓
FrontendWorkshopSourceSession
 ↓
FrontendWorkshopWorkbench
```

Source 体系围绕：

- Source Document
- Source Runtime
- Source Preview
- Source History
- Source Component
- Source AI

展开。

服务实例集中在 `FrontendWorkshopContainer.ts`；项目、Source Document 和 Source Component 分别有自己的 IndexedDB storage。

## 12. 第三方 APP

第三方 APP 由以下部分组成：

```text
ExternalAppManager
 ↓
ExternalAppService
 ├─ ExternalAppPackage
 └─ ExternalAppRuntime
 ↓
IndexedDbExternalAppStorage
```

`ExternalAppRuntime.ts` 负责把 APP 包中的 HTML/CSS/资源转换成可运行文档，并建立 Runtime Bridge。

第三方 APP 的权限和运行模式属于安全边界，修改时需要同时检查相关测试。

## 13. HTML / JavaScript 安全边界

角色卡 / HTML 预览：

- `src/components/RichContentPreview.vue`
- `src/utils/RichContentPreview.ts`

当前外层 iframe 的脚本模式使用：

```text
sandbox="allow-scripts"
```

不会额外授予 `allow-same-origin`。

Frontend Workshop Source Runtime：

- `src/utils/FrontendWorkshopSourceRuntime.ts`

第三方 APP Runtime：

- `src/services/ExternalAppRuntime.ts`

这三套运行环境虽然都涉及 HTML/JavaScript，但职责不同，不应为了复用而直接合并安全边界。

## 14. 设置与凭据

一般设备设置和界面偏好主要由：

- `BrowserStorageService.ts`
- `SettingsRegistry.ts`

管理。

敏感凭据则使用本机凭据存储服务，例如：

- `LocalCredentialStore.ts`
- `CloudCredentialStore.ts`

不要把 Token / API Key 放进普通可导出的偏好设置。

## 15. PWA 与离线

PWA 配置和 Workbox 策略位于：

- `vite.config.ts`

离线资源和 Service Worker 更新相关：

- `src/core/OfflineResources.ts`
- `src/core/ServiceWorkerUpdate.ts`
- `src/core/ServiceWorkerUpdateChecks.ts`
- `public/sw-share-target.js`

## 16. Public 版边界

Public 版通过：

```text
src/core/PublicReleaseGuard.test.ts
```

防止部分正式站专属代码重新进入运行时。

修改 Public 版架构或从其他仓库同步代码后，应确保该测试仍然通过。

## 17. 测试

项目大量采用测试共置：

```text
Foo.ts
Foo.test.ts
```

或：

```text
Foo.vue
Foo.test.ts
```

这些测试不会因为位于 `src/` 就自动进入生产 bundle；它们由 Vitest 执行。

提交前建议运行：

```bash
pnpm check
```
