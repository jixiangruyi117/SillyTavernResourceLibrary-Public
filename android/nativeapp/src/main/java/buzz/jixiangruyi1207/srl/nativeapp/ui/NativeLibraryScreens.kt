package buzz.jixiangruyi1207.srl.nativeapp.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeCategory
import buzz.jixiangruyi1207.srl.nativeapp.model.resourceTypeLabels
import java.text.DateFormat
import java.util.Date

@Composable
internal fun ResourceLibrary(
    resources: List<NativeResource>,
    categories: List<NativeCategory>,
    versions: List<NativeResource>,
    layoutMode: String,
    filtersOpen: Boolean,
    onImport: () -> Unit,
    onOpenProtection: () -> Unit,
    onOpenAiTagging: (List<String>) -> Unit,
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
) {
    var query by remember { mutableStateOf("") }
    var favoritesOnly by remember { mutableStateOf(false) }
    var typeFilter by remember { mutableStateOf<String?>(null) }
    var categoryId by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<NativeResource?>(null) }
    var manageCategories by remember { mutableStateOf(false) }
    var batchMode by remember { mutableStateOf(false) }
    var selectedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    val visible = resources.filter { resource ->
        (!favoritesOnly || resource.favorite) && (typeFilter == null || resource.type == typeFilter) &&
            (categoryId == null || resource.categoryIds.contains(categoryId)) && (
            query.isBlank() || listOf(resource.name, resource.description, resource.fileName, resource.tags.joinToString(" "))
                .any { it.contains(query.trim(), ignoreCase = true) }
            )
    }
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(onClick = onOpenProtection, modifier = Modifier.weight(1f).height(44.dp)) { Text("数据保护") }
            OutlinedButton(
                onClick = {
                    batchMode = !batchMode
                    if (!batchMode) selectedIds = emptySet()
                },
                modifier = Modifier.weight(1f).height(44.dp),
            ) { Text(if (batchMode) "退出批量" else "批量管理") }
        }
        androidx.compose.foundation.lazy.LazyRow(
            modifier = Modifier.fillMaxWidth().background(raised.copy(alpha = 0.82f)).padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            contentPadding = PaddingValues(vertical = 7.dp),
        ) {
            item { FilterChip(selected = typeFilter == null, onClick = { typeFilter = null }, label = { Text("全部 ${resources.size}") }) }
            items(resourceTypeLabels.entries.filter { entry -> resources.any { it.type == entry.key } }.toList(), key = { it.key }) { entry ->
                val count = resources.count { it.type == entry.key }
                FilterChip(selected = typeFilter == entry.key, onClick = { typeFilter = if (typeFilter == entry.key) null else entry.key }, label = { Text("${entry.value} $count") })
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().background(cream.copy(alpha = 0.9f)).padding(horizontal = 14.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.weight(1f).height(52.dp),
                singleLine = true,
                placeholder = { Text("搜索名称、标签或文件", color = inkSoft) },
                shape = RoundedCornerShape(14.dp),
            )
            FilterChip(selected = favoritesOnly, onClick = { favoritesOnly = !favoritesOnly }, label = { Text("收藏") })
        }
        if (filtersOpen && categories.isNotEmpty()) {
            androidx.compose.foundation.lazy.LazyRow(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 4.dp),
            ) {
                item { FilterChip(selected = categoryId == null, onClick = { categoryId = null }, label = { Text("全部文件夹") }) }
                items(categories.filterNot { it.hidden }, key = { it.id }) { category ->
                    FilterChip(selected = categoryId == category.id, onClick = { categoryId = if (categoryId == category.id) null else category.id }, label = { Text(category.name) })
                }
            }
        }
        if (filtersOpen) {
            OutlinedButton(
                onClick = { manageCategories = true },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp).height(46.dp),
                shape = RoundedCornerShape(14.dp),
            ) { Text(if (categories.isEmpty()) "新建资源文件夹" else "新建 / 管理资源文件夹") }
        }
        if (batchMode) {
            Surface(color = paleTeal.copy(alpha = 0.92f), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("已选择 ${selectedIds.size} 项资源", color = ink, fontWeight = FontWeight.Bold)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedButton(
                            onClick = {
                                val visibleIds = visible.map(NativeResource::id).toSet()
                                selectedIds = if (visibleIds.isNotEmpty() && visibleIds.all { it in selectedIds }) {
                                    selectedIds - visibleIds
                                } else {
                                    selectedIds + visibleIds
                                }
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text("全选当前") }
                        Button(
                            onClick = { onOpenAiTagging(selectedIds.toList()) },
                            modifier = Modifier.weight(1f),
                        ) { Text("AI 识别标签") }
                    }
                }
            }
        }
        if (visible.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                    Text(if (resources.isEmpty()) "原生资源库还是空的" else "没有匹配的资源", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        if (resources.isEmpty()) {
                            "可直接导入角色卡、JSON 或网页端 SRL ZIP 备份。由旧网页 APK 切换时，请先导出 ZIP 再在此导入；原生版不会直接读取网页 IndexedDB。"
                        } else {
                            "换个关键词或关闭收藏筛选"
                        },
                        color = ink,
                    )
                    if (resources.isEmpty()) {
                        Spacer(Modifier.height(20.dp))
                        Button(onClick = onImport, modifier = Modifier.height(48.dp)) { Text("选择文件导入") }
                    }
                }
            }
        } else if (layoutMode == "list" || layoutMode == "split") {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(visible, key = { it.id }) { resource ->
                    ResourceCard(
                        resource, categories, versions.count { it.versionGroupId == resource.id }, false,
                        resource.id in selectedIds,
                        {
                            if (batchMode) selectedIds = if (resource.id in selectedIds) selectedIds - resource.id else selectedIds + resource.id
                            else selected = resource
                        },
                        { onToggleFavorite(resource.id) },
                    )
                }
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                gridItems(visible, key = { it.id }) { resource ->
                    ResourceCard(
                        resource, categories, versions.count { it.versionGroupId == resource.id }, true,
                        resource.id in selectedIds,
                        {
                            if (batchMode) selectedIds = if (resource.id in selectedIds) selectedIds - resource.id else selectedIds + resource.id
                            else selected = resource
                        },
                        { onToggleFavorite(resource.id) },
                    )
                }
            }
        }
    }
    selected?.let { resource ->
        ResourceDialog(resource, categories, versions.filter { it.versionGroupId == resource.id }, { selected = null }, { onToggleFavorite(resource.id) },
            { name, description, tags -> onUpdateResourceDetails(resource.id, name, description, tags); selected = null },
            { ids -> onSetResourceCategories(resource.id, ids) }, { onDeleteResource(resource.id); selected = null }, onActivateVersion, onUpdateVersionNote, onDeleteVersion)
    }
    if (manageCategories) CategoryManagerDialog(categories, { manageCategories = false }, onCreateCategory, onUpdateCategory, onDeleteCategory)
}

@Composable
private fun ResourceCard(resource: NativeResource, categories: List<NativeCategory>, versionCount: Int, compact: Boolean, selected: Boolean, onOpen: () -> Unit, onFavorite: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
        colors = CardDefaults.cardColors(containerColor = if (selected) paleTeal else raised.copy(alpha = 0.9f)),
        shape = RoundedCornerShape(22.dp),
        border = androidx.compose.foundation.BorderStroke(if (selected) 2.dp else 1.dp, if (selected) teal else Color.White.copy(alpha = 0.82f)),
    ) {
        if (compact) {
            Column(modifier = Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(resourceTypeLabels[resource.type] ?: "其他", color = teal, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                    TextButton(onClick = onFavorite, modifier = Modifier.size(44.dp)) { Text(if (resource.favorite) "★" else "☆") }
                }
                Text(resource.name, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (resource.description.isNotBlank()) Text(resource.description, maxLines = 3, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                if (resource.tags.isNotEmpty()) Text(resource.tags.take(3).joinToString(" · "), color = teal, style = MaterialTheme.typography.labelSmall, maxLines = 2)
                val categoryNames = categories.filter { resource.categoryIds.contains(it.id) }.map { it.name }
                if (categoryNames.isNotEmpty()) Text(categoryNames.take(2).joinToString(" · "), color = inkSoft, style = MaterialTheme.typography.labelSmall)
                if (versionCount > 0) Text("历史版本 $versionCount 个", color = teal, style = MaterialTheme.typography.labelSmall)
            }
        } else Row(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(resourceTypeLabels[resource.type] ?: "其他", color = teal, style = MaterialTheme.typography.labelMedium)
                Text(resource.name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (resource.description.isNotBlank()) Text(resource.description, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                if (resource.tags.isNotEmpty()) Text(resource.tags.take(4).joinToString(" · "), color = teal, style = MaterialTheme.typography.labelSmall)
                val categoryNames = categories.filter { resource.categoryIds.contains(it.id) }.map { it.name }
                if (categoryNames.isNotEmpty()) Text(categoryNames.joinToString(" · "), color = ink, style = MaterialTheme.typography.labelSmall)
                if (versionCount > 0) Text("历史版本 $versionCount 个", color = teal, style = MaterialTheme.typography.labelSmall)
            }
            TextButton(onClick = onFavorite, modifier = Modifier.size(48.dp)) { Text(if (resource.favorite) "★" else "☆") }
        }
    }
}

@Composable
private fun ResourceDialog(
    resource: NativeResource,
    categories: List<NativeCategory>,
    versions: List<NativeResource>,
    onDismiss: () -> Unit,
    onFavorite: () -> Unit,
    onUpdateDetails: (String, String, List<String>) -> Unit,
    onSetCategories: (List<String>) -> Unit,
    onDeleteResource: () -> Unit,
    onActivateVersion: (String, String) -> Unit,
    onUpdateVersionNote: (String, String, String) -> Unit,
    onDeleteVersion: (String, String) -> Unit,
) {
    var selectedIds by remember(resource.id, resource.categoryIds) { mutableStateOf(resource.categoryIds) }
    var editableName by remember(resource.id) { mutableStateOf(resource.name) }
    var editableDescription by remember(resource.id) { mutableStateOf(resource.description) }
    var editableTags by remember(resource.id) { mutableStateOf(resource.tags.joinToString("，")) }
    var selectedVersion by remember { mutableStateOf<NativeResource?>(null) }
    var confirmDeleteResource by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(resource.name) },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("类型：${resourceTypeLabels[resource.type] ?: "其他"}")
                Text("文件：${resource.fileName}")
                Text("大小：${formatBytes(resource.fileSize)}")
                Text("导入时间：${DateFormat.getDateTimeInstance().format(Date(resource.createdAt))}")
                OutlinedTextField(editableName, { editableName = it.take(200) }, label = { Text("资源名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(editableDescription, { editableDescription = it.take(20_000) }, label = { Text("说明") }, minLines = 3, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(editableTags, { editableTags = it.take(2_000) }, label = { Text("标签（逗号或换行分隔）") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                Button(onClick = {
                    val tags = editableTags.split(Regex("[,，\\n]")).map(String::trim).filter(String::isNotBlank)
                    onUpdateDetails(editableName, editableDescription, tags)
                }, enabled = editableName.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("保存名称、说明和标签") }
                if (categories.isNotEmpty()) {
                    Text("所属文件夹", fontWeight = FontWeight.Bold)
                    categories.filterNot { it.hidden }.forEach { category ->
                        FilterChip(
                            selected = selectedIds.contains(category.id),
                            onClick = { selectedIds = if (selectedIds.contains(category.id)) selectedIds - category.id else selectedIds + category.id },
                            label = { Text(category.name) },
                        )
                    }
                    OutlinedButton(onClick = { onSetCategories(selectedIds) }, modifier = Modifier.fillMaxWidth()) { Text("保存文件夹") }
                }
                Text("SHA-256：${resource.contentHash.take(16)}…", style = MaterialTheme.typography.labelSmall)
                if (versions.isNotEmpty()) {
                    Text("历史版本", fontWeight = FontWeight.Bold)
                    versions.forEach { version ->
                        OutlinedButton(onClick = { selectedVersion = version }, modifier = Modifier.fillMaxWidth()) {
                            Text(version.versionLabel.ifBlank { version.fileName }, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                TextButton(onClick = { confirmDeleteResource = true }, modifier = Modifier.fillMaxWidth()) { Text("删除资源", color = Color(0xFF9B2C2C)) }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("关闭") } },
        dismissButton = { TextButton(onClick = onFavorite) { Text(if (resource.favorite) "取消收藏" else "收藏") } },
    )
    selectedVersion?.let { version ->
        VersionDialog(resource, version, { selectedVersion = null }, onActivateVersion, onUpdateVersionNote, onDeleteVersion)
    }
    if (confirmDeleteResource) AlertDialog(
        onDismissRequest = { confirmDeleteResource = false }, title = { Text("删除资源") },
        text = { Text("删除前会自动创建完整快照；资源及其历史版本随后从本机移除。确定删除？") },
        confirmButton = { TextButton(onClick = { confirmDeleteResource = false; onDeleteResource() }) { Text("删除", color = Color(0xFF9B2C2C)) } },
        dismissButton = { TextButton(onClick = { confirmDeleteResource = false }) { Text("取消") } },
    )
}

@Composable
private fun VersionDialog(
    resource: NativeResource,
    version: NativeResource,
    onDismiss: () -> Unit,
    onActivate: (String, String) -> Unit,
    onSaveNote: (String, String, String) -> Unit,
    onDelete: (String, String) -> Unit,
) {
    var note by remember(version.id) { mutableStateOf(version.versionNote) }
    var confirmDelete by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(version.versionLabel.ifBlank { version.fileName }) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${formatBytes(version.fileSize)} · ${DateFormat.getDateTimeInstance().format(Date(version.versionImportedAt))}")
                OutlinedTextField(note, { note = it.take(240) }, label = { Text("版本备注") }, minLines = 2)
                Button(onClick = { onActivate(resource.id, version.id); onDismiss() }, modifier = Modifier.fillMaxWidth()) { Text("切换为当前版本") }
                OutlinedButton(onClick = { onSaveNote(resource.id, version.id, note) }, modifier = Modifier.fillMaxWidth()) { Text("保存备注") }
                TextButton(onClick = { confirmDelete = true }, modifier = Modifier.fillMaxWidth()) { Text("删除这个历史版本", color = Color(0xFF9B2C2C)) }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("关闭") } },
    )
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("删除历史版本") },
        text = { Text("删除后无法从本机恢复，当前版本不会受影响。确定删除？") },
        confirmButton = { TextButton(onClick = { onDelete(resource.id, version.id); confirmDelete = false; onDismiss() }) { Text("删除", color = Color(0xFF9B2C2C)) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("取消") } },
    )
}

@Composable
private fun CategoryManagerDialog(
    categories: List<NativeCategory>,
    onDismiss: () -> Unit,
    onCreate: (String, String) -> Unit,
    onUpdate: (NativeCategory, String, String, Boolean) -> Unit,
    onDelete: (NativeCategory) -> Unit,
) {
    var editing by remember { mutableStateOf<NativeCategory?>(null) }
    var name by remember(editing) { mutableStateOf(editing?.name.orEmpty()) }
    var color by remember(editing) { mutableStateOf(editing?.color ?: "#1f777d") }
    var deleteTarget by remember { mutableStateOf<NativeCategory?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("管理文件夹") },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(name, { name = it }, label = { Text("文件夹名称") }, singleLine = true)
                        OutlinedTextField(color, { color = it }, label = { Text("颜色（#RRGGBB）") }, singleLine = true)
                        Button(onClick = {
                            val current = editing
                            if (current == null) onCreate(name, color) else onUpdate(current, name, color, current.hidden)
                            editing = null; name = ""; color = "#1f777d"
                        }, modifier = Modifier.fillMaxWidth()) { Text(if (editing == null) "创建文件夹" else "保存修改") }
                    }
                }
                items(categories, key = { it.id }) { category ->
                    Card(modifier = Modifier.fillMaxWidth().clickable { editing = category }) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(category.name, modifier = Modifier.weight(1f), color = if (category.hidden) Color.Gray else ink)
                            TextButton(onClick = { onUpdate(category, category.name, category.color, !category.hidden) }) { Text(if (category.hidden) "恢复" else "隐藏") }
                            TextButton(onClick = { deleteTarget = category }) { Text("删除", color = Color(0xFF9B2C2C)) }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("完成") } },
    )
    deleteTarget?.let { category ->
        AlertDialog(onDismissRequest = { deleteTarget = null }, title = { Text("删除文件夹") },
            text = { Text("删除前会自动创建完整快照；其中资源会移到“未放入文件夹”。确定删除“${category.name}”？") },
            confirmButton = { TextButton(onClick = { onDelete(category); deleteTarget = null }) { Text("删除", color = Color(0xFF9B2C2C)) } },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("取消") } })
    }
}
