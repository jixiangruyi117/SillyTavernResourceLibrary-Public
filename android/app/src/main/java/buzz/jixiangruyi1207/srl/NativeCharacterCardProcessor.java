package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.zip.InflaterInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native background character-card recognition and conservative version candidate lookup. */
final class NativeCharacterCardProcessor {
    private static final byte[] PNG = new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10};
    private static final int MAX_CARD_BYTES = 32 * 1024 * 1024;
    private static final int MAX_CHUNK_BYTES = 32 * 1024 * 1024;
    private static final int MAX_CANDIDATES = 100;

    private NativeCharacterCardProcessor() {}

    static JSONObject parseOnly(File incoming, String fileName, File parsedResourceFile) throws Exception {
        JSONObject result = new JSONObject().put("state", "not_character_card");
        CardPayload payload = readCard(incoming, fileName);
        if (payload == null) return result;
        JSONObject card = payload.card;
        CardInfo parsed = info(card, fileName);
        writeJsonAtomically(parsedResourceFile, parsedResource(card, parsed, fileName, payload.chunk));
        return result.put("state", "parsed")
            .put("parsedResourceUri", Uri.fromFile(parsedResourceFile).toString());
    }

    static JSONObject process(Context context, File incoming, String fileName, File parsedResourceFile) throws Exception {
        JSONObject result = new JSONObject().put("state", "not_character_card");
        CardPayload payload = readCard(incoming, fileName);
        if (payload == null) return result;
        JSONObject card = payload.card;
        CardInfo parsed = info(card, fileName);
        writeJsonAtomically(parsedResourceFile, parsedResource(card, parsed, fileName, payload.chunk));
        result.put("state", "parsed")
            .put("name", parsed.displayName)
            .put("creator", parsed.creator)
            .put("contentHash", parsed.fullHash)
            .put("coreHash", parsed.coreHash)
            .put("parsedResourceUri", Uri.fromFile(parsedResourceFile).toString());

        File root = NativeLibraryPlugin.libraryRoot(context);
        File current = new File(root, "current");
        File versions = new File(root, "versions");
        File[] currentEntries = current.listFiles(File::isDirectory);
        File[] versionEntries = versions.listFiles(File::isDirectory);
        int indexed = (currentEntries == null ? 0 : currentEntries.length)
            + (versionEntries == null ? 0 : versionEntries.length);
        // An empty mirror can mean an empty library or an enabled encrypted vault. Never
        // report "no match" from it: foreground IndexedDB must make the authoritative check.
        if (indexed == 0) return result.put("state", "parsed_index_unavailable");

        List<JSONObject> candidates = new ArrayList<>();
        boolean complete = collect(context, currentEntries, parsed, fileName, candidates, false)
            && collect(context, versionEntries, parsed, fileName, candidates, true);
        if (!complete) return result.put("state", "parsed_index_unavailable");
        Collections.sort(candidates, (left, right) -> Integer.compare(right.optInt("score"), left.optInt("score")));
        JSONArray selected = new JSONArray();
        for (int index = 0; index < Math.min(MAX_CANDIDATES, candidates.size()); index++) {
            selected.put(candidates.get(index));
        }
        return result.put("state", "parsed")
            .put("indexComplete", true)
            .put("candidateCount", candidates.size())
            .put("candidatesTruncated", candidates.size() > selected.length())
            .put("candidates", selected);
    }

    static JSONArray matchParsedResource(JSONObject parsedResource, String incomingFileName,
                                         JSONArray rows, boolean sameNameCandidates) throws Exception {
        JSONObject parsedMetadata = parsedResource.optJSONObject("metadata");
        JSONObject parsedCard = parsedMetadata == null ? null : parsedMetadata.optJSONObject("card");
        if (parsedCard == null) throw new IllegalArgumentException("原生角色卡解析结果缺少卡数据");
        CardInfo incoming = info(parsedCard, incomingFileName);
        List<JSONObject> matches = new ArrayList<>();
        for (int index = 0; index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row == null || !"characterCard".equals(row.optString("type", ""))) continue;
            JSONObject metadata = row.optJSONObject("metadata");
            if (metadata == null) metadata = new JSONObject();
            String existingFull = metadata.optString("cardContentHash", "");
            String existingCore = metadata.optString("cardCoreHash", "");
            CardInfo existing = null;
            if (metadata.optInt("cardFingerprintVersion", 0) != 4 || existingFull.isEmpty() || existingCore.isEmpty()) {
                JSONObject existingCard = metadata.optJSONObject("card");
                if (existingCard != null) existing = info(existingCard, row.optString("fileName", ""));
            }
            int score = incoming.fullHash.equals(existingFull) || (existing != null && incoming.fullHash.equals(existing.fullHash))
                ? 100
                : incoming.coreHash.equals(existingCore) || (existing != null && incoming.coreHash.equals(existing.coreHash))
                    ? 90
                    : scoreByIdentity(incoming, existing == null
                        ? summaryInfo(row, metadata)
                        : existing);
            String existingFileName = row.optString("fileName", "");
            String matchKind = score == 100
                ? (isCrossJsonPng(incomingFileName, existingFileName) ? "containerVariant" : "contentDuplicate")
                : score == 90 || score == 85 ? "version" : "heuristic";
            if (score < 60 && sameNameCandidates && incoming.sameName.equals(summarySameName(row.optString("name", "")))) {
                score = 60;
                matchKind = "sameName";
            }
            if (score < 60) continue;
            boolean historical = row.optBoolean("historical");
            CardInfo evidence = existing == null ? summaryInfo(row, metadata) : existing;
            matches.add(new JSONObject()
                .put("resourceId", row.optString("id", ""))
                .put("versionGroupId", row.optString("versionGroupId", ""))
                .put("fileName", existingFileName)
                .put("historical", historical)
                .put("score", score)
                .put("matchKind", matchKind)
                .put("reasons", matchReasons(matchKind, historical, score, incoming, evidence)));
        }
        Collections.sort(matches, (left, right) -> Integer.compare(right.optInt("score"), left.optInt("score")));
        JSONArray result = new JSONArray();
        for (JSONObject match : matches) result.put(match);
        return result;
    }

    private static CardInfo summaryInfo(JSONObject row, JSONObject metadata) throws Exception {
        String displayName = row.optString("name", "");
        Set<String> ids = new HashSet<>();
        JSONObject card = metadata.optJSONObject("card");
        JSONObject data = card == null ? null : card.optJSONObject("data");
        if (data == null) data = card;
        for (String key : new String[] {"uuid", "character_id", "characterId", "source_id", "sourceId", "source"}) {
            String value = data == null ? "" : data.optString(key, card == null ? "" : card.optString(key, ""));
            if (!value.isBlank() && (!"source".equals(key) || value.matches("(?i)^https?://.*")))
                ids.add(key + ":" + normalize(value));
        }
        JSONArray stableIds = metadata.optJSONArray("nativeStableIds");
        if (stableIds != null) {
            for (int index = 0; index < stableIds.length(); index++) {
                String value = stableIds.optString(index, "");
                if (!value.isBlank()) ids.add(value);
            }
        }
        return new CardInfo(normalizeMatchText(displayName), summarySameName(displayName), displayName,
            normalizeMatchText(row.optString("creator", metadata.optString("creator", ""))),
            normalize(row.optString("description", "")), ids,
            metadata.optString("cardContentHash", ""), metadata.optString("cardCoreHash", ""),
            baseName(row.optString("fileName", "")));
    }

    private static String summarySameName(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC).trim()
            .replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }

    private static boolean collect(Context context, File[] entries, CardInfo incoming, String incomingFileName,
                                List<JSONObject> candidates, boolean historical) throws Exception {
        if (entries == null) return true;
        for (File entry : entries) {
            JSONObject metadata = readJson(new File(entry, "resource.json"));
            if (metadata == null) return false;
            if (!"characterCard".equals(metadata.optString("resourceType", ""))) continue;
            String hash = metadata.optString("contentHash", "").toLowerCase(Locale.ROOT);
            if (!hash.matches("[a-f0-9]{64}")) return false;
            File object = NativeLibraryPlugin.objectFile(context, hash);
            if (!object.isFile() || object.length() != metadata.optLong("size", -1)) return false;
            String fileName = metadata.optString("fileName", "");
            CardPayload payload = readCard(object, fileName);
            if (payload == null) return false;
            CardInfo existing = info(payload.card, fileName);
            int score = incoming.fullHash.equals(existing.fullHash) ? 100
                : incoming.coreHash.equals(existing.coreHash) ? 90
                : scoreByIdentity(incoming, existing);
            String matchKind = score == 100
                ? (isCrossJsonPng(incomingFileName, fileName) ? "containerVariant" : "contentDuplicate")
                : score == 90 || score == 85 ? "version" : "heuristic";
            if (score < 60 && incoming.sameName.equals(existing.sameName)) { score = 60; matchKind = "sameName"; }
            if (score < 60) continue;
            candidates.add(new JSONObject()
                .put("resourceId", metadata.optString("id", ""))
                .put("versionGroupId", historical ? metadata.optString("versionGroupId", "") : "")
                .put("name", existing.name)
                .put("fileName", fileName)
                .put("historical", historical)
                .put("score", score)
                .put("matchKind", matchKind)
                .put("reasons", matchReasons(matchKind, historical, score, incoming, existing)));
        }
        return true;
    }

    private static int scoreByIdentity(CardInfo left, CardInfo right) {
        if (!Collections.disjoint(left.stableIds, right.stableIds)) return 85;
        int score = left.name.equals(right.name) && !left.name.isEmpty() ? 45 : 0;
        if (!left.creator.isEmpty() && left.creator.equals(right.creator)) score += 25;
        if (!left.fileBase.isEmpty() && left.fileBase.equals(right.fileBase)) score += 15;
        double similarity = jaccard(left.description, right.description);
        if (similarity >= 0.35) score += Math.round(similarity * 18);
        return score;
    }

    private static double jaccard(String left, String right) {
        Set<String> a = tokens(left), b = tokens(right);
        if (a.isEmpty() || b.isEmpty()) return 0;
        Set<String> intersection = new HashSet<>(a);
        intersection.retainAll(b);
        Set<String> union = new HashSet<>(a);
        union.addAll(b);
        return union.isEmpty() ? 0 : (double) intersection.size() / union.size();
    }

    private static Set<String> tokens(String value) {
        Set<String> result = new HashSet<>();
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("[\\p{L}\\p{N}]{2,}")
            .matcher(value == null ? "" : value);
        while (matcher.find() && result.size() < 300)
            result.add(Normalizer.normalize(matcher.group(), Normalizer.Form.NFKC).toLowerCase(Locale.ROOT));
        return result;
    }

    private static CardInfo info(JSONObject card, String fileName) throws Exception {
        JSONObject data = card.optJSONObject("data");
        if (data == null) data = card;
        String displayName = rawString(data, "name", "").trim();
        if (displayName.isEmpty()) displayName = fileName.replaceFirst("(?i)\\.(png|json)$", "");
        String name = normalizeMatchText(displayName);
        if (name.isEmpty()) throw new IllegalArgumentException("角色卡缺少名称");
        String sameName = Normalizer.normalize(displayName, Normalizer.Form.NFKC).trim()
            .replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        String creator = normalizeMatchText(data.optString("creator", ""));
        Set<String> stableIds = new HashSet<>();
        for (String key : new String[] {"uuid", "character_id", "characterId", "source_id", "sourceId", "source"}) {
            String value = normalize(data.optString(key, card.optString(key, "")));
            if (!value.isEmpty() && (!"source".equals(key) || value.matches("(?i)^https?://.*")))
                stableIds.add(key + ":" + value);
        }
        JSONObject core = new JSONObject();
        String[] fields = {"name", "description", "personality", "scenario", "mes_example"};
        boolean hasCore = false;
        for (String field : fields) {
            if (data.has(field)) core.put(field, data.get(field));
            if (!"name".equals(field) && data.opt(field) instanceof String && !data.optString(field).trim().isEmpty()) hasCore = true;
        }
        if (!hasCore) {
            core = new JSONObject();
            for (String field : new String[] {"name", "first_mes", "alternate_greetings"})
                if (data.has(field)) core.put(field, data.get(field));
        }
        JSONObject normalized = normalizeWorldBook(data);
        return new CardInfo(name, sameName, displayName.isEmpty() ? fileName : displayName, creator,
            readString(data, "description"), stableIds,
            hash(canonical(normalized)), hash(canonical(core)), baseName(fileName));
    }

    private static JSONObject parsedResource(JSONObject card, CardInfo info, String fileName, String chunk) throws Exception {
        boolean png = fileName.toLowerCase(Locale.ROOT).endsWith(".png");
        String spec = rawString(card, "spec", "");
        if (spec.isEmpty()) spec = "tavern_card_v1";
        String specVersion = rawString(card, "spec_version", "");
        if (specVersion.isEmpty()) specVersion = "1.0";
        JSONObject data = card.optJSONObject("data");
        if (data == null) data = card;
        JSONObject metadata = new JSONObject()
            .put("format", png ? "png" : "json")
            .put("parserVersion", png ? 2 : 10)
            .put("characterCardSpec", spec)
            .put("characterCardSpecVersion", specVersion)
            .put("creator", rawString(data, "creator", ""))
            .put("characterVersion", rawString(data, "character_version", ""))
            .put("card", card)
            .put("cardContentHash", info.fullHash)
            .put("cardCoreHash", info.coreHash)
            .put("cardFingerprintVersion", 4);
        if (png) metadata.put("characterCardChunk", chunk);
        else {
            metadata.put("detectedVariant", card.optJSONObject("data") == null ? "characterCardJsonLegacy" : "characterCardJson");
            JSONArray rootKeys = new JSONArray();
            Iterator<String> keys = card.keys();
            int count = 0;
            while (keys.hasNext() && count++ < 50) rootKeys.put(keys.next());
            metadata.put("rootKeys", rootKeys);
        }
        JSONArray tags = new JSONArray();
        JSONArray sourceTags = data.optJSONArray("tags");
        if (sourceTags != null) {
            Set<String> unique = new HashSet<>();
            for (int index = 0; index < sourceTags.length(); index++) {
                Object rawTag = sourceTags.opt(index);
                if (!(rawTag instanceof String)) continue;
                String tag = (String) rawTag;
                for (String piece : tag.split("[,，\\n]")) {
                    String value = piece.trim();
                    if (!value.isEmpty() && unique.add(value)) tags.put(value);
                }
            }
        }
        return new JSONObject().put("type", "characterCard").put("name", info.displayName)
            .put("description", rawString(data, "description", "")).put("tags", tags).put("metadata", metadata);
    }

    private static JSONArray matchReasons(String kind, boolean historical, int score,
                                          CardInfo incoming, CardInfo existing) throws Exception {
        JSONArray reasons = new JSONArray();
        if ("contentDuplicate".equals(kind)) reasons.put(historical ? "与历史版本卡内数据完全一致" : "卡内数据完全一致");
        else if ("containerVariant".equals(kind)) reasons.put(historical
            ? "与历史版本卡数据一致，仅立绘或文件封装可能不同"
            : "卡数据一致，仅立绘或文件封装可能不同");
        else if ("version".equals(kind) && score == 90) reasons.put(historical
            ? "与历史版本核心设定一致，其他卡内字段不同"
            : "核心设定一致，其他卡内字段不同");
        else if ("version".equals(kind)) reasons.put(historical
            ? "与历史版本的稳定来源 ID 相同"
            : "稳定来源 ID 相同");
        else if ("sameName".equals(kind)) {
            reasons.put("仅名称相同，内容可能差异较大，请人工确认");
            if (!incoming.creator.isEmpty() && !existing.creator.isEmpty()
                && !incoming.creator.equals(existing.creator)) reasons.put("作者不同");
        } else {
            if (incoming.name.equals(existing.name) && !incoming.name.isEmpty()) reasons.put("名称相同");
            if (!incoming.creator.isEmpty() && incoming.creator.equals(existing.creator)) reasons.put("作者相同");
            if (!incoming.fileBase.isEmpty() && incoming.fileBase.equals(existing.fileBase)) reasons.put("文件名主体相同");
            double similarity = jaccard(incoming.description, existing.description);
            if (similarity >= 0.35) reasons.put("内容摘要相似 " + Math.round(similarity * 100) + "%");
        }
        return reasons;
    }

    private static boolean isJsonName(String name) { return name != null && name.toLowerCase(Locale.ROOT).endsWith(".json"); }
    private static boolean isCrossJsonPng(String first, String second) {
        boolean firstJson = isJsonName(first);
        boolean secondJson = isJsonName(second);
        boolean firstPng = first != null && first.toLowerCase(Locale.ROOT).endsWith(".png");
        boolean secondPng = second != null && second.toLowerCase(Locale.ROOT).endsWith(".png");
        return (firstJson && secondPng) || (firstPng && secondJson);
    }

    private static void writeJsonAtomically(File destination, JSONObject value) throws Exception {
        File temporary = new File(destination.getParentFile(), destination.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(value.toString().getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        if (destination.exists() && !destination.delete()) throw new java.io.IOException("无法替换原生角色卡解析结果");
        if (!temporary.renameTo(destination)) throw new java.io.IOException("无法保存原生角色卡解析结果");
    }

    private static JSONObject normalizeWorldBook(JSONObject data) throws Exception {
        JSONObject copy = new JSONObject(data.toString());
        JSONObject book = copy.optJSONObject("character_book");
        if (book == null) return copy;
        JSONArray entries = book.optJSONArray("entries");
        JSONObject entryObject = book.optJSONObject("entries");
        if (entries == null && entryObject == null) return copy;
        List<String> normalized = new ArrayList<>();
        if (entries != null) {
            for (int i = 0; i < entries.length(); i++) {
                JSONObject entry = entries.optJSONObject(i);
                if (entry == null) continue;
                entry.remove("uid"); entry.remove("id"); entry.remove("__recordKey");
                normalized.add(canonical(entry));
            }
        } else {
            Iterator<String> keys = entryObject.keys();
            while (keys.hasNext()) {
                JSONObject entry = entryObject.optJSONObject(keys.next());
                if (entry == null) continue;
                entry.remove("uid"); entry.remove("id"); entry.remove("__recordKey");
                normalized.add(canonical(entry));
            }
        }
        Collections.sort(normalized);
        JSONArray sorted = new JSONArray();
        for (String item : normalized) sorted.put(new JSONObject(item));
        if (sorted.length() > 0) book.put("entries", sorted); else book.remove("entries");
        return copy;
    }

    private static CardPayload readCard(File file, String fileName) throws Exception {
        if (fileName.toLowerCase(Locale.ROOT).endsWith(".json")) {
            JSONObject value = readJson(file);
            return isCharacterCard(value) ? new CardPayload(value, "") : null;
        }
        if (!fileName.toLowerCase(Locale.ROOT).endsWith(".png")) return null;
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] signature = new byte[8];
            if (input.read(signature) != 8) return null;
            for (int i = 0; i < PNG.length; i++) if (signature[i] != PNG[i]) return null;
            CardPayload legacy = null;
            CardPayload modern = null;
            while (true) {
                byte[] lengthBytes = readExact(input, 4);
                if (lengthBytes.length == 0) return null;
                if (lengthBytes.length != 4) return null;
                int length = ((lengthBytes[0] & 255) << 24) | ((lengthBytes[1] & 255) << 16)
                    | ((lengthBytes[2] & 255) << 8) | (lengthBytes[3] & 255);
                if (length < 0 || length > MAX_CHUNK_BYTES) return null;
                byte[] type = readExact(input, 4);
                if (type.length != 4) return null;
                String kind = new String(type, StandardCharsets.US_ASCII);
                if ("tEXt".equals(kind) || "zTXt".equals(kind)) {
                    byte[] data = readExact(input, length);
                    if (data.length != length || readExact(input, 4).length != 4) return null;
                    int separator = 0;
                    while (separator < data.length && data[separator] != 0) separator++;
                    if (separator == data.length) continue;
                    String key = new String(data, 0, separator, StandardCharsets.ISO_8859_1).toLowerCase(Locale.ROOT);
                    if (!("chara".equals(key) || "ccv3".equals(key))) continue;
                    byte[] text;
                    if ("zTXt".equals(kind)) {
                        if (separator + 2 > data.length || data[separator + 1] != 0) continue;
                        try (InflaterInputStream inflater = new InflaterInputStream(new java.io.ByteArrayInputStream(data, separator + 2, data.length - separator - 2));
                             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                            byte[] buffer = new byte[8192]; int read;
                            while ((read = inflater.read(buffer)) != -1) { if (out.size() + read > MAX_CARD_BYTES) return null; out.write(buffer, 0, read); }
                            text = out.toByteArray();
                        }
                    } else text = java.util.Arrays.copyOfRange(data, separator + 1, data.length);
                    try {
                        String decoded = new String(Base64.decode(text, Base64.DEFAULT), StandardCharsets.UTF_8);
                        JSONObject card = new JSONObject(decoded);
                        if (card != null) {
                            CardPayload payload = new CardPayload(card, key);
                            if ("ccv3".equals(key)) modern = payload;
                            else legacy = payload;
                        }
                    } catch (Exception ignored) { }
                } else if (!skipExact(input, (long) length + 4)) {
                    return null;
                }
                if ("IEND".equals(kind)) return modern == null ? legacy : modern;
            }
        }
    }

    private static boolean isCharacterCard(JSONObject card) {
        if (card == null) return false;
        JSONObject data = card.optJSONObject("data");
        if (data == null) data = card;
        String spec = card.optString("spec", "");
        return data.opt("name") instanceof String && !data.optString("name", "").trim().isEmpty()
            && (("chara_card_v2".equalsIgnoreCase(spec) || "chara_card_v3".equalsIgnoreCase(spec))
                && card.optJSONObject("data") != null
                || data.opt("description") instanceof String && data.opt("personality") instanceof String
                && data.opt("scenario") instanceof String && data.opt("first_mes") instanceof String
                && data.opt("mes_example") instanceof String);
    }

    private static JSONObject readJson(File file) {
        if (!file.isFile() || file.length() > MAX_CARD_BYTES) return null;
        try (FileInputStream input = new FileInputStream(file)) {
            return new JSONObject(new String(readExact(input, (int) file.length()), StandardCharsets.UTF_8));
        } catch (Exception ignored) { return null; }
    }

    private static String canonical(Object value) throws Exception {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            List<String> keys = new ArrayList<>();
            Iterator<String> iterator = object.keys();
            while (iterator.hasNext()) keys.add(iterator.next());
            Collections.sort(keys);
            StringBuilder result = new StringBuilder("{");
            for (int i = 0; i < keys.size(); i++) {
                if (i > 0) result.append(',');
                String key = keys.get(i);
                result.append(JSONObject.quote(key)).append(':').append(canonical(object.get(key)));
            }
            return result.append('}').toString();
        }
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            StringBuilder result = new StringBuilder("[");
            for (int i = 0; i < array.length(); i++) {
                if (i > 0) result.append(',');
                result.append(canonical(array.get(i)));
            }
            return result.append(']').toString();
        }
        if (value == null || value == JSONObject.NULL) return "null";
        if (value instanceof String) return JSONObject.quote((String) value);
        if (value instanceof Number) return javascriptNumber((Number) value);
        if (value instanceof Boolean) return String.valueOf(value);
        return "null";
    }

    private static byte[] readExact(FileInputStream input, int size) throws Exception {
        byte[] result = new byte[size];
        int offset = 0;
        while (offset < size) {
            int read = input.read(result, offset, size - offset);
            if (read < 0) break;
            offset += read;
        }
        return offset == size ? result : java.util.Arrays.copyOf(result, offset);
    }

    private static boolean skipExact(FileInputStream input, long size) throws Exception {
        long remaining = size;
        while (remaining > 0) {
            long skipped = input.skip(remaining);
            if (skipped <= 0) {
                if (input.read() == -1) return false;
                skipped = 1;
            }
            remaining -= skipped;
        }
        return true;
    }

    private static String hash(String text) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(64);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value));
        return result.toString();
    }

    private static String normalize(String value) { return value == null ? "" : value.trim().toLowerCase(Locale.ROOT); }
    private static String javascriptNumber(Number value) {
        double number = value.doubleValue();
        if (Double.isNaN(number) || Double.isInfinite(number)) return "null";
        if (number == 0d) return "0";
        String raw = Double.toString(number).toLowerCase(Locale.ROOT);
        BigDecimal decimal = BigDecimal.valueOf(number).stripTrailingZeros();
        double absolute = Math.abs(number);
        if (absolute >= 1e-6 && absolute < 1e21) return decimal.toPlainString();
        int exponentIndex = raw.indexOf('e');
        if (exponentIndex < 0) return raw;
        String mantissa = raw.substring(0, exponentIndex);
        if (mantissa.endsWith(".0")) mantissa = mantissa.substring(0, mantissa.length() - 2);
        int exponent = Integer.parseInt(raw.substring(exponentIndex + 1));
        return mantissa + "e" + (exponent >= 0 ? "+" : "") + exponent;
    }
    private static String normalizeMatchText(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC).trim()
            .toLowerCase(Locale.ROOT).replaceAll("[\\s·・_—–()【】（）.]+", "")
            .replace("-", "").replaceAll("[\\[\\]]+", "");
    }
    private static String readString(JSONObject object, String key) { return normalize(object.optString(key, "")); }
    private static String rawString(JSONObject object, String key, String fallback) {
        Object value = object.opt(key);
        return value instanceof String ? (String) value : fallback;
    }
    private static String baseName(String fileName) {
        String value = fileName == null ? "" : fileName.replaceFirst("(?i)\\.(png|json)$", "")
            .replaceAll("(?i)(?:^|[\\s_-])v?\\d+(?:\\.\\d+)*(?:[\\s_-]|$)", " ")
            .replaceAll("更新|新版|修订|最终版|final|new|latest", "");
        return normalizeMatchText(value);
    }

    private static final class CardInfo {
        final String name, sameName, displayName, creator, description, fullHash, coreHash, fileBase;
        final Set<String> stableIds;
        CardInfo(String name, String sameName, String displayName, String creator, String description, Set<String> stableIds,
                 String fullHash, String coreHash, String fileBase) {
            this.name = name; this.sameName = sameName; this.displayName = displayName;
            this.creator = creator; this.description = description; this.stableIds = stableIds;
            this.fullHash = fullHash; this.coreHash = coreHash; this.fileBase = fileBase;
        }
    }

    private static final class CardPayload {
        final JSONObject card;
        final String chunk;
        CardPayload(JSONObject card, String chunk) { this.card = card; this.chunk = chunk; }
    }
}
