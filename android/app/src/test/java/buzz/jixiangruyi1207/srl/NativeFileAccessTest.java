package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NativeFileAccessTest {
    private static File scratchRoot() {
        File workspace = new File(System.getProperty("user.dir")).getAbsoluteFile();
        while (workspace != null && !new File(workspace, "src/storage/InstalledOfficialAppStorage.ts").isFile())
            workspace = workspace.getParentFile();
        if (workspace == null) throw new IllegalStateException("缺少测试工作区");
        File root = new File(workspace, ".codex-tmp/apk-app-ready-20261004/java-files");
        if (!root.isDirectory() && !root.mkdirs()) throw new IllegalStateException("无法创建测试目录");
        return root;
    }
    @Rule public TemporaryFolder temporary = new TemporaryFolder(scratchRoot());

    @Test public void checksExistingFilesAndSeesDeletionOrSizeChanges() throws Exception {
        File data = temporary.newFolder("files");
        File assets = new File(data, "official-apps/assets");
        assertTrue(assets.mkdirs());
        File file = new File(assets, "compiler.wasm");
        Files.write(file.toPath(), new byte[] { 1, 2, 3 });
        assertTrue(NativeFileAccess.hasOfficialAppFiles(data, new String[] { "/assets/compiler.wasm" }, new long[] { 3 }));
        assertFalse(NativeFileAccess.hasOfficialAppFiles(data, new String[] { "/assets/compiler.wasm" }, new long[] { 4 }));
        Files.delete(file.toPath());
        assertFalse(NativeFileAccess.hasOfficialAppFiles(data, new String[] { "/assets/compiler.wasm" }, new long[] { 3 }));
    }
    @Test public void rejectsTraversalAndPrivatePaths() throws Exception {
        File data = temporary.newFolder("files");
        for (String path : new String[] { "/assets/../private.js", "/private.js", "/assets/folder/app.js", "/assets/app..js", "/assets\\app.js" }) {
            assertThrows(IOException.class, () -> NativeFileAccess.hasOfficialAppFiles(data, new String[] { path }, new long[] { 1 }));
        }
    }
    @Test public void rejectsMalformedOrUnboundedLists() throws Exception {
        File data = temporary.newFolder("files");
        assertThrows(IOException.class, () -> NativeFileAccess.hasOfficialAppFiles(data, null, new long[0]));
        assertThrows(IOException.class, () -> NativeFileAccess.hasOfficialAppFiles(data, new String[] { "/assets/app.js" }, new long[0]));
        assertThrows(IOException.class, () -> NativeFileAccess.hasOfficialAppFiles(data, new String[101], new long[101]));
        assertThrows(IOException.class, () -> NativeFileAccess.hasOfficialAppFiles(data, new String[] { "/assets/app.js" }, new long[] { -1 }));
    }
    @Test public void acceptsAnEmptyListWithoutCreatingAssetDirectories() throws Exception {
        File data = temporary.newFolder("files");
        assertTrue(NativeFileAccess.hasOfficialAppFiles(data, new String[0], new long[0]));
        assertFalse(new File(data, "official-apps").exists());
    }
}
