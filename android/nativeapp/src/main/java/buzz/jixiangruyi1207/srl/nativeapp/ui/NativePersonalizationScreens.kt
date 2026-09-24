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
import androidx.compose.foundation.border
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeCategory
import buzz.jixiangruyi1207.srl.nativeapp.model.resourceTypeLabels
import buzz.jixiangruyi1207.srl.nativeapp.draw.NativeDrawFreshness
import buzz.jixiangruyi1207.srl.nativeapp.draw.NativeDrawOptions
import buzz.jixiangruyi1207.srl.nativeapp.draw.NativeDrawState
import buzz.jixiangruyi1207.srl.nativeapp.appearance.NativeAppearanceState
import buzz.jixiangruyi1207.srl.nativeapp.cabinet.NativeCabinetState

@Composable
internal fun NativeFeatureHub(
    drawCount: Int,
    onOpenDraw: () -> Unit,
    onOpenAppearance: () -> Unit,
    folderCount: Int,
    onOpenCabinet: () -> Unit,
    externalPackageCount: Int,
    onOpenExtensions: () -> Unit,
    onOpenTransfer: () -> Unit,
    onOpenTavernBridge: () -> Unit,
    onOpenPersona: () -> Unit,
    onOpenStitch: () -> Unit,
    onOpenBundle: () -> Unit,
    onOpenWorkshop: () -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("功能桌面", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = ink)
            Text("整理、保护与流转你的酒馆资源", color = inkSoft)
        }
        item { FeatureEntry("抽了么", "从角色档案中随机相遇", "$drawCount 次", onOpenDraw) }
        item { FeatureEntry("外观", "主题、排版与自定义 CSS", "个性化工作台", onOpenAppearance) }
        item { FeatureEntry("收藏柜", "可视化文件夹与拖放整理", "$folderCount 个文件夹", onOpenCabinet) }
        item { FeatureEntry("云备份", "GitHub 与 WebDAV", "迁移验收中", onOpenTransfer) }
        item { FeatureEntry("酒馆互传", "角色卡、世界书与预设", "迁移验收中", onOpenTavernBridge) }
        item { FeatureEntry("缝了么", "从多个预设挑段缝合", "迁移验收中", onOpenStitch) }
        item { FeatureEntry("前端了么", "状态栏正则与提示词", "迁移验收中", onOpenWorkshop) }
        item { FeatureEntry("user才是老大", "名字、设定与专属世界", "迁移验收中", onOpenPersona) }
        item { FeatureEntry("配了么", "角色卡与配套资源装配", "迁移验收中", onOpenBundle) }
        item { FeatureEntry("扩展", "导入、预览与管理本地第三方 APP", "$externalPackageCount 个已审计", onOpenExtensions) }
    }
}

@Composable
internal fun NativeCharacterDrawScreen(
    resources: List<NativeResource>,
    categories: List<NativeCategory>,
    state: NativeDrawState,
    resultIds: List<String>,
    busy: Boolean,
    onDraw: (NativeDrawOptions) -> Unit,
    onClear: () -> Unit,
) {
    val characterCards = resources.filter { it.type == "characterCard" }
    var categoryId by remember { mutableStateOf<String?>(null) }
    var tag by remember { mutableStateOf("") }
    var favoritesOnly by remember { mutableStateOf(false) }
    var freshness by remember { mutableStateOf(NativeDrawFreshness.ALL) }
    val now = System.currentTimeMillis()
    val pool = characterCards.filter { resource ->
        (categoryId == null || categoryId in resource.categoryIds) &&
            (tag.isBlank() || tag.trim() in resource.tags) &&
            (!favoritesOnly || resource.favorite) &&
            when (freshness) {
                NativeDrawFreshness.ALL -> true
                NativeDrawFreshness.NEVER -> state.records[resource.id] == null
                NativeDrawFreshness.NOT_SEVEN_DAYS -> state.records[resource.id]?.let { now - it.lastDrawnAt >= 7L * 24L * 60L * 60L * 1000L } ?: true
            }
    }
    val resultResources = resultIds.mapNotNull { id -> resources.firstOrNull { it.id == id } }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DrawStat("累计抽取", state.totalDraws.toString(), Modifier.weight(1f))
                DrawStat("抽取轮次", state.totalSessions.toString(), Modifier.weight(1f))
                DrawStat("相遇角色", state.records.size.toString(), Modifier.weight(1f))
            }
        }
        item {
            InfoCard("抽取范围", "当前有 ${characterCards.size} 张角色卡，筛选后 ${pool.size} 张可参与；筛选和记录只影响抽取，不修改资源。") {
                Text("文件夹", color = inkSoft, style = MaterialTheme.typography.labelMedium)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = categoryId == null, onClick = { categoryId = null }, label = { Text("全部") })
                    categories.filter { !it.hidden }.forEach { category ->
                        FilterChip(selected = categoryId == category.id, onClick = { categoryId = category.id }, label = { Text(category.name, maxLines = 1) })
                    }
                }
                OutlinedTextField(
                    value = tag,
                    onValueChange = { tag = it },
                    label = { Text("标签（精确匹配，可留空）") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("仅收藏", modifier = Modifier.weight(1f), color = ink)
                    Switch(checked = favoritesOnly, onCheckedChange = { favoritesOnly = it })
                }
                Text("新鲜度", color = inkSoft, style = MaterialTheme.typography.labelMedium)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = freshness == NativeDrawFreshness.ALL, onClick = { freshness = NativeDrawFreshness.ALL }, label = { Text("不限") })
                    FilterChip(selected = freshness == NativeDrawFreshness.NOT_SEVEN_DAYS, onClick = { freshness = NativeDrawFreshness.NOT_SEVEN_DAYS }, label = { Text("七日未见") })
                    FilterChip(selected = freshness == NativeDrawFreshness.NEVER, onClick = { freshness = NativeDrawFreshness.NEVER }, label = { Text("从未抽到") })
                }
            }
        }
        item {
            val options: (Int) -> NativeDrawOptions = { count ->
                NativeDrawOptions(count, categoryId, tag.trim().ifBlank { null }, favoritesOnly, freshness)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(onClick = { onDraw(options(1)) }, enabled = !busy && pool.isNotEmpty(), modifier = Modifier.weight(1f).height(52.dp)) { Text("抽取一次") }
                OutlinedButton(onClick = { onDraw(options(10)) }, enabled = !busy && pool.isNotEmpty(), modifier = Modifier.weight(1f).height(52.dp)) { Text("十连抽取") }
            }
        }
        if (resultResources.isNotEmpty()) {
            item { Text(if (resultResources.size == 1) "本次相遇" else "本轮十连", fontWeight = FontWeight.Bold, color = ink) }
            items(resultResources) { resource ->
                Card(colors = CardDefaults.cardColors(containerColor = raised.copy(alpha = 0.93f)), shape = RoundedCornerShape(18.dp)) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(resource.name, fontWeight = FontWeight.Bold, color = ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(resource.tags.take(4).joinToString(" · ").ifBlank { "暂无标签" }, color = inkSoft, style = MaterialTheme.typography.bodySmall)
                        }
                        Text("第 ${state.records[resource.id]?.count ?: 1} 次", color = teal, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        if (state.history.isNotEmpty()) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("最近抽取", modifier = Modifier.weight(1f), fontWeight = FontWeight.Bold, color = ink)
                    TextButton(onClick = onClear, enabled = !busy) { Text("清除记录") }
                }
            }
            items(state.history.take(4), key = { it.id }) { history ->
                val names = history.resourceIds.mapNotNull { id -> resources.firstOrNull { it.id == id }?.name }
                InfoCard(history.filterLabel, names.joinToString("、").ifBlank { "对应角色卡已不在本机资源库" }) {}
            }
        }
        if (characterCards.isEmpty()) item { InfoCard("还没有角色卡", "先从资源库导入 PNG 或 JSON 角色卡，再回来抽取。") {} }
        item { Spacer(Modifier.height(20.dp)) }
    }
}

@Composable
private fun DrawStat(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = raised.copy(alpha = 0.88f)), shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.fillMaxWidth().padding(vertical = 12.dp, horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, color = teal, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
            Text(label, color = inkSoft, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
internal fun NativeAppearanceScreen(
    state: NativeAppearanceState,
    busy: Boolean,
    onSave: (String, String, Boolean, Int) -> Unit,
) {
    var theme by remember(state.theme) { mutableStateOf(state.theme) }
    var layoutMode by remember(state.layoutMode) { mutableStateOf(state.layoutMode) }
    var blurThumbnails by remember(state.blurThumbnails) { mutableStateOf(state.blurThumbnails) }
    var cabinetColumns by remember(state.cabinetColumns) { mutableIntStateOf(state.cabinetColumns) }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            InfoCard("原生外观", "主题和资源排版会直接作用于 Compose 页面；配置仍使用网页备份字段，因此在网页恢复后也能继续使用。") {
                Text("主题", fontWeight = FontWeight.Bold, color = ink)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = theme == "light", onClick = { theme = "light" }, label = { Text("浅色") })
                    FilterChip(selected = theme == "dark", onClick = { theme = "dark" }, label = { Text("深色") })
                }
                Text("资源库排版", fontWeight = FontWeight.Bold, color = ink)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = layoutMode == "grid", onClick = { layoutMode = "grid" }, label = { Text("双列卡片") })
                    FilterChip(selected = layoutMode == "list", onClick = { layoutMode = "list" }, label = { Text("单列列表") })
                    FilterChip(selected = layoutMode == "split", onClick = { layoutMode = "split" }, label = { Text("分栏兼容") })
                }
                Text("手机上“分栏兼容”使用单列列表 + 详情弹层；宽屏适配时可继续扩展为双栏，不改变备份值。", color = inkSoft, style = MaterialTheme.typography.bodySmall)
            }
        }
        item {
            InfoCard("收藏柜布局", "控制原生收藏柜每行项目数；手机屏幕会在保证触控尺寸时自动收敛。") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(2, 3, 4).forEach { count ->
                        FilterChip(selected = cabinetColumns == count, onClick = { cabinetColumns = count }, label = { Text("$count 列") })
                    }
                }
            }
        }
        item {
            InfoCard("图片隐私", "打开后，未来原生缩略图和收藏柜封面默认模糊；点开资源详情后再查看。") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("默认模糊缩略图", modifier = Modifier.weight(1f), color = ink)
                    Switch(checked = blurThumbnails, onCheckedChange = { blurThumbnails = it })
                }
            }
        }
        item {
            InfoCard(
                "网页 CSS 兼容保留",
                "备份中现有自定义 CSS ${state.customCss.length} 字、${state.presetCount} 个预设${if (state.activePresetId.isNotBlank()) "，含启用预设" else ""}。原生控件不会执行网页 CSS；这些内容保持原样参与导出和云备份，回到网页端仍可使用。",
            ) {}
        }
        item {
            Button(
                onClick = { onSave(theme, layoutMode, blurThumbnails, cabinetColumns) },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(if (busy) "正在保存…" else "保存并应用原生外观") }
        }
        item { Spacer(Modifier.height(20.dp)) }
    }
}

@Composable
internal fun NativeCabinetScreen(
    resources: List<NativeResource>,
    categories: List<NativeCategory>,
    state: NativeCabinetState,
    busy: Boolean,
    onSave: (List<String>) -> Unit,
) {
    var editing by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var selectedCategoryId by remember { mutableStateOf<String?>(null) }
    var draftIds by remember(state.resourceIds) { mutableStateOf(state.resourceIds) }
    val byId = resources.associateBy(NativeResource::id)
    val pinned = draftIds.mapNotNull(byId::get).filter { selectedCategoryId == null || selectedCategoryId in it.categoryIds }
    val candidates = resources.filter { resource ->
        resource.id !in draftIds && (query.isBlank() || listOf(resource.name, resource.fileName, resource.tags.joinToString(" ")).any { it.contains(query.trim(), true) })
    }
    val columns = state.columns.coerceIn(2, 4).coerceAtMost(3)
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            InfoCard("收藏柜桌面", "固定 ${draftIds.size} 项资源；文件夹与资源仍保存在原位置，收藏柜只记录桌面入口和顺序。") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { editing = !editing }, enabled = !busy, modifier = Modifier.weight(1f).height(48.dp)) {
                        Text(if (editing) "完成整理" else "整理收藏柜")
                    }
                    if (editing) OutlinedButton(
                        onClick = { onSave(draftIds); editing = false },
                        enabled = !busy,
                        modifier = Modifier.weight(1f).height(48.dp),
                    ) { Text("保存布局") }
                }
            }
        }
        if (categories.any { !it.hidden }) {
            item { Text("文件夹", fontWeight = FontWeight.Bold, color = ink) }
            items(categories.filter { !it.hidden }.chunked(columns)) { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { category ->
                        CabinetTile(
                            title = category.name,
                            detail = "${resources.count { category.id in it.categoryIds }} 项",
                            selected = selectedCategoryId == category.id,
                            modifier = Modifier.weight(1f),
                            onClick = { selectedCategoryId = if (selectedCategoryId == category.id) null else category.id },
                        )
                    }
                    repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("桌面资源", modifier = Modifier.weight(1f), fontWeight = FontWeight.Bold, color = ink)
                if (selectedCategoryId != null) TextButton(onClick = { selectedCategoryId = null }) { Text("显示全部") }
            }
        }
        if (pinned.isEmpty()) {
            item { InfoCard("还没有桌面资源", if (editing) "从下方资源清单添加；保存后会随本地和云端备份迁移。" else "点击“整理收藏柜”添加常用资源。") {} }
        } else {
            items(pinned.chunked(columns)) { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { resource ->
                        CabinetTile(
                            title = resource.name,
                            detail = resourceTypeLabels[resource.type] ?: "其他",
                            selected = false,
                            modifier = Modifier.weight(1f),
                            onClick = {},
                        )
                    }
                    repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
        if (editing) {
            item {
                Text("调整顺序", fontWeight = FontWeight.Bold, color = ink)
                Text("手机端使用上移/下移，避免拖拽与页面滚动冲突。", color = inkSoft, style = MaterialTheme.typography.bodySmall)
            }
            items(draftIds.mapNotNull(byId::get), key = { "cabinet-order-${it.id}" }) { resource ->
                val index = draftIds.indexOf(resource.id)
                Card(colors = CardDefaults.cardColors(containerColor = raised.copy(alpha = 0.9f), contentColor = ink), shape = RoundedCornerShape(16.dp)) {
                    Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(resource.name, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, color = ink)
                        TextButton(onClick = {
                            if (index > 0) draftIds = draftIds.toMutableList().also { list -> val value = list.removeAt(index); list.add(index - 1, value) }
                        }, enabled = index > 0) { Text("上移") }
                        TextButton(onClick = {
                            if (index in 0 until draftIds.lastIndex) draftIds = draftIds.toMutableList().also { list -> val value = list.removeAt(index); list.add(index + 1, value) }
                        }, enabled = index in 0 until draftIds.lastIndex) { Text("下移") }
                        TextButton(onClick = { draftIds = draftIds - resource.id }) { Text("移除") }
                    }
                }
            }
            item {
                OutlinedTextField(query, { query = it }, label = { Text("搜索要固定的资源") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            }
            items(candidates.take(100), key = { "cabinet-add-${it.id}" }) { resource ->
                BridgeSelectionCard(resource.name, resourceTypeLabels[resource.type] ?: resource.type, false) { draftIds = draftIds + resource.id }
            }
        }
        item { Spacer(Modifier.height(20.dp)) }
    }
}

@Composable
private fun CabinetTile(
    title: String,
    detail: String,
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    Card(
        modifier = modifier.height(112.dp).clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = if (selected) paleTeal else raised.copy(alpha = 0.9f), contentColor = ink),
        shape = RoundedCornerShape(20.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, if (selected) teal else Color.White.copy(alpha = 0.75f)),
    ) {
        Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.Center) {
            Text(title, color = ink, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(detail, color = inkSoft, style = MaterialTheme.typography.labelSmall)
        }
    }
}
