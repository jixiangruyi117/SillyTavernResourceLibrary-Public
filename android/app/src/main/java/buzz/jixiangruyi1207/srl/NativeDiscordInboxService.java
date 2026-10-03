package buzz.jixiangruyi1207.srl;

import android.app.Service;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.net.URI;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;

/** User-started receive session. Transport only; the existing importer owns all commits. */
public final class NativeDiscordInboxService extends Service {
    private static final String CHANNEL = "srl_cloud_inbox";
    private static final int ONGOING = 2130, ATTENTION = 2131;
    private static final String STOP = "srl.cloud-inbox.stop";
    private static volatile boolean running;
    private static volatile String targetWorker = "", targetLibrary = "";
    private volatile boolean stopped;
    private String worker, library, secret;
    private ScheduledExecutorService schedule;
    private final OkHttpClient client = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build();
    private String previousAttention = "";
    private String previousPending = "";
    private String resourceCursor = "";

    static boolean isRunning() { return running; }
    static String targetWorker() { return targetWorker; }
    static String targetLibrary() { return targetLibrary; }
    static void validateTarget(String worker, String library, String secret) throws Exception {
        URI uri = new URI(worker);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
            || uri.getRawQuery() != null || uri.getFragment() != null || uri.getPort() != -1
            || !library.matches("[A-Za-z0-9_-]{8,100}") || !secret.matches("[A-Za-z0-9_-]{30,160}"))
            throw new IllegalArgumentException("收件配对无效");
    }
    static void start(Context context, String worker, String library, String secret) throws Exception {
        validateTarget(worker, library, secret);
        if (running && (!worker.equals(targetWorker) || !library.equals(targetLibrary)))
            throw new IllegalArgumentException("请先停止旧目标收件，再开启新配对");
        ContextCompat.startForegroundService(context, new Intent(context, NativeDiscordInboxService.class)
            .putExtra("worker", worker).putExtra("library", library).putExtra("secret", secret));
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || STOP.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        // A running session cannot silently switch targets underneath an in-flight request.
        if (running) return START_NOT_STICKY;
        try {
            worker = intent.getStringExtra("worker"); library = intent.getStringExtra("library"); secret = intent.getStringExtra("secret");
            validateTarget(worker, library, secret);
            targetWorker = worker; targetLibrary = library;
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "云端收件", NotificationManager.IMPORTANCE_LOW));
            if (Build.VERSION.SDK_INT >= 29) startForeground(ONGOING, notification("正在检查云端任务").build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ONGOING, notification("正在检查云端任务").build());
            stopped = false; running = true;
            ShareReceiverPlugin.notifyCloudInboxReady(true);
            schedule = Executors.newSingleThreadScheduledExecutor();
            schedule.scheduleWithFixedDelay(this::check, 0, 30, TimeUnit.SECONDS);
            // Android 15+ shares a six-hour dataSync budget with downloads/imports. Stop before it.
            schedule.schedule(() -> { attention("收件模式已结束", "请打开资源库重新开启；已下载文件仍保留。"); stopSelf(); }, 5, TimeUnit.HOURS);
        } catch (Exception error) { stopSelf(); }
        return START_NOT_STICKY;
    }
    private JSONObject request(String path) throws Exception {
        if (stopped) throw new java.io.IOException("收件已停止");
        Request request = new Request.Builder().url(worker + "/inbox" + path)
            .header("Authorization", "Bearer " + secret).header("X-SRL-Library-ID", library).build();
        try (Response response = client.newCall(request).execute()) {
            if (response.code() == 401 || response.code() == 403) {
                attention("收件配对已失效", "请回到收件箱重新配对。"); stopSelf();
                throw new java.io.IOException("收件配对已失效");
            }
            if ((!response.isSuccessful() && response.code() != 409) || response.body() == null) throw new java.io.IOException("云端请求失败");
            // Only small queue metadata, never a resource file or post body.
            okio.BufferedSource source = response.body().source();
            source.request(262145);
            if (source.buffer().size() > 262144) throw new java.io.IOException("队列响应过大");
            JSONObject body = new JSONObject(source.readUtf8());
            if (response.code() == 409 && !(path.startsWith("/resources/") && "resource_already_imported".equals(body.optString("error")) && "imported".equals(body.optString("state"))))
                throw new java.io.IOException("云端任务状态冲突");
            return body;
        }
    }
    static boolean downloadable(JSONObject job, String library) {
        return library.equals(job.optString("libraryId")) && job.optString("id").matches("[a-f0-9-]{36}")
            && ("queued".equals(job.optString("state")) || "downloading".equals(job.optString("state")));
    }
    private void check() {
        if (stopped) return;
        try {
            JSONObject status = request("/status");
            if (!library.equals(status.optString("libraryId")) || !status.optBoolean("paired") || !status.optBoolean("isDefault", true)) {
                attention("收件目标已改变", "已停止旧目标收件，请回到收件箱核对配对。"); stopSelf(); return;
            }
            // Continue the scan next cycle if a backlog exceeds the per-check budget.
            for (int page = 0; page < 5 && !stopped; page++) {
            JSONObject resources = request("/resources" + (resourceCursor.isEmpty() ? "" : "?after=" + Uri.encode(resourceCursor)));
            JSONArray jobs = resources.getJSONArray("jobs");
            if (jobs.length() > 20) throw new java.io.IOException("队列无效");
            for (int i = 0; i < jobs.length() && !stopped; i++) {
                JSONObject job = jobs.getJSONObject(i);
                if ("waiting_version".equals(job.optString("state"))) {
                    attention("资源需要确认历史版本", "请回到资源库选择保存方式。");
                    continue;
                }
                if (!downloadable(job, library)) continue;
                String id = job.getString("id"), token = "discord-url-" + id;
                File source = new File(getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER + "/" + token + ".json");
                if (source.isFile() && NativeShareImportService.readMetadata(source).has("error")) continue;
                if (NativeDiscordDownloadWorker.isActiveToken(this, token)) continue;
                // Completed staging is retained for the importer, not downloaded again.
                if (new File(getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER + "/" + token + ".done").isFile()) continue;
                try {
                    JSONObject detail = request("/resources/" + id);
                    if ("resource_already_imported".equals(detail.optString("error")) && "imported".equals(detail.optString("state"))) continue;
                    if (!id.equals(detail.optString("id")) || !library.equals(detail.optString("libraryId"))) throw new java.io.IOException("任务目标不匹配");
                    if (!stopped) ShareReceiverPlugin.stageCloudResource(this, id, library, worker, detail.getString("url"));
                } catch (Exception error) { attention("资源领取未完成", "请回到收件箱检查任务或重新复制有效直链。"); }
            }
            if (!resources.optBoolean("hasMore") || jobs.length() == 0) { resourceCursor = ""; break; }
            JSONObject last = jobs.getJSONObject(jobs.length() - 1);
            String next = last.getLong("createdAt") + ":" + last.getString("id");
            if (!next.matches("[0-9]{1,13}:[a-f0-9-]{36}")) throw new java.io.IOException("分页无效");
            if (next.equals(resourceCursor)) { resourceCursor = ""; break; }
            resourceCursor = next;
            }
            JSONObject posts = request("/jobs");
            JSONArray recent = posts.getJSONArray("recent");
            boolean waiting = false;
            for (int i = 0; i < Math.min(20, recent.length()); i++)
                waiting |= "waiting_binding".equals(recent.getJSONObject(i).optString("state"));
            if (waiting) attention("帖子等待绑定", "帖子已保存，请回到收件箱关联角色卡。");
            String pending = posts.getJSONArray("jobs").toString();
            // Give the live importer a check cycle to save posts before asking the user to resume.
            if (!waiting && posts.getJSONArray("jobs").length() > 0 && pending.equals(previousPending))
                attention("收到云端帖子", "应用运行时自动保存；若应用已暂停，请点此继续领取。");
            previousPending = pending;
            ShareReceiverPlugin.notifyCloudInboxReady(true);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ONGOING, notification("正在收件 · 每 30 秒检查 · 点击可返回收件箱").build());
        } catch (Exception error) {
            if (!stopped) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ONGOING, notification("暂时无法连接云端，网络恢复后继续检查").build());
        }
    }
    private PendingIntent openInbox() {
        return PendingIntent.getActivity(this, ONGOING, new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_VIEW).setData(Uri.parse("srl://inbox"))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private NotificationCompat.Builder notification(String text) {
        PendingIntent stop = PendingIntent.getService(this, ONGOING, new Intent(this, NativeDiscordInboxService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("SRL 收件模式已开启").setContentText(text).setContentIntent(openInbox())
            .setOngoing(true).setOnlyAlertOnce(true).addAction(android.R.drawable.ic_media_pause, "停止收件", stop);
    }
    private void attention(String title, String text) {
        if (title.equals(previousAttention)) return;
        previousAttention = title;
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ATTENTION, new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_more).setContentTitle(title).setContentText(text)
            .setContentIntent(openInbox()).setAutoCancel(true).build());
    }
    @Override public void onTimeout(int startId, int fgsType) { attention("系统已暂停收件", "请打开资源库重新开启收件模式。"); stopSelf(); }
    @Override public void onDestroy() {
        stopped = true; running = false;
        targetWorker = ""; targetLibrary = "";
        if (schedule != null) schedule.shutdownNow();
        client.dispatcher().cancelAll(); secret = null;
        ShareReceiverPlugin.notifyCloudInboxReady(false);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
