package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.PriorityQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import org.junit.Test;

public class NativePreviewAssetRequestsTest {
    @Test public void sameUrlSharesTransportAndOneOwnerCannotCancelAnother() throws Exception {
        List<Runnable> queue = new ArrayList<>();
        AtomicInteger downloads = new AtomicInteger();
        NativePreviewAssetRequests<String> requests = new NativePreviewAssetRequests<>(queue::add,
            (url, control) -> { downloads.incrementAndGet(); return "bytes"; });
        CompletableFuture<String> first = requests.acquire("https://cdn.example/a.png", Collections.singleton("first"), 1);
        CompletableFuture<String> second = requests.acquire("https://cdn.example/a.png", Collections.singleton("second"), 1);
        assertSame(first, second);
        assertEquals(1, queue.size());
        requests.release("first");
        assertFalse(second.isDone());
        queue.remove(0).run();
        assertEquals("bytes", second.get());
        assertEquals(1, downloads.get());
    }

    @Test public void abandonedQueuedDownloadDoesNotRunOrRemoveNewRequest() throws Exception {
        List<Runnable> queue = new ArrayList<>();
        AtomicInteger downloads = new AtomicInteger();
        NativePreviewAssetRequests<String> requests = new NativePreviewAssetRequests<>(queue::add,
            (url, control) -> { downloads.incrementAndGet(); return "new"; });
        CompletableFuture<String> old = requests.acquire("https://cdn.example/a.png", Collections.singleton("old"), 1);
        requests.release("old");
        assertTrue(old.isCompletedExceptionally());
        CompletableFuture<String> next = requests.acquire("https://cdn.example/a.png", Collections.singleton("new"), 1);
        queue.remove(0).run();
        assertSame(next, requests.acquire("https://cdn.example/a.png", Collections.singleton("another"), 1));
        queue.remove(0).run();
        assertEquals("new", next.get());
        assertEquals(1, downloads.get());
    }

    @Test public void endingLastSessionCancelsActualOkHttpCall() throws Exception {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        CountDownLatch attached = new CountDownLatch(1);
        CountDownLatch finish = new CountDownLatch(1);
        Call call = new OkHttpClient().newCall(new Request.Builder().url("https://cdn.example/a.png").build());
        try {
            NativePreviewAssetRequests<String> requests = new NativePreviewAssetRequests<>(executor, (url, control) -> {
                control.attach(call);
                attached.countDown();
                assertTrue(finish.await(5, TimeUnit.SECONDS));
                control.check();
                return "should not arrive";
            });
            CompletableFuture<String> result = requests.acquire("https://cdn.example/a.png", Collections.singleton("session"), 1);
            assertTrue(attached.await(5, TimeUnit.SECONDS));
            requests.release("session");
            assertTrue(call.isCanceled());
            assertTrue(result.isCompletedExceptionally());
        } finally {
            finish.countDown();
            executor.shutdown();
            assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS));
        }
    }

    @Test public void stylesheetsRunBeforeWaitingImagesAndPreserveFifoWithinPriority() throws Exception {
        PriorityQueue<NativePreviewAssetRequests.QueuedDownload> queue = new PriorityQueue<>();
        List<String> order = new ArrayList<>();
        NativePreviewAssetRequests<String> requests = new NativePreviewAssetRequests<>(
            task -> queue.add((NativePreviewAssetRequests.QueuedDownload) task),
            (url, control) -> { order.add(url); return url; });
        requests.acquire("image1", Collections.singleton("session"), 1);
        requests.acquire("image2", Collections.singleton("session"), 1);
        requests.acquire("stylesheet", Collections.singleton("session"), 0);
        while (!queue.isEmpty()) queue.remove().run();
        assertEquals(java.util.Arrays.asList("stylesheet", "image1", "image2"), order);
    }

    @Test public void pluginShutdownReleasesQueuedWorkAndRejectsLateRequests() {
        List<Runnable> queue = new ArrayList<>();
        AtomicInteger downloads = new AtomicInteger();
        NativePreviewAssetRequests<String> requests = new NativePreviewAssetRequests<>(queue::add,
            (url, control) -> { downloads.incrementAndGet(); return "bytes"; });
        CompletableFuture<String> result = requests.acquire("a", Collections.singleton("session"), 1);
        requests.close();
        assertTrue(result.isCompletedExceptionally());
        assertTrue(requests.acquire("b", Collections.singleton("new session"), 1).isCompletedExceptionally());
        queue.remove(0).run();
        assertEquals(0, downloads.get());
    }
}
