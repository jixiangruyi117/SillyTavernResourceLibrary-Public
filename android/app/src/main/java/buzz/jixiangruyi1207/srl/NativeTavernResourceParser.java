package buzz.jixiangruyi1207.srl;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.charset.CodingErrorAction;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Native adapter for the existing JSON, chat and CSS parser contracts; never executes scripts. */
final class NativeTavernResourceParser {
    private static final int MAX_JSON_BYTES = 32 * 1024 * 1024;
    private static final int MAX_LINE_CHARS = 4 * 1024 * 1024;
    private NativeTavernResourceParser() {}

    static JSONObject parse(File file, String fileName) throws Exception {
        String lower = fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".jsonl")) return parseJsonLines(file, fileName);
        if (!lower.endsWith(".json") && !lower.endsWith(".css") && !lower.endsWith(".txt")) return null;
        if (file.length() > MAX_JSON_BYTES) throw new IllegalArgumentException("资源较大，后台解析未完成；请在前台继续处理");
        String content = readText(file);
        if (lower.endsWith(".css") || lower.endsWith(".txt")) return parseCss(content, fileName);
        return parseJson(readJsonText(content), fileName);
    }

    static Object readJson(File file) throws Exception { return readJsonText(readText(file)); }

    private static String readText(File file) throws Exception {
        if (file.length() > MAX_JSON_BYTES) throw new IllegalArgumentException("资源较大，后台解析未完成；请在前台继续处理");
        try (InputStreamReader reader = new InputStreamReader(new FileInputStream(file),
            StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT))) {
            StringBuilder text = new StringBuilder();
            char[] buffer = new char[8192]; int count;
            while ((count = reader.read(buffer)) != -1) {
                if (text.length() + count > MAX_JSON_BYTES) throw new IllegalArgumentException("资源较大，后台解析未完成；请在前台继续处理");
                text.append(buffer, 0, count);
            }
            return text.toString();
        }
    }

    private static Object readJsonText(String content) throws Exception {
        if (content.startsWith("\uFEFF")) content = content.substring(1);
        JSONTokener tokener = new JSONTokener(content);
        Object value = tokener.nextValue();
        if (tokener.nextClean() != 0) throw new IllegalArgumentException("JSON 格式无效");
        return value;
    }

    static String label(String type) {
        switch (type) {
            case "worldBook": return "世界书";
            case "preset": return "酒馆预设";
            case "regex": return "正则";
            case "script": return "脚本";
            case "beautification": return "美化资源";
            case "quickReply": return "快速回复";
            case "userPersona": return "用户人设";
            case "chat": return "聊天记录";
            case "greeting": return "开场白";
            case "plugin": return "扩展清单";
            case "other": return "JSON 资源";
            default: return "角色卡";
        }
    }

    static boolean supportedType(String type) {
        for (String supported : new String[]{"characterCard", "worldBook", "preset", "regex", "script", "beautification",
            "quickReply", "userPersona", "chat", "greeting", "plugin", "other"}) if (supported.equals(type)) return true;
        return false;
    }

    private static String text(Object value) { return value instanceof String ? ((String) value).trim() : ""; }
    private static String text(JSONObject value, String key) { return text(value.opt(key)); }
    private static String fallback(String value, String fallback) { return value.isEmpty() ? fallback : value; }
    private static boolean string(JSONObject value, String key) { return value.opt(key) instanceof String; }
    private static JSONArray array(JSONObject value, String key) { return value.optJSONArray(key); }
    private static int length(Object value) {
        return value instanceof JSONObject ? ((JSONObject) value).length() : value instanceof JSONArray ? ((JSONArray) value).length() : 0;
    }
    private static JSONObject object(Object value) { return value instanceof JSONObject ? (JSONObject) value : new JSONObject(); }
    private static JSONArray keys(Object value) {
        JSONArray keys = new JSONArray();
        if (value instanceof JSONObject) {
            Iterator<String> iterator = ((JSONObject) value).keys();
            while (iterator.hasNext()) keys.put(iterator.next());
        } else if (value instanceof JSONArray) for (int i = 0; i < ((JSONArray) value).length(); i++) keys.put(String.valueOf(i));
        return keys;
    }
    private static java.util.List<String> objectKeys(JSONObject value) {
        java.util.List<String> result = new java.util.ArrayList<>();
        Iterator<String> iterator = value.keys();
        while (iterator.hasNext()) result.add(iterator.next());
        return result;
    }
    private static Object entry(Object value, String key) {
        return value instanceof JSONObject ? ((JSONObject) value).opt(key) : value instanceof JSONArray ? ((JSONArray) value).opt(Integer.parseInt(key)) : null;
    }
    private static JSONObject result(String type, String variant, String name, String description, Integer count,
        Object raw, JSONObject extra) throws Exception {
        JSONArray roots = keys(raw), limited = new JSONArray();
        if (raw instanceof JSONObject) for (int i = 0; i < Math.min(50, roots.length()); i++) limited.put(roots.get(i));
        JSONObject metadata = new JSONObject().put("format", "json").put("parserVersion", 10)
            .put("detectedVariant", variant).put("rootKeys", limited);
        if (count != null) metadata.put("itemCount", count);
        if (extra != null) for (String key : objectKeys(extra)) metadata.put(key, extra.get(key));
        return new JSONObject().put("type", type).put("name", name).put("description", description).put("metadata", metadata);
    }
    private static boolean regex(Object raw) {
        if (!(raw instanceof JSONObject)) return false;
        JSONObject r = (JSONObject) raw;
        return string(r, "scriptName") && string(r, "findRegex") && string(r, "replaceString")
            || string(r, "script_name") && string(r, "find_regex") && string(r, "replace_string");
    }
    private static boolean script(Object raw) {
        if (!(raw instanceof JSONObject)) return false;
        JSONObject r = (JSONObject) raw;
        JSONObject button = r.optJSONObject("button");
        if ("script".equals(r.optString("type")) && string(r, "id") && string(r, "name") && string(r, "content")
            && (button == null || array(button, "buttons") != null)) return true;
        return string(r, "id") && string(r, "name") && (string(r, "info") || array(r, "buttons") != null)
            && Pattern.compile("(?:^|[\\s;])(?:async\\s+)?function\\b|(?:^|[\\s;])(?:const|let|var)\\s+[\\w$]+|=>|['\"]use strict['\"]")
                .matcher(text(r, "content")).find();
    }
    private static boolean folder(Object raw) {
        if (!(raw instanceof JSONObject)) return false;
        JSONObject r = (JSONObject) raw;
        JSONArray scripts = array(r, "scripts");
        if (!"folder".equals(r.optString("type")) || !string(r, "name") || scripts == null) return false;
        for (int i = 0; i < scripts.length(); i++) if (!script(scripts.opt(i))) return false;
        return true;
    }
    private static int scriptCount(JSONArray values) {
        int count = 0;
        for (int i = 0; i < values.length(); i++) {
            Object value = values.opt(i);
            if (script(value)) count++;
            else if (folder(value)) count += array((JSONObject) value, "scripts").length();
            else return -1;
        }
        return count;
    }

    static JSONObject parseJson(Object raw, String fileName) throws Exception {
        if (!(raw instanceof JSONObject || raw instanceof JSONArray)) throw new IllegalArgumentException("JSON 顶层必须是对象或数组");
        String fallback = fileName.replaceFirst("(?i)\\.json$", "");
        JSONArray chat = raw instanceof JSONArray ? (JSONArray) raw : array((JSONObject) raw, "chat");
        if (chat != null && isChat(chat)) return summarizeChat(chat, fileName, "json");
        if (raw instanceof JSONArray) {
            JSONArray values = (JSONArray) raw;
            boolean allRegex = values.length() > 0;
            for (int i = 0; i < values.length(); i++) allRegex &= regex(values.opt(i));
            if (allRegex) return result("regex", "regexCollection", fallback, "包含 " + values.length() + " 条正则脚本", values.length(), raw, null);
            int count = scriptCount(values);
            if (values.length() > 0 && count >= 0) return result("script", "tavernHelperScriptTree", fallback,
                "酒馆助手脚本库，包含 " + count + " 个脚本", count, raw, null);
            return result("other", "jsonArray", fallback, "未识别的 JSON 数组，共 " + values.length() + " 项", values.length(), raw, null);
        }
        JSONObject r = (JSONObject) raw;
        if ("srl-personal-resource".equals(r.optString("format"))) return null; // Existing password/editor owner.
        if ("srl-greeting".equals(r.optString("format"))) return greeting(r);
        if ((r.opt("personas") instanceof JSONObject || r.opt("personas") instanceof JSONArray)
            && (r.opt("persona_descriptions") instanceof JSONObject || r.opt("persona_descriptions") instanceof JSONArray)) return persona(r, fallback);
        if (string(r, "display_name") && r.opt("loading_order") instanceof Number && string(r, "js"))
            return result("plugin", "extensionManifest", fallback(text(r, "display_name"), fallback),
                fallback(details(text(r, "author"), text(r, "version")), "SillyTavern 扩展清单"), null, raw, null);
        if (string(r, "name") && array(r, "qrList") != null) return result("quickReply", "quickReplySet", fallback(text(r, "name"), fallback),
            "包含 " + array(r, "qrList").length() + " 条快速回复", array(r, "qrList").length(), raw, null);
        if (regex(r)) return result("regex", string(r, "find_regex") ? "tavernHelperRegex" : "regexScript",
            fallback(text(r.opt("scriptName") == null ? r.opt("script_name") : r.opt("scriptName")), fallback), "SillyTavern 查找与替换正则脚本", 1, raw, null);
        String scope = array(r, "global") != null ? "global" : array(r, "scoped") != null ? "character" : array(r, "preset") != null ? "preset" : "";
        JSONObject scopeMeta = new JSONObject().put("sourceName", text(r, "sourceName"));
        if (!scope.isEmpty()) scopeMeta.put("regexScope", scope);
        if (string(r, "id") && string(r, "name") && array(r, "global") != null && array(r, "scoped") != null && array(r, "preset") != null)
            return result("regex", "regexPreset", fallback(text(r, "name"), fallback), "SillyTavern 正则启用方案", null, raw, scopeMeta);
        if (!scope.isEmpty()) {
            JSONArray values = array(r, "character".equals(scope) ? "scoped" : scope);
            int count = 0;
            for (int i = 0; i < values.length(); i++) if (regex(values.opt(i))) count++;
            if (count > 0) return result("regex", "regexCollection",
                "global".equals(scope) && count == 1 && "全局正则".equals(text(r, "sourceName")) ? fallback : fallback(text(r, "sourceName"), fallback),
                ("global".equals(scope) ? "全局" : "character".equals(scope) ? "角色卡" : "预设") + "正则，包含 " + count + " 条脚本", count, raw, scopeMeta);
        }
        if (script(r)) {
            JSONArray buttons = array(object(r.opt("button")), "buttons");
            if (buttons == null) buttons = array(r, "buttons");
            return result("script", "tavernHelperScript", fallback(text(r, "name"), fallback), "酒馆助手 JavaScript 脚本", buttons == null ? null : buttons.length(), raw, null);
        }
        if (folder(r)) return result("script", "tavernHelperScriptFolder", fallback(text(r, "name"), fallback),
            "酒馆助手脚本文件夹，包含 " + array(r, "scripts").length() + " 个脚本", array(r, "scripts").length(), raw, null);
        JSONArray scripts = array(r, "scripts");
        if (scripts == null) scripts = array(object(r.opt("script")), "scripts");
        if (scripts != null && scripts.length() > 0 && scriptCount(scripts) >= 0) return result("script", "tavernHelperScriptLibrary",
            fallback(text(r, "name"), fallback), "酒馆助手脚本库，包含 " + scriptCount(scripts) + " 个脚本", scriptCount(scripts), raw, null);
        int themeKeys = 0;
        for (String key : new String[]{"main_text_color", "blur_strength", "chat_tint_color", "custom_css"}) if (r.has(key)) themeKeys++;
        if (string(r, "name") && themeKeys >= 2) {
            JSONArray colors = new JSONArray();
            for (String key : new String[]{"chat_tint_color", "user_mes_blur_tint_color", "bot_mes_blur_tint_color", "main_text_color", "quote_text_color", "border_color"})
                if (!text(r, key).isEmpty()) colors.put(text(r, key));
            JSONObject preview = new JSONObject().put("colors", colors).put("customCssLength", text(r, "custom_css").length());
            if (r.opt("blur_strength") instanceof Number) preview.put("blurStrength", r.opt("blur_strength"));
            return result("beautification", "theme", fallback(text(r, "name"), fallback), "SillyTavern 界面主题", null, raw,
                new JSONObject().put("beautificationPreview", preview));
        }
        if (r.opt("entries") instanceof JSONObject || r.opt("entries") instanceof JSONArray) {
            int count = length(r.opt("entries"));
            return result("worldBook", "worldBook", fallback(text(r, "name"), fallback), fallback(text(r, "description"), "包含 " + count + " 条世界书条目"), count, raw, null);
        }
        String content = fallback(text(r, "script"), text(r, "content"));
        if (!content.isEmpty() && "stscript".equals(text(r.opt("language") == null ? r.opt("type") : r.opt("language")).toLowerCase(Locale.ROOT)))
            return result("script", "stscript", fallback(text(r, "name"), fallback(text(r, "title"), fallback)), fallback(text(r, "description"), "SillyTavern STscript 脚本"), null, raw, null);
        int samplers = 0;
        for (String key : new String[]{"temperature", "top_p", "top_k", "min_p", "repetition_penalty", "frequency_penalty", "presence_penalty"}) if (r.has(key)) samplers++;
        if (string(r, "chat_completion_source") || array(r, "prompts") != null && array(r, "prompt_order") != null
            || string(r, "input_sequence") && string(r, "output_sequence") || string(r, "story_string") && string(r, "example_separator") || samplers >= 3) {
            int regexCount = 0;
            JSONArray values = array(object(r.opt("extensions")), "regex_scripts");
            if (values != null) for (int i = 0; i < values.length(); i++) if (regex(values.opt(i))) regexCount++;
            int prompts = length(array(r, "prompts"));
            return result("preset", "generationPreset", fallback(text(r, "name"), fallback),
                fallback(text(r, "description"), "SillyTavern 生成与提示词预设" + (regexCount > 0 ? " · " + regexCount + " 条配套正则" : "")), prompts + regexCount, raw,
                new JSONObject().put("promptCount", prompts).put("presetRegexCount", regexCount));
        }
        return result("other", "jsonObject", fallback(text(r, "name"), fallback(text(r, "title"), fallback)), fallback(text(r, "description"), "未识别的 JSON 资源"), null, raw, null);
    }

    private static String details(String first, String second) {
        return first.isEmpty() ? second : second.isEmpty() ? first : first + " · " + second;
    }

    private static JSONObject greeting(JSONObject r) throws Exception {
        if (r.optInt("version") != 1) throw new IllegalArgumentException("不支持的开场白资源格式");
        JSONArray alternate = array(r, "alternate_greetings"), scripts = array(r, "companion_scripts");
        if (text(r, "name").isEmpty() || text(r, "first_mes").isEmpty() || alternate == null || scripts == null)
            throw new IllegalArgumentException("开场白资源缺少名称、主正文、备用列表或配套脚本列表");
        for (int i = 0; i < alternate.length(); i++) if (text(alternate.opt(i)).isEmpty()) throw new IllegalArgumentException("开场白资源备用列表格式不完整");
        for (int i = 0; i < scripts.length(); i++) {
            JSONObject script = object(scripts.opt(i));
            if (!"script".equals(script.optString("type")) || !string(script, "name") || !string(script, "content")) throw new IllegalArgumentException("开场白配套脚本格式不完整");
        }
        return new JSONObject().put("type", "greeting").put("name", r.getString("name"))
            .put("description", "主开场白 + " + alternate.length() + " 个备用开场白" + (scripts.length() > 0 ? " · " + scripts.length() + " 个配套脚本" : ""))
            .put("metadata", new JSONObject().put("format", "json").put("parserVersion", 10).put("detectedVariant", "greeting").put("itemCount", alternate.length() + 1));
    }

    private static JSONObject persona(JSONObject r, String fallback) throws Exception {
        Object personas = r.opt("personas"), descriptions = r.opt("persona_descriptions");
        JSONArray ids = keys(personas), names = new JSONArray();
        Set<String> nativeIds = new LinkedHashSet<>(), profileIds = new LinkedHashSet<>();
        JSONObject bindings = new JSONObject();
        int warnings = 0;
        for (int i = 0; i < ids.length(); i++) {
            String id = ids.getString(i), name = entry(personas, id) instanceof String ? (String) entry(personas, id) : "";
            if (!name.isEmpty() && names.length() < 50) names.put(name);
            if (name.isEmpty()) warnings++;
            Object raw = entry(descriptions, id);
            if (!(raw instanceof JSONObject)) warnings++;
            JSONObject descriptor = object(raw);
            Object connections = descriptor.opt("connections");
            boolean invalid = connections != null && !(connections instanceof JSONArray);
            if (connections instanceof JSONArray) for (int j = 0; j < ((JSONArray) connections).length(); j++) {
                JSONObject connection = object(((JSONArray) connections).opt(j));
                String type = text(connection, "type"), target = text(connection, "id");
                if (!("character".equals(type) || "group".equals(type)) || target.isEmpty()) invalid = true;
                else if ("character".equals(type)) nativeIds.add(connection.getString("id"));
            }
            if (invalid) warnings++;
            JSONObject snapshots = object(descriptor.opt("srl_persona_character_bindings"));
            for (String target : objectKeys(snapshots)) {
                JSONObject snapshot = object(snapshots.opt(target));
                if (string(snapshot, "avatar") && string(snapshot, "name") && text(snapshot, "hash").matches("(?i)[a-f0-9]{64}") && !bindings.has(target)) bindings.put(target, snapshot.getString("name"));
            }
            JSONObject profile = object(descriptor.opt("srl_persona_profile"));
            if (profile.optInt("version") == 1 && array(profile, "sections") != null) {
                JSONObject variants = object(profile.opt("variants"));
                for (String target : objectKeys(variants)) {
                    Object variantRaw = variants.opt(target);
                    if (target.isEmpty() || !(variantRaw instanceof JSONObject)) continue;
                    JSONObject variant = (JSONObject) variantRaw, versions = variant.optJSONObject("versions");
                    boolean valid = versions == null;
                    if (versions != null) for (String key : objectKeys(versions)) if (!key.isEmpty() && versions.opt(key) instanceof JSONObject) valid = true;
                    if (valid) profileIds.add(target);
                }
            }
        }
        String defaultId = r.opt("default_persona") instanceof String ? r.getString("default_persona") : "";
        if (!defaultId.isEmpty() && entry(personas, defaultId) == null) warnings++;
        JSONArray nativeNames = bindingNames(nativeIds, bindings), profileNames = bindingNames(profileIds, bindings);
        Set<String> all = new LinkedHashSet<>();
        for (int i = 0; i < nativeNames.length(); i++) all.add(nativeNames.getString(i));
        for (int i = 0; i < profileNames.length(); i++) all.add(profileNames.getString(i));
        return result("userPersona", "sillyTavernPersonaBackup", names.length() == 1 ? names.getString(0) : fallback,
            "SillyTavern 用户人设备份，包含 " + ids.length() + " 个人设", ids.length(), r, new JSONObject()
                .put("personaNames", names).put("personaNativeCharacterNames", nativeNames).put("personaProfileCharacterNames", profileNames)
                .put("personaCharacterNames", new JSONArray(new java.util.ArrayList<>(all))).put("defaultPersonaAvatarId", defaultId).put("warningCount", warnings));
    }
    private static JSONArray bindingNames(Set<String> ids, JSONObject bindings) {
        JSONArray names = new JSONArray();
        for (String id : ids) { if (names.length() >= 50) break; names.put(bindings.optString(id, id)); }
        return names;
    }

    private static boolean header(JSONObject r) {
        return !r.has("mes") && (r.opt("chat_metadata") instanceof JSONObject || string(r, "user_name") || string(r, "character_name"));
    }
    private static boolean message(Object raw) {
        if (!(raw instanceof JSONObject)) return false;
        JSONObject r = (JSONObject) raw;
        Object system = r.opt("is_system");
        return string(r, "name") && string(r, "mes") && r.opt("is_user") instanceof Boolean
            && (!r.has("is_system") || "".equals(system) || system instanceof Boolean);
    }
    private static boolean isChat(JSONArray values) {
        int start = values.length() > 0 && header(object(values.opt(0))) ? 1 : 0;
        if (values.length() <= start) return false;
        for (int i = start; i < values.length(); i++) if (!message(values.opt(i))) return false;
        return true;
    }
    private static final class ChatSummary {
        int total, visible;
        Set<String> users = new LinkedHashSet<>(), characters = new LinkedHashSet<>();
        void accept(JSONObject r) {
            total++;
            if (r.optBoolean("is_system", false)) return;
            visible++;
            Set<String> names = r.optBoolean("is_user") ? users : characters;
            String name = text(r, "name");
            if (!name.isEmpty() && names.size() < 64) names.add(name.substring(0, Math.min(160, name.length())));
        }
        JSONObject result(String fileName, String format) throws Exception {
            if (total == 0) throw new IllegalArgumentException("聊天记录中没有消息");
            return new JSONObject().put("type", "chat").put("name", fileName.replaceFirst("(?i)\\.(jsonl|json)$", ""))
                .put("description", total + " 楼 · 在读了么中阅读").put("metadata", new JSONObject().put("format", format)
                    .put("parserVersion", 1).put("detectedVariant", "sillyTavernChat").put("itemCount", total).put("messageCount", total)
                    .put("visibleMessageCount", visible).put("chatUserNames", new JSONArray(new java.util.ArrayList<>(users)))
                    .put("chatCharacterNames", new JSONArray(new java.util.ArrayList<>(characters))));
        }
    }
    private static JSONObject summarizeChat(JSONArray values, String name, String format) throws Exception {
        ChatSummary summary = new ChatSummary();
        for (int i = 0; i < values.length(); i++) if (message(values.opt(i))) summary.accept(values.getJSONObject(i));
        return summary.result(name, format);
    }
    private static JSONObject parseJsonLines(File file, String name) throws Exception {
        ChatSummary summary = new ChatSummary();
        boolean first = true;
        int line = 1;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file),
            StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)))) {
            StringBuilder pending = new StringBuilder();
            int character;
            while ((character = reader.read()) != -1) {
                if (character != '\n') {
                    if (pending.length() >= MAX_LINE_CHARS) throw new IllegalArgumentException("聊天记录第 " + line + " 行超过 4 MiB 字符读取上限");
                    pending.append((char) character);
                    continue;
                }
                String text = pending.toString().replaceFirst("^\uFEFF", "").trim();
                pending.setLength(0);
                if (!text.isEmpty()) {
                    JSONObject r = new JSONObject(text);
                    if (!(first && header(r))) {
                        if (!message(r)) throw new IllegalArgumentException("聊天记录第 " + line + " 行不是有效消息（需要 name、mes、is_user）");
                        summary.accept(r);
                    }
                    first = false;
                }
                line++;
            }
            String tail = pending.toString().replaceFirst("^\uFEFF", "").trim();
            if (!tail.isEmpty()) {
                JSONObject r = new JSONObject(tail);
                if (!(first && header(r))) {
                    if (!message(r)) throw new IllegalArgumentException("聊天记录第 " + line + " 行不是有效消息（需要 name、mes、is_user）");
                    summary.accept(r);
                }
            }
        }
        return summary.result(name, "jsonl");
    }

    private static int matches(String expression, String content) {
        Matcher matcher = Pattern.compile(expression, Pattern.MULTILINE | Pattern.DOTALL).matcher(content);
        int count = 0; while (matcher.find()) count++; return count;
    }
    static JSONObject parseCss(String content, String fileName) throws Exception {
        int rules = matches("(?:^|})\\s*[^@{}][^{}]{0,240}\\{[^{}]*:[^{}]*\\}", content);
        int declarations = matches("(?:^|[;{])\\s*[-\\w]+\\s*:\\s*[^;{}]+", content);
        if (rules == 0 || declarations == 0) throw new IllegalArgumentException("CSS 文件中未找到可预览的样式规则");
        Set<String> colors = new LinkedHashSet<>();
        Matcher color = Pattern.compile("#[\\da-f]{3,8}\\b|(?:rgb|hsl)a?\\([^)]*\\)", Pattern.CASE_INSENSITIVE).matcher(content);
        while (color.find() && colors.size() < 16) colors.add(color.group().trim());
        JSONArray palette = new JSONArray(new java.util.ArrayList<>(colors));
        JSONObject summary = new JSONObject().put("selectorCount", rules).put("declarationCount", declarations)
            .put("customPropertyCount", matches("--[-\\w]+\\s*:", content)).put("colors", palette)
            .put("hasImport", Pattern.compile("@import\\s", Pattern.CASE_INSENSITIVE).matcher(content).find())
            .put("hasExternalAssets", Pattern.compile("url\\s*\\(", Pattern.CASE_INSENSITIVE).matcher(content).find());
        Matcher annotation = Pattern.compile("/\\*\\s*(?:@name|name|名称)\\s*[:：]\\s*([^\\r\\n*]{1,100})\\s*\\*/", Pattern.CASE_INSENSITIVE).matcher(content);
        String name = annotation.find() ? annotation.group(1).trim() : fileName.replaceFirst("(?i)\\.(css|txt)$", "");
        boolean txt = fileName.toLowerCase(Locale.ROOT).endsWith(".txt");
        return new JSONObject().put("type", "beautification").put("name", name)
            .put("description", (txt ? "TXT 中的 CSS 美化片段" : "CSS 美化片段") + " · " + rules + " 个规则 · " + declarations + " 项声明")
            .put("metadata", new JSONObject().put("format", txt ? "text" : "css").put("parserVersion", 1).put("detectedVariant", "customCss")
                .put("itemCount", rules).put("cssSummary", summary).put("beautificationPreview", new JSONObject().put("colors", palette).put("customCssLength", content.length())));
    }
}
