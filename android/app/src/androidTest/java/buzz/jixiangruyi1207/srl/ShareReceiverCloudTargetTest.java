package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ShareReceiverCloudTargetTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private static final String TOKEN = "discord-url-c579c927-54cc-40e0-a3d2-b5f74a60b4ef";

    private File committed() throws Exception {
        File folder = temporary.newFolder();
        String staged = NativeShareImportService.stagedToken(TOKEN, 0);
        Files.write(new File(folder, staged).toPath(), "card".getBytes(StandardCharsets.UTF_8));
        NativeShareImportService.writeMetadata(folder, staged, metadata().put("cleanupToken", staged)
            .put("discordSourceToken", TOKEN).put("size", 4));
        return folder;
    }

    @Test public void resumesCommittedStagingAfterDeathBeforeReceiptWithoutDownloadingAgain() throws Exception {
        File folder = committed();
        assertFalse(new File(folder, TOKEN + ".done").exists());
        assertTrue(ShareReceiverPlugin.recoverCloudReceipt(folder, TOKEN, "library-1", "https://worker.example"));
        assertTrue(new File(folder, TOKEN + ".done").isFile());
        assertTrue(ShareReceiverPlugin.recoverCloudReceipt(folder, TOKEN, "library-1", "https://worker.example"));
        assertEquals(4, new File(folder, NativeShareImportService.stagedToken(TOKEN, 0)).length());
    }

    @Test public void incompletePayloadIsNotPublishedAsDownloaded() throws Exception {
        File folder = committed();
        Files.write(new File(folder, NativeShareImportService.stagedToken(TOKEN, 0)).toPath(), new byte[]{1});
        assertFalse(ShareReceiverPlugin.recoverCloudReceipt(folder, TOKEN, "library-1", "https://worker.example"));
        assertFalse(new File(folder, TOKEN + ".done").exists());
    }

    @Test public void foreignStagingCannotPublishAReceipt() throws Exception {
        File folder = committed();
        assertThrows(IllegalArgumentException.class, () -> ShareReceiverPlugin.recoverCloudReceipt(folder, TOKEN, "library-2", "https://worker.example"));
        assertThrows(IllegalArgumentException.class, () -> ShareReceiverPlugin.recoverCloudReceipt(folder, TOKEN, "library-1", "https://other.example"));
        assertFalse(new File(folder, TOKEN + ".done").exists());
    }

    @Test public void cancelledStagingCannotBeRevived() throws Exception {
        File folder = committed();
        NativeShareImportService.writeMetadata(folder, TOKEN, new JSONObject().put("downloadCancelled", true));
        assertFalse(ShareReceiverPlugin.recoverCloudReceipt(folder, TOKEN, "library-1", "https://worker.example"));
        assertFalse(new File(folder, TOKEN + ".done").exists());
    }

    private JSONObject metadata() throws Exception {
        return new JSONObject().put("cloudLibraryId", "library-1").put("cloudWorkerUrl", "https://worker.example");
    }

    @Test public void acceptsOnlyTheOriginalPairedTarget() throws Exception {
        ShareReceiverPlugin.assertCloudTarget(metadata(), "library-1", "https://worker.example");
    }

    @Test public void rejectsAnotherLibraryBeforeExposingItsNativeFile() throws Exception {
        assertThrows(IllegalArgumentException.class,
            () -> ShareReceiverPlugin.assertCloudTarget(metadata(), "library-2", "https://worker.example"));
    }

    @Test public void rejectsAnotherWorkerEvenIfItUsesTheSameLibraryId() throws Exception {
        assertThrows(IllegalArgumentException.class,
            () -> ShareReceiverPlugin.assertCloudTarget(metadata(), "library-1", "https://other.example"));
    }
}
