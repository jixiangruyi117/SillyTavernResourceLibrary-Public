package buzz.jixiangruyi1207.srl.nativeapp.ui

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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import buzz.jixiangruyi1207.srl.nativeapp.BuildConfig
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeSnapshot
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeBackupSelection
import buzz.jixiangruyi1207.srl.nativeapp.cloud.NativeCloudBackup
import buzz.jixiangruyi1207.srl.nativeapp.cloud.NativeCredentialState
import buzz.jixiangruyi1207.srl.nativeapp.cloud.NativeGitHubConfig
import buzz.jixiangruyi1207.srl.nativeapp.cloud.NativeWebDavConfig
import java.text.DateFormat
import java.util.Date

@Composable
internal fun TransferScreen(
    exportOnly: Boolean,
    resourceCount: Int,
    busy: Boolean,
    cloudBackups: List<NativeCloudBackup>,
    githubConfig: NativeGitHubConfig?,
    webDavConfig: NativeWebDavConfig?,
    githubCredentialState: NativeCredentialState,
    webDavCredentialState: NativeCredentialState,
    onExport: (NativeBackupSelection) -> Unit,
    onSaveGitHub: (NativeGitHubConfig, String) -> Unit,
    onSaveWebDav: (NativeWebDavConfig, String) -> Unit,
    onTestCloud: (String) -> Unit,
    onRefreshCloud: (String) -> Unit,
    onCreateCloudBackup: (String, NativeBackupSelection) -> Unit,
    onRestoreCloudBackup: (NativeCloudBackup, Boolean) -> Unit,
    onDeleteCloudBackup: (NativeCloudBackup) -> Unit,
) {
    var provider by remember { mutableStateOf(if (githubConfig != null || webDavConfig == null) "github" else "webdav") }
    var advanced by remember { mutableStateOf(false) }
    var githubOwner by remember(githubConfig) { mutableStateOf(githubConfig?.owner.orEmpty()) }
    var githubRepository by remember(githubConfig) { mutableStateOf(githubConfig?.repository.orEmpty()) }
    var githubToken by remember { mutableStateOf("") }
    var editingGitHubCredential by remember(githubCredentialState) {
        mutableStateOf(githubCredentialState != NativeCredentialState.VALID)
    }
    var githubRetention by remember(githubConfig) { mutableStateOf((githubConfig?.retention ?: 7).toString()) }
    var githubAuto by remember(githubConfig) { mutableStateOf(githubConfig?.autoBackup ?: false) }
    var githubWifiOnly by remember(githubConfig) { mutableStateOf(githubConfig?.wifiOnly ?: true) }
    var githubChargingOnly by remember(githubConfig) { mutableStateOf(githubConfig?.chargingOnly ?: false) }
    var webDavUrl by remember(webDavConfig) { mutableStateOf(webDavConfig?.baseUrl ?: "https://app.koofr.net/dav/Koofr") }
    var webDavFolder by remember(webDavConfig) { mutableStateOf(webDavConfig?.folder ?: "SRL-Backups") }
    var webDavUser by remember(webDavConfig) { mutableStateOf(webDavConfig?.username.orEmpty()) }
    var webDavPassword by remember { mutableStateOf("") }
    var editingWebDavCredential by remember(webDavCredentialState) {
        mutableStateOf(webDavCredentialState != NativeCredentialState.VALID)
    }
    var webDavRetention by remember(webDavConfig) { mutableStateOf((webDavConfig?.retention ?: 7).toString()) }
    var webDavAuto by remember(webDavConfig) { mutableStateOf(webDavConfig?.autoBackup ?: false) }
    var webDavWifiOnly by remember(webDavConfig) { mutableStateOf(webDavConfig?.wifiOnly ?: true) }
    var webDavChargingOnly by remember(webDavConfig) { mutableStateOf(webDavConfig?.chargingOnly ?: false) }
    var restoreTarget by remember { mutableStateOf<NativeCloudBackup?>(null) }
    var deleteTarget by remember { mutableStateOf<NativeCloudBackup?>(null) }
    var contentAdvanced by remember { mutableStateOf(false) }
    var includeResources by remember { mutableStateOf(true) }
    var includeVersions by remember { mutableStateOf(true) }
    var includeCategories by remember { mutableStateOf(true) }
    var includePortable by remember { mutableStateOf(true) }
    val selection = NativeBackupSelection(includeResources, includeVersions, includeCategories, includePortable)
    val hasSelection = includeResources || includeVersions || includeCategories || includePortable
    val configured = if (provider == "github") {
        githubConfig != null && githubCredentialState == NativeCredentialState.VALID
    } else {
        webDavConfig != null && webDavCredentialState == NativeCredentialState.VALID
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (exportOnly) item {
            Text("导出资源", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = ink)
            Text("选择要带走的数据，生成网页端与旧 APK 可继续使用的 ZIP。", color = inkSoft)
        }
        if (exportOnly) item {
            InfoCard("导出", "导出为 srl-archive v4，网页端和旧 APK 可以继续恢复；原文件、分类清单和已导入历史版本会保留。") {
                OutlinedButton(onClick = { onExport(selection) }, enabled = !busy && hasSelection, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("按所选内容导出") }
                TextButton(onClick = { contentAdvanced = !contentAdvanced }, modifier = Modifier.fillMaxWidth()) { Text(if (contentAdvanced) "收起备份内容" else "选择备份内容（高级）") }
                if (contentAdvanced) {
                    BackupSelectionRow("当前资源原文件（$resourceCount 项）", includeResources) { includeResources = it }
                    BackupSelectionRow("历史版本原文件", includeVersions) { includeVersions = it }
                    BackupSelectionRow("分类、归属与排序", includeCategories) { includeCategories = it }
                    BackupSelectionRow("便携设置与功能数据", includePortable) { includePortable = it }
                    if (!hasSelection) Text("至少选择一项", color = Color(0xFF9B2C2C), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (!exportOnly) item {
            InfoCard("云端对象级备份", "原生 APK 直接连接 GitHub Release 或 Koofr/WebDAV。内容按 SHA-256 复用，只上传变化块，最后才提交快照清单；完全相同的文件不会重传。") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = provider == "github", onClick = { provider = "github" }, label = { Text("GitHub") })
                    FilterChip(selected = provider == "webdav", onClick = { provider = "webdav" }, label = { Text("Koofr / WebDAV") })
                }
                Button(onClick = { onCreateCloudBackup(provider, selection) }, enabled = !busy && configured && hasSelection, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                    Text("立即备份（只传变化）")
                }
                OutlinedButton(onClick = { onRefreshCloud(provider) }, enabled = !busy && configured, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("刷新云端列表") }
                TextButton(onClick = { advanced = !advanced }, modifier = Modifier.fillMaxWidth()) { Text(if (advanced) "收起高级设置" else "展开高级设置") }
            }
        }
        if (!exportOnly && advanced) item {
            InfoCard(if (provider == "github") "GitHub 高级设置" else "Koofr / WebDAV 高级设置", "凭据使用 Android Keystore 加密后只保存在本机；已保存时会自动使用。") {
                if (provider == "github") {
                    OutlinedTextField(githubOwner, { githubOwner = it.take(100) }, label = { Text("仓库所有者") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(githubRepository, { githubRepository = it.take(100) }, label = { Text("仓库名") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    if (githubCredentialState == NativeCredentialState.VALID && !editingGitHubCredential) {
                        Text("GitHub 密钥\n已保存 · 正在使用", color = teal, fontWeight = FontWeight.Bold)
                        OutlinedButton(onClick = { editingGitHubCredential = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("重新填写密钥") }
                    } else {
                        if (githubCredentialState == NativeCredentialState.INVALID) Text("已保存密钥经服务端确认失效，请重新填写", color = Color(0xFF9B2C2C))
                        OutlinedTextField(githubToken, { githubToken = it.take(300) }, label = { Text("GitHub 令牌") },
                            singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                    }
                    OutlinedTextField(githubRetention, { githubRetention = it.filter(Char::isDigit).take(2) }, label = { Text("保留快照数（1–30）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text("应用打开且有网时自动备份", modifier = Modifier.weight(1f)); Switch(githubAuto, { githubAuto = it })
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text("自动备份仅限 Wi-Fi / 不计费网络", modifier = Modifier.weight(1f)); Switch(githubWifiOnly, { githubWifiOnly = it })
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text("自动备份仅在充电时运行", modifier = Modifier.weight(1f)); Switch(githubChargingOnly, { githubChargingOnly = it })
                    }
                    Button(onClick = {
                        onSaveGitHub(NativeGitHubConfig(githubOwner, githubRepository, githubRetention.toIntOrNull()?.coerceIn(1, 30) ?: 7, githubAuto, githubWifiOnly, githubChargingOnly), githubToken)
                        githubToken = ""
                        editingGitHubCredential = false
                    }, enabled = !busy && (!editingGitHubCredential || githubToken.isNotBlank()), modifier = Modifier.fillMaxWidth()) { Text("保存 GitHub 配置") }
                } else {
                    OutlinedTextField(webDavUrl, { webDavUrl = it.take(300) }, label = { Text("WebDAV HTTPS 地址") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(webDavFolder, { webDavFolder = it.take(120) }, label = { Text("备份文件夹") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(webDavUser, { webDavUser = it.take(160) }, label = { Text("用户名") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    if (webDavCredentialState == NativeCredentialState.VALID && !editingWebDavCredential) {
                        Text("Koofr 密钥\n已保存 · 正在使用", color = teal, fontWeight = FontWeight.Bold)
                        OutlinedButton(onClick = { editingWebDavCredential = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("重新填写密钥") }
                    } else {
                        if (webDavCredentialState == NativeCredentialState.INVALID) Text("已保存应用密码经服务端确认失效，请重新填写", color = Color(0xFF9B2C2C))
                        OutlinedTextField(webDavPassword, { webDavPassword = it.take(300) }, label = { Text("应用密码") },
                            singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                    }
                    OutlinedTextField(webDavRetention, { webDavRetention = it.filter(Char::isDigit).take(2) }, label = { Text("保留快照数（1–30）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text("应用打开且有网时自动备份", modifier = Modifier.weight(1f)); Switch(webDavAuto, { webDavAuto = it })
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text("自动备份仅限 Wi-Fi / 不计费网络", modifier = Modifier.weight(1f)); Switch(webDavWifiOnly, { webDavWifiOnly = it })
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text("自动备份仅在充电时运行", modifier = Modifier.weight(1f)); Switch(webDavChargingOnly, { webDavChargingOnly = it })
                    }
                    Button(onClick = {
                        onSaveWebDav(NativeWebDavConfig(webDavUrl, webDavFolder, webDavUser, webDavRetention.toIntOrNull()?.coerceIn(1, 30) ?: 7, webDavAuto, webDavWifiOnly, webDavChargingOnly), webDavPassword)
                        webDavPassword = ""
                        editingWebDavCredential = false
                    }, enabled = !busy && (!editingWebDavCredential || webDavPassword.isNotBlank()), modifier = Modifier.fillMaxWidth()) { Text("保存 WebDAV 配置") }
                }
                OutlinedButton(onClick = { onTestCloud(provider) }, enabled = !busy && configured, modifier = Modifier.fillMaxWidth()) { Text("测试已保存配置") }
            }
        }
        val visibleBackups = if (exportOnly) emptyList() else cloudBackups.filter { it.provider == provider }
        if (!exportOnly && visibleBackups.isEmpty()) item { Text("尚未读取此渠道的云端备份", modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.titleMedium) }
        if (!exportOnly) items(visibleBackups, key = { "${it.provider}:${it.id}" }) { backup ->
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (backup.legacy) "旧版兼容备份" else "对象级快照", fontWeight = FontWeight.Bold, color = teal)
                    Text("${DateFormat.getDateTimeInstance().format(Date(backup.createdAt))} · ${formatBytes(backup.size)} · ${backup.partCount} 个块", style = MaterialTheme.typography.bodySmall)
                    Text(backup.objectKey, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { restoreTarget = backup }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("恢复") }
                        TextButton(onClick = { deleteTarget = backup }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("删除", color = Color(0xFF9B2C2C)) }
                    }
                }
            }
        }
    }
    restoreTarget?.let { backup ->
        AlertDialog(onDismissRequest = { restoreTarget = null }, title = { Text("恢复云端备份") },
            text = {
                Text("“合并”会保留本机已有资源；“替换”会先创建本机快照，再用云端内容替换。请选择恢复方式。")
            },
            confirmButton = { TextButton(onClick = { onRestoreCloudBackup(backup, false); restoreTarget = null }) { Text("安全合并") } },
            dismissButton = { Row { TextButton(onClick = { restoreTarget = null }) { Text("取消") }; TextButton(onClick = { onRestoreCloudBackup(backup, true); restoreTarget = null }) { Text("快照后替换") } } })
    }
    deleteTarget?.let { backup ->
        AlertDialog(onDismissRequest = { deleteTarget = null }, title = { Text("删除云端备份清单") },
            text = { Text("删除这份备份的快照清单后将无法再从列表恢复。共享内容块不会立即删除，避免影响其他快照。") },
            confirmButton = { TextButton(onClick = { onDeleteCloudBackup(backup); deleteTarget = null }) { Text("删除", color = Color(0xFF9B2C2C)) } },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("取消") } })
    }
}

@Composable
internal fun DataProtectionScreen(
    snapshots: List<NativeSnapshot>, busy: Boolean,
    onCapture: (String) -> Unit, onRestore: (String) -> Unit, onDelete: (String) -> Unit,
) {
    var reason by remember { mutableStateOf("") }
    var restoreTarget by remember { mutableStateOf<NativeSnapshot?>(null) }
    var deleteTarget by remember { mutableStateOf<NativeSnapshot?>(null) }
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            InfoCard("本机完整快照", "最多保留 8 份完整 SRL ZIP。恢复前会再自动保存当前状态；本机快照不能代替异地备份。") {
                OutlinedTextField(reason, { reason = it.take(80) }, label = { Text("快照说明（可选）") }, singleLine = true)
                Button(onClick = { onCapture(reason); reason = "" }, enabled = !busy, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("创建完整快照") }
            }
        }
        if (snapshots.isEmpty()) item { Text("还没有本机快照", modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.titleMedium) }
        items(snapshots, key = { it.id }) { snapshot ->
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(snapshot.reason, fontWeight = FontWeight.Bold)
                    Text("${DateFormat.getDateTimeInstance().format(Date(snapshot.createdAt))} · ${snapshot.resourceCount} 项 · ${formatBytes(snapshot.size)}", style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { restoreTarget = snapshot }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("恢复") }
                        TextButton(onClick = { deleteTarget = snapshot }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("删除", color = Color(0xFF9B2C2C)) }
                    }
                }
            }
        }
    }
    restoreTarget?.let { snapshot ->
        AlertDialog(onDismissRequest = { restoreTarget = null }, title = { Text("恢复完整快照") }, text = { Text("当前资源库会先自动保存，再替换为“${snapshot.reason}”。确定继续？") },
            confirmButton = { TextButton(onClick = { onRestore(snapshot.id); restoreTarget = null }) { Text("恢复") } }, dismissButton = { TextButton(onClick = { restoreTarget = null }) { Text("取消") } })
    }
    deleteTarget?.let { snapshot ->
        AlertDialog(onDismissRequest = { deleteTarget = null }, title = { Text("删除本机快照") }, text = { Text("“${snapshot.reason}”删除后无法恢复，确定删除？") },
            confirmButton = { TextButton(onClick = { onDelete(snapshot.id); deleteTarget = null }) { Text("删除", color = Color(0xFF9B2C2C)) } }, dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("取消") } })
    }
}

@Composable
internal fun SettingsScreen(
    resourceCount: Int,
    storagePath: String,
    snapshotCount: Int,
    busy: Boolean,
    onOpenProtection: () -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { InfoCard("原生运行状态", "当前界面、SQLite 查询索引、资源原件、文件导入、分享接收、搜索、收藏和 ZIP 导出均在 Android 本机运行，未创建 WebView，也不加载远程网页。") {} }
        item {
            InfoCard("版本", "${BuildConfig.VERSION_NAME}\n本机资源：$resourceCount 项") {}
        }
        item {
            InfoCard("本地数据", "资源原件和 library-index.json 保存到手机的 SRL 本地目录；SQLite 仅作为查询索引。\n\n位置：$storagePath\n\n卸载或更换手机前，请先导出 ZIP 备份。") {}
        }
        item {
            InfoCard("数据保护与历史版本", "管理本机完整快照、删除前保护和安全回退。当前共有 $snapshotCount 份本机快照。") {
                OutlinedButton(onClick = onOpenProtection, enabled = !busy, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                    Text("打开本地保险库")
                }
            }
        }
    }
}
