package buzz.jixiangruyi1207.srl;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;

/** Shared connections, explicit cancellation and no transparent replay of paid POSTs. */
final class NativeMainApiRequests {
    private final OkHttpClient client = NativeHttpClients.CLOUD.newBuilder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(false)
        .build();
    private final ConcurrentHashMap<String, Call> active = new ConcurrentHashMap<>();

    Call begin(String id, Request request) {
        Call operation = client.newCall(request);
        if (active.putIfAbsent(id, operation) != null) throw new IllegalArgumentException("重复的 AI 请求标识");
        return operation;
    }

    void cancel(String id) {
        Call operation = active.get(id);
        if (operation != null) operation.cancel();
    }

    void finish(String id, Call operation) { active.remove(id, operation); }

    void close() {
        for (Call operation : active.values()) operation.cancel();
        active.clear();
    }
}
