package buzz.jixiangruyi1207.srl;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Future;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSink;
import org.json.JSONArray;
import org.json.JSONObject;

/** 持久、受网络/充电约束的原生上传器；内容对象可边暂存边上传，最终清单仍严格最后提交。 */
public class NativeCloudUploadWorker extends Worker {
    private static final String CHANNEL = "srl_cloud_backup";
    private static final int NOTIFICATION_ID = 2107;
    private static final long STAGING_IDLE_TIMEOUT_MS = 15L * 60L * 1000L;
    private File root;
    private String jobId;
    private String provider;
    private JSONObject config;
    private String secret;
    private int completed;
    private int total;
    private long uploadedBytes;
    private long httpRequestCount;
    private long retryCount;
    private long networkMs;
    private long verifyMs;
    private long lastForegroundAt;
    private int lastForegroundCompleted;

    public NativeCloudUploadWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }

    @NonNull @Override
    public Result doWork() {
        boolean clearJobSecret = true;
        jobId = getInputData().getString("jobId");
        if (jobId == null || !jobId.matches("[a-f0-9-]{36}")) return Result.failure();
        root = new File(NativeCloudTransferPlugin.jobsRoot(getApplicationContext()), jobId);
        try {
            JSONObject initial = NativeCloudTransferPlugin.readJob(root);
            if ("cancelled".equals(initial.optString("status"))) return Result.failure();
            provider = initial.getString("provider");
            config = initial.getJSONObject("config");
            completed = initial.optInt("completed", 0);
            total = initial.optInt("total", initial.optInt("expectedTotal", 0));
            uploadedBytes = initial.optLong("uploadedBytes", 0);
            httpRequestCount = initial.optLong("httpRequestCount", 0);
            retryCount = initial.optLong("retryCount", 0);
            networkMs = initial.optLong("networkMs", 0);
            verifyMs = initial.optLong("verifyMs", 0);

            NativeSecretStore secrets = new NativeSecretStore(getApplicationContext());
            secret = secrets.read("cloud-job-" + jobId);
            if (secret == null || secret.isBlank()) secret = secrets.read("cloud-" + provider);
            if (secret == null || secret.isBlank()) throw new IllegalStateException("Android 安全凭据已丢失，请回到应用重新保存云端配置");

            persistStatus("running", null, null, null);
            setForegroundAsync(foreground("正在接收并上传原生云备份…", completed, total)).get();

            JSONObject manifest = drainContentsUntilSealed();
            UploadResult result;
            if (manifest.optBoolean("uploaded", false)) {
                result = new UploadResult(manifest.optString("resultId", manifest.getString("name")));
            } else {
                result = uploadWithRetry(manifest);
                markCompleted(manifest, result);
            }

            persistStatus("completed", null, result.id, manifest.getString("name"));
            notifyFinished("云备份已完成", manifest.getString("name"));
            NativePrivacyShortcuts.updateBackupStatus(getApplicationContext(), true);
            return Result.success();
        } catch (Exception error) {
            boolean cancelled = false;
            try {
                JSONObject latest = NativeCloudTransferPlugin.readJob(root);
                cancelled = "cancelled".equals(latest.optString("status"));
                if (!cancelled && hasCause(error, IOException.class)) {
                    clearJobSecret = false;
                    persistStatus("queued", rootMessage(error), null, null);
                    notifyFinished("云备份等待网络恢复", rootMessage(error));
                    return Result.retry();
                }
                if (!cancelled) persistStatus("failed", rootMessage(error), null, null);
            } catch (Exception ignored) {}
            notifyFinished(cancelled ? "云备份已取消" : "云备份未完成", rootMessage(error));
            NativePrivacyShortcuts.updateBackupStatus(getApplicationContext(), false);
            return Result.failure();
        } finally {
            if (clearJobSecret) new NativeSecretStore(getApplicationContext()).clear("cloud-job-" + jobId);
        }
    }

    private JSONObject drainContentsUntilSealed() throws Exception {
        while (true) {
            if (isStopped()) throw new IllegalStateException("云备份已取消");
            JSONObject latest = NativeCloudTransferPlugin.readJob(root);
            if ("cancelled".equals(latest.optString("status"))) throw new IllegalStateException("云备份已取消");
            total = latest.optInt("total", total);
            completed = latest.optInt("completed", completed);

            JSONArray entries = latest.getJSONArray("objects");
            List<JSONObject> pendingContents = new ArrayList<>();
            JSONObject manifest = null;
            for (int index = 0; index < entries.length(); index++) {
                JSONObject entry = entries.getJSONObject(index);
                if (entry.optBoolean("manifest")) {
                    manifest = entry;
                } else if (!entry.optBoolean("uploaded", false)) {
                    pendingContents.add(entry);
                }
            }

            if (!pendingContents.isEmpty()) {
                List<Future<Void>> futures = new ArrayList<>();
                for (JSONObject entry : pendingContents) {
                    futures.add(NativeExecutors.network().submit((Callable<Void>) () -> {
                        UploadResult result = uploadWithRetry(entry);
                        markCompleted(entry, result);
                        return null;
                    }));
                }
                for (Future<Void> future : futures) future.get();
                continue;
            }

            if (latest.optBoolean("sealed", false)) {
                int expectedTotal = latest.optInt("expectedTotal", total);
                if (expectedTotal > 0 && entries.length() != expectedTotal) {
                    throw new IllegalStateException(
                        "原生云任务封口后的对象数量不完整：" + entries.length() + " / " + expectedTotal
                    );
                }
                if (manifest == null) throw new IllegalStateException("原生云任务缺少最终清单");
                return manifest;
            }

            long lastStagedAt = latest.optLong(
                "lastStagedAt",
                latest.optLong("createdAt", System.currentTimeMillis())
            );
            if (System.currentTimeMillis() - lastStagedAt > STAGING_IDLE_TIMEOUT_MS) {
                throw new IllegalStateException("原生云任务等待网页暂存超时");
            }
            Thread.sleep(100L);
        }
    }

    private UploadResult uploadWithRetry(JSONObject entry) throws Exception {
        Exception last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            if (isStopped()) throw new IllegalStateException("云备份已取消");
            try {
                return "github".equals(provider) ? uploadGitHub(entry) : uploadWebDav(entry);
            } catch (Exception error) {
                last = error;
                if (hasHttpStatus(error, 401)) {
                    new NativeSecretStore(getApplicationContext()).invalidateCredential(
                        "cloud-" + provider, "cloud-" + provider + "-invalid"
                    );
                    throw error;
                }
                if (attempt < 3) {
                    addMetric("retryCount", 1L);
                    Thread.sleep(attempt * 800L);
                }
            }
        }
        throw new IllegalStateException(entry.optBoolean("manifest")
            ? "最终快照清单连续 3 次提交失败；旧备份没有受到影响"
            : "对象 " + entry.getString("name") + " 连续 3 次上传或校验失败；未提交快照清单", last);
    }

    private UploadResult uploadGitHub(JSONObject entry) throws Exception {
        String owner = Uri.encode(config.getString("owner"));
        String repository = Uri.encode(config.getString("repository"));
        long releaseId = entry.optLong("releaseId", config.optLong("releaseId", -1L));
        if (releaseId <= 0) throw new IllegalStateException("GitHub 对象缺少目标 container");
        String api = "https://api.github.com/repos/" + owner + "/" + repository;
        String existingId = entry.optString("existingId", "");
        if (!existingId.isBlank()) request("DELETE", api + "/releases/assets/" + existingId, githubHeaders(), null, 0L, 404);
        String uploadUrl = "https://uploads.github.com/repos/" + owner + "/" + repository + "/releases/" + releaseId + "/assets?name=" + Uri.encode(entry.getString("name"));
        HttpResult uploaded = request("POST", uploadUrl, githubHeaders(), objectBody(entry), entry.getLong("size"), -1);
        if (uploaded.code == 401) throw new CloudHttpException(401, "GitHub 凭据已失效");
        boolean uploadedNow = uploaded.code >= 200 && uploaded.code < 300;
        String id;
        if (uploadedNow) {
            id = new JSONObject(uploaded.body).get("id").toString();
        } else if (uploaded.code == 422) {
            id = findExistingGitHubAsset(api, releaseId, entry.getString("name"), entry.getLong("size"));
            if (id == null) {
                throw new IllegalStateException("GitHub 同名对象已存在但大小不一致；拒绝覆盖 immutable 对象");
            }
        } else {
            throw new IllegalStateException("GitHub 上传失败（" + uploaded.code + "）：" + uploaded.body);
        }
        long verifyStarted = System.nanoTime();
        try {
            for (int poll = 0; poll < 4; poll++) {
                HttpResult confirmed = request("GET", api + "/releases/assets/" + id, githubHeaders(), null, 0L, 404);
                if (confirmed.code == 200 && new JSONObject(confirmed.body).optLong("size", -1) == entry.getLong("size")) return new UploadResult(id);
                if (poll < 3) Thread.sleep((poll + 1) * 600L);
            }
        } finally {
            addMetric("verifyMs", elapsedMs(verifyStarted));
        }
        if (uploadedNow) {
            request("DELETE", api + "/releases/assets/" + id, githubHeaders(), null, 0L, 404);
        }
        throw new IllegalStateException("GitHub 已接收对象，但远端大小确认失败");
    }

    private String findExistingGitHubAsset(
        String api,
        long releaseId,
        String name,
        long expectedSize
    ) throws Exception {
        for (int page = 1; page <= 100; page++) {
            HttpResult response = request(
                "GET",
                api + "/releases/" + releaseId + "/assets?per_page=100&page=" + page,
                githubHeaders(),
                null,
                0L,
                -1
            );
            if (response.code < 200 || response.code >= 300) {
                throw new CloudHttpException(response.code, "GitHub 对象索引读取失败");
            }
            JSONArray assets = new JSONArray(response.body);
            for (int index = 0; index < assets.length(); index++) {
                JSONObject asset = assets.getJSONObject(index);
                if (name.equals(asset.optString("name")) && asset.optLong("size", -1L) == expectedSize) {
                    return asset.get("id").toString();
                }
            }
            if (assets.length() < 100) return null;
        }
        return null;
    }

    private UploadResult uploadWebDav(JSONObject entry) throws Exception {
        StringBuilder url = new StringBuilder(config.getString("baseUrl").replaceAll("/+$", ""));
        for (String segment : config.getString("folder").split("/")) if (!segment.isBlank()) url.append('/').append(Uri.encode(segment));
        for (String segment : entry.getString("name").split("/")) if (!segment.isBlank()) url.append('/').append(Uri.encode(segment));
        java.util.Map<String,String> headers = new java.util.HashMap<>();
        String auth = android.util.Base64.encodeToString((config.getString("username") + ":" + secret).getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
        headers.put("Authorization", "Basic " + auth);
        HttpResult uploaded = request("PUT", url.toString(), headers, objectBody(entry), entry.getLong("size"), -1);
        if (uploaded.code == 401) throw new CloudHttpException(401, "Koofr 应用密码已失效");
        if (uploaded.code < 200 || uploaded.code >= 300) throw new IllegalStateException("WebDAV 上传失败（" + uploaded.code + "）");
        long verifyStarted = System.nanoTime();
        try {
            headers.put("Range", "bytes=0-0");
            HttpResult range = request("GET", url.toString(), headers, null, 0L, -1);
            if (range.code == 401) throw new CloudHttpException(401, "Koofr 应用密码已失效");
            long confirmed = parseContentRange(range.contentRange);
            if (range.code != 206 || confirmed < 0) {
                headers.remove("Range");
                HttpResult head = request("HEAD", url.toString(), headers, null, 0L, -1);
                if (head.code == 401) throw new CloudHttpException(401, "Koofr 应用密码已失效");
                confirmed = head.contentLength;
            }
            if (confirmed != entry.getLong("size")) {
                headers.remove("Range");
                request("DELETE", url.toString(), headers, null, 0L, 404);
                throw new IllegalStateException("WebDAV 上传后的文件大小不一致，已删除不完整对象");
            }
        } finally {
            headers.remove("Range");
            addMetric("verifyMs", elapsedMs(verifyStarted));
        }
        return new UploadResult(entry.getString("name"));
    }

    private java.util.Map<String,String> githubHeaders() {
        java.util.Map<String,String> headers = new java.util.HashMap<>();
        headers.put("Authorization", "Bearer " + secret);
        headers.put("Accept", "application/vnd.github+json");
        headers.put("X-GitHub-Api-Version", "2022-11-28");
        headers.put("User-Agent", "SRL-Native-Android/" + appVersion());
        return headers;
    }

    private HttpResult request(String method, String url, java.util.Map<String,String> headers, RequestBody body, long bodySize, int acceptedExtra) throws Exception {
        long started = System.nanoTime();
        Request.Builder request = new Request.Builder().url(url).method(method, body);
        for (java.util.Map.Entry<String,String> header : headers.entrySet()) request.header(header.getKey(), header.getValue());
        try (Response response = NativeHttpClients.CLOUD.newCall(request.build()).execute()) {
            int code = response.code();
            ResponseBody responseBody = response.body();
            String responseText = responseBody == null ? "" : readText(responseBody.byteStream(), 1024 * 1024);
            long contentLength = parseLongHeader(response.header("Content-Length"));
            HttpResult result = new HttpResult(code, responseText, response.header("Content-Range"), contentLength);
            if (acceptedExtra >= 0 && code != acceptedExtra && (code < 200 || code >= 300)) {
                throw new CloudHttpException(code, "云端请求失败：" + responseText);
            }
            return result;
        } finally {
            addMetric("httpRequestCount", 1L);
            addMetric("networkMs", elapsedMs(started));
            if (body != null) addMetric("uploadedBytes", bodySize);
        }
    }

    private RequestBody objectBody(JSONObject entry) throws Exception {
        final String contentType = entry.getString("contentType");
        final long size = entry.getLong("size");
        final JSONObject source = entry.optJSONObject("source");
        final File inline = source == null ? objectFile(entry) : null;
        if (source == null && (inline == null || !inline.isFile() || inline.length() != size)) {
            throw new IllegalStateException("原生 inline 对象已丢失或大小不一致");
        }
        return new RequestBody() {
            @Override public MediaType contentType() { return MediaType.parse(contentType); }
            @Override public long contentLength() { return size; }
            @Override public void writeTo(@NonNull BufferedSink sink) throws IOException {
                try {
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");
                    long written = 0L;
                    byte[] buffer = new byte[256 * 1024];
                    if (source == null) {
                        try (InputStream input = new FileInputStream(inline)) {
                            int count;
                            while ((count = input.read(buffer)) >= 0) {
                                if (isStopped()) throw new IOException("云备份已取消");
                                sink.write(buffer, 0, count);
                                digest.update(buffer, 0, count);
                                written += count;
                            }
                        }
                    } else {
                        JSONArray segments = source.getJSONArray("segments");
                        for (int index = 0; index < segments.length(); index++) {
                            JSONObject segment = segments.getJSONObject(index);
                            File libraryFile = NativeLibraryPlugin.objectFile(getApplicationContext(), segment.getString("sourceHash"));
                            long remaining = segment.getLong("size");
                            try (RandomAccessFile input = new RandomAccessFile(libraryFile, "r")) {
                                input.seek(segment.getLong("offset"));
                                while (remaining > 0) {
                                    if (isStopped()) throw new IOException("云备份已取消");
                                    int count = input.read(buffer, 0, (int)Math.min(buffer.length, remaining));
                                    if (count < 0) throw new IOException("NativeLibrary 对象来源在上传期间被截断");
                                    sink.write(buffer, 0, count);
                                    digest.update(buffer, 0, count);
                                    remaining -= count;
                                    written += count;
                                }
                            }
                        }
                    }
                    String expectedHash = entry.optString("sha256", "");
                    String actualHash = hex(digest.digest());
                    if (written != size || (!expectedHash.isBlank() && !expectedHash.equals(actualHash))) {
                        throw new IOException("NativeLibrary 流的大小或 SHA-256 与对象计划不一致");
                    }
                } catch (IOException error) {
                    throw error;
                } catch (Exception error) {
                    throw new IOException("无法读取 NativeLibrary 对象来源", error);
                }
            }
        };
    }

    private String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder();
        for (byte item : bytes) value.append(String.format(java.util.Locale.ROOT, "%02x", item));
        return value.toString();
    }

    private String readText(InputStream input, int limit) throws Exception {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count, total = 0;
            while ((count = source.read(buffer)) >= 0 && total < limit) { int kept = Math.min(count, limit - total); output.write(buffer, 0, kept); total += kept; }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private File objectFile(JSONObject entry) { return new File(root, entry.optString("token") + ".bin"); }
    private String appVersion() {
        try {
            return getApplicationContext().getPackageManager()
                .getPackageInfo(getApplicationContext().getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            return "unknown";
        }
    }
    private long parseLongHeader(String value) { if (value == null) return -1; try { return Long.parseLong(value); } catch (NumberFormatException ignored) { return -1; } }
    private long parseContentRange(String value) { if (value == null) return -1; try { return Long.parseLong(value.substring(value.lastIndexOf('/') + 1)); } catch (Exception ignored) { return -1; } }

    private synchronized void markCompleted(JSONObject entry, UploadResult result) throws Exception {
        String token = entry.getString("token");
        String name = entry.getString("name");
        JSONObject latest = NativeCloudTransferPlugin.mutateJob(root, current -> {
            if ("cancelled".equals(current.optString("status"))) {
                throw new IllegalStateException("云备份已取消");
            }
            JSONArray objects = current.getJSONArray("objects");
            JSONObject stored = null;
            for (int index = 0; index < objects.length(); index++) {
                JSONObject candidate = objects.getJSONObject(index);
                if (token.equals(candidate.optString("token"))) {
                    stored = candidate;
                    break;
                }
            }
            if (stored == null) throw new IllegalStateException("原生云任务找不到已上传对象");
            if (!stored.optBoolean("uploaded", false)) {
                stored.put("uploaded", true);
                if (result != null && result.id != null) stored.put("resultId", result.id);
                current.put("completed", current.optInt("completed", 0) + 1);
            }
            current.put("currentObject", name);
            applyMetrics(current);
        });
        completed = latest.optInt("completed", completed);
        total = latest.optInt("total", total);
        objectFile(entry).delete();

        setProgressAsync(new androidx.work.Data.Builder()
            .putString("jobId", jobId)
            .putInt("completed", completed)
            .putInt("total", total)
            .build());
        long now = System.currentTimeMillis();
        int onePercent = total > 0 ? Math.max(1, (int)Math.ceil(total / 100.0)) : Integer.MAX_VALUE;
        if (completed >= total || now - lastForegroundAt >= 350 || completed - lastForegroundCompleted >= onePercent) {
            setForegroundAsync(foreground("正在上传 " + name, completed, total));
            lastForegroundAt = now;
            lastForegroundCompleted = completed;
        }
    }

    private synchronized void persistStatus(
        String status,
        String error,
        String resultId,
        String resultName
    ) throws Exception {
        JSONObject latest = NativeCloudTransferPlugin.mutateJob(root, current -> {
            if ("cancelled".equals(current.optString("status")) && !"cancelled".equals(status)) {
                throw new IllegalStateException("云备份已取消");
            }
            current.put("status", status);
            current.put("error", error == null ? JSONObject.NULL : error);
            if (resultId != null) current.put("resultId", resultId);
            if (resultName != null) current.put("resultName", resultName);
            applyMetrics(current);
        });
        completed = latest.optInt("completed", completed);
        total = latest.optInt("total", total);
    }

    private void applyMetrics(JSONObject target) throws Exception {
        target.put("uploadedBytes", uploadedBytes);
        target.put("httpRequestCount", httpRequestCount);
        target.put("retryCount", retryCount);
        target.put("networkMs", networkMs);
        target.put("verifyMs", verifyMs);
    }

    private synchronized void addMetric(String key, long value) {
        if (value <= 0) return;
        switch (key) {
            case "uploadedBytes": uploadedBytes += value; break;
            case "httpRequestCount": httpRequestCount += value; break;
            case "retryCount": retryCount += value; break;
            case "networkMs": networkMs += value; break;
            case "verifyMs": verifyMs += value; break;
            default: break;
        }
    }
    private long elapsedMs(long startedNanos) { return Math.max(0L, (System.nanoTime() - startedNanos) / 1_000_000L); }

    private ForegroundInfo foreground(String text, int completed, int total) {
        ensureChannel();
        PendingIntent pending = openBackupPendingIntent();
        Intent cancel = new Intent(getApplicationContext(), NativeBackupNotificationReceiver.class)
            .setAction(NativeBackupNotificationReceiver.ACTION_CANCEL).putExtra("jobId", jobId);
        PendingIntent cancelPending = PendingIntent.getBroadcast(getApplicationContext(), NOTIFICATION_ID, cancel, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getApplicationContext(), CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("SRL 云备份").setContentText(text)
            .setOnlyAlertOnce(true).setOngoing(true).setContentIntent(pending)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "取消本次", cancelPending);
        if (total > 0) builder.setProgress(total, Math.min(completed, total), false); else builder.setProgress(0, 0, true);
        if (Build.VERSION.SDK_INT >= 29) return new ForegroundInfo(NOTIFICATION_ID, builder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        return new ForegroundInfo(NOTIFICATION_ID, builder.build());
    }
    private void notifyFinished(String title, String text) {
        ensureChannel();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getApplicationContext(), CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done).setContentTitle(title).setContentText(text).setAutoCancel(true)
            .setContentIntent(openBackupPendingIntent())
            .addAction(android.R.drawable.ic_menu_view, "查看备份", openBackupPendingIntent());
        ((NotificationManager) getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID + 1, builder.build());
    }
    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) ((NotificationManager) getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE))
            .createNotificationChannel(new NotificationChannel(CHANNEL, "云备份", NotificationManager.IMPORTANCE_LOW));
    }
    private PendingIntent openBackupPendingIntent() {
        Intent launch = new Intent(Intent.ACTION_VIEW, Uri.parse("srl://backup"), getApplicationContext(), MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(getApplicationContext(), NOTIFICATION_ID + 2, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private String rootMessage(Throwable error) { Throwable current = error; while (current.getCause() != null) current = current.getCause(); return current.getMessage() == null ? "原生云备份失败" : current.getMessage(); }
    private boolean hasCause(Throwable error, Class<? extends Throwable> type) { Throwable current = error; while (current != null) { if (type.isInstance(current)) return true; current = current.getCause(); } return false; }
    private boolean hasHttpStatus(Throwable error, int status) { Throwable current = error; while (current != null) { if (current instanceof CloudHttpException && ((CloudHttpException) current).status == status) return true; current = current.getCause(); } return false; }
    private static final class UploadResult { final String id; UploadResult(String id) { this.id = id; } }
    private static final class HttpResult { final int code; final String body, contentRange; final long contentLength; HttpResult(int code, String body, String contentRange, long contentLength) { this.code=code; this.body=body; this.contentRange=contentRange; this.contentLength=contentLength; } }
    private static final class CloudHttpException extends Exception { final int status; CloudHttpException(int status, String message) { super(message + "（" + status + "）"); this.status = status; } }
}
