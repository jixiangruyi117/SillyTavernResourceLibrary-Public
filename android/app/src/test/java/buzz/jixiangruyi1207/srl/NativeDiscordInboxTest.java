package buzz.jixiangruyi1207.srl;
import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;
public class NativeDiscordInboxTest {
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
