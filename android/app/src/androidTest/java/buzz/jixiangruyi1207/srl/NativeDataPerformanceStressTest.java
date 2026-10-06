package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Device-side stress and latency measurements over an isolated synthetic library. */
@RunWith(AndroidJUnit4.class)
public final class NativeDataPerformanceStressTest {
    private static final String TAG = "SRL_PERF";
    private static final int RESOURCE_COUNT = 20_000;
    private static final int BATCH_SIZE = 500;
    private static final int MATCH_CANDIDATE_COUNT = 200;

    @Test public void stressNativeLibraryIndexPairingAuditAndCardImport() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String databaseName = "srl-performance-stress-" + UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, databaseName);
        try {
            long resourceSeedStarted = SystemClock.elapsedRealtimeNanos();
            seedResources(database);
            long resourceSeedMs = elapsedMs(resourceSeedStarted);
            long bindingSeedStarted = SystemClock.elapsedRealtimeNanos();
            seedBindings(database);
            long bindingSeedMs = elapsedMs(bindingSeedStarted);

            List<Long> pairingReads = new ArrayList<>();
            for (int index = 0; index < 1_000; index++) {
                String resourceKey = JSONObject.quote("resource-" + index);
                long started = SystemClock.elapsedRealtimeNanos();
                JSONArray rows = database.getIndexEntries("resourceSourceBindings", "resourceId", resourceKey);
                pairingReads.add(SystemClock.elapsedRealtimeNanos() - started);
                assertEquals(1, rows.length());
                assertEquals(resourceKey, rows.getJSONObject(0).getString("indexKey"));
            }

            List<Long> pairWrites = new ArrayList<>();
            long pairWritesStarted = SystemClock.elapsedRealtimeNanos();
            for (int index = 0; index < 500; index++) {
                long started = SystemClock.elapsedRealtimeNanos();
                database.putRecords("resourceSourceBindings", new JSONArray().put(
                    bindingRow("new-resource-" + index, "new-source-" + index)));
                pairWrites.add(SystemClock.elapsedRealtimeNanos() - started);
            }
            long pairWritesTotalMs = elapsedMs(pairWritesStarted);

            long duplicateLookupStarted = SystemClock.elapsedRealtimeNanos();
            JSONArray duplicates = database.getIndexEntries(
                "resourceSummaries", "contentHash", JSONObject.quote("hash-17"));
            long duplicateLookupMs = elapsedMs(duplicateLookupStarted);
            assertEquals(4, duplicates.length());

            long auditStarted = SystemClock.elapsedRealtimeNanos();
            int audited = auditEveryResource(database);
            long auditMs = elapsedMs(auditStarted);
            assertEquals(RESOURCE_COUNT, audited);

            CardTimings cardTimings = benchmarkNativeCardParsingAndMatching(context);
            Log.i(TAG, String.format(Locale.US,
                "20k resources seed=%d ms; 20k bindings seed=%d ms; pairing 1000 indexed reads p50=%d us p95=%d us; 500 single-bind writes p50=%d ms p95=%d ms total=%d ms; duplicate index lookup=%d ms (%d matches); full audit=%d rows in %d ms; JSON parse p50=%d ms p95=%d ms; PNG parse p50=%d ms p95=%d ms; %d-card same-name version matching p50=%d ms p95=%d ms",
                resourceSeedMs, bindingSeedMs, percentile(pairingReads, 50) / 1_000L,
                percentile(pairingReads, 95) / 1_000L, millis(percentile(pairWrites, 50)),
                millis(percentile(pairWrites, 95)), pairWritesTotalMs, duplicateLookupMs,
                duplicates.length(), audited, auditMs, cardTimings.jsonP50Ms, cardTimings.jsonP95Ms,
                cardTimings.pngP50Ms, cardTimings.pngP95Ms, MATCH_CANDIDATE_COUNT,
                cardTimings.matchP50Ms, cardTimings.matchP95Ms));

            assertTrue("resource seed should finish within 180 seconds", resourceSeedMs < 180_000);
            assertTrue("binding seed should finish within 180 seconds", bindingSeedMs < 180_000);
            assertTrue("single pair writes should finish within 30 seconds", pairWritesTotalMs < 30_000);
            assertTrue("full 20k-row audit should finish within 45 seconds", auditMs < 45_000);
            assertTrue("production-sized 200-candidate matching should finish within 20 seconds",
                cardTimings.matchP95Ms < 20_000);
        } finally {
            database.close();
            context.deleteDatabase(databaseName);
        }
    }

    private static void seedResources(NativeAppDatabase database) throws Exception {
        for (int start = 0; start < RESOURCE_COUNT; start += BATCH_SIZE) {
            JSONArray rows = new JSONArray();
            for (int index = start; index < start + BATCH_SIZE; index++) {
                String id = "resource-" + index;
                String key = JSONObject.quote(id);
                JSONObject value = new JSONObject()
                    .put("id", id).put("type", "characterCard")
                    .put("name", "Synthetic card " + index)
                    .put("contentHash", "hash-" + (index % 5_000))
                    .put("createdAt", index).put("updatedAt", index)
                    .put("metadata", new JSONObject().put("cardContentHash", "card-hash-" + (index % 5_000)));
                JSONArray indexes = new JSONArray()
                    .put(index("type", JSONObject.quote("characterCard")))
                    .put(index("name", JSONObject.quote("Synthetic card " + index)))
                    .put(index("contentHash", JSONObject.quote("hash-" + (index % 5_000))));
                rows.put(new JSONObject().put("key", key).put("value", value).put("indexes", indexes));
            }
            database.putRecords("resourceSummaries", rows);
        }
    }

    private static void seedBindings(NativeAppDatabase database) throws Exception {
        for (int start = 0; start < RESOURCE_COUNT; start += BATCH_SIZE) {
            JSONArray rows = new JSONArray();
            for (int index = start; index < start + BATCH_SIZE; index++)
                rows.put(bindingRow("resource-" + index, "source-" + (index % 200)));
            database.putRecords("resourceSourceBindings", rows);
        }
    }

    private static JSONObject bindingRow(String resourceId, String sourceId) throws Exception {
        String id = resourceId + "::" + sourceId;
        JSONObject value = new JSONObject().put("id", id).put("resourceId", resourceId)
            .put("sourceId", sourceId).put("createdAt", 1);
        JSONArray indexes = new JSONArray()
            .put(index("resourceId", JSONObject.quote(resourceId)))
            .put(index("sourceId", JSONObject.quote(sourceId)))
            .put(index("[resourceId+sourceId]", new JSONArray()
                .put(resourceId).put(sourceId).toString()));
        return new JSONObject().put("key", JSONObject.quote(id)).put("value", value).put("indexes", indexes);
    }

    private static JSONObject index(String name, String key) throws Exception {
        return new JSONObject().put("name", name).put("keys", new JSONArray().put(key));
    }

    private static int auditEveryResource(NativeAppDatabase database) throws Exception {
        int audited = 0;
        String afterKey = null;
        while (true) {
            JSONArray page = database.getRecords("resourceSummaries", afterKey, BATCH_SIZE);
            for (int index = 0; index < page.length(); index++) {
                JSONObject value = page.getJSONObject(index).getJSONObject("value");
                assertTrue(value.optString("id").startsWith("resource-"));
                assertTrue(value.optString("contentHash").startsWith("hash-"));
                audited++;
            }
            if (page.length() < BATCH_SIZE) return audited;
            afterKey = page.getJSONObject(page.length() - 1).getString("key");
        }
    }

    private static CardTimings benchmarkNativeCardParsingAndMatching(Context context) throws Exception {
        File directory = new File(context.getCacheDir(), "srl-card-perf-" + UUID.randomUUID());
        assertTrue(directory.mkdir());
        File json = new File(directory, "synthetic.json");
        File png = new File(directory, "synthetic.png");
        File sidecar = new File(directory, "parsed.json");
        try {
            JSONObject card = new JSONObject().put("spec", "chara_card_v2").put("spec_version", "2.0")
                .put("data", new JSONObject().put("name", "Synthetic performance card")
                    .put("description", repeatedText("A synthetic description segment for parser throughput. ", 600))
                    .put("creator", "SRL test fixture").put("character_id", "perf-card-1")
                    .put("personality", repeatedText("Calm, curious, observant. ", 300))
                    .put("scenario", repeatedText("A performance test scenario. ", 500))
                    .put("first_mes", repeatedText("Hello, this is a synthetic greeting. ", 500))
                    .put("mes_example", repeatedText("{{char}}: hello\n{{user}}: hi\n", 500)));
            try (FileOutputStream output = new FileOutputStream(json)) {
                output.write(card.toString().getBytes(StandardCharsets.UTF_8));
            }
            writePngCard(png, card);

            List<Long> jsonSamples = new ArrayList<>();
            for (int index = 0; index < 5; index++) NativeCharacterCardProcessor.parseOnly(json, "synthetic.json", sidecar);
            for (int index = 0; index < 50; index++) {
                long started = SystemClock.elapsedRealtimeNanos();
                assertEquals("parsed", NativeCharacterCardProcessor.parseOnly(json, "synthetic.json", sidecar).getString("state"));
                jsonSamples.add(SystemClock.elapsedRealtimeNanos() - started);
            }

            List<Long> pngSamples = new ArrayList<>();
            for (int index = 0; index < 5; index++) NativeCharacterCardProcessor.parseOnly(png, "synthetic.png", sidecar);
            for (int index = 0; index < 30; index++) {
                long started = SystemClock.elapsedRealtimeNanos();
                assertEquals("parsed", NativeCharacterCardProcessor.parseOnly(png, "synthetic.png", sidecar).getString("state"));
                pngSamples.add(SystemClock.elapsedRealtimeNanos() - started);
            }

            JSONObject parsed = new JSONObject(new String(
                java.nio.file.Files.readAllBytes(sidecar.toPath()), StandardCharsets.UTF_8));
            JSONArray candidates = new JSONArray();
            for (int index = 0; index < MATCH_CANDIDATE_COUNT - 1; index++) {
                JSONObject metadata = new JSONObject().put("cardFingerprintVersion", 4)
                    .put("cardContentHash", "different-full-" + index)
                    .put("cardCoreHash", "different-core-" + index);
                candidates.put(new JSONObject().put("id", "match-candidate-" + index)
                    .put("type", "characterCard").put("name", "Synthetic performance card")
                    .put("creator", "SRL test fixture")
                    .put("fileName", "synthetic-" + index + ".json").put("metadata", metadata));
            }
            candidates.put(new JSONObject().put("id", "matching-card").put("type", "characterCard")
                .put("name", "Synthetic performance card").put("fileName", "synthetic.json")
                .put("metadata", new JSONObject().put("cardFingerprintVersion", 4)
                    .put("cardContentHash", parsed.getJSONObject("metadata").getString("cardContentHash"))
                    .put("cardCoreHash", parsed.getJSONObject("metadata").getString("cardCoreHash"))));
            List<Long> matchSamples = new ArrayList<>();
            matchInProductionBatches(parsed, candidates);
            for (int index = 0; index < 3; index++) {
                long started = SystemClock.elapsedRealtimeNanos();
                JSONArray result = matchInProductionBatches(parsed, candidates);
                matchSamples.add(SystemClock.elapsedRealtimeNanos() - started);
                assertEquals(MATCH_CANDIDATE_COUNT, result.length());
                boolean foundIncoming = false;
                for (int match = 0; match < result.length(); match++)
                    foundIncoming |= "matching-card".equals(result.getJSONObject(match).getString("resourceId"));
                assertTrue(foundIncoming);
            }
            return new CardTimings(millis(percentile(jsonSamples, 50)), millis(percentile(jsonSamples, 95)),
                millis(percentile(pngSamples, 50)), millis(percentile(pngSamples, 95)),
                millis(percentile(matchSamples, 50)), millis(percentile(matchSamples, 95)));
        } finally {
            json.delete(); png.delete(); sidecar.delete(); directory.delete();
        }
    }

    private static JSONArray matchInProductionBatches(JSONObject parsed, JSONArray candidates) throws Exception {
        JSONArray matches = new JSONArray();
        for (int offset = 0; offset < candidates.length(); offset += 200) {
            JSONArray batch = new JSONArray();
            for (int index = offset; index < Math.min(offset + 200, candidates.length()); index++)
                batch.put(candidates.getJSONObject(index));
            JSONArray result = NativeCharacterCardProcessor.matchParsedResource(parsed,
                "incoming.json", batch, false);
            for (int index = 0; index < result.length(); index++) matches.put(result.getJSONObject(index));
        }
        return matches;
    }

    private static void writePngCard(File output, JSONObject card) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (DataOutputStream data = new DataOutputStream(bytes)) {
            data.write(new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10});
            byte[] text = ("chara\0" + Base64.encodeToString(card.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP))
                .getBytes(StandardCharsets.ISO_8859_1);
            chunk(data, "tEXt", text);
            chunk(data, "IEND", new byte[0]);
        }
        try (FileOutputStream file = new FileOutputStream(output)) { file.write(bytes.toByteArray()); }
    }

    private static String repeatedText(String segment, int count) {
        StringBuilder result = new StringBuilder(segment.length() * count);
        for (int index = 0; index < count; index++) result.append(segment);
        return result.toString();
    }

    private static void chunk(DataOutputStream output, String name, byte[] data) throws Exception {
        output.writeInt(data.length);
        output.write(name.getBytes(StandardCharsets.US_ASCII));
        output.write(data);
        output.writeInt(0);
    }

    private static long percentile(List<Long> values, int percent) {
        Collections.sort(values);
        return values.get(Math.min(values.size() - 1, (values.size() * percent + 99) / 100 - 1));
    }

    private static long elapsedMs(long startedAtNanos) {
        return millis(SystemClock.elapsedRealtimeNanos() - startedAtNanos);
    }

    private static long millis(long nanoseconds) { return nanoseconds / 1_000_000L; }

    private static final class CardTimings {
        final long jsonP50Ms, jsonP95Ms, pngP50Ms, pngP95Ms, matchP50Ms, matchP95Ms;
        CardTimings(long jsonP50Ms, long jsonP95Ms, long pngP50Ms, long pngP95Ms,
                    long matchP50Ms, long matchP95Ms) {
            this.jsonP50Ms = jsonP50Ms; this.jsonP95Ms = jsonP95Ms;
            this.pngP50Ms = pngP50Ms; this.pngP95Ms = pngP95Ms;
            this.matchP50Ms = matchP50Ms; this.matchP95Ms = matchP95Ms;
        }
    }
}
