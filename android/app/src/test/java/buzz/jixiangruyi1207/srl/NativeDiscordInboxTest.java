package buzz.jixiangruyi1207.srl;
import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;
public class NativeDiscordInboxTest {
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
