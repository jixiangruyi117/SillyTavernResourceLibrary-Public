package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.webkit.MimeTypeMap;
import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Commits safe, unambiguous character-card imports directly into the shared native library. */
final class NativeBackgroundResourceImporter {
    private static final String ACTIVE_STATE = "migration:appdb:v1:active";
    private static final String VAULT_SETTING = "\"local-vault\"";
    private static final String BLOB_PATH = "$/originalBlob";
    private static final int PAGE_SIZE = 25;
    private static final int MAX_MATCHES = 100;
    private static final int MAX_ROW_JSON_CHARS = 4 * 1024 * 1024;

    private NativeBackgroundResourceImporter() {}

    static JSONObject importIfSafe(Context context, File payload, File parsedFile, String fileName,
                                   String mimeType) throws Exception {
        NativeAppDatabase database = new NativeAppDatabase(context);
        try {
            return importIfSafe(context, database, payload, parsedFile, fileName, mimeType);
        } finally {
            database.close();
        }
    }

    static synchronized JSONObject importIfSafe(Context context, NativeAppDatabase database, File payload, File parsedFile,
                                   String fileName, String mimeType) throws Exception {
        JSONObject parsed = readJson(parsedFile);
        if (!"characterCard".equals(parsed.optString("type")))
            return outcome("not_character_card", "附件不是角色卡");
        {
            JSONObject active = parseState(database.getState(ACTIVE_STATE));
            if (active == null || "legacy".equals(active.optString("mode"))
                || "rolling-back".equals(active.optString("mode")))
                return outcome("native_database_unavailable", "原生资源库尚未完成迁移");
            if (!"verified-v1".equals(database.getState("migration:appdb:indexes:v1:active")))
                return outcome("native_database_unavailable", "原生资源库索引尚未就绪");
            JSONObject vault = database.getRecord("settings", VAULT_SETTING);
            if (vault != null && vault.optJSONObject("value") != null)
                return outcome("vault_requires_foreground", "本地加密库需要在前台解锁后导入");

            String fileHash = hashFile(payload);
            if (containsHash(database, "resourceSummaries", fileHash)
                || containsHash(database, "resourceVersionSummaries", fileHash))
                return outcome("duplicate_file", "资源库已存在完全相同的文件");

            JSONArray matches = findMatches(database, parsed, fileName, "resourceSummaries", false);
            if (hasContentDuplicate(matches))
                return outcome("duplicate_card", "资源库已存在卡内数据完全相同的角色卡");
            JSONArray versions = findMatches(database, parsed, fileName, "resourceVersionSummaries", true);
            matches = mergeMatches(matches, versions);
            if (matches.length() > 0) {
                JSONObject waiting = outcome("waiting_version", "发现相似角色卡，需要选择版本");
                waiting.put("candidateCount", matches.length()).put("candidates", matches);
                return waiting;
            }

            long now = System.currentTimeMillis();
            String id = java.util.UUID.randomUUID().toString();
            String key = JSONObject.quote(id);
            String type = normalizedMimeType(fileName, mimeType);
            long size = payload.length();
            JSONObject resource = new JSONObject(parsed.toString())
                .put("id", id)
                .put("fileName", fileName)
                .put("mimeType", type)
                .put("fileSize", size)
                .put("contentHash", fileHash)
                .put("backupDescriptor", new JSONObject()
                    .put("version", 1).put("resourceId", id).put("contentHash", fileHash)
                    .put("size", size).put("updatedAt", now))
                .put("favorite", false)
                .put("categoryId", JSONObject.NULL)
                .put("categoryIds", new JSONArray())
                .put("relatedResourceIds", new JSONArray())
                .put("sourceLinks", new JSONArray())
                .put("versionImportedAt", now)
                .put("versionCount", 1)
                .put("createdAt", now)
                .put("updatedAt", now)
                .put("versionLabel", versionLabel(parsed.optString("metadata") == null ? null : parsed.optJSONObject("metadata"), fileName));

            JSONObject attachment = storeAttachment(database, payload, id, key, type);
            resource.put("originalBlob", new JSONObject()
                .put("__srlAppDatabaseValueV1", "blob")
                .put("fieldPath", BLOB_PATH)
                .put("blobOwnerKey", key)
                .put("size", size)
                .put("mimeType", type)
                .put("sha256", attachment.getString("sha256")));
            JSONObject summary = new JSONObject(resource.toString());
            summary.remove("originalBlob");
            JSONObject listSummary = new JSONObject(summary.toString())
                .put("metadata", listMetadata(summary.optJSONObject("metadata")));

            JSONArray operations = new JSONArray()
                .put(putOperation("resources", key, resource))
                .put(putOperation("resourceSummaries", key, summary))
                .put(putOperation("resourceListSummaries", key, listSummary));
            try {
                if (resource.toString().length() > MAX_ROW_JSON_CHARS ||
                    summary.toString().length() > MAX_ROW_JSON_CHARS ||
                    listSummary.toString().length() > MAX_ROW_JSON_CHARS)
                    throw new IllegalStateException("角色卡数据较大，请打开资源库完成导入");
                database.applyBatch(operations, true);
            } catch (Exception error) {
                database.deleteBlob("resources", key, BLOB_PATH);
                throw error;
            }
            return outcome("imported", "角色卡已在后台解析并导入原生资源库")
                .put("resourceId", id).put("contentHash", fileHash).put("name", resource.optString("name"));
        }
    }

    private static JSONObject readJson(File file) throws Exception {
        if (!file.isFile() || file.length() > 32L * 1024L * 1024L)
            throw new IllegalArgumentException("原生解析结果缺失或超出大小限制");
        byte[] bytes = new byte[(int) file.length()];
        try (FileInputStream input = new FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int count = input.read(bytes, offset, bytes.length - offset);
                if (count < 0) throw new java.io.IOException("原生解析结果读取不完整");
                offset += count;
            }
        }
        return new JSONObject(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
    }

    private static JSONObject parseState(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            JSONObject state = new JSONObject(raw);
            return state.optInt("version") == 1 ? state : null;
        } catch (Exception ignored) { return null; }
    }

    private static boolean containsHash(NativeAppDatabase database, String store, String hash) throws Exception {
        // contentHash is a verified SQLite index. Looking up its owner keys avoids paging and
        // deserializing every resource summary for each incoming cloud attachment.
        JSONArray indexed = database.getIndexEntries(
            store, "contentHash", JSONObject.quote(hash.toLowerCase(Locale.ROOT)));
        JSONArray keys = new JSONArray();
        for (int index = 0; index < indexed.length(); index++) {
            JSONObject entry = indexed.optJSONObject(index);
            if (entry != null) keys.put(entry.optString("primaryKey"));
        }
        for (int offset = 0; offset < keys.length(); offset += 900) {
            JSONArray batch = new JSONArray();
            for (int index = offset; index < Math.min(keys.length(), offset + 900); index++) {
                batch.put(keys.optString(index));
            }
            JSONArray rows = database.getRecordsByKeys(store, batch);
            for (int index = 0; index < rows.length(); index++) {
                JSONObject row = rows.optJSONObject(index);
                JSONObject value = row == null ? null : row.optJSONObject("value");
                if (value == null) continue;
                if (value.optBoolean("encrypted")) throw new IllegalStateException("本地加密库需要在前台解锁后导入");
                if (hash.equalsIgnoreCase(value.optString("contentHash"))) return true;
            }
        }
        return false;
    }

    private static JSONArray findMatches(NativeAppDatabase database, JSONObject parsed, String fileName,
                                         String store, boolean historical) throws Exception {
        JSONArray matches = new JSONArray();
        if (!historical && "resourceSummaries".equals(store)) {
            JSONArray indexedCards = database.getIndexEntries(
                store, "type", JSONObject.quote("characterCard"));
            for (int offset = 0; offset < indexedCards.length(); offset += PAGE_SIZE) {
                JSONArray keys = new JSONArray();
                for (int index = offset; index < Math.min(indexedCards.length(), offset + PAGE_SIZE); index++) {
                    JSONObject entry = indexedCards.optJSONObject(index);
                    if (entry != null) keys.put(entry.optString("primaryKey"));
                }
                matches = matchRows(matches, database.getRecordsByKeys(store, keys), parsed, fileName, false);
            }
            return matches;
        }
        String afterKey = null;
        while (true) {
            JSONArray page = database.getRecords(store, afterKey, PAGE_SIZE);
            matches = matchRows(matches, page, parsed, fileName, historical);
            if (page.length() < PAGE_SIZE) break;
            afterKey = page.optJSONObject(page.length() - 1).optString("key");
        }
        return matches;
    }

    private static JSONArray matchRows(JSONArray matches, JSONArray page, JSONObject parsed,
                                       String fileName, boolean historical) throws Exception {
        JSONArray rows = new JSONArray();
        for (int index = 0; index < page.length(); index++) {
            JSONObject row = page.optJSONObject(index);
            JSONObject value = row == null ? null : row.optJSONObject("value");
            if (value == null) continue;
            if (value.optBoolean("encrypted")) throw new IllegalStateException("本地加密库需要在前台解锁后导入");
            if (historical) value.put("historical", true);
            rows.put(value);
        }
        return mergeMatches(matches,
            NativeCharacterCardProcessor.matchParsedResource(parsed, fileName, rows, false));
    }

    private static JSONArray mergeMatches(JSONArray left, JSONArray right) throws Exception {
        java.util.ArrayList<JSONObject> sorted = new java.util.ArrayList<>();
        for (int index = 0; index < left.length(); index++) sorted.add(left.getJSONObject(index));
        for (int index = 0; index < right.length(); index++) sorted.add(right.getJSONObject(index));
        sorted.sort((first, second) -> Integer.compare(second.optInt("score"), first.optInt("score")));
        JSONArray matches = new JSONArray();
        for (int index = 0; index < Math.min(MAX_MATCHES, sorted.size()); index++) matches.put(sorted.get(index));
        return matches;
    }

    private static boolean hasContentDuplicate(JSONArray matches) {
        for (int index = 0; index < matches.length(); index++) {
            JSONObject match = matches.optJSONObject(index);
            if (match != null && "contentDuplicate".equals(match.optString("matchKind"))) return true;
        }
        return false;
    }

    private static JSONObject storeAttachment(NativeAppDatabase database, File payload, String id,
                                              String encodedKey, String mimeType) throws Exception {
        long size = payload.length();
        NativeAppDatabase.BlobTransfer transfer = database.beginBlob("resources", encodedKey, BLOB_PATH, size, mimeType);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[NativeAppDatabase.MAX_BLOB_CHUNK_BYTES];
        try (FileInputStream input = new FileInputStream(payload)) {
            long offset = transfer.offset;
            long skipped = 0;
            while (skipped < offset) {
                long count = input.skip(offset - skipped);
                if (count <= 0) throw new java.io.IOException("角色卡附件续传位置无效");
                skipped += count;
            }
            // A pending native blob can survive a Worker process restart. Include the already
            // staged prefix in the digest before validating the completed attachment.
            if (offset > 0) {
                try (FileInputStream prefix = new FileInputStream(payload)) {
                    long remaining = offset;
                    while (remaining > 0) {
                        int count = prefix.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                        if (count < 0) throw new java.io.IOException("角色卡附件续传前缀不完整");
                        digest.update(buffer, 0, count);
                        remaining -= count;
                    }
                }
            }
            int count;
            while ((count = input.read(buffer)) != -1) {
                digest.update(buffer, 0, count);
                offset = database.appendBlob(transfer.token, offset, java.util.Arrays.copyOf(buffer, count));
            }
            if (offset != size) throw new java.io.IOException("角色卡附件暂存不完整");
            JSONObject metadata = database.completeBlob(transfer.token);
            String calculated = hex(digest.digest());
            if (!calculated.equalsIgnoreCase(metadata.optString("sha256")))
                throw new java.io.IOException("角色卡附件 SHA-256 核验失败");
            return metadata;
        } catch (Exception error) {
            database.deleteBlob("resources", encodedKey, BLOB_PATH);
            throw error;
        }
    }

    private static JSONObject putOperation(String store, String key, JSONObject value) throws Exception {
        JSONObject row = new JSONObject().put("key", key).put("value", value)
            .put("indexes", indexEntries(store, value));
        return new JSONObject().put("type", "put").put("store", store)
            .put("rows", new JSONArray().put(row));
    }

    private static JSONArray indexEntries(String store, JSONObject value) throws Exception {
        JSONArray result = new JSONArray();
        if (!"resources".equals(store) && !"resourceSummaries".equals(store)
            && !"resourceListSummaries".equals(store)) return result;
        addIndex(result, "type", value.opt("type"));
        addIndex(result, "name", value.opt("name"));
        addIndex(result, "favorite", value.opt("favorite"));
        addIndex(result, "categoryId", value.opt("categoryId"));
        addMultiIndex(result, "categoryIds", value.optJSONArray("categoryIds"));
        addIndex(result, "createdAt", value.opt("createdAt"));
        addIndex(result, "updatedAt", value.opt("updatedAt"));
        addIndex(result, "contentHash", value.opt("contentHash"));
        addMultiIndex(result, "tags", value.optJSONArray("tags"));
        return result;
    }

    private static void addIndex(JSONArray result, String name, Object value) throws Exception {
        if (!(value instanceof String || value instanceof Number)) return;
        result.put(new JSONObject().put("name", name)
            .put("keys", new JSONArray().put(indexKey(value))));
    }

    private static void addMultiIndex(JSONArray result, String name, JSONArray values) throws Exception {
        if (values == null || values.length() == 0) return;
        JSONArray keys = new JSONArray();
        java.util.HashSet<String> distinct = new java.util.HashSet<>();
        for (int index = 0; index < values.length(); index++) {
            Object value = values.opt(index);
            if (!(value instanceof String || value instanceof Number)) continue;
            String key = indexKey(value);
            if (distinct.add(key)) keys.put(key);
        }
        if (keys.length() > 0) result.put(new JSONObject().put("name", name).put("keys", keys));
    }

    private static String indexKey(Object value) throws Exception {
        if (value instanceof String) return JSONObject.quote((String) value);
        return String.valueOf(value);
    }

    private static JSONObject listMetadata(JSONObject metadata) throws Exception {
        JSONObject result = new JSONObject();
        if (metadata == null) return result;
        JSONArray keys = metadata.names();
        if (keys == null) return result;
        for (int index = 0; index < keys.length(); index++) {
            String key = keys.optString(index);
            Object value = metadata.opt(key);
            if (value == null || value == JSONObject.NULL || value instanceof Boolean || value instanceof Number) result.put(key, value);
            else if (value instanceof String) result.put(key, ((String) value).substring(0, Math.min(2000, ((String) value).length())));
            else if (value instanceof JSONArray) {
                JSONArray source = (JSONArray) value;
                JSONArray copy = new JSONArray();
                boolean primitive = true;
                for (int item = 0; item < source.length(); item++) {
                    Object entry = source.opt(item);
                    if (!(entry instanceof String || entry instanceof Number || entry instanceof Boolean)) { primitive = false; break; }
                    if (item < 64) copy.put(entry);
                }
                if (primitive) result.put(key, "stitchedFrom".equals(key) ? new JSONArray() : copy);
            }
        }
        return result;
    }

    private static String versionLabel(JSONObject metadata, String fileName) {
        String explicit = metadata == null ? "" : metadata.optString("characterVersion", "").trim();
        if (!explicit.isEmpty()) return explicit;
        int dot = fileName.lastIndexOf('.');
        return dot > 0 ? fileName.substring(0, dot) : fileName.isBlank() ? "未命名版本" : fileName;
    }

    private static String normalizedMimeType(String fileName, String supplied) {
        if (supplied != null && supplied.contains("/") && !"application/octet-stream".equals(supplied)) return supplied;
        int dot = fileName.lastIndexOf('.');
        String guessed = dot < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(fileName.substring(dot + 1).toLowerCase(Locale.ROOT));
        return guessed == null ? "application/octet-stream" : guessed;
    }

    private static String hashFile(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[128 * 1024];
        try (FileInputStream input = new FileInputStream(file)) {
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return hex(digest.digest());
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    private static JSONObject outcome(String state, String message) throws Exception {
        return new JSONObject().put("state", state).put("message", message);
    }
}
