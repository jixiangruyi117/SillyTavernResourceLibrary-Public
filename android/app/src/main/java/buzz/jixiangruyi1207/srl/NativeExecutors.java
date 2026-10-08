package buzz.jixiangruyi1207.srl;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.PriorityBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Shared bounded executors for native plugin IO. */
final class NativeExecutors {
    private static final ExecutorService IO_SERIAL = Executors.newSingleThreadExecutor(named("srl-io-serial"));
    private static final ExecutorService IO_LIMITED = Executors.newFixedThreadPool(3, named("srl-io"));
    private static final ExecutorService NETWORK = Executors.newFixedThreadPool(3, named("srl-network"));
    private static final ExecutorService SHARE_INTAKE = Executors.newSingleThreadExecutor(named("srl-share-intake"));
    private static final ExecutorService PREVIEW_NETWORK = new ThreadPoolExecutor(3, 3, 0L,
        TimeUnit.MILLISECONDS, new PriorityBlockingQueue<>(), named("srl-preview-network"));

    private NativeExecutors() {}

    static ExecutorService ioSerial() { return IO_SERIAL; }
    static ExecutorService ioLimited() { return IO_LIMITED; }
    static ExecutorService network() { return NETWORK; }
    static ExecutorService shareIntake() { return SHARE_INTAKE; }
    static ExecutorService previewNetwork() { return PREVIEW_NETWORK; }

    private static ThreadFactory named(String prefix) {
        AtomicInteger sequence = new AtomicInteger();
        return task -> {
            Thread thread = new Thread(task, prefix + "-" + sequence.incrementAndGet());
            thread.setDaemon(false);
            return thread;
        };
    }
}
