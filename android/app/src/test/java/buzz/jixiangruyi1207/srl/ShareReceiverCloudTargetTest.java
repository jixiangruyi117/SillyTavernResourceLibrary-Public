package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.assertThrows;
import org.json.JSONObject;
import org.junit.Test;

public class ShareReceiverCloudTargetTest {
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
