package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.os.StatFs;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 把 Vue 资源原件分块镜像到 Android 应用专属 Documents/SRL 目录。
 *
 * IndexedDB 仍负责现有事务和索引；该目录提供原生文件副本与可审计清单。分块桥接
 * 避免把整份大文件一次性转成 Base64。启用网页本地保险库时由前端主动清空明文镜像。
 */
@CapacitorPlugin(name = "NativeLibrary")
public class NativeLibraryPlugin extends Plugin {
    private static final long MAX_FILE_BYTES = 8L * 1024L * 1024L * 1024L * 1024L;
    private static final int MAX_CHUNK_BYTES = 1024 * 1024;
    private static final long STALE_PENDING_MS = 24L * 60L * 60L * 1000L;
    private final ConcurrentHashMap<String, PendingWrite> pendingWrites = new ConcurrentHashMap<>();

    @PluginMethod
    public void getStorageInfo(PluginCall call) {
        runIo(call, () -> {
            File root = libraryRoot();
            File appData = getContext().getDataDir();
            File externalData = getContext().getExternalFilesDir(null);
            File cache = getContext().getCacheDir();
            File codeCache = getContext().getCodeCacheDir();
            long appDataBytes = directoryBytes(appData);
            long externalDataBytes = externalData == null ? 0L : directoryBytes(externalData);
            long appCacheBytes = directoryBytes(cache);
            long codeCacheBytes = directoryBytes(codeCache);
            JSObject result = new JSObject();
            result.put("storageVersion", hasLegacyEntries(new File(root, "current")) || hasLegacyEntries(new File(root, "versions")) ? 1 : 4);
            result.put("path", root.getAbsolutePath());
            result.put("recoveryMetadataVersion", 1);
            result.put("currentCount", countEntries(new File(root, "current")));
            result.put("versionCount", countEntries(new File(root, "versions")));
            result.put("currentManifestHash", manifestHash(new File(root, "current")));
            result.put("versionManifestHash", manifestHash(new File(root, "versions")));
            result.put("objectCount", countObjectFiles(new File(root, "objects")));
            result.put("objectBytes", countObjectBytes(new File(root, "objects")));
            result.put("appDataBytes", appDataBytes);
            result.put("externalDataBytes", externalDataBytes);
            result.put("totalBytes", appDataBytes + externalDataBytes);
            // Named subsets, not additive peers of totalBytes/objectBytes.
            NativeWebViewStorageUsage webView = NativeWebViewStorageUsage.measure(new File(appData, "app_webview"));
            result.put("webViewBytes", webView.totalBytes());
            JSObject webViewBreakdown = new JSObject();
            webViewBreakdown.put("siteDataBytes", webView.siteDataBytes);
            webViewBreakdown.put("cacheBytes", webView.cacheBytes);
            webViewBreakdown.put("temporaryBlobBytes", webView.temporaryBlobBytes);
            webViewBreakdown.put("otherBytes", webView.otherBytes);
            result.put("webViewBreakdown", webViewBreakdown);
            result.put("cacheBytes", appCacheBytes + codeCacheBytes);
            result.put("appCacheBytes", appCacheBytes);
            result.put("codeCacheBytes", codeCacheBytes);
            result.put("libraryBytes", directoryBytes(root));
            result.put("restoreTemporaryBytes", directoryBytes(new File(root, ".restore-pending")));
            result.put("writeTemporaryBytes", directoryBytes(new File(root, ".pending")));
            result.put("availableBytes", availableBytes(appData, externalData));
            call.resolve(result);
        });
    }

    /**
     * 只读分页扫描两类可恢复内容：
     * 1) Android current 索引仍在、但 IndexedDB 当前资源 ID 已缺失的条目；
     * 2) 完全没有 current/versions 原生索引引用的内容寻址对象。
     *
     * 第一类保留原 ID/文件名线索，避免数据库崩溃后启动同步把最后的元数据擦掉。
     * 这里不删除、不移动文件，也不把历史版本自动提升为当前资源。
     */
    @PluginMethod
    public void listRecoveryCandidates(PluginCall call) {
        runIo(call, () -> {
            int limit = Math.max(1, Math.min(200, call.getInt("limit", 100)));
            com.getcapacitor.JSArray currentIds = call.getArray("currentIds");
            if (currentIds == null || currentIds.length() > 50_000) {
                throw new IllegalArgumentException("当前资源 ID 清单无效");
            }
            Set<String> knownCurrent = jsonStringSet(currentIds);
            String[] cursor = call.getString("cursor", "current||0").split("\\|", -1);
            if (cursor.length != 3 || !("current".equals(cursor[0]) || "objects".equals(cursor[0]))) {
                throw new IllegalArgumentException("原件找回游标无效");
            }
            String phase = cursor[0];
            String after = cursor[1];
            long scanned;
            try { scanned = Math.max(0L, Long.parseLong(cursor[2])); }
            catch (NumberFormatException invalid) { throw new IllegalArgumentException("原件找回游标无效"); }
            com.getcapacitor.JSArray candidates = new com.getcapacitor.JSArray();
            String last = after;

            File currentRoot = new File(libraryRoot(), "current");
            if ("current".equals(phase)) {
              File[] indexedEntries = currentRoot.listFiles(File::isDirectory);
              if (indexedEntries != null) {
                java.util.Arrays.sort(indexedEntries, (left, right) -> left.getName().compareTo(right.getName()));
                for (File entry : indexedEntries) {
                    if (entry.getName().compareTo(after) <= 0) continue;
                    scanned++;
                    JSObject metadata = readJson(new File(entry, "resource.json"));
                    if (metadata == null) continue;
                    String id = metadata.optString("id", "");
                    if (id.isBlank() || knownCurrent.contains(id)) continue;
                    String hash = metadata.optString("contentHash", "").toLowerCase(Locale.ROOT);
                    long size = metadata.optLong("size", -1L);
                    if (!hash.matches("[a-f0-9]{64}") || size < 0 || size > MAX_FILE_BYTES) continue;
                    File object = objectFile(hash);
                    if (!object.isFile() || object.length() != size) continue;
                    JSObject item = new JSObject();
                    item.put("contentHash", hash);
                    item.put("size", size);
                    item.put("modifiedAt", object.lastModified());
                    item.put("nativeId", id);
                    item.put("nativeScope", "current");
                    String fileName = metadata.optString("fileName", "");
                    if (!fileName.isBlank()) item.put("fileName", fileName);
                    candidates.put(item);
                    last = entry.getName();
                    if (candidates.length() == limit) {
                        JSObject result = new JSObject();
                        result.put("candidates", candidates);
                        result.put("scanned", scanned);
                        result.put("nextCursor", "current|" + last + "|" + scanned);
                        call.resolve(result);
                        return;
                    }
                }
              }
              phase = "objects";
              after = "";
            }

            Set<String> referenced = new HashSet<>();
            collectReferencedHashes(currentRoot, referenced);
            collectReferencedHashes(new File(libraryRoot(), "versions"), referenced);
            File[] prefixes = new File(libraryRoot(), "objects").listFiles(File::isDirectory);
            if (prefixes != null) {
              java.util.Arrays.sort(prefixes, (left, right) -> left.getName().compareTo(right.getName()));
              for (File prefix : prefixes) {
                File[] objects = prefix.listFiles(File::isFile);
                if (objects == null) continue;
                java.util.Arrays.sort(objects, (left, right) -> left.getName().compareTo(right.getName()));
                for (File object : objects) {
                    String name = object.getName();
                    if (!name.matches("(?i)[a-f0-9]{64}\\.bin")) continue;
                    String hash = name.substring(0, 64).toLowerCase(Locale.ROOT);
                    if (hash.compareTo(after) <= 0) continue;
                    scanned++;
                    last = hash;
                    if (referenced.contains(hash)) continue;
                    JSObject item = new JSObject();
                    item.put("contentHash", hash);
                    item.put("size", object.length());
                    item.put("modifiedAt", object.lastModified());
                    candidates.put(item);
                    if (candidates.length() == limit) {
                        JSObject result = new JSObject();
                        result.put("candidates", candidates);
                        result.put("scanned", scanned);
                        result.put("nextCursor", "objects|" + last + "|" + scanned);
                        call.resolve(result);
                        return;
                    }
                }
              }
            }
            JSObject result = new JSObject();
            result.put("candidates", candidates);
            result.put("scanned", scanned);
            call.resolve(result);
        });
    }

    /** Read one candidate's bounded metadata; only an explicit recovery re-hashes its original. */
    @PluginMethod
    public void inspectRecoveryObject(PluginCall call) {
        runIo(call, () -> {
            String hash = requiredHash(call.getString("contentHash"));
            long size = NativeBridgeNumber.bounded(call.getData().opt("size"), 0L, MAX_FILE_BYTES, "找回原件大小无效");
            call.resolve(NativeRecoveryMetadata.inspect(
                objectFile(hash), hash, size, call.getBoolean("verify", true)
            ));
        });
    }

    /** 返回已经按内容哈希校验落盘的应用私有文件；不通过 JS/Base64 复制内容。 */
    @PluginMethod
    public void getObjectPath(PluginCall call) {
        runIo(call, () -> {
            String contentHash = requiredHash(call.getString("contentHash"));
            long expectedSize = NativeBridgeNumber.bounded(
                call.getData().opt("size"),
                0L,
                MAX_FILE_BYTES,
                "原生资源大小无效"
            );
            File object = objectFile(contentHash);
            if (!object.isFile() || object.length() != expectedSize) {
                throw new IllegalStateException("Android 原生资源不存在或大小不一致");
            }
            JSObject result = new JSObject();
            result.put("path", Uri.fromFile(object).toString());
            result.put("size", object.length());
            call.resolve(result);
        });
    }

    /** 用已存在的内容寻址对象补齐 NativeLibrary 资源索引，不读取或复制原件。 */
    @PluginMethod
    public void linkObjects(PluginCall call) {
        runIo(call, () -> {
            com.getcapacitor.JSArray records = call.getArray("records");
            if (records == null || records.length() > 50_000) {
                throw new IllegalArgumentException("原生资源引用数量无效");
            }
            int linked = 0;
            for (int index = 0; index < records.length(); index++) {
                org.json.JSONObject record = records.getJSONObject(index);
                String scope = scope(record.optString("scope", ""));
                String id = record.optString("id", "");
                String requestedFileName = record.optString("fileName", "");
                if (id.isBlank() || id.length() > 200) throw new IllegalArgumentException("资源 ID 无效");
                if (requestedFileName.isBlank() || requestedFileName.length() > 240) {
                    throw new IllegalArgumentException("资源文件名无效");
                }
                String fileName = safeFileName(requestedFileName);
                String contentHash = requiredHash(record.optString("contentHash", ""));
                long size = record.optLong("size", -1L);
                if (size < 0 || size > MAX_FILE_BYTES) throw new IllegalArgumentException("资源文件大小无效");
                File object = objectFile(contentHash);
                if (!object.isFile() || object.length() != size) {
                    throw new IllegalStateException("原生恢复对象尚未完整落盘");
                }
                File entry = entryDirectory(scope, id);
                if (!entry.exists() && !entry.mkdirs()) throw new IllegalStateException("无法创建原生资源目录");
                writeMetadata(
                    new File(entry, "resource.json"), id, scope, fileName,
                    record.optString("mimeType", "application/octet-stream"),
                    record.optString("resourceType", "other"),
                    record.optBoolean("hiddenFromDocuments", false), contentHash, size,
                    record.optLong("updatedAt", System.currentTimeMillis())
                );
                linked++;
            }
            JSObject result = new JSObject();
            result.put("linked", linked);
            call.resolve(result);
        });
    }

    /**
     * 在释放 IndexedDB 镜像前逐项核验原生索引、大小与 SHA-256。任何一项不成立就
     * 整批拒绝，调用方必须保留网页副本；这个 API 本身从不删除或迁移文件。
     */
    @PluginMethod
    public void verifyLinkedObjects(PluginCall call) {
        runIo(call, () -> {
            com.getcapacitor.JSArray records = call.getArray("records");
            if (records == null || records.length() > 200) {
                throw new IllegalArgumentException("原生镜像核验数量无效");
            }
            for (int index = 0; index < records.length(); index++) {
                org.json.JSONObject record = records.getJSONObject(index);
                String scope = scope(record.optString("scope", ""));
                String id = record.optString("id", "");
                if (id.isBlank() || id.length() > 200) {
                    throw new IllegalArgumentException("资源 ID 无效");
                }
                String contentHash = requiredHash(record.optString("contentHash", ""));
                long size = record.optLong("size", -1L);
                if (size < 0 || size > MAX_FILE_BYTES) {
                    throw new IllegalArgumentException("原生镜像大小无效");
                }
                JSObject metadata = readJson(new File(entryDirectory(scope, id), "resource.json"));
                if (metadata == null
                    || !contentHash.equalsIgnoreCase(metadata.optString("contentHash", ""))
                    || metadata.optLong("size", -1L) != size
                    || !NativeCloudRestoreTransport.verifyFile(objectFile(contentHash), contentHash, size)) {
                    throw new IllegalStateException("原生镜像索引或原件校验失败，已保留网页副本");
                }
            }
            JSObject result = new JSObject();
            result.put("verified", records.length());
            call.resolve(result);
        });
    }

    /**
     * 只撤掉陈旧的 current/versions 索引元数据，不执行对象垃圾回收。
     * 用于“数据库已有同内容资源，但崩溃前旧 ID 仍残留”的找回收尾。
     */
    @PluginMethod
    public void unlinkEntries(PluginCall call) {
        runIo(call, () -> {
            com.getcapacitor.JSArray records = call.getArray("records");
            if (records == null || records.length() > 50_000) {
                throw new IllegalArgumentException("原生资源撤链数量无效");
            }
            int removed = 0;
            for (int index = 0; index < records.length(); index++) {
                org.json.JSONObject record = records.getJSONObject(index);
                String scope = scope(record.optString("scope", ""));
                String id = record.optString("id", "");
                if (id.isBlank() || id.length() > 200) {
                    throw new IllegalArgumentException("资源 ID 无效");
                }
                String contentHash = requiredHash(record.optString("contentHash", ""));
                File entry = entryDirectory(scope, id);
                JSObject metadata = readJson(new File(entry, "resource.json"));
                if (metadata == null) continue;
                if (!contentHash.equalsIgnoreCase(metadata.optString("contentHash", ""))) {
                    throw new IllegalStateException("陈旧原生索引已变化，停止撤链");
                }
                deleteRecursively(entry);
                removed++;
            }
            JSObject result = new JSObject();
            result.put("removed", removed);
            call.resolve(result);
        });
    }

    /** 只对账索引；记录缺失不证明原件可以删除，孤立原件留给恢复入口。 */
    @PluginMethod
    public void reconcileEntries(PluginCall call) {
        runIo(call, () -> {
            com.getcapacitor.JSArray currentIds = call.getArray("currentIds");
            com.getcapacitor.JSArray versionIds = call.getArray("versionIds");
            if (currentIds == null || versionIds == null ||
                currentIds.length() > 50_000 || versionIds.length() > 200_000) {
                throw new IllegalArgumentException("原生资源对账 ID 数量无效");
            }
            Set<String> expectedCurrent = jsonStringSet(currentIds);
            Set<String> expectedVersions = jsonStringSet(versionIds);
            int removedCurrent = removeStaleEntries(new File(libraryRoot(), "current"), expectedCurrent);
            int removedVersions = removeStaleEntries(new File(libraryRoot(), "versions"), expectedVersions);
            JSObject result = new JSObject();
            result.put("removedCurrent", removedCurrent);
            result.put("removedVersions", removedVersions);
            call.resolve(result);
        });
    }

    /**
     * Android 明确定义 cache/code_cache 为可丢弃缓存。手动触发时清空其内容，但保留目录本身；
     * 不会触及 app_webview、IndexedDB、原件目录或 external files。用户应在没有活跃上传、下载
     * 或导入任务时执行，避免中断仅存在缓存目录中的临时传输文件。
     */
    @PluginMethod
    public void clearTemporaryCaches(PluginCall call) {
        runIo(call, () -> {
            File cache = getContext().getCacheDir();
            File codeCache = getContext().getCodeCacheDir();
            long clearedBytes = clearDirectoryContents(cache) + clearDirectoryContents(codeCache);
            JSObject result = new JSObject();
            result.put("clearedBytes", clearedBytes);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void beginWrite(PluginCall call) {
        runIo(call, () -> {
            String scope = scope(call.getString("scope"));
            String id = required(call, "id", 200);
            String fileName = safeFileName(required(call, "fileName", 240));
            String contentHash = requiredHash(call.getString("contentHash"));
            long size = NativeBridgeNumber.bounded(
                call.getData().opt("size"),
                0L,
                MAX_FILE_BYTES,
                "资源文件大小无效（允许范围 0–8 TiB）"
            );
            long updatedAt = NativeBridgeNumber.boundedOrDefault(
                call.getData().opt("updatedAt"),
                System.currentTimeMillis(),
                0L,
                NativeBridgeNumber.MAX_SAFE_INTEGER,
                "资源更新时间无效"
            );
            String mimeType = call.getString("mimeType", "application/octet-stream");
            String resourceType = call.getString("resourceType", "other");
            boolean hiddenFromDocuments = call.getBoolean("hiddenFromDocuments", false);
            File entry = entryDirectory(scope, id);
            File metadata = new File(entry, "resource.json");
            JSObject existing = readJson(metadata);
            File object = objectFile(contentHash);
            if (object.isFile() && object.length() == size) {
                if (!entry.exists() && !entry.mkdirs()) throw new IllegalStateException("无法创建原生资源目录");
                writeMetadata(metadata, id, scope, fileName, mimeType, resourceType,
                    hiddenFromDocuments, contentHash, size, updatedAt);
                deleteEntryPayloads(entry);
                JSObject result = new JSObject();
                result.put("alreadyPresent", true);
                result.put("token", "");
                call.resolve(result);
                return;
            }
            File legacyFile = existing == null ? null : new File(entry, safeFileName(existing.optString("storedName", "resource.bin")));
            if (existing != null && legacyFile != null && legacyFile.isFile()
                && contentHash.equalsIgnoreCase(existing.optString("contentHash"))
                && legacyFile.length() == size) {
                File stagedLegacy = new File(object.getParentFile(), object.getName() + ".legacy.part");
                if (!object.getParentFile().exists() && !object.getParentFile().mkdirs())
                    throw new IllegalStateException("无法创建原生对象目录");
                copyFile(legacyFile, stagedLegacy);
                installObject(stagedLegacy, object, size);
                writeMetadata(metadata, id, scope, fileName, mimeType, resourceType,
                    hiddenFromDocuments, contentHash, size, updatedAt);
                deleteEntryPayloads(entry);
                JSObject result = new JSObject();
                result.put("alreadyPresent", true);
                result.put("token", "");
                call.resolve(result);
                return;
            }

            File pending = new File(libraryRoot(), ".pending");
            if (!pending.exists() && !pending.mkdirs()) throw new IllegalStateException("无法创建原生资源暂存目录");
            deleteStalePending(pending);
            String token = UUID.randomUUID().toString();
            File temporary = new File(pending, token + ".part");
            PendingWrite write = new PendingWrite(
                token, scope, id, fileName, mimeType, resourceType, hiddenFromDocuments,
                contentHash, size, updatedAt,
                temporary, new FileOutputStream(temporary), MessageDigest.getInstance("SHA-256")
            );
            pendingWrites.put(token, write);
            JSObject result = new JSObject();
            result.put("alreadyPresent", false);
            result.put("token", token);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void appendWrite(PluginCall call) {
        runIo(call, () -> {
            PendingWrite write = pending(call.getString("token"));
            String encoded = required(call, "data", MAX_CHUNK_BYTES * 2);
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length > MAX_CHUNK_BYTES) throw new IllegalArgumentException("原生资源分块超过 1 MiB");
            synchronized (write) {
                if (write.written + bytes.length > write.expectedSize) throw new IllegalArgumentException("原生资源写入超过声明大小");
                write.output.write(bytes);
                write.digest.update(bytes);
                write.written += bytes.length;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void commitWrite(PluginCall call) {
        runIo(call, () -> {
            PendingWrite write = pending(call.getString("token"));
            synchronized (write) {
                write.output.flush();
                write.output.close();
            }
            String actualHash = hex(write.digest.digest());
            if (write.written != write.expectedSize || !actualHash.equalsIgnoreCase(write.contentHash)) {
                write.temporary.delete();
                throw new IllegalStateException("原生资源文件大小或 SHA-256 校验失败");
            }
            File entry = entryDirectory(write.scope, write.id);
            if (!entry.exists() && !entry.mkdirs()) throw new IllegalStateException("无法创建原生资源目录");
            File object = objectFile(write.contentHash);
            installObject(write.temporary, object, write.expectedSize);
            writeMetadata(new File(entry, "resource.json"), write.id, write.scope, write.fileName,
                write.mimeType, write.resourceType, write.hiddenFromDocuments, write.contentHash,
                write.expectedSize, write.updatedAt);
            deleteEntryPayloads(entry);
            pendingWrites.remove(write.token);
            call.resolve();
        });
    }

    @PluginMethod
    public void abortWrite(PluginCall call) {
        runIo(call, () -> {
            String token = call.getString("token", "");
            PendingWrite write = pendingWrites.remove(token);
            if (write != null) {
                synchronized (write) {
                    try { write.output.close(); } catch (Exception ignored) {}
                    write.temporary.delete();
                }
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        runIo(call, () -> {
            String scope = scope(call.getString("scope"));
            String id = required(call, "id", 200);
            File entry = entryDirectory(scope, id);
            JSObject metadata = readJson(new File(entry, "resource.json"));
            String contentHash = metadata == null ? "" : metadata.optString("contentHash", "");
            deleteRecursively(entry);
            garbageCollectObject(contentHash);
            call.resolve();
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        runIo(call, () -> {
            for (PendingWrite write : pendingWrites.values()) {
                synchronized (write) {
                    try { write.output.close(); } catch (Exception ignored) {}
                    write.temporary.delete();
                }
            }
            pendingWrites.clear();
            File root = libraryRoot();
            deleteRecursively(new File(root, "current"));
            deleteRecursively(new File(root, "versions"));
            deleteRecursively(new File(root, "objects"));
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        for (PendingWrite write : pendingWrites.values()) {
            synchronized (write) {
                try { write.output.close(); } catch (Exception ignored) {}
            }
        }
        pendingWrites.clear();
    }

    private void runIo(PluginCall call, CheckedAction action) {
        NativeExecutors.ioSerial().execute(() -> {
            try {
                action.run();
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "原生资源操作失败" : error.getMessage(), error);
            }
        });
    }

    private File libraryRoot() {
        return libraryRoot(getContext());
    }

    static File libraryRoot(Context context) {
        File documents = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (documents == null) documents = context.getFilesDir();
        File root = new File(documents, "SRL/library");
        if (!root.exists() && !root.mkdirs()) throw new IllegalStateException("无法创建 Android 本地资源目录");
        return root;
    }

    private File entryDirectory(String scope, String id) throws Exception {
        return new File(new File(libraryRoot(), scope), safeComponent(id));
    }

    private String safeComponent(String value) throws Exception {
        if (value.matches("[A-Za-z0-9._-]{1,160}")) return value;
        return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    private String scope(String value) {
        if ("current".equals(value) || "versions".equals(value)) return value;
        throw new IllegalArgumentException("原生资源范围无效");
    }

    private String required(PluginCall call, String key, int maxLength) {
        String value = call.getString(key);
        if (value == null || value.isBlank() || value.length() > maxLength) throw new IllegalArgumentException(key + " 无效");
        return value;
    }

    private String requiredHash(String value) {
        if (value == null || !value.matches("(?i)[a-f0-9]{64}")) throw new IllegalArgumentException("资源 SHA-256 无效");
        return value.toLowerCase(Locale.ROOT);
    }

    private PendingWrite pending(String token) {
        PendingWrite write = token == null ? null : pendingWrites.get(token);
        if (write == null) throw new IllegalArgumentException("原生资源写入令牌已失效");
        return write;
    }

    private String safeFileName(String value) {
        String safe = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (safe.isBlank() || ".".equals(safe) || "..".equals(safe)) safe = "resource.bin";
        return safe.length() > 180 ? safe.substring(safe.length() - 180) : safe;
    }

    private void writeMetadata(File target, String id, String scope, String fileName,
                               String mimeType, String resourceType, boolean hiddenFromDocuments,
                               String contentHash, long size, long updatedAt) throws Exception {
        JSObject metadata = new JSObject();
        metadata.put("version", 3);
        metadata.put("id", id);
        metadata.put("scope", scope);
        metadata.put("fileName", fileName);
        metadata.put("mimeType", mimeType);
        metadata.put("resourceType", resourceType);
        metadata.put("hiddenFromDocuments", hiddenFromDocuments);
        metadata.put("contentHash", contentHash);
        metadata.put("objectPath", "objects/" + contentHash.substring(0, 2) + "/" + contentHash + ".bin");
        metadata.put("size", size);
        metadata.put("updatedAt", updatedAt);
        File temporary = new File(target.getParentFile(), "resource.json.tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(metadata.toString(2).getBytes(StandardCharsets.UTF_8));
        }
        moveFile(temporary, target);
    }

    private JSObject readJson(File file) {
        if (!file.isFile() || file.length() > 64 * 1024) return null;
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) file.length()];
            int offset = 0;
            while (offset < bytes.length) {
                int read = input.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
            return new JSObject(new String(bytes, 0, offset, StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            return null;
        }
    }

    private void deleteEntryPayloads(File entry) {
        File[] files = entry.listFiles();
        if (files == null) return;
        for (File file : files) if (!"resource.json".equals(file.getName())) deleteRecursively(file);
    }

    private int countEntries(File directory) {
        File[] files = directory.listFiles(File::isDirectory);
        return files == null ? 0 : files.length;
    }

    private boolean hasLegacyEntries(File directory) {
        File[] entries = directory.listFiles(File::isDirectory);
        if (entries == null) return false;
        for (File entry : entries) {
            JSObject metadata = readJson(new File(entry, "resource.json"));
            if (metadata == null || metadata.optInt("version", 1) < 3) return true;
        }
        return false;
    }

    private File objectFile(String contentHash) {
        return objectFile(getContext(), contentHash);
    }

    static File objectFile(Context context, String contentHash) {
        String normalized = contentHash.toLowerCase(Locale.ROOT);
        if (!normalized.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("原生对象哈希无效");
        return new File(new File(new File(libraryRoot(context), "objects"), normalized.substring(0, 2)), normalized + ".bin");
    }

    private void installObject(File source, File destination, long expectedSize) throws Exception {
        if (destination.isFile()) {
            if (destination.length() != expectedSize) throw new IllegalStateException("原生对象库中存在大小异常的同名对象");
            if (!source.equals(destination)) source.delete();
            return;
        }
        File parent = destination.getParentFile();
        if (!parent.exists() && !parent.mkdirs()) throw new IllegalStateException("无法创建原生对象目录");
        moveFile(source, destination);
    }

    private void garbageCollectObject(String contentHash) throws Exception {
        if (!contentHash.matches("(?i)[a-f0-9]{64}")) return;
        if (isObjectReferenced(new File(libraryRoot(), "current"), contentHash)
            || isObjectReferenced(new File(libraryRoot(), "versions"), contentHash)) return;
        File object = objectFile(contentHash.toLowerCase(Locale.ROOT));
        if (object.delete()) {
            File parent = object.getParentFile();
            if (parent != null) parent.delete();
        }
    }

    private boolean isObjectReferenced(File scopeRoot, String contentHash) {
        File[] entries = scopeRoot.listFiles(File::isDirectory);
        if (entries == null) return false;
        for (File entry : entries) {
            JSObject metadata = readJson(new File(entry, "resource.json"));
            if (metadata != null && contentHash.equalsIgnoreCase(metadata.optString("contentHash", ""))) return true;
        }
        return false;
    }

    private String manifestHash(File scopeRoot) throws Exception {
        ArrayList<String> records = new ArrayList<>();
        File[] entries = scopeRoot.listFiles(File::isDirectory);
        if (entries != null) for (File entry : entries) {
            JSObject metadata = readJson(new File(entry, "resource.json"));
            if (metadata == null) continue;
            String id = metadata.optString("id", "");
            String contentHash = metadata.optString("contentHash", "").toLowerCase(Locale.ROOT);
            if (!id.isBlank() && contentHash.matches("[a-f0-9]{64}")) records.add(id + "\0" + contentHash + "\n");
        }
        Collections.sort(records);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (String record : records) digest.update(record.getBytes(StandardCharsets.UTF_8));
        return hex(digest.digest());
    }

    private Set<String> jsonStringSet(com.getcapacitor.JSArray values) throws Exception {
        Set<String> result = new HashSet<>();
        for (int index = 0; index < values.length(); index++) {
            String value = values.getString(index);
            if (value == null || value.isBlank() || value.length() > 200) {
                throw new IllegalArgumentException("原生资源对账 ID 无效");
            }
            result.add(value);
        }
        return result;
    }

    private int removeStaleEntries(File scopeRoot, Set<String> expectedIds) throws Exception {
        File[] entries = scopeRoot.listFiles(File::isDirectory);
        if (entries == null) return 0;
        int removed = 0;
        for (File entry : entries) {
            JSObject metadata = readJson(new File(entry, "resource.json"));
            String id = metadata == null ? entry.getName() : metadata.optString("id", entry.getName());
            if (expectedIds.contains(id)) continue;
            // Do not destroy legacy payloads or malformed/unknown entries on an empty/stale index.
            File[] files = entry.listFiles();
            if (metadata == null || files == null || files.length != 1
                || !"resource.json".equals(files[0].getName()) || !files[0].isFile()) continue;
            if (!files[0].delete()) throw new IllegalStateException("无法移除失效的原生索引");
            if (!entry.delete()) throw new IllegalStateException("无法移除空原生索引目录");
            // Explicit resource deletion still owns GC. Reconciliation is not deletion authority.
            removed++;
        }
        return removed;
    }

    private void collectReferencedHashes(File scopeRoot, Set<String> output) {
        File[] entries = scopeRoot.listFiles(File::isDirectory);
        if (entries == null) return;
        for (File entry : entries) {
            JSObject metadata = readJson(new File(entry, "resource.json"));
            if (metadata == null) continue;
            String hash = metadata.optString("contentHash", "").toLowerCase(Locale.ROOT);
            if (hash.matches("[a-f0-9]{64}")) output.add(hash);
        }
    }

    private void collectObjectFiles(File directory, ArrayList<File> output) {
        File[] files = directory.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isDirectory()) collectObjectFiles(file, output);
            else output.add(file);
        }
    }

    private int countObjectFiles(File directory) {
        File[] files = directory.listFiles();
        if (files == null) return 0;
        int count = 0;
        for (File file : files) count += file.isDirectory() ? countObjectFiles(file) : 1;
        return count;
    }

    private long countObjectBytes(File directory) {
        File[] files = directory.listFiles();
        if (files == null) return 0L;
        long bytes = 0L;
        for (File file : files) bytes += file.isDirectory() ? countObjectBytes(file) : file.length();
        return bytes;
    }

    private long directoryBytes(File directory) {
        if (directory == null || !directory.exists()) return 0L;
        File[] files = directory.listFiles();
        if (files == null) return directory.isFile() ? directory.length() : 0L;
        long bytes = 0L;
        for (File file : files) bytes += file.isDirectory() ? directoryBytes(file) : file.length();
        return bytes;
    }

    private long availableBytes(File primary, File secondary) {
        long primaryAvailable = availableBytes(primary);
        long secondaryAvailable = availableBytes(secondary);
        if (primaryAvailable <= 0L) return secondaryAvailable;
        if (secondaryAvailable <= 0L) return primaryAvailable;
        return Math.min(primaryAvailable, secondaryAvailable);
    }

    private long availableBytes(File directory) {
        if (directory == null || !directory.exists()) return 0L;
        try {
            return new StatFs(directory.getAbsolutePath()).getAvailableBytes();
        } catch (IllegalArgumentException ignored) {
            return 0L;
        }
    }

    private void deleteStalePending(File directory) {
        File[] files = directory.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - STALE_PENDING_MS;
        for (File file : files) if (file.isFile() && file.lastModified() < cutoff) file.delete();
    }

    private void moveFile(File source, File destination) throws Exception {
        // All callers stage on the same filesystem. Do not delete the destination first:
        // a failed rename must leave the existing metadata/object intact.
        if (!source.renameTo(destination)) {
            throw new IllegalStateException("无法原子替换原生资源文件");
        }
    }

    private void copyFile(File source, File destination) throws Exception {
        try (FileInputStream input = new FileInputStream(source);
             FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        }
    }

    private void deleteRecursively(File file) {
        if (!file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        file.delete();
    }

    private long clearDirectoryContents(File directory) {
        File[] children = directory.listFiles();
        if (children == null) return 0L;
        long clearedBytes = 0L;
        for (File child : children) clearedBytes += deleteRecursivelyCountBytes(child);
        return clearedBytes;
    }

    private long deleteRecursivelyCountBytes(File file) {
        long clearedBytes = 0L;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) clearedBytes += deleteRecursivelyCountBytes(child);
        }
        long bytes = file.isFile() ? file.length() : 0L;
        return file.delete() ? clearedBytes + bytes : clearedBytes;
    }

    private String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value));
        return result.toString();
    }

    @FunctionalInterface
    private interface CheckedAction { void run() throws Exception; }

    private static final class PendingWrite {
        final String token;
        final String scope;
        final String id;
        final String fileName;
        final String mimeType;
        final String resourceType;
        final boolean hiddenFromDocuments;
        final String contentHash;
        final long expectedSize;
        final long updatedAt;
        final File temporary;
        final FileOutputStream output;
        final MessageDigest digest;
        long written;

        PendingWrite(String token, String scope, String id, String fileName, String mimeType,
                     String resourceType, boolean hiddenFromDocuments, String contentHash,
                     long expectedSize, long updatedAt, File temporary,
                     FileOutputStream output, MessageDigest digest) {
            this.token = token;
            this.scope = scope;
            this.id = id;
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.resourceType = resourceType;
            this.hiddenFromDocuments = hiddenFromDocuments;
            this.contentHash = contentHash;
            this.expectedSize = expectedSize;
            this.updatedAt = updatedAt;
            this.temporary = temporary;
            this.output = output;
            this.digest = digest;
        }
    }
}
