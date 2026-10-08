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
    private final OkHttpClient mediaClient = NativeHttpClients.CLOUD.newBuilder().dispatcher(new okhttp3.Dispatcher())
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build();
    private String previousAttention = "";
    private final java.util.Map<String, String> pendingPosts = new java.util.LinkedHashMap<>();
    private final java.util.Map<String, JSONObject> savedPosts = new java.util.LinkedHashMap<>();
    private final java.util.Set<String> foregroundPosts = new java.util.HashSet<>();
    private String resourceCursor = "";
    private String postCursor = "";
    private String waitingSourceCursor = "";

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
        return request(path, 262144);
    }
    private JSONObject request(String path, int maximumBytes) throws Exception {
        if (stopped) throw new java.io.IOException("收件已停止");
        Request request = new Request.Builder().url(worker + "/inbox" + path)
            .header("Authorization", "Bearer " + secret).header("X-SRL-Library-ID", library).build();
        try (Response response = client.newCall(request).execute()) {
            if (response.code() == 401 || response.code() == 403) {
                attention("收件配对已失效", "请回到收件箱重新配对。"); stopSelf();
                throw new java.io.IOException("收件配对已失效");
            }
            if ((!response.isSuccessful() && response.code() != 409) || response.body() == null) throw new java.io.IOException("云端请求失败");
            // Queue metadata is small; captures are read one at a time within the existing row budget.
            okio.BufferedSource source = response.body().source();
            source.request((long) maximumBytes + 1);
            if (source.buffer().size() > maximumBytes) throw new java.io.IOException("帖子或队列响应过大，请回前台领取");
            JSONObject body = new JSONObject(source.readUtf8());
            if (response.code() == 409 && !(path.startsWith("/resources/") && "resource_already_imported".equals(body.optString("error")) && "imported".equals(body.optString("state")))
                && !(path.startsWith("/jobs/") && "delivery_already_saved".equals(body.optString("error"))
                    && ("saved".equals(body.optString("state")) || "waiting_binding".equals(body.optString("state")))))
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
        // These are local commits, independent of the next cloud status/list request.
        try { reconcilePendingAutoBindings(this); }
        catch (Exception ignored) { /* Keep the original receipts for the next check. */ }
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
                            synchronized (NativeDiscordDownloadWorker.class) {
                                if (ready.isFile()) {
                                    JSONObject current = NativeShareImportService.readMetadata(ready);
                                    current.put("nativeAckPending", false);
                                    NativeShareImportService.writeMetadata(ready.getParentFile(), NativeShareImportService.stagedToken(token, 0), current);
                                }
                            }
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
            boolean postsSaved = false;
            for (int page = 0; page < 5 && !stopped; page++) {
            JSONObject posts = request("/jobs" + (postCursor.isEmpty() ? "" : "?after=" + Uri.encode(postCursor)));
            JSONArray postJobs = posts.getJSONArray("jobs");
            if (postJobs.length() > 20) throw new java.io.IOException("帖子队列无效");
            for (int index = 0; index < postJobs.length() && !stopped; index++) {
                JSONObject job = postJobs.getJSONObject(index);
                String id = job.optString("id", "");
                if (!id.matches("[a-f0-9-]{36}")) continue;
                if (foregroundPosts.contains(id)) continue;
                String title = postDisplayTitle(job);
                try {
                    boolean newBody = false;
                    JSONObject saved = savedPosts.get(id);
                    if (saved != null && saved.optInt("ackAttempts") >= 3) continue;
                    if (saved == null) {
                        // Three UTF-8 bytes per JSON character plus the envelope; larger captures stay in the cloud.
                        JSONObject envelope = request("/jobs/" + id, NativeAppDatabase.MAX_ROW_JSON_CHARS * 3 + 262144);
                        if ("delivery_already_saved".equals(envelope.optString("error"))) continue;
                        if (stopped) break;
                        JSONObject capture = envelope.getJSONObject("capture");
                        if (!capture.optString("title", "").isBlank()) title = postDisplayTitle(capture);
                        saved = NativeBackgroundResourceImporter.saveCloudPostIfSafe(this, envelope, id, library, worker);
                        newBody = "saved".equals(saved.optString("state")) && !saved.optBoolean("alreadySaved");
                    }
                    if (!"saved".equals(saved.optString("state"))) {
                        if (foregroundPosts.size() < 100) foregroundPosts.add(id);
                        pendingPost(id, title, saved.optString("message", "请回前台完成保存"));
                        continue;
                    }
                    saved.put("deliveryId", id).put("displayTitle", title);
                    if (savedPosts.size() < 100) savedPosts.put(id, saved);
                    if (stopped) break; // An atomic save may finish during stop; never claim another item or ACK afterward.
                    postsSaved |= newBody;
                    if (!saved.optBoolean("bindingChecked")) {
                        try { reconcilePendingAutoBindings(this); saved.put("bindingChecked", true); }
                        catch (Exception ignored) { /* Keep the durable scan; saving does not depend on successful matching. */ }
                    }
                    if (stopped) break;
                    // Save and bind this entire metadata pass before media I/O can delay later posts.
                    if (!saved.optBoolean("attachmentDownloadPending")) finishSavedPost(saved);
                } catch (Exception error) {
                    if (!stopped) {
                        if (foregroundPosts.size() < 100) foregroundPosts.add(id);
                        pendingPost(id, title, "正文保存未完成；点击收件箱查看并重试，云端任务仍保留");
                    }
                }
            }
            if (!posts.optBoolean("hasMore") || postJobs.length() == 0) { postCursor = ""; break; }
            JSONObject lastPost = postJobs.getJSONObject(postJobs.length() - 1);
            String nextPost = lastPost.getLong("createdAt") + ":" + lastPost.getString("id");
            if (!nextPost.matches("[0-9]{1,13}:[a-f0-9-]{36}")) throw new java.io.IOException("帖子分页无效");
            if (nextPost.equals(postCursor)) { postCursor = ""; break; }
            postCursor = nextPost;
            }
            if (stopped) return; // A late atomic save must not publish "running" after onDestroy stopped the session.
            ShareReceiverPlugin.notifyCloudInboxReady(true, postsSaved);
            for (JSONObject saved : new java.util.ArrayList<>(savedPosts.values())) {
                if (stopped) return;
                if (!saved.optBoolean("attachmentDownloadPending")) continue;
                try {
                    downloadPostAttachments(saved, saved.getString("displayTitle"));
                    if (stopped) return;
                    finishSavedPost(saved);
                } catch (Exception error) {
                    if (!stopped) pendingPost(saved.getString("deliveryId"), saved.getString("displayTitle"), "正文已保存，附件处理未完成；回收件箱继续");
                }
            }
            try { reconcileBoundSources(); }
            catch (Exception ignored) {
                if (!stopped) attention("云端绑定确认未完成", "本机已完成的绑定仍保留，请回收件箱重试确认。");
            }
            if (stopped) return;
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ONGOING, notification("正在收件 · 每 30 秒检查 · 点击可返回收件箱").build());
        } catch (Exception error) {
            if (!stopped) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ONGOING, notification("暂时无法连接云端，网络恢复后继续检查").build());
        }
    }

    static void reconcilePendingAutoBindings(Context context) throws Exception {
        reconcilePendingAutoBindings(context, () -> context instanceof NativeDiscordInboxService
            && ((NativeDiscordInboxService) context).stopped);
    }
    static void reconcilePendingAutoBindings(Context context, java.util.function.BooleanSupplier cancelled) throws Exception {
        if (cancelled.getAsBoolean()) return;
        JSONArray windows = NativeBackgroundResourceImporter.pendingAutoReceiveWindows(context);
        for (int windowIndex = 0; windowIndex < windows.length(); windowIndex++) {
            if (cancelled.getAsBoolean()) return;
            String window = windows.optString(windowIndex, "");
            JSONArray reconciled = NativeBackgroundResourceImporter.reconcileAutoReceiveCycle(context, window);
            for (int index = 0; index < reconciled.length(); index++) {
                if (cancelled.getAsBoolean()) return;
                String token = reconciled.optString(index, "");
                if (!token.isBlank()) ShareReceiverPlugin.notifyDiscordDownloadCompleted(token, "", true);
            }
            if (NativeBackgroundResourceImporter.hasPendingAutoReceiveWindow(context, window)) return;
        }
        if (!cancelled.getAsBoolean()) NativeBackgroundResourceImporter.reconcileAutoReceiveCycle(context, "0");
    }

    static String postDisplayTitle(JSONObject job) {
        String title = job.optString("title", "").replaceAll("[\\r\\n\\p{Cntrl}]", " ").trim();
        if (title.isEmpty()) title = "未命名帖子";
        return title.substring(0, Math.min(120, title.length()));
    }
    static boolean postReadyForAcknowledgement(JSONObject saved) {
        return "saved".equals(saved.optString("state")) && !saved.optBoolean("attachmentDownloadPending");
    }
    private void finishSavedPost(JSONObject saved) throws Exception {
        if (stopped) return;
        String id = saved.getString("deliveryId"), title = saved.getString("displayTitle"), state;
        state = saved.optString("resultState");
        if (state.isBlank()) {
            NativeAppDatabase database = new NativeAppDatabase(this);
            try { state = database.countIndexEntries("resourceSourceBindings", "sourceId", JSONObject.quote(saved.getString("sourceId"))) > 0 ? "saved" : "waiting_binding"; }
            finally { database.close(); }
            saved.put("resultState", state);
        }
        if (stopped) return;
        if (!saved.optBoolean("notificationPosted")) {
            notifyResult(this, "post", id, worker, library, title, state, saved.optString("messageKey"), saved.optBoolean("attachmentDownloadPending"));
            saved.put("notificationPosted", true);
        }
        if (!postReadyForAcknowledgement(saved)) {
            if (foregroundPosts.size() < 100) foregroundPosts.add(id);
            savedPosts.remove(id);
            return;
        }
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel("srl-inbox-post-pending-" + id, ATTENTION);
        pendingPosts.remove(id);
        if (stopped) return;
        try { acknowledgePost(id, state); savedPosts.remove(id); }
        catch (Exception ignored) {
            saved.put("ackAttempts", saved.optInt("ackAttempts") + 1);
            if (saved.optInt("ackAttempts") >= 3) {
                pendingPost(id, title, "正文已保存，云端确认暂未成功；回收件箱重试确认");
                if (foregroundPosts.size() < 100) foregroundPosts.add(id);
                savedPosts.remove(id);
            }
        }
    }
    private void downloadPostAttachments(JSONObject saved, String title) throws Exception {
        String messageKey = saved.getString("messageKey");
        NativeAppDatabase database = new NativeAppDatabase(this);
        try {
            NativeBackgroundResourceImporter.setPostAttachmentState(database, messageKey, "pending");
            JSONArray attachments = NativeBackgroundResourceImporter.pendingPostAttachments(database, messageKey);
            File folder = new File(getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER + "/post-media");
            if (!folder.isDirectory() && !folder.mkdirs()) throw new java.io.IOException("无法创建帖子附件暂存目录");
            boolean failed = false;
            for (int index = 0; index < attachments.length() && !stopped; index++) {
                JSONObject attachment = attachments.getJSONObject(index);
                boolean stored = false;
                String originalUrl = attachment.getString("url"), proxyUrl = attachment.optString("proxyUrl");
                for (String url : originalUrl.equals(proxyUrl) || proxyUrl.isBlank()
                    ? new String[] {originalUrl} : new String[] {originalUrl, proxyUrl}) {
                    if (stopped) return;
                    String token = NativeDiscordPostCapture.hash(messageKey + "\0" + attachment.getString("id") + "\0" + url + "\0" + attachment.optDouble("size"));
                    File partial = new File(folder, token + ".part"), checkpoint = new File(folder, token + ".json");
                    boolean downloaded = false;
                    try {
                        JSONObject metadata = checkpoint.isFile() ? NativeShareImportService.readMetadata(checkpoint) : new JSONObject();
                        if (metadata.optLong("downloadNotBefore") > System.currentTimeMillis()) throw new java.io.IOException("附件服务器要求稍后继续");
                        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ONGOING,
                            notification("正在下载帖子附件 · " + title + " · " + attachment.optString("name")).build());
                        NativeDiscordAttachmentDownload.download(mediaClient, url, partial, metadata,
                            value -> NativeShareImportService.writeMetadata(folder, token, value),
                            (done, total) -> { if (stopped) throw new java.io.InterruptedIOException("收件已停止，附件断点仍保留"); },
                            call -> { if (stopped) call.cancel(); }, NativeBackgroundResourceImporter.POST_ATTACHMENT_AUTO_BYTES);
                        downloaded = true;
                        if (stopped) return;
                        NativeBackgroundResourceImporter.savePostAttachment(database, messageKey, attachment, partial,
                            metadata.optString("downloadType", attachment.optString("contentType", "application/octet-stream")), () -> stopped);
                        if (stopped) return;
                        // Only committed, read-back verified media staging can be retired.
                        stored = true;
                        if (partial.delete()) checkpoint.delete();
                        break;
                    } catch (Exception error) {
                        if (stopped) return;
                        if (downloaded) break; // Local processing failed; another URL cannot repair that stage.
                    }
                }
                if (!stored) failed = true;
            }
            if (stopped) return;
            boolean pending = NativeBackgroundResourceImporter.pendingPostAttachments(database, messageKey).length() > 0;
            NativeBackgroundResourceImporter.setPostAttachmentState(database, messageKey, pending ? "foreground_required" : "complete");
            saved.put("attachmentDownloadPending", pending);
            if (failed && pending && saved.optBoolean("notificationPosted"))
                pendingPost(saved.getString("deliveryId"), title, "正文和已有绑定已保存，附件下载未完成；回收件箱继续，已下载附件不会重传");
        } catch (Exception error) {
            if (!stopped) {
                try { NativeBackgroundResourceImporter.setPostAttachmentState(database, messageKey, "foreground_required"); }
                catch (Exception ignored) { /* Preserve the pending receipt if the library changed. */ }
                if (saved.optBoolean("notificationPosted"))
                    pendingPost(saved.getString("deliveryId"), title, "正文已保存，附件尚未完成；回收件箱检查设置、网络或保险库后继续");
            }
        } finally { database.close(); }
    }
    private void pendingPost(String id, String title, String reason) {
        String message = title + "\n" + reason;
        if (message.equals(pendingPosts.get(id))) return;
        pendingPosts.put(id, message);
        if (pendingPosts.size() > 100) pendingPosts.remove(pendingPosts.keySet().iterator().next());
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify("srl-inbox-post-pending-" + id, ATTENTION,
            NativeInboxNotificationGroup.apply(new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_more).setContentTitle("收到帖子《" + title + "》")
                .setContentText(reason).setStyle(new NotificationCompat.BigTextStyle().bigText(reason))
                .setContentIntent(openInbox()).setAutoCancel(true).setOnlyAlertOnce(true)).build());
        NativeInboxNotificationGroup.refresh(this);
    }
    private void acknowledgePost(String id, String state) throws Exception {
        if (stopped) return;
        Request request = new Request.Builder().url(worker + "/inbox/jobs/" + id + "/ack")
            .header("Authorization", "Bearer " + secret).header("X-SRL-Library-ID", library)
            .post(RequestBody.create(new JSONObject().put("state", state).toString(), MediaType.parse("application/json"))).build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) throw new java.io.IOException("云端帖子确认未完成");
        }
    }

    /** The same bounded reconciliation as the foreground owner, after durable local bindings. */
    private void reconcileBoundSources() throws Exception {
        NativeAppDatabase database = new NativeAppDatabase(this);
        try {
            for (int page = 0; page < 5 && !stopped; page++) {
                JSONObject listing = request("/waiting-sources" + (waitingSourceCursor.isEmpty() ? "" : "?after=" + Uri.encode(waitingSourceCursor)));
                JSONArray hashes = listing.getJSONArray("sourceKeyHashes");
                if (hashes.length() > 20) throw new java.io.IOException("绑定回执队列无效");
                for (int index = 0; index < hashes.length() && !stopped; index++) {
                    String hash = hashes.getString(index);
                    if (!hash.matches("[a-f0-9]{64}")) throw new java.io.IOException("绑定回执身份无效");
                    if (!NativeBackgroundResourceImporter.canConfirmCloudSourceBound(database, hash)) continue;
                    if (stopped) return;
                    Request confirmation = new Request.Builder().url(worker + "/inbox/sources/" + hash + "/ack-bound")
                        .header("Authorization", "Bearer " + secret).header("X-SRL-Library-ID", library)
                        .post(RequestBody.create(new byte[0], null)).build();
                    try (Response response = client.newCall(confirmation).execute()) {
                        if (!response.isSuccessful()) throw new java.io.IOException("云端绑定确认未完成");
                    }
                }
                String next = listing.optString("nextCursor", "");
                if (listing.isNull("nextCursor") || next.isEmpty()) { waitingSourceCursor = ""; break; }
                if (!next.matches("[a-f0-9]{64}") || next.equals(waitingSourceCursor)) throw new java.io.IOException("绑定分页无效");
                waitingSourceCursor = next;
            }
        } finally { database.close(); }
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
            JSONObject payload = new JSONObject();
            if (!response.isSuccessful() && response.body() != null) {
                try { payload = new JSONObject(response.body().string()); }
                catch (org.json.JSONException ignored) { /* An unrelated error is not a receipt. */ }
            }
            if (resourceReceiptSettled(response.code(), state, payload)) return true;
            throw new java.io.IOException("云端资源确认失败");
        }
    }
    static boolean resourceReceiptSettled(int status, String state, JSONObject payload) {
        if (status >= 200 && status < 300) return true;
        if (!"imported".equals(state)) return false;
        return (status == 404 && "resource_task_not_found_or_expired".equals(payload.optString("error")))
            || (status == 409 && "resource_already_imported".equals(payload.optString("error"))
                && "imported".equals(payload.optString("state")));
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
    static boolean resourceResultNotificationPosted(JSONObject metadata, String state) {
        if (state.equals(metadata.optString("nativeResultNotificationState"))) return true;
        JSONObject outcome = metadata.optJSONObject("nativeImportOutcome");
        String imported = outcome == null ? "" : outcome.optString("state");
        String result = "duplicate_file".equals(imported) || "duplicate_card".equals(imported) ? "duplicate" : imported;
        return metadata.optBoolean("nativeCompletionNotificationPosted", false) && state.equals(result);
    }
    static String resourceNotificationState(JSONObject outcome) {
        String state = outcome == null ? "" : outcome.optString("state");
        if ("imported".equals(state)) return "imported";
        if ("duplicate_file".equals(state) || "duplicate_card".equals(state)) return "duplicate";
        if ("waiting_version".equals(state)) return "waiting_version";
        if ("parse_failed".equals(state) || "failed".equals(state)) return "failed";
        return "foreground_required";
    }
    static void notifyResult(Context context, String kind, String id, String worker, String library, String name, String state) throws Exception {
        notifyResult(context, kind, id, worker, library, name, state, "");
    }
    static void notifyResult(Context context, String kind, String id, String worker, String library, String name, String state, String messageKey) throws Exception {
        notifyResult(context, kind, id, worker, library, name, state, messageKey, false);
    }
    static void notifyResult(Context context, String kind, String id, String worker, String library, String name, String state, String messageKey, boolean attachmentDownloadPending) throws Exception {
        synchronized (NativeDiscordDownloadWorker.class) {
            notifyResultLocked(context, kind, id, worker, library, name, state, messageKey, attachmentDownloadPending);
        }
    }
    private static void notifyResultLocked(Context context, String kind, String id, String worker, String library, String name, String state, String messageKey, boolean attachmentDownloadPending) throws Exception {
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
            else if ("foreground_required".equals(state)) label = "已下载，请回前台继续处理";
            else throw new IllegalArgumentException("资源结果无效");
        } else if ("post".equals(kind)) {
            if ("saved".equals(state)) label = attachmentDownloadPending ? "正文已保存，已整理" : "保存成功，已整理";
            else if ("waiting_binding".equals(state)) label = attachmentDownloadPending ? "正文已保存，待整理" : "保存成功，待整理";
            else if ("failed".equals(state)) label = "保存失败";
            else throw new IllegalArgumentException("帖子结果无效");
        } else throw new IllegalArgumentException("收件类型无效");
        String staged = NativeShareImportService.stagedToken("discord-url-" + id, 0);
        File folder = new File(context.getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER);
        String receiptToken = new File(folder, staged + ".json").isFile() ? staged : "discord-url-" + id;
        File receipt = new File(folder, receiptToken + ".json");
        JSONObject metadata = null;
        if ("resource".equals(kind) && receipt.isFile()) {
            metadata = NativeShareImportService.readMetadata(receipt);
            ShareReceiverPlugin.assertCloudTarget(metadata, library, worker);
            if (resourceResultNotificationPosted(metadata, state)) return;
        }
        if ("post".equals(kind) && state.equals(NativeBackgroundResourceImporter.cloudPostNotificationState(context, messageKey, id, worker, library, null))) return;
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
        String detail = "post".equals(kind) && attachmentDownloadPending
            ? "正文已保存；帖子附件后台下载未完成，请回收件箱继续" : "点击查看收件箱";
        NotificationCompat.Builder result = NativeInboxNotificationGroup.apply(new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon("failed".equals(state) ? android.R.drawable.stat_notify_error : android.R.drawable.stat_sys_download_done)
            .setContentTitle(display + "：" + label).setContentText(detail)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(display + "：" + label + "\n" + detail))
            .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true));
        if ("failed".equals(state)) result.addAction(android.R.drawable.ic_popup_sync, "查看并重试", open);
        if ("waiting_version".equals(state)) result.addAction(android.R.drawable.ic_menu_edit, "选择版本", open);
        if ("foreground_required".equals(state)) result.addAction(android.R.drawable.ic_menu_edit, "继续处理", open);
        if ("waiting_binding".equals(state)) result.addAction(android.R.drawable.ic_menu_edit, "整理帖子", open);
        if ("post".equals(kind) && attachmentDownloadPending) result.addAction(android.R.drawable.ic_popup_sync, "继续下载附件", open);
        manager.notify(tag.toString(), ATTENTION, result.build());
        if (metadata != null) {
            metadata.put("nativeResultNotificationState", state);
            NativeShareImportService.writeMetadata(folder, receiptToken, metadata);
        }
        if ("post".equals(kind)) NativeBackgroundResourceImporter.cloudPostNotificationState(context, messageKey, id, worker, library, state);
        NativeInboxNotificationGroup.refresh(context);
    }
    @Override public void onTimeout(int startId, int fgsType) { attention("系统已暂停收件", "请打开资源库重新开启收件模式。"); stopSelf(); }
    @Override public void onDestroy() {
        stopped = true; running = false;
        if (activeService == this) activeService = null;
        targetWorker = ""; targetLibrary = "";
        if (schedule != null) schedule.shutdownNow();
        client.dispatcher().cancelAll(); mediaClient.dispatcher().cancelAll(); secret = null;
        ShareReceiverPlugin.notifyCloudInboxReady(false);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
