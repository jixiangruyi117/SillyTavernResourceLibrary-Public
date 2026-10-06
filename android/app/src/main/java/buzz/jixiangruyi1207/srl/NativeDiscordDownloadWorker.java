package buzz.jixiangruyi1207.srl;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.*;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Persistent scheduling for Discord shares; files and receipts remain in the existing share directory. */
public final class NativeDiscordDownloadWorker extends Worker {
    static final String WORK_PREFIX = "srl-discord-download-";
    private static final String TAG = "srl-discord-download";
    private static final String CHANNEL = "srl_import";
    private static final int FINISHED_NOTIFICATION_ID = 2112;
    private static final Map<String, TransferGate> TRANSFERS = new HashMap<>();
    private volatile okhttp3.Call activeCall;
    private volatile Future<?> transfer;
    private long lastProgressAt;

    public NativeDiscordDownloadWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }

    static boolean validToken(String token) { return token != null && token.matches("discord-url-[a-f0-9-]{36}"); }

    static boolean shouldAttemptBackgroundImport(JSONObject processed) {
        String state = processed == null ? "" : processed.optString("state");
        // The parser only writes the sidecar; the importer performs the authoritative
        // duplicate/version lookup against the active SQLite library.
        return "parsed".equals(state) || "parsed_index_unavailable".equals(state);
    }

    static boolean shouldRetryAfterMigration(String importState, int runAttemptCount) {
        return "native_database_unavailable".equals(importState) && runAttemptCount < 5;
    }

    static boolean shouldAppendDeferredImport(boolean running, boolean hasPendingFollowup) {
        return running && !hasPendingFollowup;
    }

    static boolean shouldRetryStagedImport(JSONObject ready) {
        JSONObject outcome = ready == null ? null : ready.optJSONObject("nativeImportOutcome");
        return outcome != null && "native_database_unavailable".equals(outcome.optString("state"));
    }

    static synchronized int resumeDeferredImports(Context context) throws Exception {
        NativeAppDatabase database = new NativeAppDatabase(context);
        String activeState = database.getState("migration:appdb:v1:active");
        if (activeState == null || !"verified-v1".equals(database.getState("migration:appdb:indexes:v1:active"))) return 0;
        JSONObject active = new JSONObject(activeState);
        String mode = active.optString("mode", "active");
        if (active.optInt("version") != 1 || !("active".equals(mode) || "".equals(mode))) return 0;

        File folder = new File(context.getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER);
        File[] receipts = folder.listFiles((dir, name) -> name.endsWith(".done"));
        if (receipts == null) return 0;
        WorkManager manager = WorkManager.getInstance(context);
        int resumed = 0;
        for (File receipt : receipts) {
            String token = receipt.getName().substring(0, receipt.getName().length() - ".done".length());
            if (!validToken(token)) continue;
            String stagedToken = NativeShareImportService.stagedToken(token, 0);
            File metadataFile = new File(folder, stagedToken + ".json");
            File payload = new File(folder, stagedToken);
            if (!metadataFile.isFile() || !payload.isFile()) continue;
            JSONObject ready = NativeShareImportService.readMetadata(metadataFile);
            if (!shouldRetryStagedImport(ready)) continue;

            boolean alreadyRunning = false;
            boolean hasPendingFollowup = false;
            for (WorkInfo info : manager.getWorkInfosForUniqueWork(WORK_PREFIX + token).get()) {
                if (info.getState() == WorkInfo.State.RUNNING) alreadyRunning = true;
                else if (!info.getState().isFinished()) hasPendingFollowup = true;
            }
            OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(NativeDiscordDownloadWorker.class)
                .setInputData(new Data.Builder().putString("token", token).build())
                .addTag(TAG).addTag(WORK_PREFIX + token)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build();
            if (alreadyRunning) {
                // Startup can find a staged file while its last migration-gated attempt is still
                // running. Queue one check behind it so the ready database is not missed forever.
                if (shouldAppendDeferredImport(true, hasPendingFollowup)) {
                    manager.enqueueUniqueWork(WORK_PREFIX + token, ExistingWorkPolicy.APPEND, request)
                        .getResult().get();
                    resumed++;
                }
                continue;
            }
            ready.put("downloadWorkId", request.getId().toString());
            NativeShareImportService.writeMetadata(folder, stagedToken, ready);
            manager.enqueueUniqueWork(WORK_PREFIX + token, ExistingWorkPolicy.REPLACE, request).getResult().get();
            notifyQueued(context, token, request.getId().toString(), "正在后台继续校验并导入已下载附件");
            ShareReceiverPlugin.notifyDiscordDownloadStarted(token, request.getId().toString(), ready.optString("name", "云端资源"), ready.has("cloudLibraryId"));
            resumed++;
        }
        return resumed;
    }

    static String completionText(JSONObject processed, JSONObject nativeImport) {
        String parsedState = processed == null ? "" : processed.optString("state");
        String importState = nativeImport == null ? "deferred" : nativeImport.optString("state", "deferred");
        String detail = nativeImport == null ? "" : nativeImport.optString("message", "").trim();
        if ("parse_failed".equals(parsedState)) {
            String parseDetail = processed.optString("message", "").trim();
            return (parseDetail.isEmpty() ? "后台解析未完成" : "后台解析未完成：" + parseDetail)
                + "；附件已保留，打开 SRL 查看并继续处理。";
        }
        if ("imported".equals(importState)) return "角色卡已在后台解析并导入资源库。";
        if ("duplicate_file".equals(importState) || "duplicate_card".equals(importState))
            return "角色卡已存在于资源库，没有重复添加。";
        if ("waiting_version".equals(importState))
            return "角色卡已解析，发现相似版本；打开 SRL 选择如何处理。";
        if ("vault_requires_foreground".equals(importState))
            return detail.isEmpty() ? "保险库需要在前台解锁后才能导入；已保留下载文件。"
                : detail + "；已保留下载文件。";
        if ("native_database_unavailable".equals(importState))
            return (detail.isEmpty() ? "本机资源库暂不可用" : detail) + "；已保留下载文件，打开 SRL 后可继续导入。";
        if ("deferred".equals(importState) || "failed".equals(importState))
            return (detail.isEmpty() ? "后台入库未完成" : "后台入库未完成：" + detail)
                + "；已保留下载文件，打开 SRL 查看并继续处理。";
        if ("parsed".equals(parsedState))
            return processed.optInt("candidateCount") > 0
                ? "后台已解析角色卡，发现版本候选；打开 SRL 确认后导入。"
                : "后台已解析角色卡，但尚未完成入库；已保留下载文件，打开 SRL 查看详情。";
        if ("parsed_index_unavailable".equals(parsedState))
            return "后台已解析角色卡，但本机资源库不可用；已保留下载文件，打开 SRL 查看详情。";
        return "附件已下载；打开 SRL 继续校验并导入。";
    }

    static synchronized void enqueue(Context context, String token) throws Exception {
        enqueue(context, token, null);
    }

    static synchronized void enqueue(Context context, String token, String expectedWorkId) throws Exception {
        if (!validToken(token)) throw new IllegalArgumentException("Discord 分享链接已失效，请重新分享");
        File folder = new File(context.getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER);
        File source = new File(folder, token + ".json");
        if (!source.isFile()) {
            if (new File(folder, token + ".done").isFile()) return;
            throw new IllegalArgumentException("Discord 分享链接已失效，请重新分享");
        }
        JSONObject metadata = NativeShareImportService.readMetadata(source);
        DiscordAttachmentUrl.fromSharedText(metadata.getString("discordUrl"));
        if (!token.equals(metadata.optString("cleanupToken"))) throw new IllegalArgumentException("Discord 分享状态不匹配，请重新分享");
        if (expectedWorkId != null && (!matchesAction(metadata, token, expectedWorkId) || !metadata.has("error"))) return;
        boolean manualRetry = metadata.has("error");
        WorkManager manager = WorkManager.getInstance(context);
        for (WorkInfo info : manager.getWorkInfosForUniqueWork(WORK_PREFIX + token).get()) {
            // A stale notification must never replace a later download of the same share.
            if (!info.getState().isFinished() && blocksNewSchedule(metadata, info.getId().toString())) return;
        }
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(NativeDiscordDownloadWorker.class)
            .setInputData(new Data.Builder().putString("token", token).build())
            .addTag(TAG).addTag(WORK_PREFIX + token)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build();
        prepareScheduled(metadata, request.getId().toString());
        NativeShareImportService.writeMetadata(folder, token, metadata);
        manager.enqueueUniqueWork(WORK_PREFIX + token,
            manualRetry ? ExistingWorkPolicy.REPLACE : ExistingWorkPolicy.KEEP, request).getResult().get();
        notifyQueued(context, token, request.getId().toString(), "等待网络连接并开始下载");
        ShareReceiverPlugin.notifyDiscordDownloadStarted(token, request.getId().toString(), metadata.optString("name", "Discord 附件"), metadata.has("cloudLibraryId"));
    }

    static boolean matchesAction(JSONObject metadata, String token, String workId) {
        return validToken(token) && workId != null && workId.matches("[a-f0-9-]{36}")
            && token.equals(metadata.optString("cleanupToken")) && workId.equals(metadata.optString("downloadWorkId"));
    }

    static boolean blocksNewSchedule(JSONObject metadata, String activeWorkId) {
        return !metadata.has("error") || !activeWorkId.equals(metadata.optString("downloadWorkId"));
    }

    static void prepareScheduled(JSONObject metadata, String workId) throws Exception {
        metadata.remove("error");
        metadata.remove("downloadCancelled");
        metadata.remove("downloadFailures");
        metadata.put("downloadWorkId", workId);
    }

    static boolean markCancelled(JSONObject metadata, String token, String workId) throws Exception {
        if (!matchesAction(metadata, token, workId) || metadata.optBoolean("downloadCancelled")) return false;
        metadata.put("downloadCancelled", true).put("error", "下载已取消；已保留附件暂存，可重试");
        return true;
    }

    static synchronized void cancel(Context context, String token, String workId) throws Exception {
        if (!validToken(token)) return;
        File folder = new File(context.getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER);
        File source = new File(folder, token + ".json");
        if (!source.isFile() || new File(folder, token + ".done").isFile()) return;
        JSONObject metadata = NativeShareImportService.readMetadata(source);
        if (!markCancelled(metadata, token, workId)) return;
        // Persist first; a late checkpoint or process restart cannot revive the cancelled transfer.
        NativeShareImportService.writeMetadata(folder, token, metadata);
        WorkManager.getInstance(context).cancelUniqueWork(WORK_PREFIX + token).getResult().get();
        notifyFinished(context, token, workId, "SRL 下载已取消", metadata.getString("error"), true);
        ShareReceiverPlugin.notifyDiscordDownloadFailed(token, workId, metadata.has("cloudLibraryId"));
    }

    static synchronized void notifyActionFailed(Context context, String token, String workId) {
        if (!validToken(token)) return;
        try {
            File source = new File(new File(context.getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER), token + ".json");
            if (source.isFile() && matchesAction(NativeShareImportService.readMetadata(source), token, workId)) {
                notifyFinished(context, token, workId, "SRL 下载操作未完成", "请打开 SRL 查看附件状态并重试", false);
            }
        } catch (Exception ignored) { /* Already cleared, replaced or unavailable; do not recreate its notification. */ }
    }

    static void clearNotification(Context context, String token) {
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE))
            .cancel(WORK_PREFIX + token, FINISHED_NOTIFICATION_ID);
        NativeInboxNotificationGroup.refresh(context);
    }

    static Set<String> activeTokens(Context context) throws Exception {
        Set<String> result = new HashSet<>();
        for (WorkInfo info : WorkManager.getInstance(context).getWorkInfosByTag(TAG).get()) {
            if (info.getState().isFinished()) continue;
            for (String tag : info.getTags()) if (tag.startsWith(WORK_PREFIX)) result.add(tag.substring(WORK_PREFIX.length()));
        }
        return result;
    }

    static boolean isActiveToken(Context context, String token) throws Exception {
        for (WorkInfo info : WorkManager.getInstance(context).getWorkInfosForUniqueWork(WORK_PREFIX + token).get()) {
            if (!info.getState().isFinished()) return true;
        }
        return false;
    }

    static Set<String> transferringTokens() {
        synchronized (TRANSFERS) { return new HashSet<>(TRANSFERS.keySet()); }
    }

    @Override public void onStopped() {
        okhttp3.Call call = activeCall;
        if (call != null) call.cancel();
        Future<?> pending = transfer;
        if (pending != null) pending.cancel(true);
        super.onStopped();
    }

    @NonNull @Override public Result doWork() {
        String token = getInputData().getString("token");
        if (!validToken(token)) return Result.failure();
        File folder = new File(getApplicationContext().getFilesDir(), ShareReceiverPlugin.CACHE_FOLDER);
        File source = new File(folder, token + ".json");
        try {
            boolean retryStagedImport = false;
            if (new File(folder, token + ".done").isFile()) {
                File readyMetadata = new File(folder, NativeShareImportService.stagedToken(token, 0) + ".json");
                retryStagedImport = readyMetadata.isFile()
                    && shouldRetryStagedImport(NativeShareImportService.readMetadata(readyMetadata));
            }
            if (new File(folder, token + ".done").isFile() && !retryStagedImport) return Result.success();
            JSONObject metadata;
            if (retryStagedImport) {
                String stagedToken = NativeShareImportService.stagedToken(token, 0);
                File readyMetadata = new File(folder, stagedToken + ".json");
                if (!readyMetadata.isFile() || !new File(folder, stagedToken).isFile()) return Result.success();
                JSONObject ready = NativeShareImportService.readMetadata(readyMetadata);
                JSONObject previous = ready.optJSONObject("nativeImportOutcome");
                String previousState = previous == null ? "" : previous.optString("state");
                if ("imported".equals(previousState) || "duplicate_file".equals(previousState)
                    || "duplicate_card".equals(previousState) || "waiting_version".equals(previousState)
                    || "vault_requires_foreground".equals(previousState)) return Result.success();
                metadata = new JSONObject(ready.toString()).put("downloadWorkId", getId().toString());
            } else synchronized (NativeDiscordDownloadWorker.class) {
                metadata = NativeShareImportService.readMetadata(source);
                // Jobs already queued by an earlier APK acquire the same persisted action identity.
                if (metadata.optString("downloadWorkId").isBlank()) {
                    metadata.put("downloadWorkId", getId().toString());
                    NativeShareImportService.writeMetadata(folder, token, metadata);
                }
                if (!canCheckpoint(metadata, getId().toString())) return Result.failure();
            }
            // Honor CDN Retry-After without sleeping a worker thread or spending a network attempt.
            if (!retryStagedImport && metadata.optLong("downloadNotBefore", 0) > System.currentTimeMillis()) {
                notifyWaiting(token, source);
                return Result.retry();
            }
            if (!retryStagedImport) synchronized (NativeDiscordDownloadWorker.class) {
                requireCurrent(source);
                clearNotification(getApplicationContext(), token);
                setForegroundAsync(foreground(token, "等待下载 " + metadata.optString("name"), 0, 0)).get();
                NativeInboxNotificationGroup.refresh(getApplicationContext());
            }
            if (retryStagedImport) {
                clearNotification(getApplicationContext(), token);
                setForegroundAsync(foreground(token, "后台继续解析 " + metadata.optString("name"), 0, 0)).get();
            } else {
                transfer = NativeExecutors.network().submit(() -> {
                    try { runTransfer(token, () -> download(folder, source, token, metadata)); }
                    catch (Exception error) { throw new TransferFailure(error); }
                });
                if (isStopped()) transfer.cancel(true);
                transfer.get();
                if (isStopped()) return Result.retry();
            }
            JSONObject processed = new JSONObject();
            JSONObject nativeImport = new JSONObject().put("state", "deferred");
            try {
                // The download method writes the final staged file under a deterministic token.
                // Read that receipt to find the payload without trusting cloud-supplied paths.
                String stagedToken = NativeShareImportService.stagedToken(token, 0);
                File readyMetadata = new File(folder, stagedToken + ".json");
                JSONObject ready = NativeShareImportService.readMetadata(readyMetadata);
                File payload = new File(folder, stagedToken);
                // The native importer below performs the authoritative duplicate/version lookup
                // against the active app database. Scanning and parsing every mirrored library
                // file here first duplicated that work for every received attachment.
                processed = NativeCharacterCardProcessor.parseOnly(payload,
                    ready.optString("name", metadata.optString("name", "")),
                    new File(folder, stagedToken + ".character-card.json"));
                if (shouldAttemptBackgroundImport(processed)) {
                    try {
                        nativeImport = NativeBackgroundResourceImporter.importIfSafe(getApplicationContext(), payload,
                            new File(folder, stagedToken + ".character-card.json"),
                            ready.optString("name", metadata.optString("name", "")),
                            ready.optString("type", metadata.optString("type", "application/octet-stream")));
                    } catch (Exception importError) {
                        nativeImport = new JSONObject().put("state", "deferred")
                            .put("message", importError.getMessage() == null ? "后台入库未完成" : importError.getMessage());
                    }
                }
                String resultState = nativeImport.optString("state");
                boolean importedOrDuplicate = "imported".equals(resultState)
                    || "duplicate_file".equals(resultState) || "duplicate_card".equals(resultState);
                ready.put("nativeImportOutcome", nativeImport)
                    .put("nativeAckPending", metadata.has("cloudLibraryId") && importedOrDuplicate);
                ready.put("nativeCharacterCardResult", processed);
                NativeShareImportService.writeMetadata(folder, stagedToken, ready);
                if (metadata.has("cloudLibraryId") && importedOrDuplicate) {
                    try {
                        boolean acknowledged = NativeDiscordInboxService.acknowledgeResource(getApplicationContext(),
                            token.substring("discord-url-".length()), "imported", "");
                        if (acknowledged) {
                            ready.put("nativeAckPending", false);
                            NativeShareImportService.writeMetadata(folder, stagedToken, ready);
                        }
                    } catch (Exception ignored) { /* Retried by the receive service or APK inbox. */ }
                }
                metadata.put("nativeCharacterCardResult", processed);
                metadata.put("nativeImportOutcome", nativeImport);
            } catch (Exception parseError) {
                String committedState = nativeImport.optString("state");
                boolean alreadyCommitted = "imported".equals(committedState)
                    || "duplicate_file".equals(committedState) || "duplicate_card".equals(committedState);
                if (!alreadyCommitted) {
                    String detail = parseError.getMessage() == null ? "后台解析或入库未完成" : parseError.getMessage();
                    processed = new JSONObject().put("state", "parse_failed").put("message", detail);
                    nativeImport = new JSONObject().put("state", "parse_failed").put("message", detail);
                }
                metadata.put("nativeCharacterCardResult", processed);
                metadata.put("nativeImportOutcome", nativeImport);
            }
            String importState = nativeImport.optString("state", "deferred");
            if (shouldRetryAfterMigration(importState, getRunAttemptCount())) {
                notifyFinished(getApplicationContext(), token, getId().toString(),
                    metadata.optString("name", "云端资源") + "：已下载",
                    "原生资源库暂不可用；下载文件已保留，打开 SRL 后会继续导入。", false);
                return Result.retry();
            }
            boolean importedOrDuplicate = "imported".equals(importState)
                || "duplicate_file".equals(importState) || "duplicate_card".equals(importState);
            String completionText = completionText(processed, nativeImport);
            notifyFinished(getApplicationContext(), token, getId().toString(),
                importedOrDuplicate ? metadata.optString("name", "云端资源") + "：" + ("imported".equals(importState) ? "解析成功并已导入" : "已存在，未重复添加")
                    : metadata.has("cloudLibraryId") ? metadata.optString("name", "云端资源") + "：已下载" : "SRL 文件已就绪",
                completionText, false);
            ShareReceiverPlugin.notifyDiscordDownloadCompleted(token, getId().toString(), metadata.has("cloudLibraryId"));
            ShareReceiverPlugin.notifyShareReady();
            return Result.success();
        } catch (Exception caught) {
            if (caught instanceof InterruptedException) {
                onStopped();
                Thread.currentThread().interrupt();
                return Result.retry();
            }
            if (isStopped() || Thread.currentThread().isInterrupted()) return Result.retry();
            Exception error = caught;
            if (caught instanceof ExecutionException && caught.getCause() instanceof TransferFailure) {
                error = ((TransferFailure) caught.getCause()).error;
            }
            boolean retry = false;
            try {
                synchronized (NativeDiscordDownloadWorker.class) {
                    if (source.isFile()) {
                        JSONObject metadata = NativeShareImportService.readMetadata(source);
                        if (!canCheckpoint(metadata, getId().toString())) return Result.failure();
                        int failures = metadata.optString("downloadWorkId").equals(getId().toString())
                            ? metadata.optInt("downloadFailures", 0) + 1 : 1;
                        retry = NativeDiscordAttachmentDownload.shouldRetry(error, failures);
                        metadata.put("downloadWorkId", getId().toString()).put("downloadFailures", failures);
                        if (retry) metadata.remove("error");
                        else metadata.put("error", safeMessage(error));
                        NativeShareImportService.writeMetadata(folder, token, metadata);
                    }
                }
            } catch (Exception persistenceError) { retry = false; }
            if (retry) {
                notifyWaiting(token, source);
                return Result.retry();
            }
            notifyFailedCurrent(token, source, error);
            return Result.failure();
        } finally { activeCall = null; transfer = null; }
    }

    private void download(File folder, File source, String token, JSONObject metadata) throws Exception {
        synchronized (NativeDiscordDownloadWorker.class) { requireCurrent(source); }
        String staged = NativeShareImportService.stagedToken(token, 0);
        File payload = new File(folder, staged), partial = new File(folder, staged + ".part");
        boolean stagedReady = NativeShareImportService.isCommitted(folder, staged);
        boolean payloadReady = metadata.optBoolean("downloadComplete") && metadata.optLong("downloadSize", -1) > 0
            && payload.isFile() && payload.length() == metadata.optLong("downloadSize");
        if (!stagedReady && !payloadReady) {
            NativeDiscordAttachmentDownload.download(NativeHttpClients.CLOUD.newBuilder()
                .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build(),
                metadata.getString("discordUrl"), partial, metadata,
                saved -> saveCheckpoint(folder, source, token, saved),
                (done, total) -> {
                    if (isStopped()) throw new java.io.InterruptedIOException("Discord 下载已暂停");
                    long now = System.currentTimeMillis();
                    if (now - lastProgressAt >= 350 || (total > 0 && done == total)) {
                        lastProgressAt = now;
                        synchronized (NativeDiscordDownloadWorker.class) {
                            requireCurrent(source);
                            setForegroundAsync(foreground(token, "正在下载 " + metadata.optString("name"), done, total));
                        }
                    }
                }, call -> { activeCall = call; if (isStopped()) call.cancel(); });
        }
        synchronized (NativeDiscordDownloadWorker.class) {
            requireCurrent(source);
            if (!stagedReady) {
                if (!payloadReady) {
                    if (payload.exists() && !payload.delete()) throw new NativeDiscordAttachmentDownload.TerminalFailure("无法替换附件暂存文件");
                    if (!partial.renameTo(payload)) throw new NativeDiscordAttachmentDownload.TerminalFailure("无法提交附件暂存文件");
                }
                JSONObject ready = new JSONObject().put("version", 1).put("name", metadata.getString("name"))
                    .put("type", metadata.optString("downloadType", "application/octet-stream"))
                    .put("cleanupToken", staged).put("size", payload.length()).put("createdAt", System.currentTimeMillis())
                    .put("route", NativeShareRouteShortcuts.ROUTE_RESOURCE).put("discordSourceToken", token);
                if (metadata.has("cloudLibraryId")) ready.put("cloudLibraryId", metadata.getString("cloudLibraryId"))
                    .put("cloudWorkerUrl", metadata.getString("cloudWorkerUrl"));
                NativeShareImportService.writeMetadata(folder, staged, ready);
            }
            // Publishing staging and its receipt is one boundary against cancel/retry actions.
            publishReceipt(folder, token);
            source.delete();
        }
    }

    static void publishReceipt(File folder, String token) throws Exception {
        if (!validToken(token)) throw new IllegalArgumentException("下载任务身份无效");
        try (FileOutputStream output = new FileOutputStream(new File(folder, token + ".done"))) {
            output.write(Long.toString(System.currentTimeMillis()).getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
    }

    interface TransferTask { void run() throws Exception; }

    static void runTransfer(String token, TransferTask task) throws Exception {
        TransferGate gate;
        synchronized (TRANSFERS) {
            gate = TRANSFERS.computeIfAbsent(token, ignored -> new TransferGate());
            gate.users++;
        }
        boolean acquired = false;
        try {
            // Future cancellation completes before its IO thread exits. A replacement must wait for the real exit.
            gate.permit.acquire();
            acquired = true;
            task.run();
        } finally {
            if (acquired) gate.permit.release();
            synchronized (TRANSFERS) { if (--gate.users == 0) TRANSFERS.remove(token); }
        }
    }

    private static final class TransferGate {
        final Semaphore permit = new Semaphore(1);
        int users;
    }

    static boolean canCheckpoint(JSONObject metadata, String workId) {
        return workId.equals(metadata.optString("downloadWorkId")) && !metadata.optBoolean("downloadCancelled");
    }

    private void requireCurrent(File source) throws Exception {
        if (isStopped() || !source.isFile() || !canCheckpoint(NativeShareImportService.readMetadata(source), getId().toString())) {
            throw new java.io.InterruptedIOException("Discord 下载已暂停；已保留断点");
        }
    }

    private void saveCheckpoint(File folder, File source, String token, JSONObject metadata) throws Exception {
        synchronized (NativeDiscordDownloadWorker.class) {
            requireCurrent(source);
            NativeShareImportService.writeMetadata(folder, token, metadata);
        }
    }

    private void notifyWaiting(String token, File source) {
        try {
            synchronized (NativeDiscordDownloadWorker.class) {
                requireCurrent(source);
                notifyQueued(getApplicationContext(), token, getId().toString(), "等待网络恢复后继续下载");
            }
        } catch (Exception ignored) { /* Cancelled, replaced or cleared while the Worker was finishing. */ }
    }

    private void notifyFailedCurrent(String token, File source, Exception error) {
        try {
            synchronized (NativeDiscordDownloadWorker.class) {
                requireCurrent(source);
                JSONObject metadata = NativeShareImportService.readMetadata(source);
                notifyFinished(getApplicationContext(), token, getId().toString(),
                    metadata.has("cloudLibraryId") ? metadata.optString("name", "云端资源") + "：下载失败" : "SRL 下载未完成", safeMessage(error), true);
                // WorkInfo may still be RUNNING; persisted failed metadata is already visible to SRL.
                ShareReceiverPlugin.notifyDiscordDownloadFailed(token, getId().toString(), metadata.has("cloudLibraryId"));
            }
        } catch (Exception ignored) { /* Do not replace the later task's notification or recreate a cleared share. */ }
    }

    private ForegroundInfo foreground(String token, String text, long done, long total) {
        NotificationCompat.Builder notification = base(getApplicationContext(), token, "SRL 附件下载", text).setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "取消下载",
                action(getApplicationContext(), token, getId().toString(), NativeDiscordDownloadNotificationReceiver.ACTION_CANCEL));
        if (total > 0) notification.setProgress(100, (int) Math.min(100, done * 100 / total), false);
        else notification.setProgress(0, 0, true);
        int id = 0x10000000 | (token.hashCode() & 0x00ffffff);
        return Build.VERSION.SDK_INT >= 29
            ? new ForegroundInfo(id, notification.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            : new ForegroundInfo(id, notification.build());
    }

    private static NotificationCompat.Builder base(Context context, String token, String title, String text) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "系统导入", NotificationManager.IMPORTANCE_LOW));
        Intent launch = new Intent(Intent.ACTION_VIEW, Uri.parse("srl://shared-import/" + token), context, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return NativeInboxNotificationGroup.apply(new NotificationCompat.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title).setContentText(text).setContentIntent(pending).setOnlyAlertOnce(true));
    }
    private static PendingIntent action(Context context, String token, String workId, String action) {
        Intent intent = new Intent(context, NativeDiscordDownloadNotificationReceiver.class).setAction(action)
            .setData(Uri.parse("srl://discord-download/" + token + "/" + workId + "/" + action))
            .putExtra("token", token).putExtra("workId", workId);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static void notifyQueued(Context context, String token, String workId, String text) {
        NotificationCompat.Builder notification = base(context, token, "SRL 下载已排队", text).setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "取消下载",
                action(context, token, workId, NativeDiscordDownloadNotificationReceiver.ACTION_CANCEL));
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE))
            .notify(WORK_PREFIX + token, FINISHED_NOTIFICATION_ID, notification.build());
        NativeInboxNotificationGroup.refresh(context);
    }

    private static void notifyFinished(Context context, String token, String workId, String title, String text, boolean retry) {
        NotificationCompat.Builder notification = base(context, token, title, text).setAutoCancel(true);
        if (retry) notification.addAction(android.R.drawable.ic_popup_sync, "重试",
            action(context, token, workId, NativeDiscordDownloadNotificationReceiver.ACTION_RETRY));
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE))
            .notify(WORK_PREFIX + token, FINISHED_NOTIFICATION_ID, notification.build());
        NativeInboxNotificationGroup.refresh(context);
    }
    private static String safeMessage(Exception error) {
        return error instanceof NativeDiscordAttachmentDownload.HttpFailure || error instanceof NativeDiscordAttachmentDownload.TerminalFailure
            ? error.getMessage() : "Discord 附件下载未完成；已保留暂存，可回到 SRL 重试";
    }
    private static final class TransferFailure extends RuntimeException {
        final Exception error;
        TransferFailure(Exception error) { super(error); this.error = error; }
    }
}
