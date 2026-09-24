package buzz.jixiangruyi1207.srl.nativeapp.workshop

import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class NativeWorkshopField(
    val label: String,
    val example: String,
    val group: String,
    val kind: String,
    val path: String,
)

data class NativeWorkshopResult(
    val regexResourceId: String,
    val worldBookResourceId: String,
    val title: String,
    val fieldCount: Int,
)

class NativeFrontendWorkshopService(private val store: NativeResourceStore) {
    fun parseFields(source: String): List<NativeWorkshopField> {
        val result = mutableListOf<NativeWorkshopField>()
        var group = "基础信息"
        val aliases = mapOf(
            "文本" to "text",
            "数字" to "number",
            "数值" to "number",
            "百分比" to "percent",
            "进度" to "percent",
            "标签" to "tags",
            "列表" to "tags",
            "长文本" to "longText",
            "描述" to "longText",
        )
        source.lines().forEach { raw ->
            val line = raw.trim()
            if (line.isBlank()) return@forEach
            Regex("^(?:#{1,3}\\s*|\\[|【)([^】\\]]+?)(?:】|\\])?$").matchEntire(line)?.let { match ->
                group = match.groupValues[1].trim().take(24).ifBlank { group }
                return@forEach
            }
            if (result.size >= 24) return@forEach
            val split = Regex("^(.{1,40}?)[：:]\\s*(.*)$").matchEntire(line)
            val rawLabel = (split?.groupValues?.get(1) ?: line).trim()
            val hint = Regex("^(.+?)(?:\\[|【)([^】\\]]+)(?:\\]|】)$").matchEntire(rawLabel)
            val label = (hint?.groupValues?.get(1) ?: rawLabel).trim().take(24)
            val example = split?.groupValues?.get(2)?.trim().orEmpty().ifBlank { "示例${result.size + 1}" }
            val kind = aliases[hint?.groupValues?.get(2)?.trim()] ?: when {
                example.endsWith("%") -> "percent"
                Regex("^-?\\d+(?:\\.\\d+)?$").matches(example) -> "number"
                Regex("[、，,]").containsMatchIn(example) -> "tags"
                example.length > 28 -> "longText"
                else -> "text"
            }
            result += NativeWorkshopField(
                label = label,
                example = example,
                group = group,
                kind = kind,
                path = if (group == "基础信息") label else "$group.$label",
            )
        }
        val seen = mutableSetOf<String>()
        return result.filter { it.label.isNotBlank() && seen.add(it.label.lowercase()) }
    }

    fun compileAndSave(
        fieldSource: String,
        designSource: String,
        requestedTitle: String,
        dataMode: String,
    ): NativeWorkshopResult {
        val fields = parseFields(fieldSource)
        require(fields.isNotEmpty()) { "请至少输入一行状态字段，例如“姓名：林言”" }
        require(dataMode in setOf("reply", "mvu")) { "状态栏数据模式无效" }
        val design = extractDesign(designSource)
        val template = design.getString("htmlTemplate").trim()
        validateTemplate(template, fields)
        val title = requestedTitle.trim()
            .ifBlank { design.optString("title", "自定义状态栏") }
            .take(60)
            .ifBlank { "自定义状态栏" }
        val findRegex = if (dataMode == "mvu") {
            "/<StatusPlaceHolder\\s*\\/\\s*>|<StatusPlaceHolder>\\s*<\\/StatusPlaceHolder>/gi"
        } else {
            buildReplyRegex(fields)
        }
        val replaceString = if (dataMode == "mvu") {
            buildMvuReplacement(fields, template)
        } else {
            fields.indices.fold(template) { current, index ->
                current.replace("{{field_${index + 1}}}", "\$${index + 1}")
            }
        }
        val regex = JSONObject()
            .put("id", UUID.randomUUID().toString())
            .put("scriptName", title)
            .put("findRegex", findRegex)
            .put("replaceString", replaceString)
            .put("trimStrings", JSONArray())
            .put("placement", JSONArray().put(2))
            .put("disabled", false)
            .put("markdownOnly", true)
            .put("promptOnly", false)
            .put("runOnEdit", true)
            .put("substituteRegex", 0)
            .put("minDepth", JSONObject.NULL)
            .put("maxDepth", JSONObject.NULL)
        val worldBook = buildWorldBook(title, buildPrompt(fields, dataMode), dataMode)
        val safeName = title.replace(Regex("[\\/:*?\"<>|]"), "_").take(120).ifBlank { "frontend-workshop" }
        val regexResource = store.importGeneratedJson("$safeName.regex.json", "${regex.toString(2)}\n")
        val worldResource = try {
            store.importGeneratedJson("$safeName.world.json", "${worldBook.toString(2)}\n")
        } catch (error: Exception) {
            store.deleteResource(regexResource.id)
            throw error
        }
        try {
            store.linkResources(listOf(regexResource.id, worldResource.id))
            val metadata = JSONObject()
                .put("frontendWorkshop", true)
                .put("dataMode", dataMode)
                .put("fieldCount", fields.size)
            store.annotateResource(regexResource.id, metadata, listOf(worldResource.id))
            store.annotateResource(worldResource.id, metadata, listOf(regexResource.id))
        } catch (error: Exception) {
            store.deleteResource(regexResource.id)
            store.deleteResource(worldResource.id)
            throw error
        }
        return NativeWorkshopResult(regexResource.id, worldResource.id, title, fields.size)
    }

    fun validateTemplate(template: String, fields: List<NativeWorkshopField>) {
        val issues = mutableListOf<String>()
        if (!Regex("<(?:section|div|article)\\b", RegexOption.IGNORE_CASE).containsMatchIn(template)) {
            issues += "模板没有状态栏 HTML 容器"
        }
        if (Regex("<(?:script|iframe|object|embed|html|head|body|base|link|meta|audio|video|source|track)\\b", RegexOption.IGNORE_CASE).containsMatchIn(template)) {
            issues += "模板包含脚本、iframe 或完整网页标签"
        }
        if (Regex("\\son\\w+\\s*=", RegexOption.IGNORE_CASE).containsMatchIn(template)) issues += "模板包含内联事件"
        if (Regex("javascript\\s*:|expression\\s*\\(|-moz-binding\\s*:", RegexOption.IGNORE_CASE).containsMatchIn(template)) {
            issues += "模板包含可执行 CSS 或 URL"
        }
        if (Regex("@import\\b", RegexOption.IGNORE_CASE).containsMatchIn(template)) issues += "模板禁止使用 @import"
        if (Regex("\\bposition\\s*:\\s*fixed\\b", RegexOption.IGNORE_CASE).containsMatchIn(template)) {
            issues += "模板禁止使用 position: fixed"
        }
        Regex("(?:https?:|data:|blob:|file:|ftp:)[^\\s\"'<>\\\\)]*", RegexOption.IGNORE_CASE)
            .findAll(template)
            .forEach { match ->
                if (!match.value.startsWith("https://", true)) {
                    issues += "外部资源只允许 HTTPS：${match.value.take(80)}"
                }
            }
        if (Regex("<\\s+[!/a-z]|</\\s+[a-z]", RegexOption.IGNORE_CASE).containsMatchIn(template)) {
            issues += "模板包含畸形 HTML 标签"
        }
        fields.indices.forEach { index ->
            val placeholder = "{{field_${index + 1}}}"
            val count = (template.length - template.replace(placeholder, "").length) / placeholder.length
            if (count == 0) issues += "模板漏掉了第 ${index + 1} 个字段占位符"
            if (count > 1) issues += "第 ${index + 1} 个字段占位符出现了 $count 次"
        }
        val extra = Regex("\\{\\{field_(\\d+)\\}\\}", RegexOption.IGNORE_CASE)
            .findAll(template)
            .map { it.groupValues[1].toIntOrNull() ?: 0 }
            .firstOrNull { it !in 1..fields.size }
        if (extra != null) issues += "模板包含不存在的字段占位符 field_$extra"
        require(issues.isEmpty()) { issues.joinToString("；") }
    }

    private fun extractDesign(source: String): JSONObject {
        val template = Regex("<SRL_TEMPLATE>\\s*([\\s\\S]*?)\\s*</SRL_TEMPLATE>", RegexOption.IGNORE_CASE)
            .find(source)?.groupValues?.get(1)?.trim()
        if (!template.isNullOrBlank()) {
            val metaSource = Regex("<SRL_META>\\s*([\\s\\S]*?)\\s*</SRL_META>", RegexOption.IGNORE_CASE)
                .find(source)?.groupValues?.get(1)
            val meta = runCatching { JSONObject(metaSource.orEmpty()) }.getOrElse { JSONObject() }
            return JSONObject(meta.toString()).put("htmlTemplate", template)
        }
        val trimmed = source.trim()
            .removePrefix("```html")
            .removePrefix("```css")
            .removePrefix("```")
            .removeSuffix("```")
            .trim()
        require(trimmed.startsWith("<style", true) && Regex("<(?:section|div|article)\\b", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) {
            "输出协议不完整：缺少 SRL_TEMPLATE，且没有可用的完整 HTML/CSS 模板"
        }
        return JSONObject().put("htmlTemplate", trimmed)
    }

    private fun buildReplyRegex(fields: List<NativeWorkshopField>): String {
        val lines = fields.joinToString("\\s*(?:\\r?\\n)+\\s*") { field ->
            "${Regex.escape(field.label)}[ \\t]*[：:][ \\t]*([^\\r\\n<]*?\\S[^\\r\\n<]*?)[ \\t]*(?=\\r?\\n|</StatusPlaceHolder>)"
        }
        return "/<StatusPlaceHolder>\\s*$lines\\s*</StatusPlaceHolder>/s"
    }

    private fun buildPrompt(fields: List<NativeWorkshopField>, mode: String): String = if (mode == "mvu") {
        """【MVU 状态栏占位协议｜必须执行】
本条目只负责显示状态栏，不替代角色卡现有的 [InitVar]、变量更新规则或 <UpdateVariable> 协议。
每次回复时，先正常完成正文并按角色卡原有 MVU 规则输出变量更新；然后在回复末尾原样输出且只输出一次：
<StatusPlaceHolder/>

不要使用 Markdown 代码围栏，不要改标签名，不要在占位符内部填写字段。"""
    } else {
        val body = fields.joinToString("\n") { "${it.label}: [${it.label}当前值]" }
        """【状态栏输出协议｜必须执行】
每次回复时，先正常完成正文；然后在回复末尾原样输出且只输出一次下面的状态块。
不要使用 Markdown 代码围栏，不要改标签名，不要增删字段，不要调整字段顺序。
每个字段值只能占一行；若值未知，填“未知”，不得留空，也不得嵌入 HTML/XML 标签。
<StatusPlaceHolder>
$body
</StatusPlaceHolder>"""
    }

    private fun buildMvuReplacement(fields: List<NativeWorkshopField>, template: String): String {
        val bound = fields.indices.fold(template) { current, index ->
            current.replace(
                "{{field_${index + 1}}}",
                "<%- __srlEscape(__srlRead(${JSONObject.quote(fields[index].path)})) %>",
            )
        }
        return """<%
if (typeof runType === 'undefined' || runType === 'render') {
  const __srlMessageId = typeof message_id === 'number' ? message_id : 'latest';
  const __srlGet = (target, path) => {
    const segments = String(path).split('.').map(segment => segment.trim()).filter(Boolean);
    if (segments.some(segment => ['__proto__', 'prototype', 'constructor'].includes(segment.toLowerCase()))) return undefined;
    let cursor = target;
    for (const segment of segments) { if (!cursor || typeof cursor !== 'object') return undefined; cursor = cursor[segment]; }
    return cursor;
  };
  let __srlVariables = {};
  try {
    const __srlHelper = typeof window !== 'undefined' ? window.TavernHelper : undefined;
    if (__srlHelper && typeof __srlHelper.getVariables === 'function') __srlVariables = __srlHelper.getVariables({ type: 'message', message_id: __srlMessageId }) ?? {};
  } catch (_error) { __srlVariables = {}; }
  const __srlDisplay = __srlVariables.display_data ?? {};
  const __srlState = __srlVariables.stat_data ?? {};
  const __srlRead = path => { const displayValue = __srlGet(__srlDisplay, path); const rawValue = displayValue === undefined ? __srlGet(__srlState, path) : displayValue; return Array.isArray(rawValue) ? (rawValue[0] ?? '未知') : (rawValue ?? '未知'); };
  const __srlEscape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
%>
$bound
<% } %>"""
    }

    private fun buildWorldBook(title: String, prompt: String, mode: String): JSONObject {
        val entry = JSONObject()
            .put("uid", 0)
            .put("key", JSONArray())
            .put("keysecondary", JSONArray())
            .put("comment", if (mode == "mvu") "$title · 状态栏输出协议 · 需酒馆助手、MVU、ST-Prompt-Template" else "$title · 状态栏输出协议")
            .put("content", prompt)
            .put("constant", true)
            .put("vectorized", false)
            .put("selective", true)
            .put("selectiveLogic", 0)
            .put("addMemo", false)
            .put("order", 100)
            .put("position", 4)
            .put("disable", false)
            .put("ignoreBudget", false)
            .put("excludeRecursion", false)
            .put("preventRecursion", false)
            .put("probability", 100)
            .put("useProbability", true)
            .put("depth", 0)
            .put("role", 0)
            .put("group", "")
            .put("groupOverride", false)
            .put("groupWeight", 100)
            .put("sticky", JSONObject.NULL)
            .put("cooldown", JSONObject.NULL)
            .put("delay", JSONObject.NULL)
            .put("scanDepth", JSONObject.NULL)
            .put("caseSensitive", JSONObject.NULL)
            .put("matchWholeWords", JSONObject.NULL)
            .put("useGroupScoring", JSONObject.NULL)
            .put("automationId", "")
            .put("outletName", "")
            .put("triggers", JSONArray())
        return JSONObject().put("entries", JSONObject().put("0", entry))
    }
}
