package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public class NativeShareIntakeQueueTest {
    @Test
    public void stagedTokenIsStableForSystemRedeliveryAndDistinctAcrossFiles() {
        String operationId = "c579c927-54cc-40e0-a3d2-b5f74a60b4ef";

        assertEquals("c579c927-54cc-40e0-a3d2-b5f74a60b4ef-0", NativeShareImportService.stagedToken(operationId, 0));
        assertEquals(NativeShareImportService.stagedToken(operationId, 0), NativeShareImportService.stagedToken(operationId, 0));
        assertTrue(!NativeShareImportService.stagedToken(operationId, 0).equals(NativeShareImportService.stagedToken(operationId, 1)));
    }

    @Test public void discordBatchTokensSurviveRedeliveryWithoutCollisions() {
        String operation = "c579c927-54cc-40e0-a3d2-b5f74a60b4ef";
        java.util.Set<String> tokens = new java.util.HashSet<>();
        assertEquals("discord-url-" + operation, NativeShareImportService.discordToken(operation, 0));
        for (int index = 0; index < 200; index++) {
            String token = NativeShareImportService.discordToken(operation, index);
            assertTrue(token.matches("discord-url-[a-f0-9-]{36}"));
            assertEquals(token, NativeShareImportService.discordToken(operation, index));
            assertTrue(tokens.add(token));
        }
    }

    @Test public void networkTransfersRunWhileFileCopyIsBlockedAndConcurrencyIsBounded() throws Exception {
        CountDownLatch copyStarted = new CountDownLatch(1), releaseCopy = new CountDownLatch(1);
        CountDownLatch networkStarted = new CountDownLatch(3), releaseNetwork = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(12);
        AtomicInteger active = new AtomicInteger(), maximum = new AtomicInteger();
        NativeExecutors.shareIntake().execute(() -> {
            copyStarted.countDown();
            try { releaseCopy.await(10, TimeUnit.SECONDS); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        });
        try {
            assertTrue(copyStarted.await(5, TimeUnit.SECONDS));
            for (int index = 0; index < 12; index++) NativeExecutors.network().execute(() -> {
                int count = active.incrementAndGet(); maximum.accumulateAndGet(count, Math::max);
                networkStarted.countDown();
                try { releaseNetwork.await(10, TimeUnit.SECONDS); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); }
                finally { active.decrementAndGet(); finished.countDown(); }
            });
            assertTrue(networkStarted.await(5, TimeUnit.SECONDS));
            assertEquals(3, maximum.get());
            assertEquals(12, finished.getCount());
        } finally { releaseCopy.countDown(); releaseNetwork.countDown(); }
        assertTrue(finished.await(5, TimeUnit.SECONDS));
        assertEquals(3, maximum.get());
    }

    @Test
    public void serializesQueuedShareIntakeOperations() throws Exception {
        ExecutorService queue = NativeExecutors.shareIntake();
        CountDownLatch firstStarted = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(3);
        AtomicInteger active = new AtomicInteger();
        AtomicInteger maximumActive = new AtomicInteger();
        List<Integer> order = Collections.synchronizedList(new ArrayList<>());

        queue.execute(() -> run(1, active, maximumActive, order, firstStarted, releaseFirst, finished));
        queue.execute(() -> run(2, active, maximumActive, order, null, null, finished));
        queue.execute(() -> run(3, active, maximumActive, order, null, null, finished));

        try {
            assertTrue(firstStarted.await(5, TimeUnit.SECONDS));
            assertEquals(3, finished.getCount());
        } finally {
            releaseFirst.countDown();
        }

        assertTrue(finished.await(5, TimeUnit.SECONDS));
        assertEquals(1, maximumActive.get());
        assertEquals(List.of(1, 2, 3), order);
    }

    private static void run(
        int value,
        AtomicInteger active,
        AtomicInteger maximumActive,
        List<Integer> order,
        CountDownLatch started,
        CountDownLatch release,
        CountDownLatch finished
    ) {
        int current = active.incrementAndGet();
        maximumActive.accumulateAndGet(current, Math::max);
        try {
            if (started != null) {
                started.countDown();
                release.await(5, TimeUnit.SECONDS);
            }
            order.add(value);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        } finally {
            active.decrementAndGet();
            finished.countDown();
        }
    }
}
