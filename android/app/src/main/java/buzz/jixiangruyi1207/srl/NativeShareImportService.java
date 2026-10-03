package buzz.jixiangruyi1207.srl;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import androidx.core.app.NotificationCompat;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.UUID;
import org.json.JSONObject;

/** 从系统分享来源持续复制大文件；完成后仍交由网页 Service 使用原有酒馆兼容导入管线解析。 */
public class NativeShareImportService extends Service {
    static final String EXTRA_SOURCE = "source";
    static final String EXTRA_ROUTE = "route";
    static final String EXTRA_DISCORD_URL_TOKEN = "discordUrlToken";
    static final String EXTRA_OPERATION_ID = "operationId";
    static final String ACTION_DOWNLOAD_DISCORD_URL = "buzz.jixiangruyi1207.srl.DOWNLOAD_DISCORD_URL";
    private static final String CHANNEL = "srl_import";
    private static final int NOTIFICATION_ID = 2111;
    private static final long MAX_BYTES = 4L * 1024L * 1024L * 1024L;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private int pendingOperations;
    private int latestStartId;

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, notification("正在准备系统导入…", 0, 0, true));
        pendingOperations++;
        latestStartId = startId;
        if (intent != null && ACTION_DOWNLOAD_DISCORD_URL.equals(intent.getAction())) {
            String token = intent.getStringExtra(EXTRA_DISCORD_URL_TOKEN);
            // Compatibility with an Intent redelivered from the previous APK. New calls enqueue the Worker directly.
            NativeExecutors.ioLimited().execute(() -> {
                try { NativeDiscordDownloadWorker.enqueue(this, token); }
                catch (Exception error) { notifyFinished("SRL 下载未完成", "无法恢复下载，请回到 SRL 重试"); }
                finally { finishOperation(); }
            });
            return START_REDELIVER_INTENT;
        }
        Intent source = intent == null ? null : intent.getParcelableExtra(EXTRA_SOURCE);
        String route = intent == null ? null : intent.getStringExtra(EXTRA_ROUTE);
        String operationId = intent == null ? null : intent.getStringExtra(EXTRA_OPERATION_ID);
        if (operationId == null || !operationId.matches("[a-f0-9-]{36}")) operationId = UUID.randomUUID().toString();
        final String stableOperationId = operationId;
        java.util.concurrent.ExecutorService intake = NativeShareRouteShortcuts.ROUTE_DISCORD_URL.equals(route)
            ? NativeExecutors.ioLimited() : NativeExecutors.shareIntake();
        intake.execute(() -> {
            try {
                if (NativeShareRouteShortcuts.ROUTE_DISCORD_URL.equals(route)) {
                    CharSequence sharedText = source == null ? null : source.getCharSequenceExtra(Intent.EXTRA_TEXT);
                    stageDiscordUrl(sharedText == null ? null : sharedText.toString(), stableOperationId);
                } else {
                    ArrayList<Uri> sharedUris = uris(source);
                    if (sharedUris.isEmpty()) throw new IllegalArgumentException("没有收到分享文件");
                    for (int index = 0; index < sharedUris.size(); index++) stage(sharedUris.get(index), route, stableOperationId, index);
                }
                notifyFinished("SRL 文件已就绪", "打开 SRL 继续校验并导入资源");
            } catch (Exception error) {
                notifyFinished("SRL 导入未完成", error.getMessage() == null ? "系统文件读取失败" : error.getMessage());
            } finally {
                // Earlier items are committed independently even when a later source fails.
                try { ShareReceiverPlugin.notifyShareReady(); }
                finally { finishOperation(); }
            }
        });
        return START_REDELIVER_INTENT;
    }

    /** Keep the shared foreground notification until every queued share intake finishes. */
    private void finishOperation() {
        mainHandler.post(() -> {
            pendingOperations = Math.max(0, pendingOperations - 1);
            if (pendingOperations == 0) {
                stopForeground(true);
                stopSelfResult(latestStartId);
            }
        });
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private ArrayList<Uri> uris(Intent source) {
        ArrayList<Uri> result = new ArrayList<>();
        if (source == null) return result;
        if (Intent.ACTION_SEND_MULTIPLE.equals(source.getAction())) {
            ArrayList<Uri> values = source.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (values != null) result.addAll(values);
        } else {
            Uri value = source.getParcelableExtra(Intent.EXTRA_STREAM);
            if (value != null) result.add(value);
        }
        Uri data = source.getData();
        if (data != null && !result.contains(data)) result.add(data);
        return result;
    }

    private void stage(Uri uri, String route, String operationId, int index) throws Exception {
        if (uri == null) return;
        String token = stagedToken(operationId, index);
        if (isCommitted(token)) return;
        ContentResolver resolver = getContentResolver();
        String name = fileName(resolver, uri);
        String resolvedType = resolver.getType(uri);
        String type = resolvedType == null ? "application/octet-stream" : resolvedType;
        long expected = size(resolver, uri);
        if (expected > MAX_BYTES) throw new IllegalArgumentException("单个分享文件超过 4 GiB，请使用文件选择器或分卷后导入");
        InputStream input = resolver.openInputStream(uri);
        if (input == null) throw new IllegalArgumentException("无法打开分享文件");
        stageStream(input, name, type, expected, route, token);
    }

    private void stageDiscordUrl(String text, String operationId) throws Exception {
        File folder = shareFolder();
        java.util.List<DiscordAttachmentUrl> attachments = DiscordAttachmentUrl.fromSharedTexts(text);
        for (int index = 0; index < attachments.size(); index++) {
            DiscordAttachmentUrl attachment = attachments.get(index);
            String token = discordToken(operationId, index);
            if (new File(folder, token + ".done").isFile()) continue;
            File existing = new File(folder, token + ".json");
            if (existing.isFile()) {
                JSONObject saved = readMetadata(existing);
                if (saved.optString("cleanupToken").equals(token) && attachment.url.equals(saved.optString("discordUrl"))) continue;
                throw new IOException("Discord 分享状态不匹配，请重新分享");
            }
            JSONObject metadata = new JSONObject().put("version", 1).put("name", attachment.fileName)
                .put("type", "application/octet-stream").put("cleanupToken", token).put("size", 0)
                .put("createdAt", System.currentTimeMillis()).put("route", NativeShareRouteShortcuts.ROUTE_DISCORD_URL)
                .put("discordUrl", attachment.url);
            writeMetadata(folder, token, metadata);
        }
    }

    static String discordToken(String operationId, int index) {
        return "discord-url-" + (index == 0 ? operationId : UUID.nameUUIDFromBytes(
            (operationId + ":" + index).getBytes(StandardCharsets.UTF_8)).toString());
    }

    private void stageStream(
        InputStream input,
        String name,
        String type,
        long expected,
        String route,
        String token
    ) throws Exception {
        File folder = shareFolder();
        if (expected > MAX_BYTES) throw new IllegalArgumentException("单个分享文件超过 4 GiB，无法导入");
        if (expected > 0 && folder.getUsableSpace() > 0 && expected > folder.getUsableSpace()) {
            throw new IllegalStateException("设备可用空间不足，无法暂存分享文件");
        }
        File partial = new File(folder, token + ".part");
        File committed = new File(folder, token);
        if (isCommitted(token)) {
            input.close();
            return;
        }
        if (committed.exists()) committed.delete();
        new File(folder, token + ".json").delete();
        try (InputStream source = input; FileOutputStream output = new FileOutputStream(partial)) {
            byte[] buffer = new byte[128 * 1024]; long total = 0; int count;
            long lastNotificationAt = 0;
            long lastNotifiedBytes = 0;
            while ((count = source.read(buffer)) >= 0) {
                total += count;
                if (total > MAX_BYTES) throw new IllegalArgumentException("单个分享文件超过 4 GiB，无法导入");
                output.write(buffer, 0, count);
                long now = System.currentTimeMillis();
                long onePercent = expected > 0 ? Math.max(1, expected / 100) : Long.MAX_VALUE;
                if (now - lastNotificationAt >= 350 || total - lastNotifiedBytes >= onePercent || total == expected) {
                    startForeground(NOTIFICATION_ID, notification("正在准备 " + name, total, expected, true));
                    lastNotificationAt = now;
                    lastNotifiedBytes = total;
                }
            }
        } catch (Exception error) { partial.delete(); throw error; }
        if (!partial.renameTo(committed)) { partial.delete(); throw new IllegalStateException("无法提交附件暂存文件"); }
        JSONObject metadata = new JSONObject();
        metadata.put("version", 1); metadata.put("name", name); metadata.put("type", type);
        metadata.put("cleanupToken", token); metadata.put("size", committed.length()); metadata.put("createdAt", System.currentTimeMillis());
        if (route != null) metadata.put("route", route);
        writeMetadata(folder, token, metadata);
    }

    private boolean isCommitted(String token) {
        return isCommitted(new File(getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER), token);
    }

    static boolean isCommitted(File folder, String token) {
        File payload = new File(folder, token);
        File metadata = new File(folder, token + ".json");
        if (!payload.isFile() || !metadata.isFile() || metadata.length() > 64 * 1024) return false;
        try {
            JSONObject saved = readMetadata(metadata);
            return saved.optString("cleanupToken").equals(token) && saved.optLong("size", -1) == payload.length();
        } catch (Exception ignored) {
            return false;
        }
    }

    static String stagedToken(String operationId, int index) { return operationId + "-" + index; }

    private File shareFolder() throws IOException {
        File folder = new File(getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER);
        if (!folder.exists() && !folder.mkdirs()) throw new IOException("无法创建导入暂存目录");
        return folder;
    }

    static synchronized void writeMetadata(File folder, String token, JSONObject metadata) throws Exception {
        android.util.AtomicFile file = new android.util.AtomicFile(new File(folder, token + ".json"));
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(metadata.toString().getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
            file.finishWrite(output);
        } catch (Exception error) { if (output != null) file.failWrite(output); throw error; }
    }

    static synchronized JSONObject readMetadata(File file) throws Exception {
        try (java.io.FileInputStream input = new android.util.AtomicFile(file).openRead()) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) {
                bytes.write(buffer, 0, count);
                if (bytes.size() > 64 * 1024) throw new IOException("系统分享元数据过大");
            }
            return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        }
    }

    private NotificationCompat.Builder base(String title, String text) {
        ensureChannel();
        Intent launch = new Intent(Intent.ACTION_VIEW, Uri.parse("srl://shortcut/import"), this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, NOTIFICATION_ID, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle(title).setContentText(text).setContentIntent(pending).setOnlyAlertOnce(true);
    }
    private android.app.Notification notification(String text, long done, long total, boolean ongoing) {
        NotificationCompat.Builder builder = base("SRL 系统导入", text).setOngoing(ongoing);
        if (total > 0) {
            int percent = (int) Math.min(100L, Math.max(0L, (done * 100L) / total));
            builder.setProgress(100, percent, false);
        } else builder.setProgress(0, 0, true);
        return builder.build();
    }
    private void notifyFinished(String title, String text) { ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID + 1, base(title, text).setAutoCancel(true).build()); }
    private void ensureChannel() { if (android.os.Build.VERSION.SDK_INT >= 26) ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "系统导入", NotificationManager.IMPORTANCE_LOW)); }
    private long size(ContentResolver resolver, Uri uri) { try (Cursor cursor = resolver.query(uri, null, null, null, null)) { if (cursor != null && cursor.moveToFirst()) { int index=cursor.getColumnIndex(OpenableColumns.SIZE); if(index>=0 && !cursor.isNull(index)) return cursor.getLong(index); } } catch(Exception ignored) {} return 0; }
    private String fileName(ContentResolver resolver, Uri uri) { try (Cursor cursor = resolver.query(uri, null, null, null, null)) { if (cursor != null && cursor.moveToFirst()) { int index=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME); if(index>=0) return cursor.getString(index); } } catch(Exception ignored) {} String result=uri.getLastPathSegment(); return result == null || result.isBlank() ? "shared-file" : result; }
}
