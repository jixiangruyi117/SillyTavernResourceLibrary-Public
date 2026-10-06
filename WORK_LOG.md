# Public 工作记录

## 2026-10-06：同步主库 0.0.156 共享功能

- 目标：将主库已提交的非账号共享功能同步到 Public，使网页、APP 和原生 APK 继续跟进主库，同时保留 Public 自部署边界。
- 改动：同步 Discord 收件箱自动关联、分类清理、教程放大与 Fork 更新说明；同步 JSON/PNG 封装偏好、导入/备份/本地存储、原生后台导入与延迟恢复；同步非账号类 APP 管理入口和懒加载样式。保留免登录与 Public Worker 配置，排除资源广场、账号/作者托管功能。移除同步过程中误带入的资源广场 APK 导入代码；主库自有域名和图床地址恢复为示例占位符。Public 版本更新至 0.0.156。
- 保留差异：`NativeDiscordInboxService` 的联合类型安全字段构造继续使用 Public 已标记实现；应用身份、用户自填通用 Worker 与 Discord 独立 Worker 设置保持 Public 配置。
- 验证：`pnpm run build` 通过，生成 `srl-public-0.0.156-v8`，官方 APP 包校验通过（9 个当前包、51 个保留包、9 个可选资源）；`android/gradlew.bat :app:compileDebugJavaWithJavac` 通过。未运行测试。
- 隐私审计：增量基线 `1390334f68144d047b9fdbd6ab97e5f10c0e6f4a`；提交后扫描 `findings=[]`、`binaryReview=[]`。人工核对教程中的地址均为 Discord/Cloudflare/GitHub 官方链接、用户公开 Fork 仓库或示例占位符；私人邮箱、域名和服务地址未进入提交。同步提交已创建，待推送。
- 未决：用户 fork 及 Cloudflare 部署未修改；须用户同步 Fork 并由 Cloudflare 重新部署后才会获得本次版本。

## 2026-10-06：同步至 0.0.152

- 目标：让 Public 的共享网页与 Android 源码跟上主库 0.0.152，保留免登录和自部署边界。
- 改动：同步原生资源导入、资源存储、Discord 收件箱、工作台和导入流程；移除未被主库采用的资源广场来源字段及旧自动绑定实现。保留并标记 Public Worker 地址设置和部署教程；版本号更新至 0.0.152。
- 公共差异：登录/账号及资源广场相关实现继续排除；Worker 地址由使用者填写。保留一处经标记的 TypeScript 兼容实现：通知回传按资源/帖子分支构造安全字段对象，避免联合类型推断失败，也不传递 secret；其他 1398 个共享源码文件与主库归一化后相同。原生索引测试源码与主库一致，仅添加局部 ESLint 例外注释。
- 验证：全量源码归一化审计 1398 个文件一致，1 个已标记的类型兼容差异；全量测试 478 个文件/3780 项通过，2 项跳过；最终兼容实现的相关 2 个测试文件/14 项通过；网页及 APP 资源构建通过，9 个当前包、51 个保留包和 17 个可选资源通过检查；相关文件 lint 通过；改动文件格式检查通过。
- 公开增量隐私检查：基线 `3fdaed9c375c9fb988b50245d95a8571a07bb7c9`；凭据扫描无命中、无新增二进制。新增地址逐项复核为示例域名、GitHub fork 地址或官方文档链接。
- 发布：提交 `5f4d89974550d2078755f6f2fc7eb4d5375aca8f` 已快进推送至 Public 远端 `main`。
- 未决：Android Gradle 构建未运行，本机没有 JAVA_HOME 或可用的 java 命令；未进行 APK 真机验收。

## 2026-10-06：修复线上前端工作台旧包识别

- 现象与根因：线上 Public 首页已是 `srl-public-0.0.152-v8`，但工作台目录仍标记内容修订 4；主库对应修订为 5。APP 更新器按内容修订判断，因而可能把本机修订 4 的旧工作台继续视为最新。此前同步审计的路径过滤误把 `OfficialAppContentRevision.ts` 排除在检查范围外。
- 改动：将 Public 工作台、图像生成、用户 Persona 的内容修订号分别更新为主库的 5、3、5；账号/助手/资源广场专属项仍按 Public 边界排除。
- 验证：生产构建通过；生成的 `frontendWorkshop` 包修订号为 5；官方 APP 包校验为 9 个当前包、51 个保留包、17 个可选资源。
- 补充审计：先前按文件名排除 `OfficialApp` 的同步审计漏掉了这个共享修订配置。将非登录/非资源广场 APP 的修订号逐项与主库核对后，Public 与主库一致；其余差异仅为账号/助手/资源广场移除及已标记的通知类型兼容实现。
- 发布与部署：提交 `1239846fce2f1a50df1b701ca98f1afab86ab5b0` 已推送到 Public 主仓库 `main`。按用户要求未修改其个人 fork；用户给出的线上地址仍由该 fork 部署，需其同步 fork 并等待 Cloudflare 重部署后才会提供修订 5。

## 2026-10-06：修复网页版前端工作台加载旧入口

- 纠正前次判断：Public Worker 实际返回的 JS 与 Public 当时的源码构建一致，但此前只比较了 `FrontendWorkshopApp.vue`，没有核对主库官方 APP 的真实入口。主库 `OfficialAppPackages.ts` 将 `frontendWorkshop` 指向 `FrontendWorkshopSourceAiShell.vue`；Public 为免登录而绕过 `OfficialAppGate` 时，错误地直接载入旧的 `FrontendWorkshopApp.vue`，所以提高内容修订号并不能更新网页版实际显示的界面。
- 改动：Public 保留免登录直载方式，将 `frontendWorkshop` 入口改为 `FrontendWorkshopSourceAiShell.vue`；Public 版本推进至 `0.0.154`。不引入主库需要账号会话的共享图床/组件分享功能，也保留 Public 示例图片地址占位符，未复制主库的自有图床域名。
- 验证：`pnpm run build` 通过，生成 `srl-public-0.0.154-v8` 与前端工作台资源包；未运行测试。线上 Worker 尚未更新，需个人 fork 同步 Public 主库提交并等待 Cloudflare 构建部署。
- 公开增量隐私审计：基线 `1239846fce2f1a50df1b701ca98f1afab86ab5b0`；本次差异未发现个人邮箱、私人域名/服务地址或新增二进制。主库模板中的自有图床地址未复制，Public 示例仍是占位符。
- 未决：提交前仍需复核本次 author/committer 邮箱及远端推送；当前 Main 工作树中与本次无关的未提交改动保持未触碰。
