package buzz.jixiangruyi1207.srl.nativeapp.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
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
import androidx.compose.foundation.border
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import buzz.jixiangruyi1207.srl.nativeapp.model.resourceTypeLabels
import buzz.jixiangruyi1207.srl.nativeapp.preset.NativePresetSegment
import buzz.jixiangruyi1207.srl.nativeapp.preset.NativeStitchRequest
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResourceBundle
import java.util.UUID

@Composable
internal fun NativeFrontendWorkshopScreen(
    workshopOutputIds: List<String>,
    connectedToTavern: Boolean,
    busy: Boolean,
    onCompile: (String, String, String, String) -> Unit,
    onSendToTavern: () -> Unit,
) {
    var title by remember { mutableStateOf("自定义状态栏") }
    var fieldSource by remember { mutableStateOf("姓名：林言\n心情：平静\n好感度[百分比]：65%") }
    var dataMode by remember { mutableStateOf("reply") }
    var designSource by remember {
        mutableStateOf(
            """<SRL_META>
{"title":"自定义状态栏"}
</SRL_META>
<SRL_TEMPLATE>
<style>
.srl-status { padding: 12px; border: 1px solid #76aeb4; border-radius: 14px; background: #eef9f8; }
.srl-status strong { color: #1d707b; }
</style>
<section class="srl-status">
  <div><strong>姓名</strong> {{field_1}}</div>
  <div><strong>心情</strong> {{field_2}}</div>
  <div><strong>好感度</strong> {{field_3}}</div>
</section>
</SRL_TEMPLATE>""",
        )
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            InfoCard(
                "与网页版一致的输出边界",
                "APK 在本机校验 HTML/CSS、安全协议与字段占位，并生成 SillyTavern 正则和世界书。精确预览必须发送到已连接的真实酒馆，APK 不自造第二套渲染器。",
            ) {}
        }
        item {
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("作品名称") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
        }
        item {
            Text("数据来源", fontWeight = FontWeight.Bold, color = ink)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = dataMode == "reply", onClick = { dataMode = "reply" }, label = { Text("回复状态块") })
                FilterChip(selected = dataMode == "mvu", onClick = { dataMode = "mvu" }, label = { Text("MVU 变量") })
            }
        }
        item {
            OutlinedTextField(
                value = fieldSource,
                onValueChange = { fieldSource = it },
                label = { Text("字段清单（每行：名称：示例）") },
                supportingText = { Text("支持分组标题与 [数字]、[百分比]、[标签]、[长文本] 类型提示，最多 24 项") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 5,
            )
        }
        item {
            OutlinedTextField(
                value = designSource,
                onValueChange = { designSource = it },
                label = { Text("SRL_META / SRL_TEMPLATE 设计输出") },
                supportingText = { Text("每个 {{field_N}} 必须且只能出现一次；禁止脚本、事件、iframe、HTTP 外链与 fixed 定位") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 12,
                textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            )
        }
        item {
            Button(
                onClick = { onCompile(fieldSource, designSource, title, dataMode) },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(if (busy) "正在生成…" else "校验并保存到资源库") }
        }
        if (workshopOutputIds.size == 2) {
            item {
                InfoCard("已生成并关联", "正则与世界书已经保存为两个可独立导出、备份和回退的本机资源。") {
                    Button(
                        onClick = onSendToTavern,
                        enabled = connectedToTavern && !busy,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text(if (connectedToTavern) "发送到酒馆验收" else "连接酒馆后可发送验收") }
                }
            }
        }
        item { Spacer(Modifier.height(20.dp)) }
    }
}

@Composable
internal fun NativePresetStitchScreen(
    resources: List<NativeResource>,
    loadedSegments: Map<String, List<NativePresetSegment>>,
    busy: Boolean,
    onLoadSegments: (String) -> Unit,
    onGenerate: (NativeStitchRequest) -> Unit,
) {
    val presets = resources.filter { it.type == "preset" }
    var baseId by remember { mutableStateOf("") }
    var sourceId by remember { mutableStateOf("") }
    var selectedKeys by remember { mutableStateOf<Set<String>>(emptySet()) }
    var regexSources by remember { mutableStateOf<Set<String>>(emptySet()) }
    var productName by remember { mutableStateOf("") }
    val sourceSegments = loadedSegments[sourceId].orEmpty().filterNot { it.marker }
    val picked = loadedSegments.values.flatten().filter { "${it.sourceResourceId}:${it.identifier}" in selectedKeys }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            InfoCard("往返保真", "以主预设完整深拷贝为底板，只追加所选 prompts、重建 prompt_order 并合并整组正则；未知字段原样保留。") {}
        }
        if (presets.isEmpty()) {
            item { InfoCard("还没有可缝预设", "先从资源库导入 SillyTavern generation preset JSON。") {} }
        } else {
            item { Text("1 · 选择主预设", fontWeight = FontWeight.Bold, color = ink) }
            items(presets, key = { "base-${it.id}" }) { resource ->
                BridgeSelectionCard(resource.name, "${resource.fileName} · ${resource.description}", baseId == resource.id) {
                    baseId = resource.id
                    if (productName.isBlank()) productName = "${resource.name}·缝合"
                    if (sourceId == resource.id) sourceId = ""
                }
            }
            if (baseId.isNotBlank()) {
                item { Text("2 · 选择来源预设", fontWeight = FontWeight.Bold, color = ink) }
                items(presets.filter { it.id != baseId }, key = { "source-${it.id}" }) { resource ->
                    BridgeSelectionCard(resource.name, resource.fileName, sourceId == resource.id) {
                        sourceId = resource.id
                        onLoadSegments(resource.id)
                    }
                }
            }
            if (sourceId.isNotBlank()) {
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = raised.copy(alpha = 0.92f)), shape = RoundedCornerShape(18.dp)) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("配套正则", fontWeight = FontWeight.Bold, color = ink)
                                    Text("按整组 extensions.regex_scripts 合并并处理 ID 冲突", color = inkSoft, style = MaterialTheme.typography.bodySmall)
                                }
                                Switch(checked = sourceId in regexSources, onCheckedChange = {
                                    regexSources = if (it) regexSources + sourceId else regexSources - sourceId
                                })
                            }
                        }
                    }
                }
                if (!loadedSegments.containsKey(sourceId)) item { Text("正在读取提示词段…", color = inkSoft, modifier = Modifier.padding(12.dp)) }
                else if (sourceSegments.isEmpty()) item { Text("这个预设没有可缝提示词段。", color = inkSoft, modifier = Modifier.padding(12.dp)) }
                else {
                    item { Text("3 · 挑选提示词段", fontWeight = FontWeight.Bold, color = ink) }
                    items(sourceSegments, key = { "segment-${it.sourceResourceId}-${it.identifier}" }) { segment ->
                        val key = "${segment.sourceResourceId}:${segment.identifier}"
                        BridgeSelectionCard(
                            segment.name,
                            "${segment.role.ifBlank { "未指定角色" }} · ${segment.content.length} 字${if (!segment.inOrder) " · 孤立条目" else ""}",
                            key in selectedKeys,
                        ) { selectedKeys = if (key in selectedKeys) selectedKeys - key else selectedKeys + key }
                    }
                }
            }
            if (baseId.isNotBlank()) {
                item {
                    InfoCard("生成自缝版", "已选 ${picked.size} 个提示词段、${regexSources.size} 个正则来源；生成前会检查宏大括号与条件块。") {
                        OutlinedTextField(productName, { productName = it.take(160) }, label = { Text("自缝版预设名称") }, modifier = Modifier.fillMaxWidth())
                        Button(
                            onClick = { onGenerate(NativeStitchRequest(baseId, picked, regexSources.toList(), productName)) },
                            enabled = !busy && productName.trim().isNotBlank() && (picked.isNotEmpty() || regexSources.isNotEmpty()),
                            modifier = Modifier.fillMaxWidth().height(50.dp),
                        ) { Text("确认生成并放入资源库") }
                    }
                }
            }
        }
    }
}

@Composable
internal fun NativeResourceBundleScreen(
    resources: List<NativeResource>,
    bundles: List<NativeResourceBundle>,
    tavernConnected: Boolean,
    busy: Boolean,
    onSave: (NativeResourceBundle) -> Unit,
    onDelete: (String) -> Unit,
    onSend: (List<String>) -> Unit,
) {
    var editingId by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var primaryId by remember { mutableStateOf("") }
    var selectedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var query by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf<NativeResourceBundle?>(null) }
    val byId = resources.associateBy { it.id }
    val candidates = resources.filter { it.id != primaryId && (query.isBlank() || listOf(it.name, it.fileName, it.tags.joinToString(" ")).any { value -> value.contains(query.trim(), true) }) }
    val sendableTypes = setOf("characterCard", "worldBook", "preset", "regex", "quickReply", "beautification", "script", "userPersona")
    val bundleIds = listOfNotNull(primaryId.takeIf(String::isNotBlank)) + selectedIds.toList()
    fun reset() { editingId = ""; name = ""; primaryId = ""; selectedIds = emptySet(); query = "" }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            InfoCard("资源装配", "套装只保存主资源与配套资源关系，不复制文件、不执行脚本；保存后会建立可审计的双向关联。") {
                Button(onClick = { reset() }, enabled = !busy, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("新建套装") }
            }
        }
        if (bundles.isNotEmpty()) {
            item { Text("已保存套装", fontWeight = FontWeight.Bold, color = ink) }
            items(bundles, key = { it.id }) { bundle ->
                val allIds = listOf(bundle.primaryResourceId) + bundle.resourceIds
                val available = allIds.count(byId::containsKey)
                Card(
                    modifier = Modifier.fillMaxWidth().clickable(enabled = !busy) {
                        editingId = bundle.id; name = bundle.name
                        primaryId = bundle.primaryResourceId.takeIf(byId::containsKey).orEmpty()
                        selectedIds = bundle.resourceIds.filter(byId::containsKey).toSet()
                    },
                    colors = CardDefaults.cardColors(containerColor = if (editingId == bundle.id) paleTeal else raised.copy(alpha = 0.9f)),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(bundle.name, fontWeight = FontWeight.Bold, color = ink, modifier = Modifier.weight(1f))
                            Text("$available/${allIds.size} 项可用", color = inkSoft, style = MaterialTheme.typography.labelSmall)
                        }
                        Text(byId[bundle.primaryResourceId]?.name ?: "主资源已缺失", color = inkSoft)
                        TextButton(onClick = { deleting = bundle }, enabled = !busy, modifier = Modifier.align(Alignment.End)) { Text("删除套装记录") }
                    }
                }
            }
        }
        item {
            Text(if (editingId.isBlank()) "创建套装" else "编辑套装", fontWeight = FontWeight.Bold, color = ink)
            OutlinedTextField(name, { name = it.take(80) }, label = { Text("套装名称") }, modifier = Modifier.fillMaxWidth())
        }
        item { Text("1 · 主资源", fontWeight = FontWeight.Bold, color = ink) }
        items(resources.sortedWith(compareBy<NativeResource> { if (it.type in setOf("characterCard", "preset", "userPersona")) 0 else 1 }.thenBy { it.name }), key = { "primary-${it.id}" }) { resource ->
            BridgeSelectionCard(resource.name, resourceTypeLabels[resource.type] ?: resource.type, primaryId == resource.id) {
                primaryId = resource.id
                selectedIds = selectedIds - resource.id
            }
        }
        if (primaryId.isNotBlank()) {
            item {
                Text("2 · 配套资源", fontWeight = FontWeight.Bold, color = ink)
                OutlinedTextField(query, { query = it }, label = { Text("搜索名称、标签或文件") }, modifier = Modifier.fillMaxWidth())
            }
            items(candidates, key = { "candidate-${it.id}" }) { resource ->
                BridgeSelectionCard(resource.name, "${resourceTypeLabels[resource.type] ?: resource.type} · ${resource.fileName}", resource.id in selectedIds) {
                    selectedIds = if (resource.id in selectedIds) selectedIds - resource.id else selectedIds + resource.id
                }
            }
            item {
                val executableCount = bundleIds.count { byId[it]?.type in setOf("script", "plugin") }
                InfoCard("套装体检", "共 ${bundleIds.size} 项；其中 $executableCount 项是脚本/扩展，发送或导入后是否启用仍由用户在酒馆决定。") {
                    Button(
                        onClick = {
                            val now = System.currentTimeMillis()
                            onSave(NativeResourceBundle(editingId.ifBlank { UUID.randomUUID().toString() }, name, primaryId, selectedIds.toList(),
                                bundles.firstOrNull { it.id == editingId }?.createdAt ?: now, now))
                        },
                        enabled = !busy && name.trim().isNotBlank() && selectedIds.isNotEmpty(),
                        modifier = Modifier.fillMaxWidth().height(50.dp),
                    ) { Text("保存套装与关联") }
                    OutlinedButton(
                        onClick = { onSend(bundleIds) },
                        enabled = !busy && tavernConnected && bundleIds.size >= 2 && bundleIds.all { byId[it]?.type in sendableTypes },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text(if (tavernConnected) "发送整套到酒馆" else "连接酒馆后可发送整套") }
                }
            }
        }
    }
    deleting?.let { bundle ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("删除资源套装？") },
            text = { Text("删除“${bundle.name}”吗？资源文件和已经建立的关联不会被删除。") },
            confirmButton = { TextButton(onClick = { onDelete(bundle.id); deleting = null }) { Text("删除套装") } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } },
        )
    }
}
