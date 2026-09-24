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
import android.provider.OpenableColumns;
import androidx.core.app.NotificationCompat;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.UUID;
import org.json.JSONObject;

/** 从系统分享来源持续复制大文件；完成后仍交由网页 Service 使用原有酒馆兼容导入管线解析。 */
public class NativeShareImportService extends Service {
    static final String EXTRA_SOURCE = "source";
    private static final String CHANNEL = "srl_import";
    private static final int NOTIFICATION_ID = 2111;
    private static final int MAX_BYTES = 256 * 1024 * 1024;

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, notification("正在准备系统导入…", 0, 0, true));
        Intent source = intent == null ? null : intent.getParcelableExtra(EXTRA_SOURCE);
        NativeExecutors.ioLimited().execute(() -> {
            try {
                for (Uri uri : uris(source)) stage(uri);
                notifyFinished("SRL 文件已就绪", "打开 SRL 继续校验并导入资源");
                ShareReceiverPlugin.notifyShareReady();
            } catch (Exception error) {
                notifyFinished("SRL 导入未完成", error.getMessage() == null ? "系统文件读取失败" : error.getMessage());
            } finally { stopForeground(true); stopSelf(startId); }
        });
        return START_NOT_STICKY;
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

    private void stage(Uri uri) throws Exception {
        if (uri == null) return;
        ContentResolver resolver = getContentResolver();
        String name = fileName(resolver, uri);
        long expected = size(resolver, uri);
        File folder = new File(getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER);
        if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("无法创建导入暂存目录");
        String token = UUID.randomUUID() + "-" + safeName(name);
        File partial = new File(folder, token + ".part");
        File committed = new File(folder, token);
        try (InputStream input = resolver.openInputStream(uri); FileOutputStream output = new FileOutputStream(partial)) {
            if (input == null) throw new IllegalArgumentException("无法打开分享文件");
            byte[] buffer = new byte[128 * 1024]; int total = 0, count;
            long lastNotificationAt = 0;
            long lastNotifiedBytes = 0;
            while ((count = input.read(buffer)) >= 0) {
                total += count;
                if (total > MAX_BYTES) throw new IllegalArgumentException("单个分享文件超过 256 MB，请分卷后导入");
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
        if (!partial.renameTo(committed)) { partial.delete(); throw new IllegalStateException("无法提交系统分享暂存文件"); }
        JSONObject metadata = new JSONObject();
        metadata.put("version", 1); metadata.put("name", name); metadata.put("type", resolver.getType(uri) == null ? "application/octet-stream" : resolver.getType(uri));
        metadata.put("cleanupToken", token); metadata.put("size", committed.length()); metadata.put("createdAt", System.currentTimeMillis());
        try (FileOutputStream output = new FileOutputStream(new File(folder, token + ".json"))) { output.write(metadata.toString().getBytes(StandardCharsets.UTF_8)); }
    }

    private NotificationCompat.Builder base(String title, String text) {
        ensureChannel();
        Intent launch = new Intent(Intent.ACTION_VIEW, Uri.parse("srl://shortcut/import"), this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, NOTIFICATION_ID, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle(title).setContentText(text).setContentIntent(pending).setOnlyAlertOnce(true);
    }
    private android.app.Notification notification(String text, long done, long total, boolean ongoing) {
        NotificationCompat.Builder builder = base("SRL 系统导入", text).setOngoing(ongoing);
        if (total > 0) builder.setProgress((int)Math.min(total, Integer.MAX_VALUE), (int)Math.min(done, Integer.MAX_VALUE), false); else builder.setProgress(0, 0, true);
        return builder.build();
    }
    private void notifyFinished(String title, String text) { ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID + 1, base(title, text).setAutoCancel(true).build()); }
    private void ensureChannel() { if (android.os.Build.VERSION.SDK_INT >= 26) ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "系统导入", NotificationManager.IMPORTANCE_LOW)); }
    private long size(ContentResolver resolver, Uri uri) { try (Cursor cursor = resolver.query(uri, null, null, null, null)) { if (cursor != null && cursor.moveToFirst()) { int index=cursor.getColumnIndex(OpenableColumns.SIZE); if(index>=0 && !cursor.isNull(index)) return cursor.getLong(index); } } catch(Exception ignored) {} return 0; }
    private String fileName(ContentResolver resolver, Uri uri) { try (Cursor cursor = resolver.query(uri, null, null, null, null)) { if (cursor != null && cursor.moveToFirst()) { int index=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME); if(index>=0) return cursor.getString(index); } } catch(Exception ignored) {} String result=uri.getLastPathSegment(); return result == null || result.isBlank() ? "shared-file" : result; }
    private String safeName(String value) { String result=value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim(); return result.isBlank()?"shared-file":result; }
}
