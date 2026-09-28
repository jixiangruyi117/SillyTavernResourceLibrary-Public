package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativeCloudTransferRegressionTest {
    @Test
    public void cancellationAndManifestCommitHaveOneDurableWinner() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            for (int attempt = 0; attempt < 20; attempt++) {
                String id = UUID.randomUUID().toString();
                File root = new File(NativeCloudTransferPlugin.jobsRoot(context), id);
                assertTrue(root.mkdir());
                JSONObject job = new JSONObject();
                job.put("id", id);
                job.put("status", "running");
                job.put("sealed", true);
                org.json.JSONArray objects = new org.json.JSONArray();
                objects.put(new JSONObject().put("token", "content").put("uploaded", true));
                objects.put(new JSONObject().put("token", "manifest").put("manifest", true).put("uploaded", false));
                job.put("objects", objects);
                NativeCloudTransferPlugin.writeJob(root, job);

                CountDownLatch start = new CountDownLatch(1);
                Future<Boolean> commit = executor.submit(() -> {
                    start.await();
                    try {
                        NativeCloudTransferPlugin.beginManifestCommit(root);
                        return true;
                    } catch (IllegalStateException cancellationWon) {
                        return false;
                    }
                });
                Future<JSONObject> cancel = executor.submit(() -> {
                    start.await();
                    return NativeCloudTransferPlugin.requestCancellation(root);
                });
                start.countDown();
                boolean commitWon = commit.get();
                JSONObject cancelResult = cancel.get();
                JSONObject durable = NativeCloudTransferPlugin.readJob(root);
                if (commitWon) {
                    assertEquals("committing", durable.getString("status"));
                    assertTrue(durable.getBoolean("manifestCommitStarted"));
                    assertEquals("committing", cancelResult.getString("status"));
                } else {
                    assertEquals("cancelled", durable.getString("status"));
                    assertFalse(durable.optBoolean("manifestCommitStarted", false));
                    assertEquals("cancelled", cancelResult.getString("status"));
                }
                new File(root, "job.json").delete();
                root.delete();
            }
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    public void durableCredentialInvalidationRemovesTheOldSecretUntilReplacement() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NativeSecretStore store = new NativeSecretStore(context);
        String key = "test-cloud-" + UUID.randomUUID();
        String invalidKey = key + "-invalid";
        try {
            store.saveCredential(key, invalidKey, "old-token");
            assertEquals("old-token", store.read(key));
            assertFalse(store.isCredentialInvalid(invalidKey));

            store.invalidateCredential(key, invalidKey);
            assertNull(store.read(key));
            assertTrue(store.isCredentialInvalid(invalidKey));

            store.saveCredential(key, invalidKey, "new-token");
            assertEquals("new-token", store.read(key));
            assertFalse(store.isCredentialInvalid(invalidKey));
        } finally {
            store.clearCredential(key, invalidKey);
        }
    }

    @Test
    public void nativeRestorePrefersCcv3MetadataOverAnEarlierLegacyChunk() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File file = new File(context.getCacheDir(), "native-card-" + UUID.randomUUID() + ".png");
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(pngWithCards(
                new JSONObject().put("name", "legacy"),
                new JSONObject().put("name", "v3")
            ));
        }
        try {
            JSONObject card = NativeCloudCardMetadata.readCharacterCard(file, file.getName());
            assertEquals("v3", card.getString("name"));
        } finally {
            file.delete();
        }
    }

    private byte[] pngWithCards(JSONObject legacy, JSONObject v3) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bytes.write(new byte[]{-119, 80, 78, 71, 13, 10, 26, 10});
        writeTextChunk(bytes, "chara", legacy);
        writeTextChunk(bytes, "ccv3", v3);
        writeChunk(bytes, "IEND", new byte[0]);
        return bytes.toByteArray();
    }

    private void writeTextChunk(ByteArrayOutputStream output, String keyword, JSONObject card) throws Exception {
        String encoded = Base64.encodeToString(
            card.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP
        );
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        data.write(keyword.getBytes(StandardCharsets.ISO_8859_1));
        data.write(0);
        data.write(encoded.getBytes(StandardCharsets.ISO_8859_1));
        writeChunk(output, "tEXt", data.toByteArray());
    }

    private void writeChunk(ByteArrayOutputStream output, String type, byte[] data) throws Exception {
        DataOutputStream stream = new DataOutputStream(output);
        stream.writeInt(data.length);
        stream.write(type.getBytes(StandardCharsets.US_ASCII));
        stream.write(data);
        stream.writeInt(0);
    }
}
