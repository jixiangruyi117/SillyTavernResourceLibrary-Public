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
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NativeDiscordDownloadNotificationTest {
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
            new JSONObject().put("state", "waiting_version")).contains("选择如何处理"));
        assertTrue(NativeDiscordDownloadWorker.completionText(
            new JSONObject().put("state", "parse_failed").put("message", "角色卡字段无效"),
            new JSONObject().put("state", "parse_failed").put("message", "角色卡字段无效"))
            .contains("后台解析未完成：角色卡字段无效；附件已保留"));
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
