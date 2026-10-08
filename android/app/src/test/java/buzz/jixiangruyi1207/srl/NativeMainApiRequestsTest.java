package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Request;
import org.junit.Test;

public class NativeMainApiRequestsTest {
    @Test public void cancelInterruptsRequestWaitingForHeaders() throws Exception {
        NativeMainApiRequests requests = new NativeMainApiRequests();
        CountDownLatch received = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (ServerSocket server = new ServerSocket(0)) {
            var executor = Executors.newFixedThreadPool(2);
            try {
                executor.submit(() -> {
                    try (Socket socket = server.accept()) {
                        BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
                        while (!reader.readLine().isEmpty()) {}
                        received.countDown();
                        release.await(5, TimeUnit.SECONDS);
                    } catch (Exception ignored) {}
                });
                Call operation = requests.begin("first", new Request.Builder().url("http://127.0.0.1:" + server.getLocalPort()).build());
                var response = executor.submit(() -> {
                    try (var ignored = operation.execute()) { return false; }
                    catch (IOException cancelled) { return operation.isCanceled(); }
                    finally { requests.finish("first", operation); }
                });
                assertTrue(received.await(2, TimeUnit.SECONDS));
                requests.cancel("first");
                assertTrue(response.get(2, TimeUnit.SECONDS));
            } finally { release.countDown(); requests.close(); executor.shutdownNow(); }
        }
    }

    @Test public void requestIdsIsolateCancellationAndDestructionClosesAll() {
        NativeMainApiRequests requests = new NativeMainApiRequests();
        Request request = new Request.Builder().url("https://example.com").build();
        Call first = requests.begin("first", request);
        Call second = requests.begin("second", request);
        requests.cancel("first");
        assertTrue(first.isCanceled());
        assertFalse(second.isCanceled());
        requests.finish("first", first);
        requests.close();
        assertTrue(second.isCanceled());
    }
}
