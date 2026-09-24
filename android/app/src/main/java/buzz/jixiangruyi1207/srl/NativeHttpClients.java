package buzz.jixiangruyi1207.srl;

import java.util.concurrent.TimeUnit;
import okhttp3.ConnectionPool;
import okhttp3.OkHttpClient;

/** Process-wide HTTP clients so uploads and metadata requests reuse connections. */
final class NativeHttpClients {
    private static final ConnectionPool CONNECTION_POOL = new ConnectionPool(8, 5, TimeUnit.MINUTES);
    static final OkHttpClient CLOUD = new OkHttpClient.Builder()
        .connectionPool(CONNECTION_POOL)
        .connectTimeout(45, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.MINUTES)
        .writeTimeout(10, TimeUnit.MINUTES)
        .retryOnConnectionFailure(true)
        .build();
    static final OkHttpClient METADATA = CLOUD.newBuilder()
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .build();

    private NativeHttpClients() {}
}
