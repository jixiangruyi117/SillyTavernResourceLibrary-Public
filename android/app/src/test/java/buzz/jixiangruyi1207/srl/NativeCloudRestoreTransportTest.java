package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import static buzz.jixiangruyi1207.srl.NativeCloudRestoreTransport.*;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NativeCloudRestoreTransportTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private byte[] bytes(String text) { return text.getBytes(StandardCharsets.UTF_8); }
    private String hash(byte[] data) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(data)); }
    private RestoreObject object(byte[] data) throws Exception { return new RestoreObject(hash(data), data.length, "https://example.invalid/object"); }
    private RestoreResource resource(byte[] data, RestoreSegment... segments) throws Exception {
        return new RestoreResource(hash(data), data.length, Arrays.asList(segments));
    }
    private File file(File root, String hash) { return new File(root, hash + ".bin"); }

    @Test public void completeLocalOriginalSkipsAllRemoteChunksEvenWhenTheirCopiesAreMissing() throws Exception {
        File root = temporary.newFolder();
        byte[] first = bytes("first"), second = bytes("second"), full = bytes("firstsecond");
        RestoreObject a = object(first), b = object(second);
        Files.write(file(root, hash(full)).toPath(), full);
        AtomicInteger downloads = new AtomicInteger();
        RestoreCounts result = restoreFiles(new File(root, "pending"), Arrays.asList(a, b),
            Collections.singletonList(resource(full, new RestoreSegment(a.hash, 0, a.size), new RestoreSegment(b.hash, 0, b.size))),
            h -> file(root, h), (o, target) -> { downloads.incrementAndGet(); throw new IOException("offline"); });
        assertEquals(0, downloads.get()); assertEquals(1, result.reused); assertEquals(0, result.assembled);
        assertEquals(1, root.listFiles().length);
        assertArrayEquals(full, Files.readAllBytes(file(root, hash(full)).toPath()));
    }

    @Test public void sameSizeCorruptLocalOriginalIsDownloadedAndReverified() throws Exception {
        File root = temporary.newFolder();
        byte[] expected = bytes("good"), corrupt = bytes("evil");
        RestoreObject object = object(expected);
        Files.write(file(root, object.hash).toPath(), corrupt);
        AtomicInteger downloads = new AtomicInteger();

        RestoreCounts result = restoreFiles(new File(root, "pending"), Collections.singletonList(object),
            Collections.singletonList(resource(expected, new RestoreSegment(object.hash, 0, object.size))),
            h -> file(root, h), (o, target) -> { downloads.incrementAndGet(); Files.write(target.toPath(), expected); });

        assertEquals(1, downloads.get()); assertEquals(1, result.downloaded); assertEquals(1, result.assembled);
        assertArrayEquals(expected, Files.readAllBytes(file(root, object.hash).toPath()));
    }

    @Test public void missingResourceDownloadsOnlyItsSegmentsAndNeverInstallsTransportChunks() throws Exception {
        File root = temporary.newFolder();
        byte[] aData = bytes("part-a"), bData = bytes("part-b"), full = bytes("part-apart-b");
        RestoreObject a = object(aData), b = object(bData), unused = object(bytes("unused"));
        RestoreResource plan = resource(full, new RestoreSegment(a.hash, 0, a.size), new RestoreSegment(b.hash, 0, b.size));
        AtomicInteger downloads = new AtomicInteger();
        ObjectDownloader transport = (o, target) -> {
            downloads.incrementAndGet();
            if (o.hash.equals(unused.hash)) throw new AssertionError("unneeded download");
            Files.write(target.toPath(), o.hash.equals(a.hash) ? aData : bData);
        };
        RestoreCounts result = restoreFiles(new File(root, "pending"), Arrays.asList(a, b, unused),
            Collections.singletonList(plan), h -> file(root, h), transport);
        assertEquals(2, result.downloaded); assertEquals(1, result.assembled);
        assertEquals(1, root.listFiles().length);
        assertFalse(file(root, a.hash).exists()); assertFalse(file(root, b.hash).exists());
        assertArrayEquals(full, Files.readAllBytes(file(root, hash(full)).toPath()));
        restoreFiles(new File(root, "pending"), Arrays.asList(a, b, unused), Collections.singletonList(plan), h -> file(root, h), transport);
        assertEquals(2, downloads.get()); assertEquals(1, root.listFiles().length);
    }

    @Test public void sharedPackIsDownloadedOnceAndLegacyChunkCopiesAreNeverDeleted() throws Exception {
        File root = temporary.newFolder();
        byte[] pack = bytes("aaabbb"); RestoreObject object = object(pack);
        List<RestoreResource> plans = Arrays.asList(resource(bytes("aaa"), new RestoreSegment(object.hash, 0, 3)),
            resource(bytes("bbb"), new RestoreSegment(object.hash, 3, 3)));
        Files.write(file(root, object.hash).toPath(), pack);
        restoreFiles(new File(root, "pending"), Collections.singletonList(object), plans, h -> file(root, h),
            (o, target) -> { throw new AssertionError("legacy verified copy exists"); });
        assertArrayEquals(pack, Files.readAllBytes(file(root, object.hash).toPath()));
        assertEquals(3, root.listFiles().length);
    }

    @Test public void failedDownloadCleansOnlyThisTasksPartials() throws Exception {
        File root = temporary.newFolder(); File pending = new File(root, "pending"); pending.mkdir();
        File otherTask = new File(pending, "other-task.part"); Files.write(otherTask.toPath(), bytes("keep"));
        RestoreObject object = object(bytes("original"));
        try {
            restoreFiles(pending, Collections.singletonList(object), Collections.singletonList(resource(bytes("original"),
                new RestoreSegment(object.hash, 0, object.size))), h -> file(root, h),
                (o, target) -> { Files.write(target.toPath(), bytes("partial")); throw new IOException("interrupted"); });
            fail("must surface download failure");
        } catch (IOException expected) { assertEquals("interrupted", expected.getMessage()); }
        assertArrayEquals(bytes("keep"), Files.readAllBytes(otherTask.toPath()));
        assertEquals(1, pending.listFiles().length); assertFalse(file(root, object.hash).exists());
    }

    @Test public void wrongHashCannotBecomeAResourceEvenWhenSizeMatches() throws Exception {
        File root = temporary.newFolder(); RestoreObject object = object(bytes("good"));
        try {
            restoreFiles(new File(root, "pending"), Collections.singletonList(object),
                Collections.singletonList(resource(bytes("good"), new RestoreSegment(object.hash, 0, 4))),
                h -> file(root, h), (o, target) -> Files.write(target.toPath(), bytes("evil")));
            fail("must verify SHA");
        } catch (IOException expected) { assertTrue(expected.getMessage().contains("SHA-256")); }
        assertEquals(0, root.listFiles().length);
    }

    @Test public void invalidRangeFailsBeforeAnyDownloadOrMutation() throws Exception {
        File root = temporary.newFolder(); RestoreObject object = object(bytes("x"));
        try {
            restoreFiles(new File(root, "pending"), Collections.singletonList(object),
                Collections.singletonList(resource(bytes("x"), new RestoreSegment(object.hash, Long.MAX_VALUE, 1))),
                h -> file(root, h), (o, target) -> { throw new AssertionError("must validate plan first"); });
            fail("invalid range");
        } catch (IllegalArgumentException expected) { assertTrue(expected.getMessage().contains("范围")); }
        assertEquals(0, root.listFiles().length);
    }

    @Test public void failedAssemblyPreservesExistingOriginalAndLegacyFiles() throws Exception {
        File root = temporary.newFolder(); byte[] old = bytes("retained"), pack = bytes("xxx");
        Files.write(file(root, hash(old)).toPath(), old);
        RestoreObject object = object(pack); Files.write(file(root, object.hash).toPath(), pack);
        try {
            restoreFiles(new File(root, "pending"), Collections.singletonList(object),
                Collections.singletonList(resource(bytes("bad"), new RestoreSegment(object.hash, 0, 3))),
                h -> file(root, h), (o, target) -> { throw new AssertionError("should reuse"); });
            fail("wrong assembled content hash");
        } catch (IOException expected) { assertTrue(expected.getMessage().contains("SHA-256")); }
        assertEquals(2, root.listFiles().length);
        assertArrayEquals(old, Files.readAllBytes(file(root, hash(old)).toPath()));
    }

    @Test public void durableRetryKeepsVerifiedChunksAndDownloadsOnlyTheInterruptedChunk() throws Exception {
        File root = temporary.newFolder(); File pending = new File(root, "pending");
        byte[] aBytes = bytes("aaa"), bBytes = bytes("bbb"), full = bytes("aaabbb");
        RestoreObject a = object(aBytes), b = object(bBytes);
        List<RestoreResource> plans = Collections.singletonList(resource(full,
            new RestoreSegment(a.hash, 0, 3), new RestoreSegment(b.hash, 0, 3)));
        AtomicInteger firstDownloads = new AtomicInteger();
        try {
            restoreFiles(pending, Arrays.asList(a, b), plans, h -> file(root, h), (o, target) -> {
                firstDownloads.incrementAndGet();
                Files.write(target.toPath(), o.hash.equals(a.hash) ? aBytes : bytes("b"));
                if (o.hash.equals(b.hash)) throw new IOException("offline");
            }, true, (completed, total) -> {});
            fail("network must interrupt the first invocation");
        } catch (IOException expected) { assertEquals("offline", expected.getMessage()); }
        assertEquals(2, firstDownloads.get());
        AtomicInteger resumedDownloads = new AtomicInteger();
        restoreFiles(pending, Arrays.asList(a, b), plans, h -> file(root, h), (o, target) -> {
            resumedDownloads.incrementAndGet();
            assertEquals(b.hash, o.hash);
            assertArrayEquals(bytes("b"), Files.readAllBytes(target.toPath()));
            Files.write(target.toPath(), bBytes);
        }, true, (completed, total) -> {});
        assertEquals(1, resumedDownloads.get());
        assertArrayEquals(full, Files.readAllBytes(file(root, hash(full)).toPath()));
        assertFalse(pending.exists());
    }

    @Test public void byteResumeAcceptsOnlyAnExactRangeAndRestartsSafelyWhenTheServerIgnoresRange() {
        assertEquals(4, restoreResponseOffset(206, "bytes 4-9/10", 4, 10));
        assertEquals(0, restoreResponseOffset(200, null, 4, 10));
        for (String range : Arrays.asList("bytes 0-9/10", "bytes 4-8/10", "bytes 4-9/11", "bytes 4-9/*", null)) {
            try { restoreResponseOffset(206, range, 4, 10); fail("must reject mismatched suffix"); }
            catch (IllegalStateException expected) {}
        }
    }

    private static final class HttpFixture implements AutoCloseable {
        final java.net.ServerSocket server = new java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress());
        final java.util.concurrent.CompletableFuture<Void> response;
        volatile String range;
        HttpFixture(int status, String contentRange, byte[] body) throws Exception {
            response = java.util.concurrent.CompletableFuture.runAsync(() -> {
                try (java.net.Socket client = server.accept()) {
                    java.io.BufferedReader input = new java.io.BufferedReader(new java.io.InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                    String line;
                    while ((line = input.readLine()) != null && !line.isEmpty()) {
                        if (line.startsWith("Range: ")) range = line.substring(7);
                    }
                    String headers = "HTTP/1.1 " + status + " OK\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n"
                        + (contentRange == null ? "" : "Content-Range: " + contentRange + "\r\n") + "\r\n";
                    client.getOutputStream().write(headers.getBytes(StandardCharsets.UTF_8));
                    client.getOutputStream().write(body);
                    client.getOutputStream().flush();
                } catch (IOException error) { throw new java.util.concurrent.CompletionException(error); }
            });
        }
        String url() { return "http://127.0.0.1:" + server.getLocalPort() + "/object"; }
        @Override public void close() throws Exception {
            try { response.get(5, java.util.concurrent.TimeUnit.SECONDS); } finally { server.close(); }
        }
    }

    @Test public void realHttpResumeAppendsOnlyTheMissingSuffixAndVerifiesTheWholeFile() throws Exception {
        byte[] full = bytes("firstsecond"); File target = temporary.newFile();
        Files.write(target.toPath(), bytes("first"));
        try (HttpFixture server = new HttpFixture(206, "bytes 5-10/11", bytes("second"))) {
            downloadRestoreObject("github", server.url(), "test-token", "", hash(full), full.length, target);
            assertEquals("bytes=5-", server.range);
            assertArrayEquals(full, Files.readAllBytes(target.toPath()));
        }
    }

    @Test public void realHttpIgnoredRangeReplacesThePrefixWithoutDuplicatingBytes() throws Exception {
        byte[] full = bytes("firstsecond"); File target = temporary.newFile();
        Files.write(target.toPath(), bytes("first"));
        try (HttpFixture server = new HttpFixture(200, null, full)) {
            downloadRestoreObject("github", server.url(), "test-token", "", hash(full), full.length, target);
            assertArrayEquals(full, Files.readAllBytes(target.toPath()));
        }
    }
}
