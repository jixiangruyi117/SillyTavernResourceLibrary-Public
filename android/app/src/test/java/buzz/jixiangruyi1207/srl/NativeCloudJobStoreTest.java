package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;

import java.io.File;
import java.util.List;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NativeCloudJobStoreTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    private JSONObject job(int expected) throws Exception {
        JSONObject job = new JSONObject();
        job.put("version", 3);
        job.put("objectCount", 0);
        job.put("totalBytes", 0L);
        job.put("completed", 0);
        job.put("expectedTotal", expected);
        job.put("manifestStaged", false);
        return job;
    }

    private JSONObject entry(int index, boolean manifest) throws Exception {
        JSONObject entry = new JSONObject();
        entry.put("token", "token-" + index);
        entry.put("name", manifest ? "snapshot.json.gz" : "object-" + index + ".bin");
        entry.put("size", 128);
        entry.put("manifest", manifest);
        entry.put("uploaded", false);
        return entry;
    }

    @Test public void thousandsOfEntriesKeepTheJobHeaderSmallAndReadableByPages() throws Exception {
        File root = temporary.newFolder();
        int count = 2_501;
        JSONObject header = job(count);

        for (int index = 0; index < count; index++) {
            NativeCloudJobStore.append(root, header, entry(index, index == count - 1));
        }

        assertEquals(count, NativeCloudJobStore.objectCount(header));
        assertEquals(128L * count, header.getLong("totalBytes"));
        assertTrue("job header must not contain the object list", header.toString().length() < 1_024);
        assertEquals(count, NativeCloudJobStore.readAll(root, header).size());
        List<JSONObject> page = NativeCloudJobStore.readRange(root, header, 128, 64);
        assertEquals(64, page.size());
        assertEquals(128, page.get(0).getInt("stagingIndex"));
        assertEquals("token-128", page.get(0).getString("token"));

        NativeCloudJobStore.validate(root, header, count);
        JSONObject uploaded = NativeCloudJobStore.readRange(root, header, 0, 1).get(0);
        assertTrue(NativeCloudJobStore.markUploaded(root, header, uploaded, "asset-0"));
        assertFalse(NativeCloudJobStore.markUploaded(root, header, uploaded, "asset-0"));
        assertEquals(1, header.getInt("completed"));
        JSONObject persisted = NativeCloudJobStore.readRange(root, header, 0, 1).get(0);
        assertTrue(persisted.getBoolean("uploaded"));
        assertEquals("asset-0", persisted.getString("resultId"));
    }

    @Test public void duplicateNamesAndSecondManifestAreRejected() throws Exception {
        File root = temporary.newFolder();
        JSONObject header = job(3);
        NativeCloudJobStore.append(root, header, entry(0, false));

        try {
            NativeCloudJobStore.append(root, header, entry(0, false));
            fail("duplicate object names must be rejected");
        } catch (IllegalStateException expected) {
            assertTrue(expected.getMessage().contains("重复"));
        }

        NativeCloudJobStore.append(root, header, entry(1, true));
        try {
            JSONObject secondManifest = entry(2, true);
            secondManifest.put("name", "another-snapshot.json.gz");
            NativeCloudJobStore.append(root, header, secondManifest);
            fail("a job must have exactly one manifest");
        } catch (IllegalStateException expected) {
            assertTrue(expected.getMessage().contains("最终清单"));
        }
        assertEquals(2, NativeCloudJobStore.objectCount(header));
        NativeCloudJobStore.validate(root, header, 2);
    }

    @Test public void retryAfterHeaderCommitCrashRecoversTheAlreadyWrittenObject() throws Exception {
        File root = temporary.newFolder();
        JSONObject header = job(2);
        JSONObject first = entry(0, false);
        NativeCloudJobStore.append(root, header, first);

        // Simulate a process stop after the object and name marker reached disk,
        // but before job.json persisted the new count.
        header.put("objectCount", 0);
        header.put("totalBytes", 0L);
        header.put("manifestStaged", false);
        NativeCloudJobStore.append(root, header, first);

        assertEquals(1, NativeCloudJobStore.objectCount(header));
        assertEquals(128L, header.getLong("totalBytes"));
        NativeCloudJobStore.append(root, header, entry(1, true));
        assertEquals(2, NativeCloudJobStore.objectCount(header));
        NativeCloudJobStore.validate(root, header, 2);
    }

    @Test public void legacyJobsStillReadTheirInlineObjectArray() throws Exception {
        File root = temporary.newFolder();
        JSONObject header = new JSONObject();
        header.put("version", 2);
        header.put("objects", new org.json.JSONArray().put(entry(0, false)).put(entry(1, true)));

        assertEquals(2, NativeCloudJobStore.objectCount(header));
        assertEquals(2, NativeCloudJobStore.readRange(root, header, 0, 64).size());
    }

    @Test public void primaryRenameCrashReadsCommittedBackupAndCanFinishUpload() throws Exception {
        File root = temporary.newFolder();
        JSONObject header = job(1);
        NativeCloudJobStore.append(root, header, entry(0, true));
        File primary = new File(root, "objects/00000000.json");
        File backup = new File(root, "objects/00000000.json.bak");
        assertTrue(primary.renameTo(backup));
        JSONObject recovered = NativeCloudJobStore.readRange(root, header, 0, 1).get(0);
        assertEquals("token-0", recovered.getString("token"));
        NativeCloudJobStore.validate(root, header, 1);
        assertTrue(NativeCloudJobStore.markUploaded(root, header, recovered, "asset-0"));
        assertTrue(primary.isFile());
        assertFalse(backup.exists());
        assertTrue(NativeCloudJobStore.readRange(root, header, 0, 1).get(0).getBoolean("uploaded"));
    }

    @Test public void resumeReconcilesObjectSuccessBeforeHeaderCommitWithoutUploadingAgain() throws Exception {
        File root = temporary.newFolder();
        JSONObject header = job(1);
        NativeCloudJobStore.append(root, header, entry(0, true));
        JSONObject object = NativeCloudJobStore.readRange(root, header, 0, 1).get(0);
        assertTrue(NativeCloudJobStore.markUploaded(root, header, object, "asset-0"));
        header.put("completed", 0); // Crash before job.json persisted its increment.
        NativeCloudJobStore.reconcileCompleted(root, header);
        assertEquals(1, header.getInt("completed"));
        assertFalse(NativeCloudJobStore.markUploaded(root, header, object, "asset-0"));
        assertEquals(1, header.getInt("completed"));
    }
}
