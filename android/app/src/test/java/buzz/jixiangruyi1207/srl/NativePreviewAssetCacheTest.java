package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.io.RandomAccessFile;
import java.security.MessageDigest;
import java.util.concurrent.TimeUnit;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;

public class NativePreviewAssetCacheTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test public void cacheKeepsRedirectBaseMimeAndActualCorsPolicy() throws Exception {
        File file = temporary.newFile("stylesheet.bin");
        Files.write(file.toPath(), "body{background:url('./cover.png')}".getBytes(StandardCharsets.UTF_8));
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "https://public.example");
        headers.put("Cross-Origin-Resource-Policy", "cross-origin");
        NativePreviewAssetPlugin.writeCacheMetadata(new NativePreviewAssetPlugin.DownloadedAsset(
            file, "https://cdn.example/themes/actual.css", "text/css; charset=utf-8", headers, false));
        NativePreviewAssetPlugin.DownloadedAsset cached = NativePreviewAssetPlugin.readCachedAsset(file, "https://public.example/theme");
        assertTrue(cached.cached);
        assertEquals("text/css; charset=utf-8", cached.contentType);
        assertEquals("https://cdn.example/themes/cover.png", java.net.URI.create(cached.resolvedUrl).resolve("./cover.png").toString());
        assertEquals(headers, cached.headers);
        assertFalse(cached.headers.containsKey("Cookie"));
        assertFalse(cached.headers.containsKey("Authorization"));
    }

    @Test public void damagedMetadataIsReportedInsteadOfInventingAnAssetAddress() throws Exception {
        File file = temporary.newFile("asset.bin");
        Files.write(new File(file.getPath() + ".meta").toPath(), "broken".getBytes(StandardCharsets.UTF_8));
        try {
            NativePreviewAssetPlugin.readCachedAsset(file, "https://cdn.example/a");
            fail("Expected invalid metadata rejection");
        } catch (IOException expected) {
            assertEquals("素材缓存元数据无效", expected.getMessage());
        }
    }

    @Test public void interceptedPublicResponseCannotAddCorsOrReplayCookies() {
        Response response = new Response.Builder().request(new Request.Builder().url("https://cdn.example/a.png").build())
            .protocol(Protocol.HTTP_1_1).code(200).message("OK")
            .header("Set-Cookie", "private=value").header("Authorization", "private")
            .header("Cross-Origin-Resource-Policy", "same-origin").build();
        Map<String, String> headers = NativePreviewAssetPlugin.publicResponseHeaders(response);
        assertFalse(headers.containsKey("Access-Control-Allow-Origin"));
        assertFalse(headers.containsKey("Set-Cookie"));
        assertFalse(headers.containsKey("Authorization"));
        assertEquals("same-origin", headers.get("Cross-Origin-Resource-Policy"));
    }

    @Test public void legacyBytesWithoutResponsePolicyAreNotServedAsAuthorizedCache() throws Exception {
        File file = temporary.newFile("legacy.png");
        try {
            NativePreviewAssetPlugin.readCachedAsset(file, "https://cdn.example/a.png");
            fail("Legacy cache must refresh response metadata first");
        } catch (IOException expected) { assertEquals("素材缓存缺少响应元数据", expected.getMessage()); }
    }

    @Test public void expiredAndMissingFilesRemoveTheirMetadataWithoutASecondDirectoryScan() throws Exception {
        File root = temporary.newFolder("cache");
        File expired = cached(root, "https://cdn.example/expired.png", 1, System.currentTimeMillis() - TimeUnit.HOURS.toMillis(7));
        File fresh = cached(root, "https://cdn.example/fresh.png", 1, System.currentTimeMillis());
        NativePreviewAssetPlugin plugin = new NativePreviewAssetPlugin();
        plugin.indexCache(root);
        assertFalse(expired.exists());
        assertFalse(new File(expired.getPath() + ".meta").exists());
        assertEquals(fresh, plugin.findFreshCache("https://cdn.example/fresh.png"));
        assertTrue(fresh.delete());
        assertNull(plugin.findFreshCache("https://cdn.example/fresh.png"));
        assertFalse(new File(fresh.getPath() + ".meta").exists());
    }

    @Test public void totalBudgetIncludesMetadataAndEvictsOldestEntry() throws Exception {
        File root = temporary.newFolder("budget");
        // Bodies alone fit exactly; response metadata must still be counted.
        long now = System.currentTimeMillis();
        File oldest = cached(root, "https://cdn.example/old.png", 8L * 1024L * 1024L, now - 1000);
        for (int index = 1; index < 7; index++) cached(root, "https://cdn.example/" + index + ".png", 8L * 1024L * 1024L, now - 1000 + index);
        File newest = cached(root, "https://cdn.example/new.png", 8L * 1024L * 1024L, now);
        NativePreviewAssetPlugin plugin = new NativePreviewAssetPlugin();
        plugin.indexCache(root);
        assertFalse(oldest.exists());
        assertFalse(new File(oldest.getPath() + ".meta").exists());
        assertTrue(newest.exists());
    }

    private static File cached(File root, String url, long size, long modified) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(url.getBytes(StandardCharsets.UTF_8));
        StringBuilder key = new StringBuilder();
        for (byte value : hash) key.append(String.format("%02x", value & 0xff));
        File file = new File(root, key + ".png");
        try (RandomAccessFile output = new RandomAccessFile(file, "rw")) { output.setLength(size); }
        NativePreviewAssetPlugin.writeCacheMetadata(new NativePreviewAssetPlugin.DownloadedAsset(
            file, url, "image/png", java.util.Collections.emptyMap(), false));
        assertTrue(file.setLastModified(modified));
        return file;
    }
}
