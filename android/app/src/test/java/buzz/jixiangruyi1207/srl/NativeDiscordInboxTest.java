package buzz.jixiangruyi1207.srl;
import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;
public class NativeDiscordInboxTest {
    @Test public void stoppedPostMediaNeverOpensTheDatabaseOrCommitsALateResult() {
        assertThrows(java.io.InterruptedIOException.class, () -> NativeBackgroundResourceImporter.savePostAttachment(
            null, "message", null, null, "image/png", () -> true));
    }
    @Test public void postAttachmentPhaseDoesNotDiscardItsCloudDeliveryOrRequireSavingTheBodyAgain() throws Exception {
        JSONObject settings = new JSONObject().put("downloadPostMedia", true);
        JSONObject attachment = new JSONObject().put("id", "image").put("url", "https://cdn.discordapp.com/attachments/a/b/image.png");
        JSONObject message = new JSONObject().put("attachments", new org.json.JSONArray().put(attachment));
        assertTrue(NativeBackgroundResourceImporter.postAttachmentsNeedDownload(message, settings));
        JSONObject saved = new JSONObject().put("state", "saved").put("notificationPosted", true).put("attachmentDownloadPending", true);
        assertFalse(NativeDiscordInboxService.postReadyForAcknowledgement(saved));
        attachment.put("localAssetId", "saved-image");
        assertFalse(NativeBackgroundResourceImporter.postAttachmentsNeedDownload(message, settings));
        saved.put("attachmentDownloadPending", false);
        assertTrue(NativeDiscordInboxService.postReadyForAcknowledgement(saved));
        attachment.remove("localAssetId");
        assertFalse(NativeBackgroundResourceImporter.postAttachmentsNeedDownload(message, new JSONObject()));
        attachment.put("size", 8 * 1024 * 1024 + 1);
        assertFalse(NativeBackgroundResourceImporter.postAttachmentsNeedDownload(message, settings));
        assertFalse(NativeBackgroundResourceImporter.postAttachmentsNeedDownload(new JSONObject(), settings));
        assertFalse(NativeDiscordInboxService.postReadyForAcknowledgement(saved.put("state", "foreground_required")));
    }
    @Test public void cancelledBindingCheckNeverOpensTheDatabaseOrStartsAnotherBatch() throws Exception {
        NativeDiscordInboxService.reconcilePendingAutoBindings(null, () -> true);
    }
    @Test public void everyTerminalResourceOutcomeRoutesToASpecificForegroundActionOrSuccess() throws Exception {
        for (String state : new String[]{"imported", "waiting_version"})
            assertEquals(state, NativeDiscordInboxService.resourceNotificationState(new JSONObject().put("state", state)));
        for (String state : new String[]{"duplicate_file", "duplicate_card"})
            assertEquals("duplicate", NativeDiscordInboxService.resourceNotificationState(new JSONObject().put("state", state)));
        for (String state : new String[]{"failed", "parse_failed"})
            assertEquals("failed", NativeDiscordInboxService.resourceNotificationState(new JSONObject().put("state", state)));
        for (String state : new String[]{"foreground_required", "vault_requires_foreground", "native_database_unavailable", "deferred"})
            assertEquals("foreground_required", NativeDiscordInboxService.resourceNotificationState(new JSONObject().put("state", state)));
        JSONObject posted = new JSONObject().put("nativeResultNotificationState", "waiting_version");
        assertTrue(NativeDiscordInboxService.resourceResultNotificationPosted(posted, "waiting_version"));
        assertFalse(NativeDiscordInboxService.resourceResultNotificationPosted(posted, "imported"));
    }
    @Test public void foregroundReceiptDoesNotReplayAlreadyPostedNativeResults() throws Exception {
        JSONObject metadata = new JSONObject().put("nativeImportOutcome", new JSONObject().put("state", "imported"));
        assertFalse(NativeDiscordInboxService.resourceResultNotificationPosted(metadata, "imported"));
        metadata.put("nativeResultNotificationState", "imported");
        assertTrue(NativeDiscordInboxService.resourceResultNotificationPosted(metadata, "imported"));
        assertFalse(NativeDiscordInboxService.resourceResultNotificationPosted(metadata, "failed"));
        metadata.remove("nativeResultNotificationState");
        metadata.put("nativeCompletionNotificationPosted", true);
        assertTrue(NativeDiscordInboxService.resourceResultNotificationPosted(metadata, "imported"));
        for (String state : new String[]{"duplicate_file", "duplicate_card"}) {
            metadata.put("nativeImportOutcome", new JSONObject().put("state", state));
            assertTrue(NativeDiscordInboxService.resourceResultNotificationPosted(metadata, "duplicate"));
            assertFalse(NativeDiscordInboxService.resourceResultNotificationPosted(metadata, "imported"));
        }
    }
    @Test public void downloadReceiptWaitsForNativeParsingBeforeTheWebViewClaimsIt() throws Exception {
        JSONObject metadata = new JSONObject();
        assertFalse(ShareReceiverPlugin.cloudResourceReadyForForeground(metadata, true));
        metadata.put("nativeBackgroundImportFinished", false)
            .put("nativeImportOutcome", new JSONObject().put("state", "native_database_unavailable"));
        assertFalse(ShareReceiverPlugin.cloudResourceReadyForForeground(metadata, true));
        metadata.put("nativeBackgroundImportFinished", true);
        assertTrue(ShareReceiverPlugin.cloudResourceReadyForForeground(metadata, true));
        metadata.remove("nativeBackgroundImportFinished");
        assertTrue(ShareReceiverPlugin.cloudResourceReadyForForeground(metadata, false));
    }
    @Test public void committedReceiptsSettleOnlyOnSuccessOrExactTerminalTaskResponses() throws Exception {
        JSONObject expired = new JSONObject().put("error", "resource_task_not_found_or_expired");
        assertTrue(NativeDiscordInboxService.resourceReceiptSettled(200, "imported", new JSONObject()));
        assertTrue(NativeDiscordInboxService.resourceReceiptSettled(404, "imported", expired));
        assertFalse(NativeDiscordInboxService.resourceReceiptSettled(404, "waiting_version", expired));
        for (int status : new int[]{401, 403, 409, 429, 500, 503})
            assertFalse(NativeDiscordInboxService.resourceReceiptSettled(status, "imported", expired));
        assertFalse(NativeDiscordInboxService.resourceReceiptSettled(404, "imported", new JSONObject()));
        assertFalse(NativeDiscordInboxService.resourceReceiptSettled(404, "imported",
            new JSONObject().put("error", "delivery_not_found_or_expired")));
        JSONObject imported = new JSONObject().put("error", "resource_already_imported").put("state", "imported");
        assertTrue(NativeDiscordInboxService.resourceReceiptSettled(409, "imported", imported));
        assertFalse(NativeDiscordInboxService.resourceReceiptSettled(409, "imported", imported.put("state", "queued")));
    }
    @Test public void separateBindingsKeepTheirNotificationsAndRepeatReportsUpdateTheSameBinding() throws Exception {
        JSONObject first = new JSONObject().put("sourceId", "post-a").put("resourceId", "card-a")
            .put("sourceTitle", "相同标题").put("resourceName", "同名角色");
        JSONObject second = new JSONObject(first.toString()).put("sourceId", "post-b");
        String firstTag = NativeDiscordInboxService.autoBindingNotificationTag(first);
        assertNotEquals(firstTag, NativeDiscordInboxService.autoBindingNotificationTag(second));
        first.put("sourceTitle", "修改后的标题").put("resourceName", "改名角色");
        assertEquals(firstTag, NativeDiscordInboxService.autoBindingNotificationTag(first));
        assertNotEquals(firstTag, NativeDiscordInboxService.autoBindingNotificationTag(
            new JSONObject(first.toString()).put("resourceId", "card-b")));
        JSONObject legacy = new JSONObject().put("sourceTitle", "旧网页帖子 A").put("resourceName", "角色 A");
        assertNotEquals(NativeDiscordInboxService.autoBindingNotificationTag(legacy),
            NativeDiscordInboxService.autoBindingNotificationTag(new JSONObject(legacy.toString()).put("sourceTitle", "旧网页帖子 B")));
    }
    @Test public void rejectsCredentialsInUrlsAndInvalidPairing() throws Exception {
        NativeDiscordInboxService.validateTarget("https://worker.example", "library-1", "S".repeat(40));
        for (String url : new String[]{"http://worker.example", "https://secret@worker.example", "https://worker.example?secret=abc", "https://worker.example#secret", "https://worker.example:443"})
            assertThrows(IllegalArgumentException.class, () -> NativeDiscordInboxService.validateTarget(url, "library-1", "S".repeat(40)));
        assertThrows(IllegalArgumentException.class, () -> NativeDiscordInboxService.validateTarget("https://worker.example", "other", "S".repeat(40)));
    }
    @Test public void onlyDownloadsUnfinishedTasksInTheOriginalLibrary() throws Exception {
        JSONObject job = new JSONObject().put("id", "11111111-1111-4111-a111-111111111111").put("libraryId", "library-1").put("state", "queued");
        assertTrue(NativeDiscordInboxService.downloadable(job, "library-1"));
        assertFalse(NativeDiscordInboxService.downloadable(job, "library-2"));
        for (String state : new String[]{"waiting_version", "imported", "failed", "cancelled", "unknown"}) {
            job.put("state", state); assertFalse(NativeDiscordInboxService.downloadable(job, "library-1"));
        }
        job.put("state", "queued").put("id", "../another-file");
        assertFalse(NativeDiscordInboxService.downloadable(job, "library-1"));
    }
}
