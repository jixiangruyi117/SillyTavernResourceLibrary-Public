package buzz.jixiangruyi1207.srl;

import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.atomic.AtomicLong;
import okhttp3.Call;

/** One cancellable transport per URL, shared by preview sessions and bridge callers. */
final class NativePreviewAssetRequests<T> {
    interface Download<T> { T run(String url, Control control) throws Exception; }

    static final class Control {
        private boolean cancelled;
        private Call call;

        synchronized void attach(Call next) throws IOException {
            check();
            call = next;
        }

        synchronized void check() throws IOException {
            if (cancelled) throw new IOException("预览资源下载已取消");
        }

        synchronized void cancel() {
            cancelled = true;
            if (call != null) call.cancel();
        }
    }

    static final class QueuedDownload implements Runnable, Comparable<QueuedDownload> {
        private static final AtomicLong SEQUENCE = new AtomicLong();
        private final long sequence = SEQUENCE.getAndIncrement();
        private final int priority;
        private final Runnable action;

        QueuedDownload(int priority, Runnable action) {
            this.priority = priority;
            this.action = action;
        }

        @Override public void run() { action.run(); }
        @Override public int compareTo(QueuedDownload other) {
            int result = Integer.compare(priority, other.priority);
            return result == 0 ? Long.compare(sequence, other.sequence) : result;
        }
    }

    private final class Pending {
        final CompletableFuture<T> future = new CompletableFuture<>();
        final Control control = new Control();
        final Set<String> owners = new HashSet<>();
        QueuedDownload queued;
    }

    private final Map<String, Pending> pending = new HashMap<>();
    private final Executor executor;
    private final Download<T> download;
    private boolean closed;

    NativePreviewAssetRequests(Executor executor, Download<T> download) {
        this.executor = executor;
        this.download = download;
    }

    synchronized CompletableFuture<T> acquire(String url, Set<String> owners, int priority) {
        if (closed || owners.isEmpty()) return failed(new IOException("预览会话已结束"));
        Pending existing = pending.get(url);
        if (existing != null) {
            existing.owners.addAll(owners);
            return existing.future;
        }
        Pending task = new Pending();
        task.owners.addAll(owners);
        pending.put(url, task);
        task.queued = new QueuedDownload(priority, () -> {
            try {
                task.control.check();
                task.future.complete(download.run(url, task.control));
            } catch (Exception error) {
                task.future.completeExceptionally(error);
            } finally {
                synchronized (NativePreviewAssetRequests.this) {
                    pending.remove(url, task);
                }
            }
        });
        try { executor.execute(task.queued); }
        catch (RuntimeException error) {
            pending.remove(url, task);
            task.future.completeExceptionally(error);
        }
        return task.future;
    }

    synchronized void release(String owner) {
        for (Map.Entry<String, Pending> entry : new HashMap<>(pending).entrySet()) {
            Pending task = entry.getValue();
            if (task.owners.remove(owner) && task.owners.isEmpty()) {
                pending.remove(entry.getKey(), task);
                task.control.cancel();
                if (executor instanceof ThreadPoolExecutor) ((ThreadPoolExecutor) executor).remove(task.queued);
                task.future.completeExceptionally(new IOException("预览资源下载已取消"));
            }
        }
    }

    synchronized void close() {
        closed = true;
        Set<String> owners = new HashSet<>();
        for (Pending task : pending.values()) owners.addAll(task.owners);
        for (String owner : owners) release(owner);
    }

    private static <T> CompletableFuture<T> failed(Exception error) {
        CompletableFuture<T> result = new CompletableFuture<>();
        result.completeExceptionally(error);
        return result;
    }
}
