package buzz.jixiangruyi1207.srl;

import java.io.File;
import java.nio.file.Files;
import java.util.*;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class ShareReceiverIntakeFilesTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private static final Set<String> NONE = Collections.emptySet();
    private File write(File folder, String name, String content) throws Exception {
        File file = new File(folder, name); Files.write(file.toPath(), content.getBytes(java.nio.charset.StandardCharsets.UTF_8)); return file;
    }
    private ShareReceiverIntakeFiles.Entry first(File folder) throws Exception {
        return ShareReceiverIntakeFiles.list(folder, NONE, NONE, false).get(0);
    }
    @Test public void inventoriesCompanionsWithoutDeletingEvenOldOrFailedFiles() throws Exception {
        File folder = temporary.newFolder();
        File payload = write(folder, "share-0", "incoming data"); payload.setLastModified(1);
        write(folder, "share-0.json", new JSONObject().put("name", "角色.json").put("error", "failed").toString());
        write(folder, "share-0.json.bak", "backup"); write(folder, "share-0.character-card.json", "{}");
        ShareReceiverIntakeFiles.Entry entry = first(folder);
        assertEquals("角色.json", entry.name); assertEquals(4, entry.files.size());
        assertEquals("失败或已取消的暂存", entry.state); assertTrue(payload.isFile());
        assertTrue(new File(folder, "share-0.json.bak").isFile());
    }
    @Test public void removesOnlyConfirmedGroupAndAllItsPartialsAndReceipts() throws Exception {
        File folder = temporary.newFolder(); File outside = temporary.newFile();
        String token = "discord-url-c579c927-54cc-40e0-a3d2-b5f74a60b4ef";
        for (String suffix : new String[]{".json", ".done", "-0", "-0.json", "-0.part", "-0.character-card.json", "-0.json.new"}) write(folder, token + suffix, "{}");
        write(folder, "unrelated-0", "keep");
        ShareReceiverIntakeFiles.Entry entry = ShareReceiverIntakeFiles.list(folder, NONE, NONE, false).stream().filter(item -> item.token.equals(token)).findFirst().get();
        assertEquals(7, entry.files.size());
        assertEquals(entry.bytes, ShareReceiverIntakeFiles.remove(folder, token, entry.snapshot, NONE, NONE, false));
        assertTrue(outside.isFile()); assertTrue(new File(folder, "unrelated-0").isFile());
        assertEquals(1, folder.listFiles().length);
    }
    @Test public void rechecksChangedFilesAndNewOwnershipAtDeletion() throws Exception {
        File folder = temporary.newFolder(); File payload = write(folder, "share-0", "data");
        ShareReceiverIntakeFiles.Entry entry = first(folder);
        for (int mode = 0; mode < 3; mode++) {
            try {
                ShareReceiverIntakeFiles.remove(folder, entry.token, entry.snapshot,
                    mode == 0 ? Set.of(entry.token) : NONE, mode == 1 ? Set.of(payload.getCanonicalPath()) : NONE, mode == 2);
                fail("must reject ownership");
            } catch (java.io.IOException expected) { assertTrue(payload.isFile()); }
        }
        write(folder, "share-0", "updated payload");
        try { ShareReceiverIntakeFiles.remove(folder, entry.token, entry.snapshot, NONE, NONE, false); fail("must reject stale selection"); }
        catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("变化")); }
    }
    @Test public void blocksTraversalDirectoriesAndRecoveryReferences() throws Exception {
        File folder = temporary.newFolder(); write(folder, "safe", "data"); new File(folder, "directory").mkdir();
        ShareReceiverIntakeFiles.Entry directory = ShareReceiverIntakeFiles.list(folder, NONE, NONE, false).stream().filter(item -> item.token.equals("directory")).findFirst().get();
        assertFalse(directory.protectedReason.isEmpty());
        for (String token : new String[]{"../safe", "directory", "safe/../safe"}) {
            try { ShareReceiverIntakeFiles.remove(folder, token, directory.snapshot, NONE, NONE, false); fail("must reject"); }
            catch (java.io.IOException expected) { assertTrue(new File(folder, "safe").isFile()); }
        }
    }
    @Test public void metadataChangeAndPendingAutoBindingRemainProtected() throws Exception {
        File folder = temporary.newFolder(); write(folder, "share", "data");
        write(folder, "share.json", "{\"name\":\"A\"}");
        ShareReceiverIntakeFiles.Entry entry = first(folder);
        File metadata = new File(folder, "share.json"); long modified = metadata.lastModified();
        write(folder, "share.json", "{\"name\":\"B\"}"); metadata.setLastModified(modified);
        try { ShareReceiverIntakeFiles.remove(folder, entry.token, entry.snapshot, NONE, NONE, false); fail("must hash metadata"); }
        catch (java.io.IOException expected) { assertTrue(new File(folder, "share").isFile()); }
        write(folder, "share.json", "{\"cloudAutoBindingPending\":true}");
        assertTrue(first(folder).protectedReason.contains("关联"));
    }
    @Test public void inventoryScalesWithDirectoryEntriesWithoutLoadingPayloads() throws Exception {
        File folder = temporary.newFolder(); int written = 0;
        for (int size : new int[]{1000, 5000, 10000}) {
            for (; written < size; written++) write(folder, "staged-" + written, "data");
            long started = System.nanoTime();
            List<ShareReceiverIntakeFiles.Entry> entries = ShareReceiverIntakeFiles.list(folder, NONE, NONE, false);
            assertEquals(size, entries.size());
            assertEquals(size * 4L, entries.stream().mapToLong(entry -> entry.bytes).sum());
            System.out.println("Intake directory fixture " + size + " entries: " + ((System.nanoTime() - started) / 1000000) + " ms; payload reads 0 by bounded sidecar-only reader");
        }
    }
    @Test public void receiptCleanupInspectsSelectedFilesWithoutRescanningDirectory() throws Exception {
        File folder = temporary.newFolder();
        File receipt = write(folder, "receipt.done", "1791456000000");
        write(folder, "attachment", "keep");
        ShareReceiverIntakeFiles.Entry entry = ShareReceiverIntakeFiles.list(folder, NONE, NONE, false).stream().filter(item -> item.token.equals("receipt")).findFirst().get();
        assertTrue(entry.receiptOnly);
        assertEquals("已处理回执（防止重复接收）", entry.state);
        File noScan = new File(folder.getPath()) { @Override public File[] listFiles() { throw new AssertionError("must not rescan directory"); } };
        assertEquals(13, ShareReceiverIntakeFiles.removeReceipt(noScan, entry.token, entry.snapshot, NONE, NONE, false));
        assertFalse(receipt.exists()); assertTrue(new File(folder, "attachment").exists());
    }
    @Test public void receiptCleanupRetainsNewCompanionsActiveAndChangedReceipts() throws Exception {
        File folder = temporary.newFolder(); String token = "discord-url-c579c927-54cc-40e0-a3d2-b5f74a60b4ef";
        File receipt = write(folder, token + ".done", "1791456000000");
        ShareReceiverIntakeFiles.Entry entry = first(folder);
        for (int mode = 0; mode < 5; mode++) {
            File companion = null;
            if (mode == 3) companion = write(folder, token + "-0.json", "{\"cloudAutoBindingPending\":true}");
            if (mode == 4) write(folder, token + ".done", "changed");
            try {
                ShareReceiverIntakeFiles.removeReceipt(folder, token, entry.snapshot,
                    mode == 0 ? Set.of(token + "-0") : NONE, mode == 1 ? Set.of(receipt.getCanonicalPath()) : NONE, mode == 2);
                fail("must preserve changed or owned receipt");
            } catch (java.io.IOException expected) { assertTrue(receipt.exists()); }
            if (companion != null) assertTrue(companion.delete());
        }
        for (String invalid : new String[]{"../receipt", "safe/../receipt"}) {
            try { ShareReceiverIntakeFiles.removeReceipt(folder, invalid, entry.snapshot, NONE, NONE, false); fail("must reject traversal"); }
            catch (java.io.IOException expected) { assertTrue(receipt.exists()); }
        }
    }
}
