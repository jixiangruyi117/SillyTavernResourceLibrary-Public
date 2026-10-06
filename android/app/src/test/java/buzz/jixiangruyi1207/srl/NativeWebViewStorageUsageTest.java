package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NativeWebViewStorageUsageTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    private File write(File root, String path, int size) throws Exception {
        File file = new File(root, path);
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), new byte[size]);
        return file;
    }

    @Test public void classifiesProfilesWithoutCountingDatabaseBlobsAsTemporary() throws Exception {
        File root = temporary.newFolder("app_webview");
        File original = write(root, "Default/IndexedDB/origin.blob/blob_storage/data", 101);
        write(root, "Default/Local Storage/leveldb/data", 20);
        write(root, "Profile 2/Session Storage/data", 30);
        write(root, "Default/Service Worker/CacheStorage/data", 40);
        write(root, "Default/Cache/data", 50);
        write(root, "Default/Code Cache/js/data", 60);
        write(root, "Default/blob_storage/id/data", 70);
        write(root, "Default/unknown/data", 80);
        NativeWebViewStorageUsage usage = NativeWebViewStorageUsage.measure(root);
        assertEquals(151, usage.siteDataBytes);
        assertEquals(150, usage.cacheBytes);
        assertEquals(70, usage.temporaryBlobBytes);
        assertEquals(80, usage.otherBytes);
        assertEquals(451, usage.totalBytes());
        assertTrue(original.isFile());
        assertEquals(101, original.length());
        assertEquals(451, NativeWebViewStorageUsage.measure(root).totalBytes());
    }

    @Test public void absentWebViewDirectoryIsEmpty() throws Exception {
        assertEquals(0, NativeWebViewStorageUsage.measure(new File(temporary.getRoot(), "missing")).totalBytes());
    }
}
