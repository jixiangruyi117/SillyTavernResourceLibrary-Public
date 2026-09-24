package buzz.jixiangruyi1207.srl.nativeapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeCategory
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeSnapshot
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeBackupSelection
import buzz.jixiangruyi1207.srl.nativeapp.cloud.NativeCloudBackup
import buzz.jixiangruyi1207.srl.nativeapp.cloud.NativeCredentialState
import buzz.jixiangruyi1207.srl.nativeapp.cloud.NativeGitHubConfig
import buzz.jixiangruyi1207.srl.nativeapp.cloud.NativeWebDavConfig
import buzz.jixiangruyi1207.srl.nativeapp.tavern.NativeTavernBridgeState
import buzz.jixiangruyi1207.srl.nativeapp.tavern.NativeTavernResourceItem
import buzz.jixiangruyi1207.srl.nativeapp.persona.NativePersonaBackup
import buzz.jixiangruyi1207.srl.nativeapp.persona.NativePersonaEntry
import buzz.jixiangruyi1207.srl.nativeapp.preset.NativePresetSegment
import buzz.jixiangruyi1207.srl.nativeapp.preset.NativeStitchRequest
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResourceBundle
import buzz.jixiangruyi1207.srl.nativeapp.draw.NativeDrawOptions
import buzz.jixiangruyi1207.srl.nativeapp.draw.NativeDrawState
import buzz.jixiangruyi1207.srl.nativeapp.appearance.NativeAppearanceState
import buzz.jixiangruyi1207.srl.nativeapp.cabinet.NativeCabinetState
import buzz.jixiangruyi1207.srl.nativeapp.extensions.NativeExternalPackage
import buzz.jixiangruyi1207.srl.nativeapp.tagging.NativeAiConfig
import buzz.jixiangruyi1207.srl.nativeapp.tagging.NativeAiDraft
import buzz.jixiangruyi1207.srl.nativeapp.tagging.NativeAiReviewItem
import buzz.jixiangruyi1207.srl.nativeapp.tagging.NativeAiState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeSrlApp(
    resources: List<NativeResource>,
    categories: List<NativeCategory>,
    versions: List<NativeResource>,
    snapshots: List<NativeSnapshot>,
    cloudBackups: List<NativeCloudBackup>,
    githubConfig: NativeGitHubConfig?,
    webDavConfig: NativeWebDavConfig?,
    githubCredentialState: NativeCredentialState,
    webDavCredentialState: NativeCredentialState,
    tavernBridgeState: NativeTavernBridgeState,
    tavernResources: List<NativeTavernResourceItem>,
    personaBackup: NativePersonaBackup?,
    presetSegments: Map<String, List<NativePresetSegment>>,
    resourceBundles: List<NativeResourceBundle>,
    workshopOutputIds: List<String>,
    drawState: NativeDrawState,
    drawResultIds: List<String>,
    appearanceState: NativeAppearanceState,
    cabinetState: NativeCabinetState,
    externalPackages: List<NativeExternalPackage>,
    aiTaggingState: NativeAiState,
    busy: Boolean,
    message: String,
    storagePath: String,
    onImport: () -> Unit,
    onExport: (NativeBackupSelection) -> Unit,
    onToggleFavorite: (String) -> Unit,
    onUpdateResourceDetails: (String, String, String, List<String>) -> Unit,
    onCreateCategory: (String, String) -> Unit,
    onUpdateCategory: (NativeCategory, String, String, Boolean) -> Unit,
    onDeleteCategory: (NativeCategory) -> Unit,
    onSetResourceCategories: (String, List<String>) -> Unit,
    onDeleteResource: (String) -> Unit,
    onActivateVersion: (String, String) -> Unit,
    onUpdateVersionNote: (String, String, String) -> Unit,
    onDeleteVersion: (String, String) -> Unit,
    onCaptureSnapshot: (String) -> Unit,
    onRestoreSnapshot: (String) -> Unit,
    onDeleteSnapshot: (String) -> Unit,
    onSaveGitHub: (NativeGitHubConfig, String) -> Unit,
    onSaveWebDav: (NativeWebDavConfig, String) -> Unit,
    onTestCloud: (String) -> Unit,
    onRefreshCloud: (String) -> Unit,
    onCreateCloudBackup: (String, NativeBackupSelection) -> Unit,
    onRestoreCloudBackup: (NativeCloudBackup, Boolean) -> Unit,
    onDeleteCloudBackup: (NativeCloudBackup) -> Unit,
    onJoinTavernBridge: (String) -> Unit,
    onAcceptTavernBridge: () -> Unit,
    onRefreshTavernResources: () -> Unit,
    onPullTavernResources: (List<String>) -> Unit,
    onSendTavernResources: (List<String>, String) -> Unit,
    onDisconnectTavernBridge: () -> Unit,
    onLoadPersona: (String) -> Unit,
    onCreatePersona: (NativePersonaEntry) -> Unit,
    onSavePersona: (String, String?, NativePersonaEntry) -> Unit,
    onDuplicatePersona: (String, String, String) -> Unit,
    onDeletePersonaEntry: (String, String) -> Unit,
    onSetDefaultPersona: (String, String) -> Unit,
    onExportPersona: (String, String) -> Unit,
    onLoadPresetSegments: (String) -> Unit,
    onGenerateStitchedPreset: (NativeStitchRequest) -> Unit,
    onSaveResourceBundle: (NativeResourceBundle) -> Unit,
    onDeleteResourceBundle: (String) -> Unit,
    onCompileWorkshop: (String, String, String, String) -> Unit,
    onDrawCharacters: (NativeDrawOptions) -> Unit,
    onClearDrawHistory: () -> Unit,
    onSaveAppearance: (String, String, Boolean, Int) -> Unit,
    onSaveCabinet: (List<String>) -> Unit,
    onRegisterExternalPackage: (String) -> Unit,
    onUnregisterExternalPackage: (String) -> Unit,
    onSaveAiConfig: (NativeAiConfig, String) -> Unit,
    onClearAiApiKey: () -> Unit,
    onRunAiTagging: (List<String>, Int, String, String, Boolean, Boolean) -> Unit,
    onSaveAiDraft: (NativeAiDraft) -> Unit,
    onApplyAiTags: (List<NativeAiReviewItem>) -> Unit,
    onUndoAiTags: () -> Unit,
    onClearAiDraft: () -> Unit,
) {
    nativeDarkPalette = appearanceState.theme == "dark"
    var page by remember { mutableIntStateOf(0) }
    var featureRoute by remember { mutableIntStateOf(0) }
    var importChooserOpen by remember { mutableStateOf(false) }
    var libraryFiltersOpen by remember { mutableStateOf(false) }
    var aiTaggingInitialIds by remember { mutableStateOf<List<String>>(emptyList()) }
    val nativeColorScheme = if (nativeDarkPalette) darkColorScheme(
        primary = teal,
        onPrimary = Color(0xFF082125),
        primaryContainer = paleTeal,
        onPrimaryContainer = ink,
        secondary = teal,
        onSecondary = Color(0xFF082125),
        secondaryContainer = paleTeal,
        onSecondaryContainer = ink,
        background = cream,
        onBackground = ink,
        surface = raised,
        onSurface = ink,
        surfaceVariant = paleTeal,
        onSurfaceVariant = inkSoft,
        outline = Color(0xFF75A7AE),
        outlineVariant = Color(0xFF466D73),
        error = Color(0xFFFFB2BB),
    ) else lightColorScheme(
            primary = teal,
            onPrimary = Color.White,
            primaryContainer = paleTeal,
            onPrimaryContainer = ink,
            secondary = teal,
            onSecondary = Color.White,
            secondaryContainer = paleTeal,
            onSecondaryContainer = ink,
            tertiary = Color(0xFF4B728D),
            onTertiary = Color.White,
            background = cream,
            onBackground = ink,
            surface = cream,
            onSurface = ink,
            surfaceVariant = paleTeal,
            onSurfaceVariant = inkSoft,
            outline = Color(0xFF356A7A).copy(alpha = 0.42f),
            outlineVariant = Color(0xFF436F80).copy(alpha = 0.2f),
            error = Color(0xFFA8495A),
        )
    MaterialTheme(colorScheme = nativeColorScheme) {
        Box(
            modifier = Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    if (nativeDarkPalette) listOf(Color(0xFF0D2228), Color(0xFF102A32), Color(0xFF14272D))
                    else listOf(Color(0xFFEFFBFC), Color(0xFFEAF3FB), Color(0xFFF6FBFB)),
                ),
            ),
        ) {
            Scaffold(
                containerColor = Color.Transparent,
                topBar = {
                    NativeMobileHeader(
                        showFilter = page == 0,
                        filtersOpen = libraryFiltersOpen,
                        onToggleFilters = { libraryFiltersOpen = !libraryFiltersOpen },
                    )
                },
                bottomBar = {
                    NativeBottomNavigation(
                        page = page,
                        onPage = {
                            page = it
                            if (it == 1) featureRoute = 0
                        },
                        onOpenImport = { importChooserOpen = true },
                    )
                },
            ) { padding ->
                Column(modifier = Modifier.fillMaxSize().padding(padding)) {
                    if (busy || !message.endsWith("已就绪")) StatusBanner(busy, message)
                    when (page) {
                        0 -> ResourceLibrary(
                            resources, categories, versions, appearanceState.layoutMode, libraryFiltersOpen, onImport,
                            onOpenProtection = { page = 1; featureRoute = 2 },
                            onOpenAiTagging = { selectedIds -> aiTaggingInitialIds = selectedIds; page = 1; featureRoute = 12 },
                            onToggleFavorite, onUpdateResourceDetails, onCreateCategory, onUpdateCategory,
                            onDeleteCategory, onSetResourceCategories, onDeleteResource,
                            onActivateVersion, onUpdateVersionNote, onDeleteVersion,
                        )
                        1 -> when (featureRoute) {
                            1 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("云端备份", "差分上传、恢复与备份保留", onBack = { featureRoute = 0 })
                                TransferScreen(
                                    exportOnly = false, resources.size, busy, cloudBackups, githubConfig, webDavConfig,
                                    githubCredentialState, webDavCredentialState, onExport,
                                    onSaveGitHub, onSaveWebDav, onTestCloud, onRefreshCloud, onCreateCloudBackup,
                                    onRestoreCloudBackup, onDeleteCloudBackup,
                                )
                            }
                            2 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("本地保险库与历史", "完整快照、删除前保护和安全回退", onBack = { featureRoute = 0 })
                                DataProtectionScreen(snapshots, busy, onCaptureSnapshot, onRestoreSnapshot, onDeleteSnapshot)
                            }
                            3 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("酒馆互传", "设备码安全中继，双向收发资源", onBack = { featureRoute = 0 })
                                NativeTavernBridgeScreen(
                                    resources, tavernBridgeState, tavernResources, busy,
                                    onJoinTavernBridge, onAcceptTavernBridge, onRefreshTavernResources,
                                    onPullTavernResources, onSendTavernResources, onDisconnectTavernBridge,
                                )
                            }
                            4 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("user才是老大", "名字、设定与专属世界", onBack = { featureRoute = 0 })
                                NativeUserPersonaScreen(
                                    resources, personaBackup, busy, onImport, onLoadPersona, onCreatePersona,
                                    onSavePersona, onDuplicatePersona, onDeletePersonaEntry, onSetDefaultPersona, onExportPersona,
                                )
                            }
                            5 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("缝了么", "从多个预设挑段缝合", onBack = { featureRoute = 0 })
                                NativePresetStitchScreen(resources, presetSegments, busy, onLoadPresetSegments, onGenerateStitchedPreset)
                            }
                            6 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("配了么", "角色卡与配套资源装配", onBack = { featureRoute = 0 })
                                NativeResourceBundleScreen(
                                    resources, resourceBundles, tavernBridgeState.status == "connected", busy,
                                    onSaveResourceBundle, onDeleteResourceBundle,
                                    onSend = { ids -> onSendTavernResources(ids, "copy") },
                                )
                            }
                            7 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("前端了么", "状态栏正则与提示词", onBack = { featureRoute = 0 })
                                NativeFrontendWorkshopScreen(
                                    workshopOutputIds = workshopOutputIds,
                                    connectedToTavern = tavernBridgeState.status == "connected",
                                    busy = busy,
                                    onCompile = onCompileWorkshop,
                                    onSendToTavern = { onSendTavernResources(workshopOutputIds, "copy") },
                                )
                            }
                            8 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("抽了么", "从角色档案中随机相遇", onBack = { featureRoute = 0 })
                                NativeCharacterDrawScreen(
                                    resources = resources,
                                    categories = categories,
                                    state = drawState,
                                    resultIds = drawResultIds,
                                    busy = busy,
                                    onDraw = onDrawCharacters,
                                    onClear = onClearDrawHistory,
                                )
                            }
                            9 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("外观", "主题、排版与兼容配置", onBack = { featureRoute = 0 })
                                NativeAppearanceScreen(appearanceState, busy, onSaveAppearance)
                            }
                            10 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("收藏柜", "可视化文件夹与桌面整理", onBack = { featureRoute = 0 })
                                NativeCabinetScreen(resources, categories, cabinetState, busy, onSaveCabinet)
                            }
                            11 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("扩展", "导入、审计与管理第三方 APP 包", onBack = { featureRoute = 0 })
                                NativeExternalPackageScreen(
                                    resources, externalPackages, busy, onImport,
                                    onRegisterExternalPackage, onUnregisterExternalPackage,
                                )
                            }
                            12 -> Column(Modifier.fillMaxSize()) {
                                FeaturePageHeader("AI 标签实验台", "生成草稿、人工确认、精确撤销", onBack = { featureRoute = 0 })
                                NativeAiTaggingScreen(
                                    resources, categories, aiTaggingState, aiTaggingInitialIds, busy, message, onSaveAiConfig, onClearAiApiKey,
                                    onRunAiTagging, onSaveAiDraft, onApplyAiTags, onUndoAiTags, onClearAiDraft,
                                )
                            }
                            else -> NativeFeatureHub(
                                drawCount = drawState.totalDraws,
                                onOpenDraw = { featureRoute = 8 },
                                onOpenAppearance = { featureRoute = 9 },
                                folderCount = categories.count { !it.hidden },
                                onOpenCabinet = { featureRoute = 10 },
                                externalPackageCount = externalPackages.size,
                                onOpenExtensions = { featureRoute = 11 },
                                onOpenTransfer = { featureRoute = 1 },
                                onOpenTavernBridge = { featureRoute = 3 },
                                onOpenPersona = { featureRoute = 4 },
                                onOpenStitch = { featureRoute = 5 },
                                onOpenBundle = { featureRoute = 6 },
                                onOpenWorkshop = { featureRoute = 7 },
                            )
                        }
                        3 -> TransferScreen(
                            exportOnly = true, resources.size, busy, cloudBackups, githubConfig, webDavConfig,
                            githubCredentialState, webDavCredentialState, onExport,
                            onSaveGitHub, onSaveWebDav, onTestCloud, onRefreshCloud, onCreateCloudBackup,
                            onRestoreCloudBackup, onDeleteCloudBackup,
                        )
                        4 -> SettingsScreen(resources.size, storagePath, snapshots.size, busy, { page = 1; featureRoute = 2 })
                        else -> SettingsScreen(resources.size, storagePath, snapshots.size, busy, { page = 1; featureRoute = 2 })
                    }
                }
            }
        }
    }
    if (importChooserOpen) {
        ModalBottomSheet(
            onDismissRequest = { importChooserOpen = false },
            containerColor = raised,
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, bottom = 30.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("资源 / 备份", fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.headlineSmall, color = ink)
                Text("选择要进入的原生流程", color = inkSoft)
                FeatureEntry("本地资源 / 备份", "从手机选择角色卡、JSON、CSS 或 SRL ZIP", "选择文件") {
                    importChooserOpen = false
                    onImport()
                }
                FeatureEntry("云端备份", "进入 GitHub 与 Koofr / WebDAV 差分备份", "打开") {
                    importChooserOpen = false
                    page = 1
                    featureRoute = 1
                }
            }
        }
    }
}
