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
import android.os.ResultReceiver;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.net.URI;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;

/** User-started receive session. Transport only; the existing importer owns all commits. */
public final class NativeDiscordInboxService extends Service {
    private static final String CHANNEL = "srl_cloud_inbox";
    private static final int ONGOING = 2130, ATTENTION = 2131;
    private static final String STOP = "srl.cloud-inbox.stop";
    private static volatile boolean running;
    private static volatile NativeDiscordInboxService activeService;
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
    static void start(Context context, String worker, String library, String secret, ResultReceiver confirmation) throws Exception {
        validateTarget(worker, library, secret);
        if (running && (!worker.equals(targetWorker) || !library.equals(targetLibrary)))
            throw new IllegalArgumentException("请先停止旧目标收件，再开启新配对");
        ContextCompat.startForegroundService(context, new Intent(context, NativeDiscordInboxService.class)
            .putExtra("worker", worker).putExtra("library", library).putExtra("secret", secret).putExtra("confirmation", confirmation));
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || STOP.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        // A running session cannot silently switch targets underneath an in-flight request.
        if (running) { confirmStartup(intent, true, null); return START_NOT_STICKY; }
        try {
            worker = intent.getStringExtra("worker"); library = intent.getStringExtra("library"); secret = intent.getStringExtra("secret");
            validateTarget(worker, library, secret);
            targetWorker = worker; targetLibrary = library;
            activeService = this;
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
            confirmStartup(intent, true, null);
        } catch (Exception error) { confirmStartup(intent, false, error.getClass().getSimpleName()); stopSelf(); }
        return START_NOT_STICKY;
    }
    private void confirmStartup(Intent intent, boolean successful, String reason) {
        ResultReceiver receiver = intent.getParcelableExtra("confirmation");
        if (receiver != null) {
            android.os.Bundle data = new android.os.Bundle();
            if (reason != null) data.putString("reason", reason);
            receiver.send(successful ? 1 : 0, data);
        }
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
        String autoReceiveWindow = Long.toString(System.currentTimeMillis());
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
                if (!library.equals(job.optString("libraryId")) || !job.optString("id").matches("[a-f0-9-]{36}")) continue;
                String id = job.getString("id"), token = "discord-url-" + id;
                File source = new File(getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER + "/" + token + ".json");
                File ready = new File(getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER + "/" + NativeShareImportService.stagedToken(token, 0) + ".json");
                if (ready.isFile()) {
                    JSONObject staged = NativeShareImportService.readMetadata(ready);
                    JSONObject outcome = staged.optJSONObject("nativeImportOutcome");
                    String result = outcome == null ? "" : outcome.optString("state");
                    if ("true".equals(staged.optString("nativeAckPending"))
                        && ("imported".equals(result) || "duplicate_file".equals(result) || "duplicate_card".equals(result))) {
                        if (acknowledgeResourceBestEffort(this, id, "imported", "")) {
                            staged.put("nativeAckPending", false);
                            NativeShareImportService.writeMetadata(ready.getParentFile(), NativeShareImportService.stagedToken(token, 0), staged);
                        }
                    }
                    if ("waiting_version".equals(result)) acknowledgeResourceBestEffort(this, id, "waiting_version", "需要在前台确认历史版本");
                    else if ("parse_failed".equals(result) || "failed".equals(result))
                        acknowledgeResourceBestEffort(this, id, "failed", outcome == null ? "原生解析或导入失败" : outcome.optString("message", "原生解析或导入失败"));
                }
                if (source.isFile() && NativeShareImportService.readMetadata(source).has("error")) {
                    JSONObject failed = NativeShareImportService.readMetadata(source);
                    acknowledgeResourceBestEffort(this, id, "failed", failed.optString("error", "下载失败"));
                    continue;
                }
                if (!downloadable(job, library)) continue;
                if (NativeDiscordDownloadWorker.isActiveToken(this, token)) continue;
                // Completed staging is retained for the importer, not downloaded again.
                if (new File(getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER + "/" + token + ".done").isFile()) continue;
                try {
                    JSONObject detail = request("/resources/" + id);
                    if ("resource_already_imported".equals(detail.optString("error")) && "imported".equals(detail.optString("state"))) continue;
                    if (!id.equals(detail.optString("id")) || !library.equals(detail.optString("libraryId"))) throw new java.io.IOException("任务目标不匹配");
                    if (!stopped) ShareReceiverPlugin.stageCloudResource(this, id, library, worker, detail.getString("url"), true, autoReceiveWindow);
                } catch (Exception error) { attention("资源领取未完成", "请回到收件箱检查任务或重新复制有效直链。"); }
            }
            if (!resources.optBoolean("hasMore") || jobs.length() == 0) { resourceCursor = ""; break; }
            JSONObject last = jobs.getJSONObject(jobs.length() - 1);
            String next = last.getLong("createdAt") + ":" + last.getString("id");
            if (!next.matches("[0-9]{1,13}:[a-f0-9-]{36}")) throw new java.io.IOException("分页无效");
            if (next.equals(resourceCursor)) { resourceCursor = ""; break; }
            resourceCursor = next;
            }
            JSONArray windows = NativeBackgroundResourceImporter.pendingAutoReceiveWindows(this);
            for (int windowIndex = 0; windowIndex < windows.length(); windowIndex++) {
                JSONArray reconciled = NativeBackgroundResourceImporter.reconcileAutoReceiveCycle(this, windows.optString(windowIndex, ""));
                for (int i = 0; i < reconciled.length(); i++) {
                    String token = reconciled.optString(i, "");
                    if (!token.isBlank()) ShareReceiverPlugin.notifyDiscordDownloadCompleted(token, "", true);
                }
                // Preserve chronological scan progress when a slow download leaves an older cycle open.
                if (NativeBackgroundResourceImporter.hasPendingAutoReceiveWindow(this, windows.optString(windowIndex, ""))) break;
            }
            JSONObject posts = request("/jobs");
            String pending = posts.getJSONArray("jobs").toString();
            // Give the live importer a check cycle to save posts before asking the user to resume.
            if (posts.getJSONArray("jobs").length() > 0 && pending.equals(previousPending))
                attention("收到云端帖子", "应用运行时自动保存；若应用已暂停，请点此继续领取。");
            previousPending = pending;
            ShareReceiverPlugin.notifyCloudInboxReady(true);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ONGOING, notification("正在收件 · 每 30 秒检查 · 点击可返回收件箱").build());
        } catch (Exception error) {
            if (!stopped) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ONGOING, notification("暂时无法连接云端，网络恢复后继续检查").build());
        }
    }

    static boolean acknowledgeResource(Context context, String id, String state, String error) throws Exception {
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("资源任务身份无效");
        NativeDiscordInboxService service = activeService;
        if (!running || service == null || service.stopped) return false;
        JSONObject body = new JSONObject().put("state", state);
        if (error != null && !error.isBlank()) body.put("error", error);
        Request request = new Request.Builder().url(service.worker + "/inbox/resources/" + id + "/ack")
            .header("Authorization", "Bearer " + service.secret)
            .header("X-SRL-Library-ID", service.library)
            .post(RequestBody.create(body.toString(), MediaType.parse("application/json"))).build();
        try (Response response = service.client.newCall(request).execute()) {
            if (response.code() == 409 && "imported".equals(state)) return true;
            if (!response.isSuccessful()) throw new java.io.IOException("云端资源确认失败");
            return true;
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
    private static boolean acknowledgeResourceBestEffort(Context context, String id, String state, String message) {
        try { return acknowledgeResource(context, id, state, message); }
        catch (Exception ignored) { return false; } // Leave the receipt for the existing next check; continue other jobs.
    }
    static void notifyAutoBindings(Context context, JSONArray bindings) {
        notifyAutoBindings(context, bindings, true);
    }
    static String autoBindingNotificationTag(JSONObject binding) throws Exception {
        String source = binding.optString("sourceId", "");
        String resource = binding.optString("resourceId", "");
        String identity = !source.isBlank() && !resource.isBlank()
            ? "id\n" + source + "\n" + resource
            : "label\n" + binding.optString("sourceTitle", "") + "\n" + binding.optString("resourceName", "");
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest(identity.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder tag = new StringBuilder("srl-auto-binding-");
        for (byte value : digest) tag.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return tag.toString();
    }
    static void notifyAutoBindings(Context context, JSONArray bindings, boolean publishCommit) {
        if (bindings == null || bindings.length() == 0) return;
        if (publishCommit) ShareReceiverPlugin.notifyAutoBindingsCommitted(bindings);
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
            String bindingChannel = "srl_auto_binding";
            if (Build.VERSION.SDK_INT >= 26)
                manager.createNotificationChannel(new NotificationChannel(bindingChannel, "帖子自动绑定结果", NotificationManager.IMPORTANCE_DEFAULT));
            PendingIntent open = PendingIntent.getActivity(context, ATTENTION + 2,
                new Intent(context, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("srl://inbox"))
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            for (int index = 0; index < bindings.length(); index++) {
                JSONObject binding = bindings.optJSONObject(index);
                if (binding == null) continue;
                String line = "帖子“" + safeLabel(binding.optString("sourceTitle"), "未命名帖子")
                    + "”已绑定角色卡“" + safeLabel(binding.optString("resourceName"), "未命名角色卡") + "”";
                // Repeated reports of one binding update it; different bindings remain visible.
                manager.notify(autoBindingNotificationTag(binding), ATTENTION + 2,
                    new NotificationCompat.Builder(context, bindingChannel).setSmallIcon(android.R.drawable.stat_notify_more)
                        .setContentTitle("帖子自动绑定成功").setContentText(line)
                        .setStyle(new NotificationCompat.BigTextStyle().bigText(line))
                        .setContentIntent(open).setAutoCancel(true).build());
            }
            NativeInboxNotificationGroup.refresh(context);
        } catch (Exception ignored) { /* Notification delivery must not roll back a committed binding. */ }
    }
    private static String safeLabel(String value, String fallback) {
        String clean = value == null ? "" : value.replaceAll("[\\r\\n\\p{Cntrl}]", " ").trim();
        if (clean.isEmpty()) clean = fallback;
        return clean.length() > 80 ? clean.substring(0, 80) : clean;
    }
    static void notifyResult(Context context, String kind, String id, String worker, String library, String name, String state) throws Exception {
        if (!id.matches("[a-f0-9-]{36}") || !library.matches("[A-Za-z0-9_-]{8,100}"))
            throw new IllegalArgumentException("收件身份无效");
        Uri target = Uri.parse(worker);
        if (!"https".equals(target.getScheme()) || target.getHost() == null)
            throw new IllegalArgumentException("收件目标无效");
        String label;
        if ("resource".equals(kind)) {
            if ("imported".equals(state)) label = "解析成功并已导入";
            else if ("duplicate".equals(state)) label = "资源已存在，未重复导入";
            else if ("waiting_version".equals(state)) label = "存在历史版本，待确认";
            else if ("cancelled".equals(state)) label = "已跳过导入";
            else if ("failed".equals(state)) label = "下载或解析导入失败";
            else throw new IllegalArgumentException("资源结果无效");
        } else if ("post".equals(kind)) {
            if ("saved".equals(state)) label = "保存成功，已整理";
            else if ("waiting_binding".equals(state)) label = "保存成功，待整理";
            else if ("failed".equals(state)) label = "保存失败";
            else throw new IllegalArgumentException("帖子结果无效");
        } else throw new IllegalArgumentException("收件类型无效");
        String display = name.replaceAll("[\\r\\n\\p{Cntrl}]", " ").trim();
        if (display.isEmpty()) display = "resource".equals(kind) ? "云端资源" : "Discord 帖子";
        if (display.length() > 120) display = display.substring(0, 120);
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest((worker + "\n" + library + "\n" + kind + "\n" + id).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder tag = new StringBuilder("srl-inbox-result-");
        for (byte value : digest) tag.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        PendingIntent open = PendingIntent.getActivity(context, ATTENTION, new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_VIEW).setData(Uri.parse("srl://inbox"))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationManager manager = (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26)
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "云端收件", NotificationManager.IMPORTANCE_LOW));
        if ("resource".equals(kind)) NativeDiscordDownloadWorker.clearNotification(context, "discord-url-" + id);
        NotificationCompat.Builder result = NativeInboxNotificationGroup.apply(new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon("failed".equals(state) ? android.R.drawable.stat_notify_error : android.R.drawable.stat_sys_download_done)
            .setContentTitle(display + "：" + label).setContentText("点击查看收件箱")
            .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true));
        if ("failed".equals(state)) result.addAction(android.R.drawable.ic_popup_sync, "查看并重试", open);
        if ("waiting_version".equals(state)) result.addAction(android.R.drawable.ic_menu_edit, "选择版本", open);
        if ("waiting_binding".equals(state)) result.addAction(android.R.drawable.ic_menu_edit, "整理帖子", open);
        manager.notify(tag.toString(), ATTENTION, result.build());
        NativeInboxNotificationGroup.refresh(context);
    }
    @Override public void onTimeout(int startId, int fgsType) { attention("系统已暂停收件", "请打开资源库重新开启收件模式。"); stopSelf(); }
    @Override public void onDestroy() {
        stopped = true; running = false;
        if (activeService == this) activeService = null;
        targetWorker = ""; targetLibrary = "";
        if (schedule != null) schedule.shutdownNow();
        client.dispatcher().cancelAll(); secret = null;
        ShareReceiverPlugin.notifyCloudInboxReady(false);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
