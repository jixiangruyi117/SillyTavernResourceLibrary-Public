package buzz.jixiangruyi1207.srl;

import android.net.Uri;
import android.util.AtomicFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.lang.ref.WeakReference;
import java.util.Set;
import org.json.JSONObject;

@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {
    private static final long STALE_FILE_AGE_MS = 7L * 24L * 60L * 60L * 1000L;
    static final String CACHE_FOLDER = "srl-shared-intake";
    private static final Object LISTENER_LOCK = new Object();
    private static WeakReference<ShareReceiverPlugin> activePlugin = new WeakReference<>(null);

    @Override public void load() { synchronized (LISTENER_LOCK) { activePlugin = new WeakReference<>(this); } }

    static void notifyShareReady() {
        ShareReceiverPlugin plugin;
        synchronized (LISTENER_LOCK) { plugin = activePlugin.get(); }
        if (plugin != null) plugin.notifyListeners("ready", new JSObject());
    }

    static void notifyDiscordDownloadFailed(String token, String workId) {
        ShareReceiverPlugin plugin;
        synchronized (LISTENER_LOCK) { plugin = activePlugin.get(); }
        if (plugin != null) plugin.notifyListeners("discordDownloadFailed", new JSObject().put("token", token).put("workId", workId));
    }

    static void notifyDiscordDownloadCompleted(String token, String workId) {
        ShareReceiverPlugin plugin;
        synchronized (LISTENER_LOCK) { plugin = activePlugin.get(); }
        if (plugin != null) plugin.notifyListeners("discordDownloadCompleted", new JSObject().put("token", token).put("workId", workId));
    }

    static void notifyDiscordDownloadStarted(String token, String workId, String name) {
        ShareReceiverPlugin plugin;
        synchronized (LISTENER_LOCK) { plugin = activePlugin.get(); }
        if (plugin != null) plugin.notifyListeners("discordDownloadStarted",
            new JSObject().put("token", token).put("workId", workId).put("name", name));
    }

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        NativeExecutors.ioLimited().execute(() -> {
          try {
            // MainActivity + NativeShareImportService are the only owners of Android
            // share Intent ingestion. This plugin only exposes already committed staging
            // files, so resume/ready events can never copy the source URI a second time.
            call.resolve(listPendingShare());
          } catch (Exception error) {
            call.reject("读取系统分享文件失败：" + error.getMessage(), error);
          }
        });
    }

    @PluginMethod
    public void downloadDiscordAttachment(PluginCall call) {
        String token = call.getString("token", "");
        NativeExecutors.ioLimited().execute(() -> {
            try { NativeDiscordDownloadWorker.enqueue(getContext(), token); call.resolve(); }
            catch (Exception error) { call.reject("无法启动 Discord 附件下载，请回到 SRL 重试", error); }
        });
    }

    @PluginMethod
    public void cleanupPendingShare(PluginCall call) {
        NativeExecutors.ioLimited().execute(() -> cleanupPendingShareNow(call));
    }

    /** A cloud job stages into the same download owner with a stable task token. */
    @PluginMethod
    public void stageCloudResource(PluginCall call) {
        NativeExecutors.ioLimited().execute(() -> {
            try {
                String token = stageCloudResource(getContext(), call.getString("id", ""), call.getString("libraryId", ""), call.getString("workerUrl", ""), call.getString("url", ""));
                call.resolve(new JSObject().put("token", token));
            } catch (Exception error) { call.reject("无法接收云端资源下载任务：" + error.getMessage(), error); }
        });
    }

    static String stageCloudResource(android.content.Context context, String id, String libraryId, String worker, String url) throws Exception {
                String token = "discord-url-" + id;
                if (!NativeDiscordDownloadWorker.validToken(token) || !libraryId.matches("[A-Za-z0-9_-]{8,100}"))
                    throw new IllegalArgumentException("云端资源任务身份无效");
                java.net.URI origin = new java.net.URI(worker);
                if (!"https".equals(origin.getScheme()) || origin.getHost() == null || origin.getUserInfo() != null
                    || origin.getRawQuery() != null || origin.getFragment() != null)
                    throw new IllegalArgumentException("云端资源地址无效");
                DiscordAttachmentUrl attachment = DiscordAttachmentUrl.fromSharedText(url);
                File folder = new File(context.getFilesDir(), CACHE_FOLDER);
                if (!folder.exists() && !folder.mkdirs()) throw new java.io.IOException("无法创建下载目录");
                synchronized (NativeDiscordDownloadWorker.class) {
                    File source = new File(folder, token + ".json");
                    File ready = new File(folder, NativeShareImportService.stagedToken(token, 0) + ".json");
                    if (ready.isFile()) {
                        assertCloudTarget(NativeShareImportService.readMetadata(ready), libraryId, worker);
                        return token;
                    }
                    JSONObject metadata;
                    if (source.isFile()) {
                        metadata = NativeShareImportService.readMetadata(source);
                        assertCloudTarget(metadata, libraryId, worker);
                        java.net.URI previous = new java.net.URI(metadata.getString("discordUrl"));
                        java.net.URI next = new java.net.URI(attachment.url);
                        if (!previous.getRawPath().equals(next.getRawPath())) throw new IllegalArgumentException("附件身份已改变");
                        metadata.put("discordUrl", attachment.url);
                    } else {
                        metadata = new JSONObject().put("version", 1).put("cleanupToken", token)
                            .put("discordUrl", attachment.url).put("name", attachment.fileName)
                            .put("type", "application/octet-stream").put("createdAt", System.currentTimeMillis())
                            .put("cloudLibraryId", libraryId).put("cloudWorkerUrl", worker);
                    }
                    NativeShareImportService.writeMetadata(folder, token, metadata);
                    NativeDiscordDownloadWorker.enqueue(context, token);
                }
                return token;
    }

    @PluginMethod public void startCloudInbox(PluginCall call) {
        try {
            NativeDiscordInboxService.start(getContext(), call.getString("workerUrl", ""), call.getString("libraryId", ""), call.getString("secret", ""));
            call.resolve();
        } catch (Exception error) { call.reject("无法开启收件模式，请更新 APK 并检查配对", error); }
    }
    @PluginMethod public void stopCloudInbox(PluginCall call) {
        getContext().stopService(new android.content.Intent(getContext(), NativeDiscordInboxService.class));
        call.resolve();
    }
    @PluginMethod public void cloudInboxStatus(PluginCall call) {
        call.resolve(new JSObject().put("running", NativeDiscordInboxService.isRunning())
            .put("workerUrl", NativeDiscordInboxService.targetWorker()).put("libraryId", NativeDiscordInboxService.targetLibrary()));
    }
    static void notifyCloudInboxReady(boolean running) {
        ShareReceiverPlugin plugin;
        synchronized (LISTENER_LOCK) { plugin = activePlugin.get(); }
        if (plugin != null) plugin.notifyListeners("cloudInboxReady", new JSObject().put("running", running));
    }

    @PluginMethod
    public void readCloudResource(PluginCall call) {
        NativeExecutors.ioLimited().execute(() -> {
            try {
                String token = "discord-url-" + call.getString("id", "");
                if (!NativeDiscordDownloadWorker.validToken(token)) throw new IllegalArgumentException("云端任务身份无效");
                File folder = shareCacheFolder();
                String staged = NativeShareImportService.stagedToken(token, 0);
                File ready = new File(folder, staged + ".json"), payload = new File(folder, staged);
                File source = new File(folder, token + ".json");
                JSObject result = new JSObject();
                synchronized (NativeDiscordDownloadWorker.class) {
                    JSONObject metadata = readMetadata(ready.isFile() ? ready : source);
                    assertCloudTarget(metadata, call.getString("libraryId", ""), call.getString("workerUrl", ""));
                    result.put("error", metadata.optString("error", ""));
                    result.put("cancelled", metadata.optBoolean("downloadCancelled"));
                    result.put("totalBytes", metadata.optLong("downloadSize", -1));
                    File partial = new File(folder, staged + ".part");
                    result.put("transferredBytes", partial.isFile() ? partial.length() : payload.isFile() ? payload.length() : 0);
                    if (ready.isFile() && new File(folder, token + ".done").isFile() && payload.isFile()
                        && metadata.optLong("size", -1) == payload.length()) {
                        JSObject file = new JSObject(metadata.toString());
                        file.put("uri", Uri.fromFile(payload).toString());
                        result.put("file", file);
                    }
                }
                call.resolve(result);
            } catch (Exception error) { call.reject("无法读取云端资源下载进度：" + error.getMessage(), error); }
        });
    }

    static void assertCloudTarget(JSONObject metadata, String libraryId, String worker) {
        if (!libraryId.equals(metadata.optString("cloudLibraryId")) || !worker.equals(metadata.optString("cloudWorkerUrl")))
            throw new IllegalArgumentException("云端任务属于另一份资源库");
    }

    private void cleanupPendingShareNow(PluginCall call) {
        JSArray tokens = call.getArray("tokens", new JSArray());
        try {
            File cacheFolder = shareCacheFolder();
            String cachePrefix = cacheFolder.getCanonicalPath() + File.separator;
            for (int index = 0; index < tokens.length(); index++) {
                String token = tokens.optString(index, "");
                if (token.isBlank() || token.contains("/") || token.contains("\\")) continue;
                if (NativeDiscordDownloadWorker.validToken(token)) {
                    synchronized (NativeDiscordDownloadWorker.class) { assertDiscordShareMayBeCleaned(cacheFolder, token); }
                    // A cancelled Future may still be closing its stream. Wait outside the state lock, then recheck inside it.
                    NativeDiscordDownloadWorker.runTransfer(token, () -> cleanupPendingShareToken(cacheFolder, cachePrefix, token));
                } else {
                    cleanupPendingShareToken(cacheFolder, cachePrefix, token);
                }
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("清理系统分享临时文件失败：" + error.getMessage(), error);
        }
    }

    private void assertDiscordShareMayBeCleaned(File folder, String token) throws Exception {
        File metadata = new File(folder, token + ".json");
        if (NativeDiscordDownloadWorker.isActiveToken(getContext(), token)
            && (!metadata.isFile() || !readMetadata(metadata).has("error"))) {
            throw new java.io.IOException("这个附件已加入下载队列，请在下载完成后处理导入");
        }
    }

    private void cleanupPendingShareToken(File cacheFolder, String cachePrefix, String token) throws Exception {
        // Cleanup and notification commands share one boundary; a retry cannot recreate deleted staging.
        synchronized (NativeDiscordDownloadWorker.class) {
            if (NativeDiscordDownloadWorker.validToken(token)) assertDiscordShareMayBeCleaned(cacheFolder, token);
            File target = new File(cacheFolder, token);
            File metadata = new File(cacheFolder, token + ".json");
            File committed = new File(cacheFolder, token + ".done");
            if (!target.getCanonicalPath().startsWith(cachePrefix)
                || !metadata.getCanonicalPath().startsWith(cachePrefix)) return;
            // Keep the receipt if best-effort cleanup fails, preventing redelivery after a committed import.
            if (!committed.exists()) {
                try (FileOutputStream output = new FileOutputStream(committed)) {
                    output.write(Long.toString(System.currentTimeMillis()).getBytes(StandardCharsets.UTF_8));
                    output.getFD().sync();
                }
            }
            boolean targetRemoved = !target.exists() || target.delete();
            boolean metadataRemoved = targetRemoved && (!metadata.exists() || metadata.delete());
            if (NativeDiscordDownloadWorker.validToken(token)) {
                File partial = new File(cacheFolder, NativeShareImportService.stagedToken(token, 0) + ".part");
                metadataRemoved = metadataRemoved && (!partial.exists() || partial.delete());
            }
            if (targetRemoved && metadataRemoved) {
                committed.delete();
                if (NativeDiscordDownloadWorker.validToken(token)) NativeDiscordDownloadWorker.clearNotification(getContext(), token);
            } else throw new java.io.IOException("暂存文件仍被占用，请稍后重试清理");
        }
    }

    @PluginMethod
    public void setPendingShareRoute(PluginCall call) {
        JSArray tokens = call.getArray("tokens", new JSArray());
        String route = call.getString("route", null);
        if (route != null && !isSharedImportRoute(route)) {
            call.reject("系统分享用途无效");
            return;
        }
        File folder = shareCacheFolder();
        try {
            String cachePrefix = folder.getCanonicalPath() + File.separator;
            for (int index = 0; index < tokens.length(); index++) {
                String token = tokens.optString(index, "");
                if (token.isBlank() || token.length() > 240 || token.contains("/") || token.contains("\\")) {
                    throw new IllegalArgumentException("系统分享文件标识无效");
                }
                File payload = new File(folder, token);
                File metadataFile = new File(folder, token + ".json");
                if (!payload.getCanonicalPath().startsWith(cachePrefix)
                    || !metadataFile.getCanonicalPath().startsWith(cachePrefix)
                    || !payload.isFile() || !metadataFile.isFile()
                    || metadataFile.length() > 64 * 1024) {
                    throw new java.io.IOException("系统分享暂存文件已失效");
                }
                JSONObject metadata = readMetadata(metadataFile);
                if (metadata.has("discordUrl") || metadata.optLong("size", -1L) != payload.length()) {
                    throw new java.io.IOException("系统分享暂存文件不匹配");
                }
                if (route == null) metadata.remove("route");
                else metadata.put("route", route);

                AtomicFile atomicFile = new AtomicFile(metadataFile);
                FileOutputStream output = null;
                try {
                    output = atomicFile.startWrite();
                    output.write(metadata.toString().getBytes(StandardCharsets.UTF_8));
                    output.getFD().sync();
                    atomicFile.finishWrite(output);
                } catch (Exception error) {
                    if (output != null) atomicFile.failWrite(output);
                    throw error;
                }
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("保存系统分享用途失败：" + error.getMessage(), error);
        }
    }

    private boolean isSharedImportRoute(String route) {
        return "libraryBackup".equals(route)
            || "tavernBackup".equals(route)
            || "resource".equals(route)
            || "thirdPartyApp".equals(route);
    }

    private JSONObject readMetadata(File metadataFile) throws Exception { return NativeShareImportService.readMetadata(metadataFile); }

    private File shareCacheFolder() {
        File folder = new File(getContext().getFilesDir(), CACHE_FOLDER);
        if (!folder.exists() && !folder.mkdirs()) {
            throw new IllegalStateException("无法创建系统分享临时目录");
        }
        return folder;
    }

    private void deleteStaleFiles(File folder, Set<String> active) {
        File[] files = folder.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - STALE_FILE_AGE_MS;
        java.util.Set<String> retained;
        try { retained = NativeArchiveTasks.retainedSourcePaths(getContext()); }
        catch (Exception error) { return; } // A journal read failure must not remove a recovery source.
        for (File file : files) {
            boolean downloading = false;
            for (String token : active) if (file.getName().equals(token + ".json")
                || file.getName().startsWith(token + "-0")) { downloading = true; break; }
            if (downloading) continue;
            String path;
            try { path = file.getCanonicalPath(); } catch (Exception error) { continue; }
            if (retained.contains(path) || (path.endsWith(".json") && retained.contains(path.substring(0,path.length()-5)))) continue;
            if (file.isFile() && file.lastModified() < cutoff) file.delete();
        }
    }

    private JSObject listPendingShare() throws Exception {
        File folder = shareCacheFolder();
        Set<String> active;
        synchronized (NativeDiscordDownloadWorker.class) {
            active = NativeDiscordDownloadWorker.activeTokens(getContext());
            // Cancellation is durable before the IO thread exits; retain its files through that exit as well.
            active.addAll(NativeDiscordDownloadWorker.transferringTokens());
            deleteStaleFiles(folder, active);
        }
        JSArray files = new JSArray();
        JSArray discordUrls = new JSArray();
        JSArray downloads = new JSArray();
        File[] metadataFiles = folder.listFiles((dir, name) -> name.endsWith(".json"));
        JSObject result = new JSObject();
        result.put("downloads", downloads);
        if (metadataFiles == null) {
            result.put("files", files);
            result.put("discordUrls", discordUrls);
            return result;
        }
        for (File metadataFile : metadataFiles) {
            String token = metadataFile.getName().substring(0, metadataFile.getName().length() - 5);
            File payload = new File(folder, token);
            if (new File(folder, token + ".done").isFile()) continue;
            if (metadataFile.length() > 64 * 1024) continue;
            JSObject file;
            try { file = new JSObject(readMetadata(metadataFile).toString()); }
            catch (java.io.FileNotFoundException completedDuringScan) { continue; }
            if (file.has("discordUrl")) {
                if (active.contains(token) && !file.has("error")) {
                    if (!file.has("cloudLibraryId")) downloads.put(new JSObject()
                        .put("token", token).put("workId", file.optString("downloadWorkId"))
                        .put("name", file.optString("name", "Discord 附件")));
                    continue;
                }
                file.put("cleanupToken", token);
                discordUrls.put(file);
                continue;
            }
            String sourceToken = file.optString("discordSourceToken", "");
            if (!sourceToken.isBlank() && !new File(folder, sourceToken + ".done").isFile()) continue;
            if (!payload.isFile()) continue;
            if (file.optLong("size", -1L) != payload.length()) continue;
            file.put("uri", Uri.fromFile(payload).toString());
            files.put(file);
        }
        result.put("files", files);
        result.put("discordUrls", discordUrls);
        return result;
    }

}
