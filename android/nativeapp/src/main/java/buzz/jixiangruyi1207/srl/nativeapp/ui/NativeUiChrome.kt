package buzz.jixiangruyi1207.srl.nativeapp.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.border
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

internal var nativeDarkPalette = false
internal val cream: Color get() = if (nativeDarkPalette) Color(0xFF10262C) else Color(0xFFE8F3F5)
internal val teal: Color get() = if (nativeDarkPalette) Color(0xFF70CDD0) else Color(0xFF1D707B)
internal val paleTeal: Color get() = if (nativeDarkPalette) Color(0xFF1B444B) else Color(0xFFD8EEEC)
internal val ink: Color get() = if (nativeDarkPalette) Color(0xFFEAF8F8) else Color(0xFF183842)
internal val inkSoft: Color get() = if (nativeDarkPalette) Color(0xFFA9C5C9) else Color(0xFF59727C)
internal val raised: Color get() = if (nativeDarkPalette) Color(0xFF18343A) else Color(0xFFFBFEFE)

@Composable
internal fun NativeMobileHeader(showFilter: Boolean, filtersOpen: Boolean, onToggleFilters: () -> Unit) {
    Box(
        modifier = Modifier.fillMaxWidth()
            .background(Brush.horizontalGradient(listOf(raised.copy(alpha = 0.96f), Color(0xFFEAF7F8).copy(alpha = 0.94f))))
            .statusBarsPadding(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Box(
                modifier = Modifier.size(42.dp).background(raised, CircleShape).border(1.dp, Color(0xFF6A9CA8).copy(alpha = 0.44f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text("SRL", color = teal, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
            }
            Text(
                "酒馆资源库",
                modifier = Modifier.weight(1f),
                color = ink,
                fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.titleMedium,
            )
            if (showFilter) {
                Surface(
                    modifier = Modifier.size(44.dp).clickable(onClick = onToggleFilters),
                    shape = CircleShape,
                    color = if (filtersOpen) paleTeal else raised.copy(alpha = 0.82f),
                    border = androidx.compose.foundation.BorderStroke(1.dp, if (filtersOpen) teal.copy(alpha = 0.55f) else Color(0xFF6A9CA8).copy(alpha = 0.28f)),
                ) {
                    Box(contentAlignment = Alignment.Center) { NativeLineIcon(NavGlyph.Filter, if (filtersOpen) teal else inkSoft) }
                }
            }
        }
    }
}

@Composable
internal fun StatusBanner(busy: Boolean, message: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)
            .background(paleTeal.copy(alpha = 0.8f), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(10.dp))
        }
        Text(message, style = MaterialTheme.typography.bodySmall, color = ink)
    }
}

@Composable
internal fun NativeBottomNavigation(page: Int, onPage: (Int) -> Unit, onOpenImport: () -> Unit) {
    Surface(color = raised.copy(alpha = 0.98f), shadowElevation = 16.dp, tonalElevation = 0.dp) {
        Row(
            modifier = Modifier.fillMaxWidth().height(82.dp).padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            NativeNavItem(NavGlyph.Library, "资源库", page == 0, Modifier.weight(1f)) { onPage(0) }
            NativeNavItem(NavGlyph.Features, "功能", page == 1, Modifier.weight(1f)) { onPage(1) }
            Column(
                modifier = Modifier.weight(1.18f).clickable(onClick = onOpenImport),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Box(
                    modifier = Modifier.size(54.dp).background(teal, CircleShape).border(4.dp, raised, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Text("+", color = Color.White, style = MaterialTheme.typography.headlineMedium) }
                Text("资源 / 备份", color = inkSoft, style = MaterialTheme.typography.labelSmall, maxLines = 1)
            }
            NativeNavItem(NavGlyph.Export, "导出", page == 3, Modifier.weight(1f)) { onPage(3) }
            NativeNavItem(NavGlyph.Settings, "设置", page == 4, Modifier.weight(1f)) { onPage(4) }
        }
    }
}

@Composable
internal fun FeaturePageHeader(title: String, subtitle: String, onBack: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        OutlinedButton(onClick = onBack, modifier = Modifier.height(44.dp), shape = RoundedCornerShape(14.dp)) { Text("返回") }
        Column(Modifier.weight(1f)) {
            Text(title, color = ink, fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleLarge)
            Text(subtitle, color = inkSoft, style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun NativeNavItem(icon: NavGlyph, label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier.fillMaxSize().clickable(onClick = onClick)
            .background(if (selected) paleTeal else Color.Transparent, RoundedCornerShape(14.dp)).padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        NativeLineIcon(icon, if (selected) teal else inkSoft)
        Text(label, color = if (selected) teal else inkSoft, style = MaterialTheme.typography.labelSmall)
    }
}

private enum class NavGlyph { Library, Features, Export, Settings, Filter }

@Composable
private fun NativeLineIcon(glyph: NavGlyph, color: Color, modifier: Modifier = Modifier.size(23.dp)) {
    Canvas(modifier = modifier) {
        val stroke = 1.65.dp.toPx()
        val outline = Stroke(width = stroke, cap = StrokeCap.Round)
        when (glyph) {
            NavGlyph.Library, NavGlyph.Features -> {
                val box = size.minDimension * if (glyph == NavGlyph.Library) 0.27f else 0.29f
                val gap = size.minDimension * 0.16f
                val start = (size.minDimension - box * 2 - gap) / 2
                for (row in 0..1) for (column in 0..1) {
                    drawRoundRect(
                        color = color,
                        topLeft = androidx.compose.ui.geometry.Offset(start + column * (box + gap), start + row * (box + gap)),
                        size = androidx.compose.ui.geometry.Size(box, if (glyph == NavGlyph.Library && row == 1) box * 0.7f else box),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(2.dp.toPx()),
                        style = outline,
                    )
                }
            }
            NavGlyph.Export -> {
                drawLine(color, androidx.compose.ui.geometry.Offset(size.width * 0.5f, size.height * 0.13f), androidx.compose.ui.geometry.Offset(size.width * 0.5f, size.height * 0.69f), stroke, StrokeCap.Round)
                val arrow = Path().apply {
                    moveTo(size.width * 0.29f, size.height * 0.51f)
                    lineTo(size.width * 0.5f, size.height * 0.72f)
                    lineTo(size.width * 0.71f, size.height * 0.51f)
                }
                drawPath(arrow, color, style = outline)
                drawLine(color, androidx.compose.ui.geometry.Offset(size.width * 0.2f, size.height * 0.87f), androidx.compose.ui.geometry.Offset(size.width * 0.8f, size.height * 0.87f), stroke, StrokeCap.Round)
            }
            NavGlyph.Settings -> {
                drawCircle(color, radius = size.minDimension * 0.18f, style = outline)
                drawCircle(color, radius = size.minDimension * 0.38f, style = outline)
                repeat(8) { index ->
                    val angle = Math.PI * 2 * index / 8
                    drawLine(
                        color,
                        androidx.compose.ui.geometry.Offset(size.width / 2 + cos(angle).toFloat() * size.minDimension * 0.38f, size.height / 2 + sin(angle).toFloat() * size.minDimension * 0.38f),
                        androidx.compose.ui.geometry.Offset(size.width / 2 + cos(angle).toFloat() * size.minDimension * 0.48f, size.height / 2 + sin(angle).toFloat() * size.minDimension * 0.48f),
                        stroke,
                        StrokeCap.Round,
                    )
                }
            }
            NavGlyph.Filter -> {
                drawLine(color, androidx.compose.ui.geometry.Offset(size.width * 0.18f, size.height * 0.28f), androidx.compose.ui.geometry.Offset(size.width * 0.82f, size.height * 0.28f), stroke, StrokeCap.Round)
                drawLine(color, androidx.compose.ui.geometry.Offset(size.width * 0.29f, size.height * 0.5f), androidx.compose.ui.geometry.Offset(size.width * 0.71f, size.height * 0.5f), stroke, StrokeCap.Round)
                drawLine(color, androidx.compose.ui.geometry.Offset(size.width * 0.4f, size.height * 0.72f), androidx.compose.ui.geometry.Offset(size.width * 0.6f, size.height * 0.72f), stroke, StrokeCap.Round)
            }
        }
    }
}

internal fun Set<String>.toggle(value: String): Set<String> = if (value in this) this - value else this + value

@Composable
internal fun FeatureEntry(title: String, body: String, status: String, onClick: (() -> Unit)?) {
    Card(
        modifier = Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        colors = CardDefaults.cardColors(containerColor = raised.copy(alpha = 0.88f)),
        shape = RoundedCornerShape(22.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.8f)),
    ) {
        Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(48.dp).background(paleTeal, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
                Text(title.take(1), color = teal, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, fontWeight = FontWeight.Bold, color = ink)
                Text(body, style = MaterialTheme.typography.bodySmall, color = inkSoft)
            }
            Text(status, color = if (onClick != null) teal else inkSoft, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
internal fun InfoCard(title: String, body: String, actions: @Composable () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = raised.copy(alpha = 0.9f), contentColor = ink),
        shape = RoundedCornerShape(22.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.82f)),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = teal)
            Text(body, style = MaterialTheme.typography.bodyMedium, color = ink)
            actions()
        }
    }
}

@Composable
internal fun BackupSelectionRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

internal fun formatBytes(bytes: Long): String = when {
    bytes >= 1024L * 1024L -> "%.1f MB".format(bytes / 1024.0 / 1024.0)
    bytes >= 1024L -> "%.1f KB".format(bytes / 1024.0)
    else -> "$bytes B"
}
