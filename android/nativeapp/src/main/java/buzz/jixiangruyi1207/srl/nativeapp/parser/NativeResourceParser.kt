package buzz.jixiangruyi1207.srl.nativeapp.parser

import android.util.Base64
import buzz.jixiangruyi1207.srl.nativeapp.model.ParsedNativeResource
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.DataInputStream
import java.io.File
import java.io.FileInputStream
import java.nio.charset.StandardCharsets

object NativeResourceParser {
    private const val MAX_METADATA_BYTES = 32 * 1024 * 1024
    private val pngSignature = byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)

    fun parse(file: File, fileName: String): ParsedNativeResource {
        return when {
            fileName.endsWith(".png", ignoreCase = true) -> parsePng(file, fileName)
            fileName.endsWith(".json", ignoreCase = true) -> parseJson(file, fileName)
            fileName.endsWith(".css", ignoreCase = true) || fileName.endsWith(".txt", ignoreCase = true) -> parseBeautification(file, fileName)
            else -> ParsedNativeResource(
                type = "other",
                name = baseName(fileName),
                description = "未识别格式，已按原文件保存",
                tags = emptyList(),
                metadataJson = JSONObject().put("format", "binary").toString(),
            )
        }
    }

    private fun parseJson(file: File, fileName: String): ParsedNativeResource {
        if (file.length() > MAX_METADATA_BYTES) {
            return ParsedNativeResource(
                "other",
                baseName(fileName),
                "JSON 超过 32 MB，已保留原文件但未展开元数据",
                emptyList(),
                JSONObject().put("format", "largeJson").toString(),
            )
        }
        val text = file.readText(StandardCharsets.UTF_8)
        val value = JSONTokener(text).nextValue()
        return detectJson(value, baseName(fileName))
    }

    private fun detectJson(value: Any, fallbackName: String): ParsedNativeResource {
        if (value is JSONArray) {
            val regexCount = (0 until value.length()).count { index ->
                val item = value.optJSONObject(index)
                item != null && isRegex(item)
            }
            if (value.length() > 0 && regexCount == value.length()) return parsed("regex", fallbackName, "包含 ${value.length()} 条正则脚本", emptyList(), "regexCollection", value)
            val helperCount = (0 until value.length()).sumOf { countHelperScripts(value.opt(it)) }
            if (helperCount > 0 && (0 until value.length()).all { countHelperScripts(value.opt(it)) > 0 }) {
                return parsed("script", fallbackName, "酒馆助手脚本库，包含 $helperCount 个脚本", emptyList(), "tavernHelperScriptTree", value)
            }
            return parsed("other", fallbackName, "JSON 数组，共 ${value.length()} 项", emptyList(), "jsonArray", value)
        }
        if (value !is JSONObject) return parsed("other", fallbackName, "JSON 数据", emptyList(), "jsonValue", value)

        val personas = value.optJSONObject("personas")
        val personaDescriptions = value.optJSONObject("persona_descriptions")
        if (personas != null && personaDescriptions != null) {
            val names = personas.keys().asSequence().mapNotNull { personas.optString(it).trim().takeIf(String::isNotBlank) }.toList()
            val metadata = JSONObject().put("format", "json").put("variant", "sillyTavernPersonaBackup")
                .put("itemCount", personas.length()).put("personaNames", JSONArray(names.take(50)))
                .put("defaultPersonaAvatarId", value.optString("default_persona"))
            return ParsedNativeResource("userPersona", if (names.size == 1) names.single() else fallbackName,
                "SillyTavern 用户人设备份，包含 ${personas.length()} 个人设", emptyList(), metadata.toString())
        }

        val card = value.optJSONObject("data") ?: value
        val spec = value.optString("spec")
        val isVersionedCard = Regex("^chara_card_v[23]$", RegexOption.IGNORE_CASE).matches(spec)
        val isLegacyCard = listOf("name", "description", "personality", "scenario", "first_mes", "mes_example")
            .all { card.opt(it) is String }
        if (card.optString("name").isNotBlank() && (isVersionedCard || isLegacyCard)) {
            return parsed(
                "characterCard",
                card.optString("name", fallbackName),
                card.optString("description"),
                stringList(card.optJSONArray("tags")),
                "characterCardJson",
                value,
            )
        }

        if (value.has("entries") && (value.opt("entries") is JSONObject || value.opt("entries") is JSONArray)) {
            val entries = value.opt("entries")
            val count = when (entries) {
                is JSONObject -> entries.length()
                is JSONArray -> entries.length()
                else -> 0
            }
            return parsed("worldBook", value.optString("name", fallbackName), "世界书，包含 $count 条目", emptyList(), "worldBook", value)
        }
        if (value.opt("qrList") is JSONArray) {
            return parsed("quickReply", value.optString("name", fallbackName), "包含 ${value.optJSONArray("qrList")?.length() ?: 0} 条快速回复", emptyList(), "quickReplySet", value)
        }
        if (isRegex(value)) {
            val name = value.optString("scriptName", value.optString("script_name", fallbackName))
            return parsed("regex", name, "SillyTavern 查找与替换正则脚本", emptyList(), "regexScript", value)
        }
        if (value.optString("display_name").isNotBlank() && value.opt("loading_order") is Number && value.optString("js").isNotBlank()) {
            return parsed("plugin", value.optString("display_name", fallbackName), "SillyTavern 扩展清单", emptyList(), "extensionManifest", value)
        }

        if (isRegexPreset(value)) {
            return parsed("regex", value.optString("name", fallbackName), "SillyTavern 正则启用方案", emptyList(), "regexPreset", value)
        }
        val regexScope = listOf("global", "scoped", "preset").firstOrNull { value.optJSONArray(it)?.let { array -> (0 until array.length()).any { isRegex(array.optJSONObject(it)) } } == true }
        if (regexScope != null) {
            val count = value.getJSONArray(regexScope).let { array -> (0 until array.length()).count { isRegex(array.optJSONObject(it)) } }
            return parsed("regex", value.optString("sourceName", fallbackName), "包含 $count 条正则脚本", emptyList(), "regexCollection", value)
        }

        val helperCount = countHelperScripts(value)
        if (helperCount > 0) {
            val variant = when {
                value.optString("type") == "folder" -> "tavernHelperScriptFolder"
                value.optJSONArray("scripts") != null || value.optJSONObject("script")?.optJSONArray("scripts") != null -> "tavernHelperScriptLibrary"
                else -> "tavernHelperScript"
            }
            return parsed("script", value.optString("name", fallbackName), value.optString("info", "酒馆助手脚本，包含 $helperCount 个脚本"), emptyList(), variant, value)
        }

        val themeKeys = listOf("main_text_color", "blur_strength", "chat_tint_color", "custom_css")
        if (value.optString("name").isNotBlank() && themeKeys.count(value::has) >= 2) {
            return parsed("beautification", value.optString("name", fallbackName), "SillyTavern 界面主题", emptyList(), "theme", value)
        }

        val scriptContent = value.optString("script").ifBlank { value.optString("content") }
        val language = value.optString("language").ifBlank { value.optString("type") }
        if (scriptContent.isNotBlank() && language.equals("stscript", true)) {
            return parsed("script", value.optString("name", value.optString("title", fallbackName)), value.optString("description", "SillyTavern STscript 脚本"), emptyList(), "stscript", value)
        }

        val samplerKeys = listOf("temperature", "top_p", "top_k", "min_p", "repetition_penalty", "frequency_penalty", "presence_penalty")
        val isPreset = value.optString("chat_completion_source").isNotBlank() ||
            (value.optJSONArray("prompts") != null && value.optJSONArray("prompt_order") != null) ||
            (value.has("input_sequence") && value.has("output_sequence")) ||
            (value.has("story_string") && value.has("example_separator")) || samplerKeys.count(value::has) >= 3
        if (isPreset) return parsed("preset", value.optString("name", fallbackName), value.optString("description", "SillyTavern 生成与提示词预设"), emptyList(), "generationPreset", value)

        return parsed("other", value.optString("name", fallbackName), "未识别的 JSON 对象", emptyList(), "jsonObject", value)
    }

    private fun parseBeautification(file: File, fileName: String): ParsedNativeResource {
        require(file.length() <= MAX_METADATA_BYTES) { "美化文件超过 32 MB" }
        val content = file.readText(StandardCharsets.UTF_8)
        require(content.isNotBlank()) { "美化文件内容为空" }
        val selectorCount = Regex("(?:^|\\})\\s*[^@{}][^{}]{0,240}\\{[^{}]*:[^{}]*\\}", setOf(RegexOption.MULTILINE, RegexOption.DOT_MATCHES_ALL)).findAll(content).count()
        val declarationCount = Regex("(?:^|[;{])\\s*[-\\w]+\\s*:\\s*[^;{}]+").findAll(content).count()
        require(selectorCount > 0 && declarationCount > 0) { if (fileName.endsWith(".txt", true)) "TXT 内容不像 CSS 美化片段，未自动归类" else "CSS 文件中未找到可预览的样式规则" }
        val fallback = baseName(fileName)
        val name = Regex("/\\*\\s*(?:@name|name|名称)\\s*[:：]\\s*([^\\r\\n*]{1,100})\\s*\\*/", RegexOption.IGNORE_CASE)
            .find(content)?.groupValues?.getOrNull(1)?.trim().orEmpty().ifBlank { fallback }
        val metadata = JSONObject().put("format", if (fileName.endsWith(".txt", true)) "text" else "css")
            .put("variant", "customCss").put("itemCount", selectorCount)
            .put("cssSummary", JSONObject().put("selectorCount", selectorCount).put("declarationCount", declarationCount)
                .put("customPropertyCount", Regex("--[-\\w]+\\s*:").findAll(content).count()).put("hasImport", Regex("@import\\s", RegexOption.IGNORE_CASE).containsMatchIn(content))
                .put("hasExternalAssets", Regex("url\\s*\\(", RegexOption.IGNORE_CASE).containsMatchIn(content)))
        return ParsedNativeResource("beautification", name, "CSS 美化片段 · $selectorCount 个规则 · $declarationCount 项声明", emptyList(), metadata.toString())
    }

    private fun isRegexPreset(value: JSONObject): Boolean = value.optString("id").isNotBlank() && value.optString("name").isNotBlank() &&
        listOf("global", "scoped", "preset").all { value.optJSONArray(it) != null }

    private fun countHelperScripts(value: Any?): Int {
        val record = value as? JSONObject ?: return 0
        val content = record.optString("content")
        val executable = Regex("(?:^|[\\s;])(?:async\\s+)?function\\b|(?:^|[\\s;])(?:const|let|var)\\s+[\\w$]+|=>|['\"]use strict['\"]").containsMatchIn(content)
        val isScript = content.isNotBlank() && ((record.optString("type") == "script" && record.has("id") && record.has("name")) ||
            (record.has("id") && record.has("name") && (record.has("info") || record.optJSONArray("buttons") != null) && executable))
        if (isScript) return 1
        val scripts = record.optJSONArray("scripts") ?: record.optJSONObject("script")?.optJSONArray("scripts") ?: return 0
        return (0 until scripts.length()).sumOf { countHelperScripts(scripts.opt(it)) }
    }

    private fun parsePng(file: File, fileName: String): ParsedNativeResource {
        val card = readPngCard(file)
            ?: return ParsedNativeResource("other", baseName(fileName), "普通 PNG 图片", emptyList(), JSONObject().put("format", "png").toString())
        val data = card.optJSONObject("data") ?: card
        return parsed(
            "characterCard",
            data.optString("name", baseName(fileName)),
            data.optString("description"),
            stringList(data.optJSONArray("tags")),
            "characterCardPng",
            card,
        )
    }

    private fun readPngCard(file: File): JSONObject? {
        DataInputStream(FileInputStream(file).buffered()).use { input ->
            val signature = ByteArray(8)
            input.readFully(signature)
            if (!signature.contentEquals(pngSignature)) return null
            while (true) {
                val length = try { input.readInt() } catch (_: Exception) { return null }
                if (length < 0) return null
                val typeBytes = ByteArray(4)
                input.readFully(typeBytes)
                val type = String(typeBytes, StandardCharsets.US_ASCII)
                if (length > MAX_METADATA_BYTES && type == "tEXt") return null
                if (type == "tEXt") {
                    val data = ByteArray(length)
                    input.readFully(data)
                    input.skipFully(4)
                    val separator = data.indexOf(0)
                    if (separator > 0) {
                        val keyword = String(data, 0, separator, StandardCharsets.ISO_8859_1).lowercase()
                        if (keyword == "chara" || keyword == "ccv3") {
                            val encoded = String(data, separator + 1, data.size - separator - 1, StandardCharsets.ISO_8859_1)
                            val decoded = Base64.decode(encoded, Base64.DEFAULT)
                            return JSONTokener(String(decoded, StandardCharsets.UTF_8)).nextValue() as? JSONObject
                        }
                    }
                } else {
                    input.skipFully(length.toLong())
                    input.skipFully(4)
                }
                if (type == "IEND") return null
            }
        }
    }

    private fun DataInputStream.skipFully(byteCount: Long) {
        var remaining = byteCount
        while (remaining > 0) {
            val skipped = skip(remaining)
            if (skipped <= 0) {
                if (read() < 0) throw IllegalArgumentException("PNG 数据块不完整")
                remaining -= 1
            } else remaining -= skipped
        }
    }

    private fun isRegex(value: JSONObject): Boolean {
        return (value.has("scriptName") && value.has("findRegex") && value.has("replaceString")) ||
            (value.has("script_name") && value.has("find_regex") && value.has("replace_string"))
    }

    private fun parsed(type: String, name: String, description: String, tags: List<String>, variant: String, source: Any): ParsedNativeResource {
        val metadata = JSONObject().put("format", "json").put("variant", variant)
        if (type == "characterCard") metadata.put("card", source)
        return ParsedNativeResource(type, name.ifBlank { "未命名资源" }, description, tags, metadata.toString())
    }

    private fun stringList(array: JSONArray?): List<String> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { array.optString(it).trim().takeIf(String::isNotEmpty) }.distinct()
    }

    private fun baseName(fileName: String): String = fileName.substringBeforeLast('.').ifBlank { "未命名资源" }
}
