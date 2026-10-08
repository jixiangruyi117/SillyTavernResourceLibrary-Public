package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NativeDiscordAttachmentDownloadTest {
    @Test public void postMediaBudgetRejectsDeclaredOrStreamedOversizeWithoutChangingResourceDownloadBudget() throws Exception {
        for (String headers : List.of("Content-Length: 9\r\n", "")) {
            File file = part(); JSONObject metadata = new JSONObject();
            try (HttpFixture server = new HttpFixture(response(200, headers, "123456789"))) {
                assertThrows(NativeDiscordAttachmentDownload.TerminalFailure.class, () -> NativeDiscordAttachmentDownload.download(
                    server.client(), URL, file, metadata, saved -> {}, (done, total) -> {}, call -> {}, 8));
                assertFalse(metadata.optBoolean("downloadComplete"));
                assertTrue(!file.exists() || file.length() <= 8);
            }
        }
        assertEquals(4L * 1024 * 1024 * 1024, NativeDiscordAttachmentDownload.MAX_BYTES);
    }
    @Test public void postMediaUsesTheSameRangeCheckpointAndCompletedBytesWithoutAnotherRequest() throws Exception {
        File file = part(); JSONObject metadata = prefix(file, "\"v1\"");
        try (HttpFixture server = new HttpFixture(response(206, "Content-Length: 5\r\nContent-Range: bytes 3-7/8\r\nETag: \"v1\"\r\n", "defgh"))) {
            NativeDiscordAttachmentDownload.download(server.client(), URL, file, metadata, saved -> {}, (done, total) -> {}, call -> {}, 8);
            assertTrue(server.requests.get(0).contains("Range: bytes=3-"));
            NativeDiscordAttachmentDownload.download(server.client(), URL, file, metadata, saved -> {}, (done, total) -> {},
                call -> { throw new AssertionError("completed media must not download again"); }, 8);
            assertEquals("abcdefgh", read(file));
            assertEquals(1, server.requests.size());
        }
    }
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private static final String URL = "https://cdn.discordapp.com/attachments/123/456/card.json?ex=abc&hm=signature";
    private String read(File file) throws Exception { return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8); }
    private File part() throws Exception { return new File(temporary.newFolder(), "share.part"); }
    private JSONObject prefix(File file, String etag) throws Exception {
        Files.write(file.toPath(), "abc".getBytes(StandardCharsets.UTF_8));
        return new JSONObject().put("downloadSize", 8).put("downloadValidator", etag);
    }
    private void download(HttpFixture server, File file, JSONObject metadata) throws Exception {
        NativeDiscordAttachmentDownload.download(server.client(), URL, file, metadata,
            saved -> {}, (done, total) -> {}, call -> {});
    }

    @Test public void disconnectedStreamPersistsPrefixAndResumesOnlyMissingBytesOnNextRun() throws Exception {
        File part = part(); JSONObject metadata = new JSONObject();
        try (HttpFixture server = new HttpFixture(
            response(200, "Content-Length: 8\r\nETag: \"version1\"\r\n", "abc"),
            response(206, "Content-Length: 5\r\nContent-Range: bytes 3-7/8\r\nETag: \"version1\"\r\n", "defgh"))) {
            assertThrows(IOException.class, () -> download(server, part, metadata));
            assertEquals("abc", read(part));
            assertFalse(metadata.optBoolean("downloadComplete"));
            // A new JSONObject represents the persisted checkpoint read after process recreation.
            JSONObject reopened = new JSONObject(metadata.toString());
            download(server, part, reopened);
            assertEquals("abcdefgh", read(part));
            assertTrue(reopened.getBoolean("downloadComplete"));
            assertTrue(server.requests.get(1).contains("Range: bytes=3-"));
            assertTrue(server.requests.get(1).contains("If-Range: \"version1\""));
            assertTrue(server.requests.get(1).contains("Accept-Encoding: identity"));
        }
    }

    @Test public void ignoredRangeRewritesOnlyTheUnfinishedAttachment() throws Exception {
        File part = part(); JSONObject metadata = prefix(part, "\"old\"");
        File unrelated = new File(part.getParentFile(), "other.part"); Files.write(unrelated.toPath(), "keep".getBytes(StandardCharsets.UTF_8));
        try (HttpFixture server = new HttpFixture(response(200, "Content-Length: 8\r\nETag: \"new\"\r\n", "12345678"))) {
            download(server, part, metadata);
            assertEquals("12345678", read(part));
            assertEquals("keep", read(unrelated));
            assertEquals("\"new\"", metadata.getString("downloadValidator"));
        }
    }

    @Test public void missingValidatorCannotAppendAPrefixFromAnUnverifiedVersion() throws Exception {
        File part = part(); JSONObject metadata = prefix(part, "");
        try (HttpFixture server = new HttpFixture(response(200, "Content-Length: 8\r\n", "12345678"))) {
            download(server, part, metadata);
            assertFalse(server.requests.get(0).contains("Range:"));
            assertEquals("12345678", read(part));
        }
    }

    @Test public void weakEtagAndTimestampDoNotAuthorizeAppendingAnOldPrefix() throws Exception {
        File part = part(); JSONObject metadata = new JSONObject();
        try (HttpFixture server = new HttpFixture(
            response(200, "Content-Length: 8\r\nETag: W/\"v1\"\r\nLast-Modified: Fri, 02 Oct 2026 00:00:00 GMT\r\n", "abc"),
            response(200, "Content-Length: 8\r\n", "12345678"))) {
            assertThrows(IOException.class, () -> download(server, part, metadata));
            assertEquals("", metadata.getString("downloadValidator"));
            download(server, part, metadata);
            assertFalse(server.requests.get(1).contains("Range:"));
            assertEquals("12345678", read(part));
        }
    }

    @Test public void mismatchedRangeAndChangedValidatorNeverAppendOrComplete() throws Exception {
        for (String headers : List.of(
            "Content-Range: bytes 2-7/8\r\nETag: \"v1\"\r\n",
            "Content-Range: bytes 3-7/8\r\nETag: \"v2\"\r\n")) {
            File part = part(); JSONObject metadata = prefix(part, "\"v1\"");
            try (HttpFixture server = new HttpFixture(response(206, "Content-Length: 5\r\n" + headers, "defgh"))) {
                assertThrows(NativeDiscordAttachmentDownload.TerminalFailure.class, () -> download(server, part, metadata));
                assertEquals("abc", read(part));
                assertFalse(metadata.optBoolean("downloadComplete"));
            }
        }
    }

    @Test public void fullDownloadSurvivesFailureToPublishWithoutAnotherRequest() throws Exception {
        File part = part(); JSONObject metadata = new JSONObject();
        try (HttpFixture server = new HttpFixture(response(200, "Content-Length: 8\r\nETag: \"v1\"\r\n", "abcdefgh"))) {
            download(server, part, metadata);
            NativeDiscordAttachmentDownload.download(server.client(), URL, part, new JSONObject(metadata.toString()),
                saved -> { throw new AssertionError("already committed checkpoint"); }, (done, total) -> {},
                call -> { throw new AssertionError("must not redownload completed bytes"); });
            assertEquals(1, server.requests.size());
        }
    }

    @Test public void completeBytesBeforeFinalCheckpointArePublishedWithoutRedownloading() throws Exception {
        File part = part(); Files.write(part.toPath(), "abcdefgh".getBytes(StandardCharsets.UTF_8));
        JSONObject metadata = new JSONObject().put("downloadSize", 8).put("downloadValidator", "\"v1\"");
        NativeDiscordAttachmentDownload.download(new OkHttpClient(), URL, part, metadata,
            saved -> {}, (done, total) -> {}, call -> { throw new AssertionError("all bytes already on disk"); });
        assertTrue(metadata.getBoolean("downloadComplete"));
        assertEquals("abcdefgh", read(part));
    }

    @Test public void checkpointFailureBeforeANewVersionCannotAttachOldBytesToNewValidator() throws Exception {
        File part = part(); JSONObject metadata = prefix(part, "\"old\"");
        try (HttpFixture server = new HttpFixture(response(200, "Content-Length: 8\r\nETag: \"new\"\r\n", "12345678"))) {
            assertThrows(IOException.class, () -> NativeDiscordAttachmentDownload.download(server.client(), URL, part, metadata,
                saved -> { throw new IOException("simulated process stop before checkpoint commit"); }, (done, total) -> {}, call -> {}));
            assertEquals(0, part.length());
            assertFalse(metadata.optBoolean("downloadComplete"));
        }
    }

    @Test public void expiredLinkIsTerminalAndKeepsExistingPartialForExplicitRecovery() throws Exception {
        File part = part(); JSONObject metadata = prefix(part, "\"v1\"");
        try (HttpFixture server = new HttpFixture(response(403, "Content-Length: 0\r\n", ""))) {
            Exception error = assertThrows(NativeDiscordAttachmentDownload.HttpFailure.class, () -> download(server, part, metadata));
            assertFalse(NativeDiscordAttachmentDownload.retryable(error));
            assertEquals("abc", read(part));
        }
    }

    @Test public void throttledResponsePersistsRetryAfterInsteadOfBusyLooping() throws Exception {
        File part = part(); JSONObject metadata = new JSONObject(); long before = System.currentTimeMillis();
        try (HttpFixture server = new HttpFixture(response(429, "Content-Length: 0\r\nRetry-After: 120\r\n", ""))) {
            Exception error = assertThrows(NativeDiscordAttachmentDownload.HttpFailure.class, () -> download(server, part, metadata));
            assertTrue(NativeDiscordAttachmentDownload.retryable(error));
            assertTrue(metadata.getLong("downloadNotBefore") >= before + 120_000);
            assertEquals(1, server.requests.size());
            assertFalse(part.exists());
        }
    }

    @Test public void redirectCannotEscapeDiscordCdn() throws Exception {
        File part = part(); JSONObject metadata = new JSONObject();
        try (HttpFixture server = new HttpFixture(response(302, "Content-Length: 0\r\nLocation: https://example.invalid/file\r\n", ""))) {
            assertThrows(IllegalArgumentException.class, () -> download(server, part, metadata));
            assertEquals(1, server.requests.size());
            assertFalse(part.exists());
        }
    }

    @Test public void emptyHtmlAndOversizedResponsesAreRejected() throws Exception {
        for (String headers : List.of("Content-Length: 0\r\n", "Content-Type: text/html\r\nContent-Length: 0\r\n",
            "Content-Length: " + (NativeDiscordAttachmentDownload.MAX_BYTES + 1) + "\r\n")) {
            File part = part(); JSONObject metadata = new JSONObject();
            try (HttpFixture server = new HttpFixture(response(200, headers, ""))) {
                assertThrows(NativeDiscordAttachmentDownload.TerminalFailure.class, () -> download(server, part, metadata));
                assertFalse(metadata.optBoolean("downloadComplete"));
            }
        }
    }

    @Test public void retryClassificationAndRangeOverflowAreBounded() throws Exception {
        assertTrue(NativeDiscordAttachmentDownload.retryable(new IOException("disconnected")));
        assertTrue(NativeDiscordAttachmentDownload.retryable(new NativeDiscordAttachmentDownload.HttpFailure(503)));
        assertFalse(NativeDiscordAttachmentDownload.retryable(new NativeDiscordAttachmentDownload.HttpFailure(400)));
        assertFalse(NativeDiscordAttachmentDownload.retryable(new NativeDiscordAttachmentDownload.TerminalFailure("storage full")));
        assertTrue(NativeDiscordAttachmentDownload.shouldRetry(new IOException("disconnected"), 3));
        assertFalse(NativeDiscordAttachmentDownload.shouldRetry(new IOException("disconnected"), 4));
        assertThrows(NativeDiscordAttachmentDownload.TerminalFailure.class,
            () -> NativeDiscordAttachmentDownload.rangeTotal("bytes 3-999999999999999999999/8", 3));
        assertEquals(30_000, NativeDiscordAttachmentDownload.retryAfterMillis("invalid"));
        assertEquals(86_400_000, NativeDiscordAttachmentDownload.retryAfterMillis("999999999"));
        java.text.SimpleDateFormat date = new java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", java.util.Locale.US);
        date.setTimeZone(java.util.TimeZone.getTimeZone("GMT"));
        long wait = NativeDiscordAttachmentDownload.retryAfterMillis(date.format(new java.util.Date(System.currentTimeMillis() + 120_000)));
        assertTrue(wait >= 118_000 && wait <= 120_000);
    }

    private static String response(int status, String headers, String body) {
        return "HTTP/1.1 " + status + " Test\r\nConnection: close\r\n" + headers + "\r\n" + body;
    }
    private static final class HttpFixture implements AutoCloseable {
        final ServerSocket socket;
        final Thread thread;
        final List<String> requests = Collections.synchronizedList(new ArrayList<>());
        volatile Throwable failure;
        HttpFixture(String... responses) throws Exception {
            socket = new ServerSocket(0, 10, InetAddress.getLoopbackAddress());
            socket.setSoTimeout(5000);
            thread = new Thread(() -> {
                try {
                    for (String response : responses) try (Socket connection = socket.accept()) {
                        connection.setSoTimeout(5000);
                        BufferedReader input = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
                        StringBuilder request = new StringBuilder(); String line;
                        while ((line = input.readLine()) != null && !line.isEmpty()) request.append(line).append('\n');
                        requests.add(request.toString());
                        connection.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));
                        connection.getOutputStream().flush();
                    }
                } catch (Throwable error) { if (!socket.isClosed()) failure = error; }
            });
            thread.setDaemon(true); thread.start();
        }
        OkHttpClient client() {
            return new OkHttpClient.Builder().followRedirects(false).retryOnConnectionFailure(false)
                .readTimeout(2, TimeUnit.SECONDS).addInterceptor(chain -> chain.proceed(chain.request().newBuilder()
                    .url("http://127.0.0.1:" + socket.getLocalPort() + chain.request().url().encodedPath()).build())).build();
        }
        public void close() throws Exception {
            socket.close(); thread.join(6000);
            assertFalse("HTTP fixture did not stop", thread.isAlive());
            if (failure != null) throw new AssertionError(failure);
        }
    }
}
