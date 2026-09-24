package buzz.jixiangruyi1207.srl.nativeapp.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import buzz.jixiangruyi1207.srl.nativeapp.persona.NativePersonaBackup
import buzz.jixiangruyi1207.srl.nativeapp.persona.NativePersonaEntry

@Composable
internal fun NativeUserPersonaScreen(
    resources: List<NativeResource>,
    backup: NativePersonaBackup?,
    busy: Boolean,
    onImport: () -> Unit,
    onLoad: (String) -> Unit,
    onCreate: (NativePersonaEntry) -> Unit,
    onSave: (String, String?, NativePersonaEntry) -> Unit,
    onDuplicate: (String, String, String) -> Unit,
    onDelete: (String, String) -> Unit,
    onSetDefault: (String, String) -> Unit,
    onExport: (String, String) -> Unit,
) {
    val personaResources = resources.filter { it.type == "userPersona" }
    var editing by remember { mutableStateOf<NativePersonaEntry?>(null) }
    var editingOriginalId by remember { mutableStateOf<String?>(null) }
    var creatingResource by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<NativePersonaEntry?>(null) }
    val blankEntry = NativePersonaEntry("persona.png", "", "", "", 0, 2, 0, "", emptyList(), 0)
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            InfoCard("酒馆格式", "直接读写 personas、persona_descriptions 与 default_persona；保存前校验，旧文件自动成为历史版本。") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { creatingResource = true; editingOriginalId = null; editing = blankEntry },
                        enabled = !busy,
                        modifier = Modifier.weight(1f).height(48.dp),
                    ) { Text("新建备份") }
                    OutlinedButton(onClick = onImport, enabled = !busy, modifier = Modifier.weight(1f).height(48.dp)) { Text("导入 JSON") }
                }
            }
        }
        if (personaResources.isEmpty()) {
            item { InfoCard("还没有用户人设", "可新建一份酒馆原生人设备份，或从手机导入 personas JSON。") {} }
        } else {
            item { Text("人设备份", fontWeight = FontWeight.Bold, color = ink) }
            items(personaResources, key = { it.id }) { resource ->
                Card(
                    modifier = Modifier.fillMaxWidth().clickable(enabled = !busy) { onLoad(resource.id) },
                    colors = CardDefaults.cardColors(containerColor = if (backup?.resourceId == resource.id) paleTeal else raised.copy(alpha = 0.9f)),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(resource.name, fontWeight = FontWeight.Bold, color = ink)
                        Text(resource.description, color = inkSoft, style = MaterialTheme.typography.bodySmall)
                        Text(resource.fileName, color = inkSoft, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        if (backup != null) {
            item {
                InfoCard("当前备份 · ${backup.entries.size} 条", if (backup.warnings.isEmpty()) "格式校验通过" else backup.warnings.joinToString("；")) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { creatingResource = false; editingOriginalId = null; editing = blankEntry },
                            enabled = !busy,
                            modifier = Modifier.weight(1f).height(48.dp),
                        ) { Text("新增人设") }
                        OutlinedButton(
                            onClick = { onExport(backup.resourceId, backup.fileName) },
                            enabled = !busy,
                            modifier = Modifier.weight(1f).height(48.dp),
                        ) { Text("导出 JSON") }
                    }
                }
            }
            items(backup.entries, key = { it.avatarId }) { entry ->
                Card(colors = CardDefaults.cardColors(containerColor = raised.copy(alpha = 0.92f)), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(entry.name.ifBlank { "未命名人设" }, fontWeight = FontWeight.Bold, color = ink)
                                Text(entry.avatarId, color = inkSoft, style = MaterialTheme.typography.labelSmall)
                            }
                            if (backup.defaultPersona == entry.avatarId) Text("默认", color = teal, fontWeight = FontWeight.Bold)
                        }
                        if (entry.title.isNotBlank()) Text(entry.title, color = inkSoft)
                        Text(entry.description.ifBlank { "暂无人设描述" }, color = inkSoft, maxLines = 4, overflow = TextOverflow.Ellipsis)
                        Text("位置 ${personaPositionLabel(entry.position)} · 深度 ${entry.depth} · ${personaRoleLabel(entry.role)}", color = inkSoft, style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            OutlinedButton(
                                onClick = { creatingResource = false; editingOriginalId = entry.avatarId; editing = entry },
                                enabled = !busy,
                                modifier = Modifier.weight(1f),
                            ) { Text("编辑") }
                            OutlinedButton(
                                onClick = {
                                    val stem = entry.avatarId.substringBeforeLast('.')
                                    val suffix = entry.avatarId.substringAfterLast('.', "png")
                                    val used = backup.entries.mapTo(mutableSetOf()) { it.avatarId }
                                    var index = 1
                                    var next = "$stem-copy.$suffix"
                                    while (next in used) { index += 1; next = "$stem-copy-$index.$suffix" }
                                    onDuplicate(backup.resourceId, entry.avatarId, next)
                                },
                                enabled = !busy,
                                modifier = Modifier.weight(1f),
                            ) { Text("复制") }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            OutlinedButton(
                                onClick = { onSetDefault(backup.resourceId, entry.avatarId) },
                                enabled = !busy && backup.defaultPersona != entry.avatarId,
                                modifier = Modifier.weight(1f),
                            ) { Text("设为默认") }
                            TextButton(onClick = { deleting = entry }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("删除") }
                        }
                    }
                }
            }
        }
    }
    editing?.let { entry ->
        NativePersonaEditorDialog(
            initial = entry,
            title = when { creatingResource -> "新建用户人设备份"; editingOriginalId == null -> "新增用户人设"; else -> "编辑用户人设" },
            onDismiss = { editing = null },
            onSave = { next ->
                if (creatingResource) onCreate(next)
                else backup?.let { onSave(it.resourceId, editingOriginalId, next) }
                editing = null
            },
        )
    }
    deleting?.let { entry ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("删除这条用户人设？") },
            text = { Text("${entry.name.ifBlank { entry.avatarId }} 将从当前 JSON 移除；删除前内容会保留为可恢复历史版本。") },
            confirmButton = { TextButton(onClick = { backup?.let { onDelete(it.resourceId, entry.avatarId) }; deleting = null }) { Text("删除") } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } },
        )
    }
}

@Composable
private fun NativePersonaEditorDialog(
    initial: NativePersonaEntry,
    title: String,
    onDismiss: () -> Unit,
    onSave: (NativePersonaEntry) -> Unit,
) {
    var avatarId by remember(initial) { mutableStateOf(initial.avatarId) }
    var name by remember(initial) { mutableStateOf(initial.name) }
    var personaTitle by remember(initial) { mutableStateOf(initial.title) }
    var description by remember(initial) { mutableStateOf(initial.description) }
    var position by remember(initial) { mutableIntStateOf(initial.position) }
    var depth by remember(initial) { mutableStateOf(initial.depth.toString()) }
    var role by remember(initial) { mutableIntStateOf(initial.role) }
    var lorebook by remember(initial) { mutableStateOf(initial.lorebook) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(avatarId, { avatarId = it.take(160) }, label = { Text("头像文件名") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(name, { name = it.take(160) }, label = { Text("人设名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(personaTitle, { personaTitle = it.take(240) }, label = { Text("标题") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(description, { description = it.take(100_000) }, label = { Text("人设描述") }, minLines = 5, modifier = Modifier.fillMaxWidth())
                Text("注入位置", color = inkSoft, style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf(0 to "提示词", 2 to "作者注前", 3 to "作者注后").forEach { option ->
                        FilterChip(selected = position == option.first, onClick = { position = option.first }, label = { Text(option.second) })
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf(1 to "角色后", 4 to "指定深度", 9 to "不注入").forEach { option ->
                        FilterChip(selected = position == option.first, onClick = { position = option.first }, label = { Text(option.second) })
                    }
                }
                if (position == 4) OutlinedTextField(depth, { depth = it.filter(Char::isDigit).take(3) }, label = { Text("深度") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("消息角色", color = inkSoft, style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(0 to "系统", 1 to "用户", 2 to "助手").forEach { option ->
                        FilterChip(selected = role == option.first, onClick = { role = option.first }, label = { Text(option.second) })
                    }
                }
                OutlinedTextField(lorebook, { lorebook = it.take(240) }, label = { Text("专属世界书名称") }, modifier = Modifier.fillMaxWidth())
                if (initial.connections.isNotEmpty()) Text("已保留 ${initial.connections.size} 条酒馆角色/群组连接；原生编辑不会静默丢弃。", color = inkSoft, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(
                enabled = avatarId.trim().isNotBlank() && name.trim().isNotBlank() && (depth.toIntOrNull() ?: -1) in 0..999,
                onClick = {
                    onSave(initial.copy(avatarId = avatarId.trim(), name = name.trim(), title = personaTitle, description = description,
                        position = position, depth = depth.toIntOrNull() ?: 2, role = role, lorebook = lorebook))
                },
            ) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

private fun personaPositionLabel(position: Int): String = when (position) {
    0 -> "提示词内"
    1 -> "角色描述后"
    2 -> "作者注释顶部"
    3 -> "作者注释底部"
    4 -> "指定深度"
    9 -> "不注入"
    else -> "未知"
}

private fun personaRoleLabel(role: Int): String = when (role) { 1 -> "用户消息"; 2 -> "助手消息"; else -> "系统消息" }
