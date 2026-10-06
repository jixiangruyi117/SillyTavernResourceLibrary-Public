package buzz.jixiangruyi1207.srl.nativeapp.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeCategory
import buzz.jixiangruyi1207.srl.nativeapp.model.resourceTypeLabels
import buzz.jixiangruyi1207.srl.nativeapp.extensions.NativeExternalPackage
import buzz.jixiangruyi1207.srl.nativeapp.tagging.NativeAiConfig
import buzz.jixiangruyi1207.srl.nativeapp.tagging.NativeAiDraft
import buzz.jixiangruyi1207.srl.nativeapp.tagging.NativeAiReviewItem
import buzz.jixiangruyi1207.srl.nativeapp.tagging.NativeAiState
import buzz.jixiangruyi1207.srl.nativeapp.tagging.NativeAiSuggestedTag

@Composable
internal fun NativeExternalPackageScreen(
    resources: List<NativeResource>,
    packages: List<NativeExternalPackage>,
    busy: Boolean,
    onImport: () -> Unit,
    onRegister: (String) -> Unit,
    onUnregister: (String) -> Unit,
) {
    var removing by remember { mutableStateOf<NativeExternalPackage?>(null) }
    val registeredResourceIds = packages.map(NativeExternalPackage::resourceId).toSet()
    val candidates = resources.filter { it.fileName.endsWith(".srlapp", true) && it.id !in registeredResourceIds }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            InfoCard(
                "原生安全边界",
                "扩展包会检查大小、ZIP 路径、文件数量、manifest、入口和权限等级。当前页面不会执行 HTML/JavaScript，不读凭据、不控制主程序、不偷偷上传、不静默改资源。",
            ) {
                Button(onClick = onImport, enabled = !busy, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("选择 .srlapp 安装包") }
            }
        }
        if (candidates.isNotEmpty()) {
            item { Text("待检查安装包", fontWeight = FontWeight.Bold, color = ink) }
            items(candidates, key = { "external-candidate-${it.id}" }) { resource ->
                InfoCard(resource.name, "${resource.fileName} · ${formatBytes(resource.fileSize)}") {
                    Button(onClick = { onRegister(resource.id) }, enabled = !busy, modifier = Modifier.fillMaxWidth().height(46.dp)) { Text("检查清单并登记") }
                }
            }
        }
        if (packages.isEmpty()) {
            item { InfoCard("还没有已审计扩展包", "导入 `.srlapp` 后先检查清单和权限。原安装包作为普通本机资源参与导出和云备份。") {} }
        } else {
            item { Text("已审计扩展包", fontWeight = FontWeight.Bold, color = ink) }
            items(packages, key = { it.id }) { app ->
                Card(colors = CardDefaults.cardColors(containerColor = raised.copy(alpha = 0.9f), contentColor = ink), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(app.name, fontWeight = FontWeight.Bold, color = ink)
                                Text("v${app.version}${if (app.author.isNotBlank()) " · ${app.author}" else ""}", color = inkSoft, style = MaterialTheme.typography.bodySmall)
                            }
                            Text(extensionLevelLabel(app.permissionLevel), color = teal, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                        }
                        Text(app.description.ifBlank { "作者未提供功能说明。" }, color = inkSoft)
                        Text(
                            if (app.permissions.isEmpty()) "不申请资源库、网络或文件权限" else app.permissions.joinToString(" · ") { extensionPermissionLabel(it) },
                            color = inkSoft,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text("已登记但未运行；启用第三方网页 APP 需要单独决定是否加入受限沙箱页。", color = teal, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { removing = app }, enabled = !busy, modifier = Modifier.align(Alignment.End)) { Text("移除登记") }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(20.dp)) }
    }
    removing?.let { app ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("移除扩展登记？") },
            text = { Text("只移除“${app.name}”的审计登记；原 `.srlapp` 资源文件和网页备份中的第三方 APP 数据都不会删除。") },
            confirmButton = { TextButton(onClick = { onUnregister(app.id); removing = null }) { Text("移除登记") } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("取消") } },
        )
    }
}

private fun extensionLevelLabel(level: String): String = when (level) {
    "selectedRead" -> "L1 已选资源"
    "resourceAssistant" -> "L2 资源助手"
    "fullControl" -> "L3 完整管理"
    else -> "L0 隔离工具"
}

private fun extensionPermissionLabel(permission: String): String = when (permission) {
    "app.storage" -> "自身本地数据"
    "resources.selected.read" -> "读取当次选择"
    "resources.library.read" -> "查看资源摘要"
    "resources.content.read" -> "读取授权内容"
    "resources.write" -> "修改普通字段"
    "resources.delete" -> "请求删除资源"
    "network.https" -> "HTTPS 网络"
    "files.importExport" -> "导入导出文件"
    "tavern.transfer" -> "酒馆互传"
    else -> permission
}

@Composable
internal fun NativeAiTaggingScreen(
    resources: List<NativeResource>,
    categories: List<NativeCategory>,
    state: NativeAiState,
    initialSelectedIds: List<String>,
    busy: Boolean,
    message: String,
    onSaveConfig: (NativeAiConfig, String) -> Unit,
    onClearApiKey: () -> Unit,
    onRun: (List<String>, Int, String, String, Boolean, Boolean) -> Unit,
    onSaveDraft: (NativeAiDraft) -> Unit,
    onApply: (List<NativeAiReviewItem>) -> Unit,
    onUndo: () -> Unit,
    onClearDraft: () -> Unit,
) {
    var protocol by remember(state.config) { mutableStateOf(state.config.protocol) }
    var apiUrl by remember(state.config) { mutableStateOf(state.config.url) }
    var model by remember(state.config) { mutableStateOf(state.config.model) }
    var maxTokens by remember(state.config) { mutableStateOf(state.config.maxTokens.toString()) }
    var apiKey by remember(state.config.hasApiKey) { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var typeFilter by remember { mutableStateOf("all") }
    var categoryFilter by remember { mutableStateOf("all") }
    var tagState by remember { mutableStateOf("all") }
    var selectedIds by remember(state.draft?.selectedIds, initialSelectedIds, resources.map(NativeResource::id)) {
        val validIds = resources.map(NativeResource::id).toSet()
        val restored = state.draft?.selectedIds?.filter { it in validIds }.orEmpty()
        val initial = initialSelectedIds.filter { it in validIds }
        mutableStateOf((if (restored.isNotEmpty()) restored else initial).toSet())
    }
    var batchSize by remember(state.draft?.batchSize) { mutableIntStateOf(state.draft?.batchSize ?: 4) }
    var customPrompt by remember(state.draft?.customPrompt) { mutableStateOf(state.draft?.customPrompt.orEmpty()) }
    var taxonomy by remember(state.draft?.taxonomyTemplateId) { mutableStateOf(state.draft?.taxonomyTemplateId ?: "free") }
    var mergeAliases by remember(state.draft?.mergeAliases) { mutableStateOf(state.draft?.mergeAliases ?: false) }
    var reviewItems by remember(state.draft) { mutableStateOf(state.draft?.reviewItems.orEmpty()) }
    var manualTags by remember(state.draft) { mutableStateOf<Map<String, String>>(emptyMap()) }
    val visible = resources.filter { resource ->
        (query.isBlank() || listOf(resource.name, resource.fileName, resource.tags.joinToString(" ")).any { it.contains(query.trim(), true) }) &&
            (typeFilter == "all" || resource.type == typeFilter) &&
            (categoryFilter == "all" || categoryFilter in resource.categoryIds) &&
            (tagState == "all" || (tagState == "tagged" && resource.tags.isNotEmpty()) || (tagState == "untagged" && resource.tags.isEmpty()))
    }
    fun saveReviews(next: List<NativeAiReviewItem>) {
        reviewItems = next
        state.draft?.let { onSaveDraft(it.copy(reviewItems = next)) }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            InfoCard(
                "先审核，后写入",
                "资源内容只作为不可信证据发送给你配置的 API。识别结果先保存为本机草稿，不会直接修改标签；失败批次可单独重试，上次真正新增的标签可精确撤销。API Key 仅进入 Android Keystore，不写入备份。",
            ) {}
        }
        item {
            InfoCard("AI 接口", if (state.config.hasApiKey) "本机已保存加密 API Key" else "尚未保存 API Key；无鉴权接口可留空") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = protocol == "openai-compatible", onClick = { protocol = "openai-compatible" }, label = { Text("OpenAI 兼容") })
                    FilterChip(selected = protocol == "anthropic-compatible", onClick = { protocol = "anthropic-compatible" }, label = { Text("Anthropic 兼容") })
                }
                OutlinedTextField(apiUrl, { apiUrl = it.take(2_000) }, label = { Text("HTTPS API 地址") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(model, { model = it.take(200) }, label = { Text("模型名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(maxTokens, { maxTokens = it.filter(Char::isDigit).take(6) }, label = { Text("最大输出 Token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(apiKey, { apiKey = it }, label = { Text(if (state.config.hasApiKey) "新 API Key（留空则保留）" else "API Key") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                Button(
                    onClick = { onSaveConfig(NativeAiConfig(protocol, apiUrl, model, maxTokens.toIntOrNull() ?: 4096, state.config.hasApiKey), apiKey) },
                    enabled = !busy && apiUrl.isNotBlank() && model.isNotBlank(), modifier = Modifier.fillMaxWidth().height(48.dp),
                ) { Text("保存接口配置") }
                if (state.config.hasApiKey) TextButton(onClick = onClearApiKey, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("删除本机 API Key") }
            }
        }
        if (state.undo.isNotEmpty()) {
            item {
                InfoCard("可撤销上次注入", "涉及 ${state.undo.size} 项资源；只移除上次新增且目前仍存在的标签。") {
                    OutlinedButton(onClick = onUndo, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("撤销上次 AI 新增标签") }
                }
            }
        }
        if (reviewItems.isNotEmpty() || state.draft?.failures?.isNotEmpty() == true) {
            item {
                Text("审核草稿", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = ink)
                Text(state.draft?.usageText.orEmpty().ifBlank { "只有点击写入后才会改变资源" }, color = inkSoft)
            }
            items(reviewItems, key = { "ai-review-${it.resourceId}" }) { item ->
                val resource = resources.firstOrNull { it.id == item.resourceId }
                if (resource != null) {
                    Card(colors = CardDefaults.cardColors(containerColor = raised.copy(alpha = 0.92f), contentColor = ink), shape = RoundedCornerShape(18.dp)) {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(resource.name, fontWeight = FontWeight.Bold, color = ink)
                                    Text("原有：${resource.tags.joinToString(" · ").ifBlank { "无" }}", color = inkSoft, style = MaterialTheme.typography.bodySmall)
                                }
                                FilterChip(selected = item.accepted, onClick = {
                                    saveReviews(reviewItems.map { if (it.resourceId == item.resourceId) it.copy(accepted = !it.accepted) else it })
                                }, label = { Text(if (item.accepted) "已接受" else "已排除") })
                            }
                            if (item.tags.isEmpty()) Text("AI 没有找到可靠的新标签", color = inkSoft)
                            item.tags.forEach { tag ->
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(tag.name, color = teal, fontWeight = FontWeight.Bold)
                                        Text("${if (tag.level == "explicit") "明确证据" else "合理推断"} · ${tag.evidence.ifBlank { "未提供依据" }}", color = inkSoft, style = MaterialTheme.typography.bodySmall)
                                    }
                                    TextButton(onClick = {
                                        saveReviews(reviewItems.map { if (it.resourceId == item.resourceId) it.copy(tags = it.tags.filterNot { value -> value == tag }) else it })
                                    }, enabled = !busy) { Text("移除") }
                                }
                            }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(
                                    manualTags[item.resourceId].orEmpty(),
                                    { manualTags = manualTags + (item.resourceId to it.take(40)) },
                                    label = { Text("手动补充标签") }, singleLine = true, modifier = Modifier.weight(1f),
                                )
                                TextButton(onClick = {
                                    val name = manualTags[item.resourceId].orEmpty().replace(Regex("^#+"), "").trim()
                                    if (name.isNotBlank() && item.tags.none { it.name.equals(name, true) } && resource.tags.none { it.equals(name, true) }) {
                                        saveReviews(reviewItems.map { if (it.resourceId == item.resourceId) it.copy(tags = it.tags + NativeAiSuggestedTag(name, "用户在审核阶段手动补充", "explicit")) else it })
                                    }
                                    manualTags = manualTags - item.resourceId
                                }, enabled = !busy) { Text("添加") }
                            }
                        }
                    }
                }
            }
            state.draft?.failures?.takeIf { it.isNotEmpty() }?.let { failures ->
                item {
                    InfoCard("失败批次", failures.joinToString("\n") { it.message }) {
                        val retryIds = failures.filter { it.retryable }.flatMap { it.resourceIds }.distinct()
                        if (retryIds.isNotEmpty()) Button(
                            onClick = { onRun(retryIds, batchSize, customPrompt, taxonomy, mergeAliases, true) }, enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("只重试 ${retryIds.size} 项失败资源") }
                    }
                }
            }
            item {
                Button(
                    onClick = { onApply(reviewItems) }, enabled = !busy && reviewItems.any { it.accepted && it.tags.isNotEmpty() },
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) { Text("写入已审核标签") }
                TextButton(onClick = onClearDraft, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("放弃草稿（不改资源）") }
            }
        }
        item {
            Text("选择资源", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = ink)
            Text("已选 ${selectedIds.size} / 200", color = inkSoft)
            OutlinedTextField(query, { query = it }, label = { Text("搜索名称、文件或标签") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = typeFilter == "all", onClick = { typeFilter = "all" }, label = { Text("全部类型") })
                resources.map(NativeResource::type).distinct().forEach { type ->
                    FilterChip(selected = typeFilter == type, onClick = { typeFilter = type }, label = { Text(resourceTypeLabels[type] ?: type) })
                }
            }
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = categoryFilter == "all", onClick = { categoryFilter = "all" }, label = { Text("全部文件夹") })
                categories.filterNot(NativeCategory::hidden).forEach { category ->
                    FilterChip(selected = categoryFilter == category.id, onClick = { categoryFilter = category.id }, label = { Text(category.name) })
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = tagState == "all", onClick = { tagState = "all" }, label = { Text("不限标签") })
                FilterChip(selected = tagState == "untagged", onClick = { tagState = "untagged" }, label = { Text("未标签") })
                FilterChip(selected = tagState == "tagged", onClick = { tagState = "tagged" }, label = { Text("已有标签") })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { selectedIds = (selectedIds + visible.map(NativeResource::id)).take(200).toSet() }, enabled = visible.isNotEmpty()) { Text("选择当前结果") }
                TextButton(onClick = { selectedIds = emptySet() }) { Text("清空选择") }
            }
        }
        items(visible, key = { "ai-select-${it.id}" }) { resource ->
            Card(
                modifier = Modifier.fillMaxWidth().clickable(enabled = selectedIds.size < 200 || resource.id in selectedIds) {
                    selectedIds = if (resource.id in selectedIds) selectedIds - resource.id else selectedIds + resource.id
                },
                colors = CardDefaults.cardColors(containerColor = if (resource.id in selectedIds) paleTeal else raised, contentColor = ink),
                shape = RoundedCornerShape(16.dp),
            ) {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(resource.name, fontWeight = FontWeight.Bold, color = ink)
                        Text("${resourceTypeLabels[resource.type] ?: resource.type} · ${resource.tags.joinToString(" · ").ifBlank { "暂无标签" }}", color = inkSoft, style = MaterialTheme.typography.bodySmall)
                    }
                    Text(if (resource.id in selectedIds) "已选" else "选择", color = teal, fontWeight = FontWeight.Bold)
                }
            }
        }
        item {
            InfoCard("识别参数", "建议每批 3–5 项；系统最多 8 项并限制单批上下文。") {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { batchSize = (batchSize - 1).coerceAtLeast(1) }) { Text("−") }
                    Text("每批 $batchSize 项", color = ink, fontWeight = FontWeight.Bold)
                    OutlinedButton(onClick = { batchSize = (batchSize + 1).coerceAtMost(8) }) { Text("+") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = taxonomy == "free", onClick = { taxonomy = "free" }, label = { Text("自由标签") })
                    FilterChip(selected = taxonomy == "story-resource", onClick = { taxonomy = "story-resource" }, label = { Text("剧情资源规范") })
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("合并常见别名", color = ink, fontWeight = FontWeight.Bold)
                        Text("例如 bg → BG、百合 → GL", color = inkSoft, style = MaterialTheme.typography.bodySmall)
                    }
                    Switch(mergeAliases, { mergeAliases = it })
                }
                OutlinedTextField(customPrompt, { customPrompt = it.take(4_000) }, label = { Text("补充要求（可选）") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
                Button(
                    onClick = { onRun(selectedIds.toList(), batchSize, customPrompt, taxonomy, mergeAliases, false) },
                    enabled = !busy && selectedIds.isNotEmpty() && state.config.url.isNotBlank() && state.config.model.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) { Text(if (busy) "识别中…" else "生成审核草稿") }
                OutlinedButton(
                    onClick = { onSaveDraft(NativeAiDraft(selectedIds.toList(), batchSize, customPrompt, taxonomy, mergeAliases, reviewItems, state.draft?.failures.orEmpty(), state.draft?.usageText.orEmpty())) },
                    enabled = !busy && selectedIds.isNotEmpty(), modifier = Modifier.fillMaxWidth(),
                ) { Text("只保存当前选择为草稿") }
            }
        }
        item { InfoCard("当前状态", message) {}; Spacer(Modifier.height(24.dp)) }
    }
}
