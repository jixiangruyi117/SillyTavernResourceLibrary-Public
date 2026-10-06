package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.webkit.MimeTypeMap;
import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
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
            // Preserve the existing active-content fast path: an exact same-format duplicate
            // does not need to scan every historical version record.
            if (hasContentDuplicate(matches))
                return outcome("duplicate_card", "资源库已存在卡内数据完全相同的角色卡");
            JSONArray versions = findMatches(database, parsed, fileName, "resourceVersionSummaries", true);
            matches = mergeMatches(matches, versions);
            JSONObject automationSettings = readAutomationSettings(database);
            if (automationSettings.optBoolean("preferPngContainer", false)) {
                JSONObject containerMatch = uniqueContainerMatch(matches, fileName);
                if (containerMatch != null) {
                    JSONObject containerResult = importPreferredPngContainer(
                        context, database, payload, parsed, fileName, mimeType, fileHash,
                        containerMatch, matches, automationSettings);
                    if (containerResult != null) return containerResult;
                }
            }
            if (hasContentDuplicate(matches))
                return outcome("duplicate_card", "资源库已存在卡内数据完全相同的角色卡");
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
            JSONObject resource = newResource(parsed, fileName, type, fileHash, size, id, now);

            JSONArray automationOperations = new JSONArray();
            JSONObject autoBinding = findAutoBinding(database, parsed, fileName, id, automationSettings, now);
            if (autoBinding != null) {
                JSONObject source = autoBinding.optJSONObject("source");
                JSONObject binding = autoBinding.getJSONObject("binding");
                if (source != null)
                    automationOperations.put(putOperation("communitySources",
                        JSONObject.quote(source.optString("id")), source));
                automationOperations.put(putOperation("resourceSourceBindings",
                    JSONObject.quote(binding.getString("id")), binding));
            }

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
            for (int index = 0; index < automationOperations.length(); index++)
                operations.put(automationOperations.getJSONObject(index));
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
            JSONObject result = outcome("imported", "角色卡已在后台解析并导入原生资源库")
                .put("resourceId", id).put("contentHash", fileHash).put("name", resource.optString("name"));
            if (autoBinding != null)
                result.put("autoBoundSourceId", autoBinding.getJSONObject("binding").optString("sourceId"))
                    .put("autoBindingRule", autoBinding.getJSONObject("binding").optString("autoBindingRule"));
            return result;
        }
    }

    private static JSONObject uniqueContainerMatch(JSONArray matches, String incomingFileName) {
        boolean incomingPng = incomingFileName.toLowerCase(Locale.ROOT).endsWith(".png");
        JSONObject selected = null;
        for (int index = 0; index < matches.length(); index++) {
            JSONObject match = matches.optJSONObject(index);
            if (match == null || !"containerVariant".equals(match.optString("matchKind"))) continue;
            String matchedName = match.optString("fileName", "");
            boolean matchedPng = matchedName.toLowerCase(Locale.ROOT).endsWith(".png");
            if (incomingPng == matchedPng) continue;
            if (selected != null) return null;
            selected = match;
        }
        return selected;
    }

    private static JSONObject importPreferredPngContainer(Context context, NativeAppDatabase database,
        File payload, JSONObject parsed, String fileName, String mimeType, String fileHash,
        JSONObject match, JSONArray matches, JSONObject automationSettings) throws Exception {
        String targetId = match.optString("resourceId", "");
        boolean matchedHistorical = match.optBoolean("historical");
        if (matchedHistorical) targetId = match.optString("versionGroupId", "");
        if (targetId.isBlank()) return null;
        String targetKey = JSONObject.quote(targetId);
        long now = System.currentTimeMillis();
        String type = normalizedMimeType(fileName, mimeType);
        JSONObject current = database.getRecord("resources", targetKey);
        if (current == null) return null;
        if (matchedHistorical)
            return storeHistoricalContainer(database, payload, parsed, fileName, type, fileHash,
                current, match, targetId, automationSettings, now);
        boolean incomingPng = fileName.toLowerCase(Locale.ROOT).endsWith(".png");
        boolean currentPng = current.optString("fileName", "").toLowerCase(Locale.ROOT).endsWith(".png");
        if (incomingPng == currentPng && !matchedHistorical) return null;
        // A second JSON representation is still the same-format duplicate. Keep the PNG
        // current, and do not manufacture another JSON history record for it.
        if (!incomingPng) {
            for (int index = 0; index < matches.length(); index++) {
                JSONObject candidate = matches.optJSONObject(index);
                if (candidate != null && "contentDuplicate".equals(candidate.optString("matchKind")))
                    return outcome("duplicate_card", "PNG 封装已保留；资源库已有相同角色卡 JSON 文件")
                        .put("resourceId", targetId).put("name", current.optString("name"));
            }
        }

        long size = payload.length();
        JSONObject incoming = newResource(parsed, fileName, type, fileHash, size,
            java.util.UUID.randomUUID().toString(), now);
        JSONArray operations = new JSONArray();
        String bindingResourceId = targetId;
        String attachmentStore = incomingPng ? "resources" : "resourceVersions";
        String attachmentKey = JSONObject.quote(incoming.optString("id"));

        if (incomingPng) {
            String stagedKey = JSONObject.quote(incoming.optString("id"));
            String versionId = java.util.UUID.randomUUID().toString();
            String versionKey = JSONObject.quote(versionId);
            JSONObject archived = new JSONObject(current.toString())
                .put("id", versionId)
                .put("versionGroupId", targetId)
                .put("versionNote", "同内容 JSON / PNG 封装")
                .put("versionVariantKind", "container");
            JSONObject archivedBlob = archived.optJSONObject("originalBlob");
            if (archivedBlob != null) archivedBlob.remove("blobOwnerKey");
            JSONObject archivedBackup = archived.optJSONObject("backupDescriptor");
            if (archivedBackup != null) archivedBackup.put("resourceId", versionId);
            JSONObject archivedMetadata = archived.optJSONObject("metadata");
            if (archivedMetadata == null) archivedMetadata = new JSONObject();
            archived.put("metadata", new JSONObject(archivedMetadata.toString())
                .put("versionVariantKind", "container"));
            long logicalCount = Math.max(1, current.optLong("versionCount", 1));
            archived.put("versionCount", logicalCount)
                .put("versionImportedAt", current.optLong("versionImportedAt", current.optLong("createdAt", now)))
                .put("versionLabel", current.optString("versionLabel", versionLabel(current.optJSONObject("metadata"), current.optString("fileName"))));

            incoming.put("id", targetId)
                .put("versionCount", logicalCount)
                .put("createdAt", current.optLong("createdAt", now));
            JSONObject incomingBackup = incoming.optJSONObject("backupDescriptor");
            if (incomingBackup != null) incomingBackup.put("resourceId", targetId);
            JSONObject incomingMetadata = incoming.optJSONObject("metadata");
            if (incomingMetadata == null) incomingMetadata = new JSONObject();
            incoming.put("metadata", new JSONObject(incomingMetadata.toString())
                .put("versionVariantKind", "container"));
            preserveUserFields(incoming, current);
            attachmentStore = "resources";
            attachmentKey = stagedKey;
            JSONObject attachment = storeAttachment(database, attachmentStore, payload,
                incoming.optString("id"), attachmentKey, type);
            incoming.put("originalBlob", blobReference(stagedKey, size, type, attachment));
            JSONObject archivedSummary = resourceSummary(archived);
            JSONObject archivedList = listSummary(archivedSummary);
            JSONObject currentSummary = resourceSummary(incoming);
            JSONObject currentList = listSummary(currentSummary);
            operations.put(moveBlobsOperation("resources", targetKey, "resourceVersions", versionKey))
                .put(putOperation("resourceVersions", versionKey, archived))
                .put(putOperation("resourceVersionSummaries", versionKey, archivedSummary))
                .put(putOperation("resources", targetKey, incoming))
                .put(putOperation("resourceSummaries", targetKey, currentSummary))
                .put(putOperation("resourceListSummaries", targetKey, currentList));
        } else {
            String versionId = incoming.optString("id");
            String versionKey = JSONObject.quote(versionId);
            long logicalCount = Math.max(1, current.optLong("versionCount", 1));
            incoming.put("versionGroupId", targetId)
                .put("versionCount", logicalCount)
                .put("versionNote", "同内容 JSON / PNG 封装");
            JSONObject metadata = incoming.optJSONObject("metadata");
            if (metadata == null) metadata = new JSONObject();
            incoming.put("metadata", new JSONObject(metadata.toString()).put("versionVariantKind", "container"));

            current.put("versionCount", logicalCount).put("updatedAt", now);
            attachmentStore = "resourceVersions";
            attachmentKey = versionKey;
            JSONObject attachment = storeAttachment(database, attachmentStore, payload,
                versionId, attachmentKey, type);
            JSONObject versionBlob = blobReference(versionKey, size, type, attachment);
            versionBlob.remove("blobOwnerKey");
            incoming.put("originalBlob", versionBlob);
            JSONObject versionSummary = resourceSummary(incoming);
            JSONObject currentSummary = resourceSummary(current);
            operations.put(putOperation("resourceVersions", versionKey, incoming))
                .put(putOperation("resourceVersionSummaries", versionKey, versionSummary))
                .put(putOperation("resources", targetKey, current))
                .put(putOperation("resourceSummaries", targetKey, currentSummary))
                .put(putOperation("resourceListSummaries", targetKey, listSummary(currentSummary)));
        }

        JSONObject autoBinding = findAutoBinding(database, parsed, fileName, bindingResourceId, automationSettings, now);
        appendAutoBindingOperations(operations, autoBinding);
        try {
            for (int index = 0; index < operations.length(); index++) {
                JSONObject operation = operations.optJSONObject(index);
                if (operation == null) continue;
                JSONArray rows = operation.optJSONArray("rows");
                if (rows != null) for (int row = 0; row < rows.length(); row++) {
                    JSONObject record = rows.optJSONObject(row);
                    JSONObject value = record == null ? null : record.optJSONObject("value");
                    if (value != null && value.toString().length() > MAX_ROW_JSON_CHARS)
                        throw new IllegalStateException("角色卡数据较大，请打开资源库完成导入");
                }
            }
            database.applyBatch(operations, true);
        } catch (Exception error) {
            database.deleteBlob(attachmentStore, attachmentKey, BLOB_PATH);
            throw error;
        }
        JSONObject result = outcome("imported", incomingPng
            ? "PNG 封装已设为当前资源，原 JSON 已保留为不同封装"
            : "JSON 已保存为不同封装，PNG 当前封装保持不变")
            .put("resourceId", targetId).put("contentHash", fileHash)
            .put("name", incoming.optString("name")).put("containerPreference", "png-current")
            .put("importedAs", incomingPng ? "current-png-container" : "json-container-variant");
        if (autoBinding != null)
            result.put("autoBoundSourceId", autoBinding.getJSONObject("binding").optString("sourceId"))
                .put("autoBindingRule", autoBinding.getJSONObject("binding").optString("autoBindingRule"));
        return result;
    }

    private static JSONObject storeHistoricalContainer(NativeAppDatabase database, File payload,
        JSONObject parsed, String fileName, String type, String fileHash, JSONObject current,
        JSONObject match, String targetId, JSONObject automationSettings, long now) throws Exception {
        String selectedKey = JSONObject.quote(match.optString("resourceId", ""));
        JSONObject selected = database.getRecord("resourceVersions", selectedKey);
        if (selected == null || !targetId.equals(selected.optString("versionGroupId", ""))) return null;
        boolean incomingPng = fileName.toLowerCase(Locale.ROOT).endsWith(".png");
        boolean selectedPng = selected.optString("fileName", "").toLowerCase(Locale.ROOT).endsWith(".png");
        if (incomingPng == selectedPng) return null;
        String incomingId = java.util.UUID.randomUUID().toString();
        String incomingKey = JSONObject.quote(incomingId);
        long logicalCount = Math.max(1, current.optLong("versionCount", 1));
        JSONObject incoming = newResource(parsed, fileName, type, fileHash, payload.length(), incomingId, now)
            .put("versionGroupId", targetId)
            .put("versionCount", logicalCount)
            .put("versionNote", "同内容 JSON / PNG 封装");
        JSONObject incomingMetadata = incoming.optJSONObject("metadata");
        if (incomingMetadata == null) incomingMetadata = new JSONObject();
        incoming.put("metadata", new JSONObject(incomingMetadata.toString()).put("versionVariantKind", "container"));
        JSONObject incomingAttachment = storeAttachment(database, "resourceVersions", payload,
            incomingId, incomingKey, type);
        JSONObject incomingBlob = blobReference(incomingKey, payload.length(), type, incomingAttachment);
        incomingBlob.remove("blobOwnerKey");
        incoming.put("originalBlob", incomingBlob);
        JSONArray operations = new JSONArray()
            .put(putOperation("resourceVersions", incomingKey, incoming))
            .put(putOperation("resourceVersionSummaries", incomingKey, resourceSummary(incoming)));
        JSONObject autoBinding = findAutoBinding(database, parsed, fileName, targetId, automationSettings, now);
        appendAutoBindingOperations(operations, autoBinding);
        try {
            database.applyBatch(operations, true);
        } catch (Exception error) {
            database.deleteBlob("resourceVersions", incomingKey, BLOB_PATH);
            throw error;
        }
        JSONObject result = outcome("imported", "历史封装已保存；当前版本保持不变")
            .put("resourceId", targetId).put("contentHash", fileHash)
            .put("name", incoming.optString("name")).put("containerPreference", "png-current")
            .put("importedAs", "historical-container-variant");
        if (autoBinding != null)
            result.put("autoBoundSourceId", autoBinding.getJSONObject("binding").optString("sourceId"))
                .put("autoBindingRule", autoBinding.getJSONObject("binding").optString("autoBindingRule"));
        return result;
    }

    private static JSONObject newResource(JSONObject parsed, String fileName, String type, String fileHash,
                                            long size, String id, long now) throws Exception {
        return new JSONObject(parsed.toString())
            .put("id", id).put("fileName", fileName).put("mimeType", type).put("fileSize", size)
            .put("contentHash", fileHash)
            .put("backupDescriptor", new JSONObject().put("version", 1).put("resourceId", id)
                .put("contentHash", fileHash).put("size", size).put("updatedAt", now))
            .put("favorite", false).put("categoryId", JSONObject.NULL).put("categoryIds", new JSONArray())
            .put("relatedResourceIds", new JSONArray()).put("sourceLinks", new JSONArray())
            .put("versionImportedAt", now).put("versionCount", 1).put("createdAt", now).put("updatedAt", now)
            .put("versionLabel", versionLabel(parsed.optJSONObject("metadata"), fileName));
    }

    private static void preserveUserFields(JSONObject incoming, JSONObject current) throws Exception {
        for (String field : new String[] {"favorite", "categoryId", "categoryIds", "relatedResourceIds", "sourceLinks", "tags"})
            if (current.has(field)) incoming.put(field, current.get(field));
        JSONObject metadata = incoming.optJSONObject("metadata");
        JSONObject previous = current.optJSONObject("metadata");
        if (metadata == null) metadata = new JSONObject();
        if (previous != null) for (String field : new String[] {
            "authorNote", "manuallyBoundResourceIds", "resourceCoverId", "characterContentEdits", "recognizedFileHashes"})
            if (previous.has(field)) metadata.put(field, previous.get(field));
        incoming.put("metadata", metadata);
    }

    private static JSONObject resourceSummary(JSONObject resource) throws Exception {
        JSONObject summary = new JSONObject(resource.toString());
        summary.remove("originalBlob");
        return summary;
    }

    private static JSONObject listSummary(JSONObject summary) throws Exception {
        return new JSONObject(summary.toString()).put("metadata", listMetadata(summary.optJSONObject("metadata")));
    }

    private static JSONObject blobReference(String ownerKey, long size, String type, JSONObject attachment) throws Exception {
        return new JSONObject().put("__srlAppDatabaseValueV1", "blob").put("fieldPath", BLOB_PATH)
            .put("blobOwnerKey", ownerKey).put("size", size).put("mimeType", type)
            .put("sha256", attachment.getString("sha256"));
    }

    private static JSONObject moveBlobsOperation(String fromStore, String fromKey, String toStore,
                                                  String toKey) throws Exception {
        return new JSONObject().put("type", "moveBlobs").put("store", fromStore)
            .put("fromStore", fromStore).put("fromKey", fromKey).put("toStore", toStore).put("toKey", toKey);
    }

    private static void appendAutoBindingOperations(JSONArray operations, JSONObject autoBinding) throws Exception {
        if (autoBinding == null) return;
        JSONObject source = autoBinding.optJSONObject("source");
        JSONObject binding = autoBinding.getJSONObject("binding");
        if (source != null) operations.put(putOperation("communitySources", JSONObject.quote(source.optString("id")), source));
        operations.put(putOperation("resourceSourceBindings", JSONObject.quote(binding.getString("id")), binding));
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

    private static JSONObject readAutomationSettings(NativeAppDatabase database) {
        JSONObject record = database.getRecord("settings", JSONObject.quote("discordInbox.automation.v1"));
        return record == null ? new JSONObject() : record.optJSONObject("value") == null
            ? new JSONObject() : record.optJSONObject("value");
    }

    private static JSONObject findAutoBinding(NativeAppDatabase database, JSONObject parsed, String fileName,
                                               String resourceId, JSONObject settings, long now) throws Exception {
        if (!"characterCard".equals(parsed.optString("type"))) return null;
        boolean sameNameEnabled = settings.optBoolean("bindSameName", false);
        boolean sameAuthorEnabled = settings.optBoolean("bindSameAuthor", false);
        boolean nextPngEnabled = settings.optBoolean("bindNextPng", false) && fileName.toLowerCase(Locale.ROOT).endsWith(".png");
        if (!sameNameEnabled && !sameAuthorEnabled && !nextPngEnabled) return null;

        ArrayList<JSONObject> recent = new ArrayList<>();
        JSONArray sourceRows = database.getRecentRecordsByIndex("communitySources", "updatedAt", 5);
        for (int index = 0; index < sourceRows.length(); index++) {
            JSONObject row = sourceRows.optJSONObject(index);
            JSONObject source = row == null ? null : row.optJSONObject("value");
            if (source != null) recent.add(source);
        }
        if (recent.isEmpty()) return null;

        ArrayList<JSONObject> nameMatches = new ArrayList<>();
        ArrayList<JSONObject> authorMatches = new ArrayList<>();
        ArrayList<JSONObject> pendingPng = new ArrayList<>();
        String cardName = normalize(parsed.optString("name", ""));
        JSONObject metadata = parsed.optJSONObject("metadata");
        String creator = normalize(parsed.optString("creator", metadata == null ? "" : metadata.optString("creator", "")));
        for (JSONObject source : recent) {
            String sourceId = source.optString("id", "");
            if (sourceId.isBlank()) continue;
            String starterContent = readStarterContent(database, sourceId);
            if (sameNameEnabled && !cardName.isEmpty()
                && normalize(source.optString("title", "") + "\n" + starterContent).contains(cardName))
                nameMatches.add(source);
            if (sameAuthorEnabled && !creator.isEmpty() && creator.equals(authorLabel(starterContent)))
                authorMatches.add(source);
            if (nextPngEnabled && source.optBoolean("autoBindPendingPng", false)) pendingPng.add(source);
        }

        String rule = null;
        JSONObject source = unique(nameMatches);
        if (source != null) rule = "same-name";
        else if (!nameMatches.isEmpty()) return null;
        if (source == null) {
            source = unique(authorMatches);
            if (source != null) rule = "same-author";
            else if (!authorMatches.isEmpty()) return null;
        }
        if (source == null && !pendingPng.isEmpty()) {
            // Recent sources are newest-first; the oldest marked post owns the next PNG.
            source = pendingPng.get(pendingPng.size() - 1);
            rule = "next-png";
        }
        if (source == null || rule == null) return null;

        String sourceId = source.getString("id");
        JSONObject sourceUpdate = null;
        if ("next-png".equals(rule)) {
            source.remove("autoBindPendingPng");
            source.put("updatedAt", now);
            sourceUpdate = source;
        }
        JSONObject binding = new JSONObject()
            .put("id", resourceId + ":source:" + sourceId)
            .put("resourceId", resourceId)
            .put("sourceId", sourceId)
            .put("autoBindingRule", rule)
            .put("note", "自动关联：" + ("same-name".equals(rule) ? "同名" : "same-author".equals(rule) ? "同作者" : "后续 PNG") + " · " + parsed.optString("name"))
            .put("createdAt", now);
        return new JSONObject().put("source", sourceUpdate == null ? JSONObject.NULL : sourceUpdate)
            .put("binding", binding);
    }

    private static JSONObject unique(ArrayList<JSONObject> candidates) {
        return candidates.size() == 1 ? candidates.get(0) : null;
    }

    private static String readStarterContent(NativeAppDatabase database, String sourceId) throws Exception {
        JSONArray compoundKey = new JSONArray().put(sourceId).put("starter");
        JSONArray entries = database.getIndexEntries("communitySourceMessages", "[sourceId+kind]", compoundKey.toString());
        if (entries.length() == 0) return "";
        String key = entries.optJSONObject(0) == null ? "" : entries.optJSONObject(0).optString("primaryKey", "");
        if (key.isEmpty()) return "";
        JSONObject row = database.getRecordsByKeys("communitySourceMessages", new JSONArray().put(key)).optJSONObject(0);
        JSONObject message = row == null ? null : row.optJSONObject("value");
        return message == null ? "" : message.optString("content", "");
    }

    private static String authorLabel(String content) {
        java.util.regex.Matcher matcher = java.util.regex.Pattern
            .compile("(?:^|\\n)\\s*(?:作者|author)\\s*[:：]\\s*([^\\r\\n]+)", java.util.regex.Pattern.CASE_INSENSITIVE)
            .matcher(content == null ? "" : content);
        return matcher.find() ? normalize(matcher.group(1)) : "";
    }

    private static String normalize(String value) {
        return java.text.Normalizer.normalize(value == null ? "" : value, java.text.Normalizer.Form.NFKC)
            .trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
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
        return storeAttachment(database, "resources", payload, id, encodedKey, mimeType);
    }

    private static JSONObject storeAttachment(NativeAppDatabase database, String store, File payload,
                                              String id, String encodedKey, String mimeType) throws Exception {
        long size = payload.length();
        NativeAppDatabase.BlobTransfer transfer = database.beginBlob(store, encodedKey, BLOB_PATH, size, mimeType);
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
            database.deleteBlob(store, encodedKey, BLOB_PATH);
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
        if ("communitySources".equals(store)) {
            addIndex(result, "id", value.opt("id"));
            addIndex(result, "platform", value.opt("platform"));
            addIndex(result, "sourceKeyHash", value.opt("sourceKeyHash"));
            addIndex(result, "updatedAt", value.opt("updatedAt"));
            return result;
        }
        if ("resourceSourceBindings".equals(store)) {
            addIndex(result, "resourceId", value.opt("resourceId"));
            addIndex(result, "sourceId", value.opt("sourceId"));
            addIndex(result, "createdAt", value.opt("createdAt"));
            return result;
        }
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
