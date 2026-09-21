# 二次开发导航

> [!NOTE]
> 本文档由 AI 辅助整理，并按当前仓库源码逐项核对。它的作用是帮助定位代码，不替代源码本身。
>
> 如果本文档与当前代码不一致，请以代码为准。内置功能名称以 `src/core/FeatureAppRegistry.ts` 为准，核心服务组装以 `src/core/AppContainer.ts` 为准。

## 先理解目录职责

通常可以按下面的顺序定位一个功能：

```text
components/   页面和 Vue 组件
    ↓
composables/  页面状态、交互和事件编排
    ↓
services/     业务逻辑、外部 API、导入导出
    ↓
parser/       文件格式识别与解析
storage/      IndexedDB / 本地数据持久化
```

其他常用目录：

- `src/core/`：全局容器、功能注册、运行时基础设施。
- `src/utils/`：独立算法、兼容、转换、安全和渲染辅助。
- `src/types/`：TypeScript 数据结构。
- `src/workers/`：浏览器 Web Worker，不是 Cloudflare Worker。
- `src/styles/`：各功能页面样式。
- 与业务文件并列的 `*.test.ts` / `*.spec.ts`：对应模块测试。

## 几个重要真源

修改较大的功能前，优先确认这些文件：

| 作用                                | 当前文件                                |
| ----------------------------------- | --------------------------------------- |
| 内置功能名称、ID、说明与排序        | `src/core/FeatureAppRegistry.ts`        |
| 功能桌面与页面挂载                  | `src/components/FeatureHub.vue`         |
| 功能桌面的状态和导航                | `src/composables/UseFeatureHub.ts`      |
| 资源、分类、备份、AI 等核心服务实例 | `src/core/AppContainer.ts`              |
| Frontend Workshop 服务实例          | `src/core/FrontendWorkshopContainer.ts` |
| 应用数据库实例                      | `src/core/AppDatabaseInstance.ts`       |
| Public 版边界回归检查               | `src/core/PublicReleaseGuard.test.ts`   |

## 功能定位

### 资源导入、解析与保存

主要链路：

```text
ResourceService.ts
    ↓
ImportPipeline.ts
    ↓
ResourceParserRegistry
    ↓
PersonalResourceParser / PngResourceParser / JsonResourceParser / TextBeautificationParser
    ↓
ResourceStorage
```

从这里开始看：

- `src/services/ResourceService.ts`：资源导入、更新、版本、关联等主要业务入口。
- `src/services/ImportPipeline.ts`：单个导入文件的共享处理上下文和阶段。
- `src/core/AppContainer.ts`：当前 Parser Registry 的实际注册位置。
- `src/parser/PngResourceParser.ts`：PNG 资源解析。
- `src/parser/JsonResourceParser.ts`：JSON 资源解析。
- `src/parser/PersonalResourceParser.ts`：个人资源解析。
- `src/parser/TextBeautificationParser.ts`：文本美化资源解析。
- `src/storage/IndexedDbResourceStorage.ts`：Web 端资源 IndexedDB 存储。
- `src/storage/NativeMirroredResourceStorage.ts`：对资源存储的原生镜像包装层。

GitHub 链接导入相关逻辑还可继续查看：

- `src/services/ResourceLinkImport.ts`
- `src/services/GitHubResourceInspector.ts`

### 分类、文件夹与收藏柜

```text
FolderLibraryView.vue
    ↓
UseFolderLibraryView.ts
    ↓
分类/资源事件 + 本地收藏柜布局
```

主要文件：

- `src/components/FolderLibraryView.vue`：文件夹与收藏柜 UI。
- `src/composables/UseFolderLibraryView.ts`：筛选、分页、拖放、缩略图和整理状态。
- `src/services/CategoryService.ts`：分类创建、修改、排序等业务。
- `src/services/BrowserStorageService.ts`：收藏柜布局及部分设备偏好。
- `src/services/CabinetLayout.ts`：收藏柜布局结构相关逻辑。

### GitHub 云备份

```text
CloudBackupCenter.vue
    ↓
UseCloudBackupCenter.ts
    ↓
cloudBackupService（AppContainer）
    ↓
CloudBackupService.ts
    ↓
CloudBackupGitHubTransport.ts
    ↓
GitHub API
```

主要文件：

- `src/components/CloudBackupCenter.vue`：云备份页面。
- `src/composables/UseCloudBackupCenter.ts`：页面状态、连接测试、备份列表与操作。
- `src/services/CloudBackupService.ts`：备份/恢复主业务。
- `src/services/CloudBackupGitHubTransport.ts`：GitHub Release/Asset 传输。
- `src/services/CloudBackupConfiguration.ts`：GitHub 备份配置和凭据状态。
- `src/services/CloudBackupHttp.ts`：GitHub 网络错误和请求辅助。
- `src/services/CloudCredentialStore.ts`：云备份凭据存储。

Public 版当前只保留 GitHub Provider。

### 酒馆互传

```text
TavernBridgeCenter.vue
    ↓
UseTavernBridgeCenter.ts
    ↓
TavernConnectionStore / TavernBridgeService
    ↓
窗口通信或本机酒馆插件
```

主要文件：

- `src/components/TavernBridgeCenter.vue`：互传页面。
- `src/composables/UseTavernBridgeCenter.ts`：筛选、同步差异、冲突策略和传输队列。
- `src/core/TavernConnectionStore.ts`：连接状态对页面的封装。
- `src/services/TavernBridgeService.ts`：互传会话和文件传输。
- `src/services/TavernBridgeProtocol.ts`：消息协议。
- `src/services/TavernHttpRelayPort.ts`：酒馆提供的 HTTP relay port。
- `src/services/LanDirectService.ts`：`127.0.0.1:8000` 本机直传。
- `src/utils/TavernBridgeDiff.ts` / `src/utils/TavernSyncPlan.ts`：两端差异和同步计划。

Public 版不使用作者服务器的桥接会话接口。

### 前端了么 / Frontend Workshop

当前入口链：

```text
FrontendWorkshopApp.vue
    ↓
FrontendWorkshopSourceAiShell.vue
    ↓
FrontendWorkshopSourceSession.vue
    ↓
FrontendWorkshopWorkbench.vue
    ├─ FrontendWorkshopSourceWorkspace
    ├─ FrontendWorkshopSourceEditor
    ├─ FrontendWorkshopSourcePreview
    ├─ FrontendWorkshopSourceHistoryPanel
    └─ FrontendWorkshopSourceComponentLibrary
```

主要文件：

- `src/components/FrontendWorkshopApp.vue`：当前功能入口薄壳。
- `src/components/FrontendWorkshopSourceAiShell.vue`：Source、Source AI 和源码编辑页面的总壳。
- `src/components/FrontendWorkshopSourceSession.vue`：Source 文档、预览、历史、选区、组件库的会话层。
- `src/components/FrontendWorkshopWorkbench.vue`：可视化工作台。
- `src/composables/UseFrontendWorkshopWorkbench.ts`：工作台主要状态和操作。
- `src/components/FrontendWorkshopSourceWorkspace.vue`：Source 运行画布。
- `src/components/FrontendWorkshopSourceEditor.vue`：源码编辑。
- `src/components/FrontendWorkshopSourcePreview.vue`：Source 运行预览。
- `src/components/FrontendWorkshopSourceAiWorkspace.vue`：Source AI 工作区。
- `src/core/FrontendWorkshopContainer.ts`：Source 文档、历史、组件、AI 等服务实例。
- `src/storage/IndexedDbFrontendWorkshopProjectStorage.ts`
- `src/storage/IndexedDbFrontendWorkshopSourceDocumentStorage.ts`
- `src/storage/IndexedDbFrontendWorkshopSourceComponentStorage.ts`

### AI 生图

```text
ImageGenerationApp.vue
    ↓
UseImageGenerationApp.ts
    ↓
ImageGenerationContainer
    ↓
FrontendWorkshopImageGenerationService.ts
```

主要文件：

- `src/components/ImageGenerationApp.vue`：生图页面。
- `src/composables/UseImageGenerationApp.ts`：Provider、参数、结果、本地相册、图床等页面状态。
- `src/core/ImageGenerationContainer.ts`：生图服务实例。
- `src/services/FrontendWorkshopImageGenerationService.ts`：GPT / OpenAI 与 NovelAI 生图业务；OpenAI Provider 同时支持 OpenAI-compatible Endpoint、模型探测和能力证据。
- `src/services/OpenAiImageRequest.ts`：OpenAI 请求构建。
- `src/services/NovelAiImageRequest.ts` / `NovelAiImageResponse.ts`：NovelAI 请求与响应处理。

### 生图相册与自建图床

```text
GeneratedImageAlbumApp.vue
    ↓
GeneratedImageAlbumService.ts
    ↓
GeneratedImageAlbumStorage

上传直链：
FrontendWorkshopImageHostingService.ts
    ↓
SelfHostedImageTransport.ts
    ↓
用户自建 ImgBed
```

主要文件：

- `src/components/GeneratedImageAlbumApp.vue`
- `src/services/GeneratedImageAlbumService.ts`
- `src/storage/IndexedDbGeneratedImageAlbumStorage.ts`
- `src/services/FrontendWorkshopImageHostingService.ts`
- `src/core/SelfHostedImageTransport.ts`

### 第三方 APP

```text
ExternalAppManager.vue
    ↓
ExternalAppService.ts
    ↓
ExternalAppPackage / ExternalAppRuntime
    ↓
IndexedDbExternalAppStorage
```

主要文件：

- `src/components/ExternalAppManager.vue`：导入、检查、安装、权限和管理。
- `src/components/ExternalAppHost.vue`：已安装 APP 的宿主页面。
- `src/services/ExternalAppService.ts`：APP 安装、更新、权限和本地数据。
- `src/services/ExternalAppPackage.ts`：包格式处理。
- `src/services/ExternalAppRuntime.ts`：运行文档和 Runtime Bridge。
- `src/storage/IndexedDbExternalAppStorage.ts`：已安装 APP 及 APP 数据。

### 外观与自定义 CSS

主要入口：

- `src/components/AppearanceStudio.vue`
- `src/services/BrowserStorageService.ts`
- `src/core/AppearanceScopes.ts`
- `src/core/AppearanceSafety.ts`

`src/services/AppearanceScopeService.ts` 当前主要负责清理某个内置 APP 对应的局部外观，不是外观编辑页面的主业务入口。

### 抽了么

从这里开始：

- `src/components/DrawApp.vue`
- `src/services/CharacterDrawService.ts`
- `src/core/AppContainer.ts` 中的 `characterDrawService`

### 缝了么

从这里开始：

- `src/components/PresetStitcherApp.vue`
- `src/composables/UsePresetStitcherApp.ts`
- `src/services/BrowserStorageService.ts` 中的 stitch 工作区持久化。

### 用户人设

从这里开始：

- `src/components/UserPersonaApp.vue`
- `src/composables/UseUserPersonaApp.ts`
- `src/services/UserPersonaService.ts`
- `src/core/AppContainer.ts` 中的 `userPersonaService`

### 配了么 / 资源套装

从这里开始：

- `src/components/ResourceBundleApp.vue`
- `src/services/BrowserStorageService.ts` 中的 Chat Loadout / Resource Bundle 本地数据。
- `src/components/FeatureHub.vue`：套装可直接把资源 ID 交给酒馆互传页。

### HTML / JavaScript 预览安全

如果要改角色卡或 HTML 预览行为，优先检查：

- `src/components/RichContentPreview.vue`：iframe 宿主。
- `src/utils/RichContentPreview.ts`：预览文档生成、兼容与安全处理。
- `src/core/SettingsRegistry.ts`：远程资源和脚本开关的默认设置。
- `src/utils/FrontendWorkshopSourceRuntime.ts`：Frontend Workshop Source Runtime。
- `src/services/ExternalAppRuntime.ts`：第三方 APP Runtime。

当前 `RichContentPreview.vue` 的脚本 iframe 使用 `sandbox="allow-scripts"`，不授予 `allow-same-origin`。

### PWA、离线与更新

从这里开始：

- `vite.config.ts`：Vite PWA、Workbox 和离线资源清单。
- `src/core/OfflineResources.ts`：完整离线资源管理。
- `src/core/ServiceWorkerUpdate.ts`
- `src/core/ServiceWorkerUpdateChecks.ts`
- `public/sw-share-target.js`：Web Share Target 接收。

## 修改一个功能时的建议顺序

例如修“云备份按钮点了没反应”：

1. 看 `CloudBackupCenter.vue` 是否正确绑定事件。
2. 看 `UseCloudBackupCenter.ts` 是否进入对应 action。
3. 看 `CloudBackupService.ts` 是否进入业务逻辑。
4. 如果是 GitHub 请求问题，再进入 `CloudBackupGitHubTransport.ts` / `CloudBackupHttp.ts`。
5. 同时运行相邻的 `*.test.ts`。

不要一上来直接修改最底层 transport，也不要只改 UI 隐藏错误。

## 新增或改动内置功能

内置功能桌面的真源是 `src/core/FeatureAppRegistry.ts`。

但一个功能的可见入口还涉及：

- `src/components/FeatureHub.vue`
- `src/composables/UseFeatureHub.ts`
- `src/core/FeatureAppLoaders.ts`
- 对应页面组件和数据 Owner

因此不要只在 Registry 中加一项就认为功能接入完成。

## 测试与提交前检查

测试文件大多与业务代码共置。

修改后至少执行：

```bash
pnpm format:check
pnpm lint
pnpm test
pnpm build
```

也可以：

```bash
pnpm check
```

Public 版还必须保持 `src/core/PublicReleaseGuard.test.ts` 通过。
