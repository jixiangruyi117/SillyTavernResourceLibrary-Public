package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import androidx.work.ExistingWorkPolicy;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NativeDiscordDownloadNotificationTest {
    @Test public void finishedFailuresCannotBlockLaterCyclesButRunningRetriesStillWait() throws Exception {
        for (String state : new String[]{"deferred", "native_database_unavailable"}) {
            JSONObject metadata = new JSONObject().put("nativeImportOutcome", new JSONObject().put("state", state).put("message", "原始失败原因"))
                .put("nativeCharacterCardResult", new JSONObject().put("state", "parsed"));
            assertFalse(NativeBackgroundResourceImporter.settleAutoReceiveMetadata(metadata, false));
            assertTrue(NativeBackgroundResourceImporter.settleAutoReceiveMetadata(metadata, true));
            assertFalse(NativeBackgroundResourceImporter.blocksAutoReceiveCycle(metadata));
            assertEquals("原始失败原因", metadata.getJSONObject("nativeImportOutcome").getString("message"));
        }
        JSONObject interrupted = new JSONObject();
        assertFalse(NativeBackgroundResourceImporter.settleAutoReceiveMetadata(interrupted, false));
        assertTrue(NativeBackgroundResourceImporter.settleAutoReceiveMetadata(interrupted, true));
        assertEquals("failed", interrupted.getJSONObject("nativeImportOutcome").getString("state"));
        assertFalse(NativeBackgroundResourceImporter.blocksAutoReceiveCycle(interrupted));
        JSONObject legacy = new JSONObject().put("nativeImportOutcome", new JSONObject().put("state", "deferred"))
            .put("nativeCompletionNotificationPosted", true);
        assertTrue(NativeBackgroundResourceImporter.settleAutoReceiveMetadata(legacy, false));
        assertEquals("foreground_required", legacy.getJSONObject("nativeImportOutcome").getString("state"));
        for (String state : new String[]{"failed", "parse_failed", "cancelled", "waiting_version", "foreground_required", "imported"})
            assertTrue(NativeBackgroundResourceImporter.settleAutoReceiveMetadata(new JSONObject().put("nativeImportOutcome", new JSONObject().put("state", state)), false));
    }
    @Test public void versionArrivalUsesTheCurrentImportTimeAndNeverAMetadataEdit() throws Exception {
        JSONObject resource = new JSONObject().put("createdAt", 10L).put("updatedAt", 300L);
        assertEquals(10L, NativeBackgroundResourceImporter.currentVersionImportedAt(resource));
        resource.put("versionImportedAt", 200L);
        assertEquals(200L, NativeBackgroundResourceImporter.currentVersionImportedAt(resource));
    }
    @Test public void standaloneWorldBooksUseForegroundCompatibleSummariesAndAccurateCompletionNotices() throws Exception {
        for (Object entries : new Object[]{new JSONObject().put("0", new JSONObject().put("content", "设定")),
            new org.json.JSONArray().put(new JSONObject().put("content", "设定")), new JSONObject()}) {
            JSONObject book = NativeTavernResourceParser.parseJson(new JSONObject().put("entries", entries), "测试.JSON");
            assertEquals("worldBook", book.getString("type"));
            assertEquals("测试", book.getString("name"));
            int count = entries instanceof JSONObject ? ((JSONObject) entries).length() : ((org.json.JSONArray) entries).length();
            assertEquals(count, book.getJSONObject("metadata").getInt("itemCount"));
            assertEquals("worldBook", book.getJSONObject("metadata").getString("detectedVariant"));
            assertFalse(book.getJSONObject("metadata").has("entries"));
        }
        JSONObject named = NativeTavernResourceParser.parseJson(new JSONObject().put("entries", new JSONObject())
            .put("name", "  书名  ").put("description", "  简介  "), "fallback.json");
        assertEquals("书名", named.getString("name"));
        assertEquals("简介", named.getString("description"));
        assertEquals("other", NativeTavernResourceParser.parseJson(new JSONObject().put("entries", "invalid"), "a.json").getString("type"));
        assertNull(NativeTavernResourceParser.parseJson(new JSONObject().put("entries", new JSONObject())
            .put("format", "srl-personal-resource"), "a.json"));
        JSONObject parsed = new JSONObject().put("state", "parsed").put("resourceType", "worldBook");
        assertTrue(NativeDiscordDownloadWorker.shouldAttemptBackgroundImport(parsed));
        assertEquals("世界书已在后台解析并导入资源库。", NativeDiscordDownloadWorker.completionText(parsed,
            new JSONObject().put("state", "imported").put("resourceType", "worldBook")));
        assertEquals("世界书已存在于资源库，没有重复添加。", NativeDiscordDownloadWorker.completionText(parsed,
            new JSONObject().put("state", "duplicate_file").put("resourceType", "worldBook")));
    }
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private static final String TOKEN = "discord-url-c579c927-54cc-40e0-a3d2-b5f74a60b4ef";
    private static final String OTHER_TOKEN = "discord-url-864ec8d6-e079-4589-9cd1-2508c73e4d12";
    private static final String WORK = "69f2d6d1-448f-4e82-a44d-1375c9b903c3";
    private static final String NEXT = "a4b650a8-2375-48cb-b63a-2427f0ccf317";

    private JSONObject checkpoint() throws Exception {
        return new JSONObject().put("cleanupToken", TOKEN).put("downloadWorkId", WORK)
            .put("discordUrl", "https://cdn.discordapp.com/attachments/123/456/card.json?ex=abc&hm=signature")
            .put("downloadSize", 8000).put("downloadValidator", "\"version1\"")
            .put("downloadNotBefore", 123456).put("downloadComplete", false);
    }

    private String read(File file) throws Exception {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }

    @Test public void parsedCardStillAttemptsAuthoritativeNativeImportWhenMirrorIndexIsUnavailable() throws Exception {
        assertTrue(NativeDiscordDownloadWorker.shouldAttemptBackgroundImport(
            new JSONObject().put("state", "parsed")));
        assertTrue(NativeDiscordDownloadWorker.shouldAttemptBackgroundImport(
            new JSONObject().put("state", "parsed_index_unavailable")));
        assertFalse(NativeDiscordDownloadWorker.shouldAttemptBackgroundImport(
            new JSONObject().put("state", "not_character_card")));
        assertFalse(NativeDiscordDownloadWorker.shouldAttemptBackgroundImport(
            new JSONObject().put("state", "parse_failed")));
    }

    @Test public void completedNonCardDoesNotHoldLaterBindingCyclesButUnfinishedWorkStillDoes() throws Exception {
        JSONObject legacy = new JSONObject()
            .put("name", "Npcs.docx").put("cloudAutoBindingPending", true)
            .put("nativeCharacterCardResult", new JSONObject().put("state", "not_character_card"))
            .put("nativeImportOutcome", new JSONObject().put("state", "deferred"));
        assertTrue(NativeBackgroundResourceImporter.requiresForegroundImport(legacy));
        assertFalse(NativeBackgroundResourceImporter.blocksAutoReceiveCycle(legacy));
        assertFalse(NativeBackgroundResourceImporter.blocksAutoReceiveCycle(new JSONObject()
            .put("nativeImportOutcome", new JSONObject().put("state", "foreground_required"))));
        assertTrue(NativeBackgroundResourceImporter.blocksAutoReceiveCycle(new JSONObject()));
        assertTrue(NativeBackgroundResourceImporter.blocksAutoReceiveCycle(new JSONObject()
            .put("nativeCharacterCardResult", new JSONObject().put("state", "parsed"))
            .put("nativeImportOutcome", new JSONObject().put("state", "deferred"))));
        assertTrue(NativeBackgroundResourceImporter.blocksAutoReceiveCycle(new JSONObject()
            .put("nativeImportOutcome", new JSONObject().put("state", "native_database_unavailable"))));
        for (String state : new String[]{"imported", "waiting_version", "parse_failed", "cancelled"})
            assertFalse(NativeBackgroundResourceImporter.blocksAutoReceiveCycle(new JSONObject()
                .put("nativeImportOutcome", new JSONObject().put("state", state))));
        assertFalse(NativeBackgroundResourceImporter.blocksAutoReceiveCycle(new JSONObject().put("error", "download failed")));
    }

    @Test public void nonCardNoticeDistinguishesRequiredForegroundProcessingFromFailedImport() throws Exception {
        JSONObject parsed = new JSONObject().put("state", "not_character_card");
        for (String state : new String[]{"deferred", "foreground_required"}) {
            String text = NativeDiscordDownloadWorker.completionText(parsed, new JSONObject().put("state", state));
            assertTrue(text.contains("需要在前台解析导入"));
            assertTrue(text.contains("文件已下载并保留"));
            assertFalse(text.contains("后台入库未完成"));
        }
    }

    @Test public void manualReceiveOptOutCannotBePromotedByTheAutomaticReceiver() throws Exception {
        JSONObject metadata = new JSONObject();
        ShareReceiverPlugin.setCloudAutoBindingIntent(metadata, false, "");
        assertTrue(metadata.getBoolean("cloudAutoBindingOptOut"));
        assertFalse(metadata.getBoolean("cloudAutoBindingPending"));
        ShareReceiverPlugin.setCloudAutoBindingIntent(metadata, true, "1234567890");
        assertTrue(metadata.getBoolean("cloudAutoBindingOptOut"));
        assertFalse(metadata.getBoolean("cloudAutoBindingPending"));
        assertFalse(metadata.has("cloudAutoReceiveWindow"));
    }

    @Test public void automaticReceiveKeepsItsFirstThirtySecondCycleAssignment() throws Exception {
        JSONObject metadata = new JSONObject();
        ShareReceiverPlugin.setCloudAutoBindingIntent(metadata, true, "1234567890");
        ShareReceiverPlugin.setCloudAutoBindingIntent(metadata, true, "1234567920");
        assertTrue(metadata.getBoolean("cloudAutoBindingPending"));
        assertEquals("1234567890", metadata.getString("cloudAutoReceiveWindow"));
    }

    @Test public void migrationUnavailableImportGetsBoundedRetriesWithoutStartingAnotherDownload() {
        assertTrue(NativeDiscordDownloadWorker.shouldRetryAfterMigration("native_database_unavailable", 0));
        assertTrue(NativeDiscordDownloadWorker.shouldRetryAfterMigration("native_database_unavailable", 4));
        assertFalse(NativeDiscordDownloadWorker.shouldRetryAfterMigration("native_database_unavailable", 5));
        assertFalse(NativeDiscordDownloadWorker.shouldRetryAfterMigration("waiting_version", 0));
    }

    @Test public void stagedImportCanResumeAfterMigrationCompletesWithoutRedownloading() throws Exception {
        assertTrue(NativeDiscordDownloadWorker.shouldRetryStagedImport(new JSONObject()
            .put("nativeImportOutcome", new JSONObject().put("state", "native_database_unavailable"))));
        assertFalse(NativeDiscordDownloadWorker.shouldRetryStagedImport(new JSONObject()
            .put("nativeImportOutcome", new JSONObject().put("state", "imported"))));
        assertFalse(NativeDiscordDownloadWorker.shouldRetryStagedImport(new JSONObject()
            .put("nativeImportOutcome", new JSONObject().put("state", "waiting_version"))));
        assertFalse(NativeDiscordDownloadWorker.shouldRetryStagedImport(new JSONObject()));
    }

    @Test public void restoresCompletionNoticeOnlyForCommittedOutcomesMissingTheirNotice() throws Exception {
        assertTrue(NativeDiscordDownloadWorker.shouldRestoreCompletionNotification(new JSONObject()
            .put("nativeImportOutcome", new JSONObject().put("state", "imported"))));
        assertTrue(NativeDiscordDownloadWorker.shouldRestoreCompletionNotification(new JSONObject()
            .put("nativeImportOutcome", new JSONObject().put("state", "duplicate_file"))));
        assertFalse(NativeDiscordDownloadWorker.shouldRestoreCompletionNotification(new JSONObject()
            .put("nativeImportOutcome", new JSONObject().put("state", "native_database_unavailable"))));
        assertFalse(NativeDiscordDownloadWorker.shouldRestoreCompletionNotification(new JSONObject()
            .put("nativeCompletionNotificationPosted", true)
            .put("nativeImportOutcome", new JSONObject().put("state", "imported"))));
    }

    @Test public void queuesOneFollowupWhenStartupFindsADeferredImportStillRunning() {
        assertTrue(NativeDiscordDownloadWorker.shouldAppendDeferredImport(true, false));
        assertFalse(NativeDiscordDownloadWorker.shouldAppendDeferredImport(true, true));
        assertFalse(NativeDiscordDownloadWorker.shouldAppendDeferredImport(false, false));
        assertEquals(ExistingWorkPolicy.APPEND_OR_REPLACE,
            NativeDiscordDownloadWorker.deferredImportFollowupPolicy());
    }

    @Test public void completionNoticeReportsActualImportFallbackInsteadOfHidingItsCause() throws Exception {
        JSONObject parsed = new JSONObject().put("state", "parsed");
        assertTrue(NativeDiscordDownloadWorker.completionText(parsed,
            new JSONObject().put("state", "native_database_unavailable").put("message", "原生资源库索引尚未就绪"))
            .contains("原生资源库索引尚未就绪"));
        assertTrue(NativeDiscordDownloadWorker.completionText(parsed,
            new JSONObject().put("state", "deferred").put("message", "SQLite 写入失败"))
            .contains("SQLite 写入失败"));
        assertTrue(NativeDiscordDownloadWorker.completionText(parsed,
            new JSONObject().put("state", "vault_requires_foreground").put("message", "本地加密库需要在前台解锁后导入"))
            .contains("本地加密库需要在前台解锁后导入"));
        assertEquals("角色卡已在后台解析并导入资源库。", NativeDiscordDownloadWorker.completionText(parsed,
            new JSONObject().put("state", "imported")));
        assertTrue(NativeDiscordDownloadWorker.completionText(parsed,
            new JSONObject().put("state", "imported").put("autoBoundSourceId", "post-1")
                .put("autoBoundSourceTitle", "帖子 A").put("autoBoundResourceName", "角色卡 B"))
            .contains("帖子“帖子 A”已绑定角色卡“角色卡 B”"));
        assertTrue(NativeDiscordDownloadWorker.completionText(parsed,
            new JSONObject().put("state", "waiting_version")).contains("选择如何处理"));
        assertTrue(NativeDiscordDownloadWorker.completionText(
            new JSONObject().put("state", "parse_failed").put("message", "角色卡字段无效"),
            new JSONObject().put("state", "parse_failed").put("message", "角色卡字段无效"))
            .contains("后台解析未完成：角色卡字段无效；附件已保留"));
        assertTrue(NativeDiscordDownloadWorker.deferredImportWaitText(
            new JSONObject().put("message", "原生资源库索引尚未就绪"))
            .contains("原生资源库索引尚未就绪；下载文件已保留"));
        assertTrue(NativeDiscordDownloadWorker.deferredImportWaitText(new JSONObject())
            .contains("SRL 就绪后会自动继续导入"));
    }

    @Test public void cancellationSurvivesRestartAndKeepsTheSignedLinkAndResumeCheckpoint() throws Exception {
        JSONObject saved = checkpoint();
        String url = saved.getString("discordUrl");
        assertTrue(NativeDiscordDownloadWorker.markCancelled(saved, TOKEN, WORK));
        JSONObject restarted = new JSONObject(saved.toString());
        assertTrue(restarted.getBoolean("downloadCancelled"));
        assertTrue(restarted.has("error"));
        assertFalse(NativeDiscordDownloadWorker.canCheckpoint(restarted, WORK));
        assertEquals(url, restarted.getString("discordUrl"));
        assertEquals(8000, restarted.getLong("downloadSize"));
        assertEquals("\"version1\"", restarted.getString("downloadValidator"));
        assertFalse(NativeDiscordDownloadWorker.markCancelled(restarted, TOKEN, WORK));
    }

    @Test public void staleAndMismatchedNotificationsCannotCancelAnotherShareOrTheNextAttempt() throws Exception {
        JSONObject saved = checkpoint();
        String before = saved.toString();
        assertFalse(NativeDiscordDownloadWorker.markCancelled(saved, OTHER_TOKEN, WORK));
        assertFalse(NativeDiscordDownloadWorker.markCancelled(saved, TOKEN, NEXT));
        assertFalse(NativeDiscordDownloadWorker.markCancelled(saved, "../" + TOKEN, WORK));
        assertFalse(NativeDiscordDownloadWorker.markCancelled(saved, TOKEN, null));
        assertEquals(before, saved.toString());
        NativeDiscordDownloadWorker.prepareScheduled(saved, NEXT);
        assertFalse(NativeDiscordDownloadWorker.markCancelled(saved, TOKEN, WORK));
        assertFalse(NativeDiscordDownloadWorker.canCheckpoint(saved, WORK));
        assertTrue(NativeDiscordDownloadWorker.canCheckpoint(saved, NEXT));
    }

    @Test public void repeatedRetryCannotReplaceTheAlreadyQueuedAttempt() throws Exception {
        JSONObject saved = checkpoint().put("error", "network failure").put("downloadFailures", 4);
        assertTrue(NativeDiscordDownloadWorker.matchesAction(saved, TOKEN, WORK));
        assertFalse(NativeDiscordDownloadWorker.blocksNewSchedule(saved, WORK));
        assertTrue(NativeDiscordDownloadWorker.blocksNewSchedule(saved, NEXT));
        NativeDiscordDownloadWorker.prepareScheduled(saved, NEXT);
        assertFalse(NativeDiscordDownloadWorker.matchesAction(saved, TOKEN, WORK));
        assertTrue(NativeDiscordDownloadWorker.blocksNewSchedule(saved, NEXT));
        assertFalse(saved.has("error"));
        assertFalse(saved.has("downloadFailures"));
    }

    @Test public void retryRetainsCdnDelayAndCompletedBytesInsteadOfRestartingTheAttachment() throws Exception {
        JSONObject saved = checkpoint().put("downloadComplete", true);
        NativeDiscordDownloadWorker.markCancelled(saved, TOKEN, WORK);
        NativeDiscordDownloadWorker.prepareScheduled(saved, NEXT);
        assertFalse(saved.has("downloadCancelled"));
        assertFalse(saved.has("error"));
        assertEquals(123456, saved.getLong("downloadNotBefore"));
        assertEquals(8000, saved.getLong("downloadSize"));
        assertEquals("\"version1\"", saved.getString("downloadValidator"));
        assertTrue(saved.getBoolean("downloadComplete"));
        assertTrue(NativeDiscordDownloadWorker.canCheckpoint(saved, NEXT));
    }

    @Test public void replacementCannotTouchPartialBytesUntilTheCancelledIoReallyExits() throws Exception {
        File partial = temporary.newFile("attachment.part");
        ExecutorService executor = Executors.newFixedThreadPool(3);
        CountDownLatch writing = new CountDownLatch(1), interrupted = new CountDownLatch(1);
        CountDownLatch releaseOldIo = new CountDownLatch(1), unrelatedRan = new CountDownLatch(1);
        try {
            Future<?> previous = executor.submit(() -> {
                try {
                    NativeDiscordDownloadWorker.runTransfer(TOKEN, () -> {
                        Files.write(partial.toPath(), "prefix".getBytes(StandardCharsets.UTF_8));
                        writing.countDown();
                        try { releaseOldIo.await(); }
                        catch (InterruptedException stopping) {
                            // Model a socket/file stream still closing after Future.cancel(true) returns.
                            interrupted.countDown();
                            releaseOldIo.await();
                        }
                        Files.write(partial.toPath(), "closed-prefix".getBytes(StandardCharsets.UTF_8));
                    });
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            assertTrue(writing.await(5, TimeUnit.SECONDS));
            previous.cancel(true);
            assertTrue(previous.isDone());
            assertTrue(interrupted.await(5, TimeUnit.SECONDS));
            Future<String> replacement = executor.submit(() -> {
                String[] received = new String[1];
                NativeDiscordDownloadWorker.runTransfer(TOKEN, () -> {
                    received[0] = read(partial);
                    Files.write(partial.toPath(), (received[0] + "-resumed").getBytes(StandardCharsets.UTF_8));
                });
                return received[0];
            });
            Future<?> unrelated = executor.submit(() -> {
                try { NativeDiscordDownloadWorker.runTransfer(OTHER_TOKEN, unrelatedRan::countDown); }
                catch (Exception error) { throw new RuntimeException(error); }
            });
            assertTrue(unrelatedRan.await(5, TimeUnit.SECONDS));
            unrelated.get(5, TimeUnit.SECONDS);
            assertFalse(replacement.isDone());
            assertEquals("prefix", read(partial));
            releaseOldIo.countDown();
            assertEquals("closed-prefix", replacement.get(5, TimeUnit.SECONDS));
            assertEquals("closed-prefix-resumed", read(partial));
            NativeDiscordDownloadWorker.runTransfer(TOKEN, () -> assertEquals("closed-prefix-resumed", read(partial)));
        } finally { releaseOldIo.countDown(); executor.shutdownNow(); }
    }
}
