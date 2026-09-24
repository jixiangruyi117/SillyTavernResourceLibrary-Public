package buzz.jixiangruyi1207.srl.nativeapp.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.border
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import buzz.jixiangruyi1207.srl.nativeapp.model.resourceTypeLabels
import buzz.jixiangruyi1207.srl.nativeapp.tavern.NativeTavernBridgeState
import buzz.jixiangruyi1207.srl.nativeapp.tavern.NativeTavernResourceItem

@Composable
internal fun NativeTavernBridgeScreen(
    resources: List<NativeResource>,
    state: NativeTavernBridgeState,
    tavernResources: List<NativeTavernResourceItem>,
    busy: Boolean,
    onJoin: (String) -> Unit,
    onAccept: () -> Unit,
    onRefresh: () -> Unit,
    onPull: (List<String>) -> Unit,
    onSend: (List<String>, String) -> Unit,
    onDisconnect: () -> Unit,
) {
    var code by remember { mutableStateOf("") }
    var receiveMode by remember { mutableStateOf(true) }
    var selectedTavernIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var selectedLocalIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var conflictPolicy by remember { mutableStateOf("copy") }
    val sendable = resources.filter { it.type in setOf("characterCard", "worldBook", "preset", "regex", "quickReply", "beautification", "script", "userPersona") }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            InfoCard("连接状态", state.detail) {
                when (state.status) {
                    "pairing" -> {
                        Text("六位配对码", color = inkSoft, style = MaterialTheme.typography.labelMedium)
                        Text(state.pairCode, color = teal, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.displaySmall)
                        Button(onClick = onAccept, enabled = !busy, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("配对码一致，确认连接") }
                        TextButton(onClick = onDisconnect, modifier = Modifier.fillMaxWidth()) { Text("取消连接") }
                    }
                    "connected" -> {
                        Text("酒馆扩展 ${state.bridgeVersion.ifBlank { "已连接" }}", color = teal, fontWeight = FontWeight.Bold)
                        OutlinedButton(onClick = onDisconnect, enabled = !busy, modifier = Modifier.fillMaxWidth().height(46.dp)) { Text("断开连接") }
                    }
                    else -> {
                        OutlinedTextField(
                            value = code,
                            onValueChange = { code = it.uppercase().filter { ch -> ch in "23456789ABCDEFGHJKLMNPQRSTUVWXYZ" }.take(8) },
                            label = { Text("8 位设备码") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Button(onClick = { onJoin(code) }, enabled = !busy && code.length == 8, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("连接酒馆") }
                        Text("设备码和六位确认码由酒馆扩展生成。构建应用时请配置自己部署的 HTTPS Worker 中继地址。", color = inkSoft, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        if (state.status == "connected") {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    FilterChip(selected = receiveMode, onClick = { receiveMode = true }, label = { Text("从酒馆接收") }, modifier = Modifier.weight(1f))
                    FilterChip(selected = !receiveMode, onClick = { receiveMode = false }, label = { Text("发送到酒馆") }, modifier = Modifier.weight(1f))
                }
            }
            if (receiveMode) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedButton(onClick = onRefresh, enabled = !busy, modifier = Modifier.weight(1f)) { Text("读取酒馆列表") }
                        Button(onClick = { onPull(selectedTavernIds.toList()) }, enabled = !busy && selectedTavernIds.isNotEmpty(), modifier = Modifier.weight(1f)) { Text("接收所选") }
                    }
                }
                if (tavernResources.isEmpty()) item { Text("尚未读取酒馆资源。连接后点击“读取酒馆列表”。", color = inkSoft, modifier = Modifier.padding(12.dp)) }
                items(tavernResources, key = { it.id }) { item ->
                    BridgeSelectionCard(
                        title = item.name.ifBlank { item.fileName },
                        detail = listOf(item.kind, item.detail).filter(String::isNotBlank).joinToString(" · "),
                        selected = item.id in selectedTavernIds,
                        onClick = { selectedTavernIds = selectedTavernIds.toggle(item.id) },
                    )
                }
            } else {
                item {
                    InfoCard("酒馆同名资源处理", "复制会保留旧文件；覆盖会替换同名资源；跳过不会修改酒馆现有文件。") {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf("copy" to "复制", "overwrite" to "覆盖", "skip" to "跳过").forEach { (value, label) ->
                                FilterChip(selected = conflictPolicy == value, onClick = { conflictPolicy = value }, label = { Text(label) })
                            }
                        }
                        Button(onClick = { onSend(selectedLocalIds.toList(), conflictPolicy) }, enabled = !busy && selectedLocalIds.isNotEmpty(), modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("发送所选到酒馆") }
                    }
                }
                if (sendable.isEmpty()) item { Text("本机还没有可发送到酒馆的资源。", color = inkSoft, modifier = Modifier.padding(12.dp)) }
                items(sendable, key = { it.id }) { resource ->
                    BridgeSelectionCard(
                        title = resource.name,
                        detail = "${resourceTypeLabels[resource.type] ?: resource.type} · ${formatBytes(resource.fileSize)}",
                        selected = resource.id in selectedLocalIds,
                        onClick = { selectedLocalIds = selectedLocalIds.toggle(resource.id) },
                    )
                }
            }
        }
    }
}

@Composable
internal fun BridgeSelectionCard(title: String, detail: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp),
        color = if (selected) paleTeal else raised.copy(alpha = 0.88f),
        border = androidx.compose.foundation.BorderStroke(1.dp, if (selected) teal.copy(alpha = 0.52f) else Color.White.copy(alpha = 0.8f)),
    ) {
        Row(Modifier.fillMaxWidth().padding(15.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(30.dp).background(if (selected) teal else Color.Transparent, CircleShape).border(1.dp, teal.copy(alpha = 0.55f), CircleShape), contentAlignment = Alignment.Center) {
                if (selected) Text("✓", color = Color.White, fontWeight = FontWeight.Bold)
            }
            Column(Modifier.weight(1f)) {
                Text(title, color = ink, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (detail.isNotBlank()) Text(detail, color = inkSoft, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
