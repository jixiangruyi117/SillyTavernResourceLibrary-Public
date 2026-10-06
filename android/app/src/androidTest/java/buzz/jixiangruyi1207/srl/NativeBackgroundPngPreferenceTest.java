package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

@RunWith(AndroidJUnit4.class)
public class NativeBackgroundPngPreferenceTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test public void incomingPngBecomesCurrentAndKeepsPreviousJsonAsContainer() throws Exception {
        runContainerPreferenceCase(true);
    }

    @Test public void incomingJsonIsArchivedWithoutReplacingCurrentPng() throws Exception {
        runContainerPreferenceCase(false);
    }

    @Test public void incomingJsonMatchingHistoricalPngKeepsNewerCurrentVersion() throws Exception {
        runHistoricalContainerCase(false);
    }

    @Test public void incomingPngMatchingHistoricalJsonKeepsNewerCurrentVersion() throws Exception {
        runHistoricalContainerCase(true);
    }

    private void runHistoricalContainerCase(boolean incomingPng) throws Exception {
        String databaseName = "srl-png-history-pref-" + java.util.UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, databaseName);
        File directory = new File(context.getCacheDir(), "srl-png-history-pref-" + java.util.UUID.randomUUID());
        assertTrue(directory.mkdir());
        try {
            database.putState("migration:appdb:v1:active", new JSONObject()
                .put("version", 1).put("mode", "active").toString());
            database.putState("migration:appdb:indexes:v1:active", "verified-v1");
            database.putRecords("settings", new JSONArray().put(new JSONObject()
                .put("key", JSONObject.quote("discordInbox.automation.v1"))
                .put("value", new JSONObject().put("id", "discordInbox.automation.v1")
                    .put("value", new JSONObject().put("preferPngContainer", true)))));

            JSONObject matchedCard = card();
            JSONObject currentCard = card("A later semantic version.");
            String currentName = incomingPng ? "current.png" : "current.json";
            File currentFile = new File(directory, currentName);
            writeCard(currentFile, incomingPng, currentCard, false);
            JSONObject currentParsed = parse(currentFile, currentFile.getName(), directory);
            String currentId = "active-card";
            String currentKey = JSONObject.quote(currentId);
            JSONObject current = new JSONObject(currentParsed.toString()).put("id", currentId)
                .put("fileName", currentName).put("createdAt", 10L).put("versionCount", 2)
                .put("favorite", true);
            JSONObject currentAttachment = storeBlob(database, "resources", currentKey, currentFile);
            current.put("originalBlob", blobReference(currentKey, currentFile.length(), currentAttachment));
            JSONObject currentSummary = new JSONObject(current.toString()); currentSummary.remove("originalBlob");

            String historicalName = incomingPng ? "matched.json" : "matched.png";
            File historicalFile = new File(directory, historicalName);
            writeCard(historicalFile, historicalName.endsWith(".png"), matchedCard, false);
            JSONObject historicalParsed = parse(historicalFile, historicalFile.getName(), directory);
            String historicalId = "matching-historical-png";
            String historicalKey = JSONObject.quote(historicalId);
            JSONObject historical = new JSONObject(historicalParsed.toString()).put("id", historicalId)
                .put("fileName", historicalName).put("versionGroupId", currentId)
                .put("versionVariantKind", "container").put("versionCount", 2);
            JSONObject historicalMetadata = historical.getJSONObject("metadata").put("versionVariantKind", "container");
            historical.put("metadata", historicalMetadata);
            JSONObject historicalAttachment = storeBlob(database, "resourceVersions", historicalKey, historicalFile);
            historical.put("originalBlob", blobReference(historicalKey, historicalFile.length(), historicalAttachment));
            JSONObject historicalSummary = new JSONObject(historical.toString()); historicalSummary.remove("originalBlob");
            database.applyBatch(new JSONArray()
                .put(put("resources", currentKey, current))
                .put(put("resourceSummaries", currentKey, currentSummary, true))
                .put(put("resourceListSummaries", currentKey, currentSummary))
                .put(put("resourceVersions", historicalKey, historical))
                .put(put("resourceVersionSummaries", historicalKey, historicalSummary)));

            String incomingName = incomingPng ? "incoming.png" : "incoming.json";
            File incoming = new File(directory, incomingName);
            writeCard(incoming, incomingPng, matchedCard, true);
            JSONObject parsedIncoming = parse(incoming, incoming.getName(), directory);
            File parsedFile = new File(directory, "incoming.parsed.json");
            try (FileOutputStream output = new FileOutputStream(parsedFile)) {
                output.write(parsedIncoming.toString().getBytes(StandardCharsets.UTF_8));
            }
            JSONObject result = NativeBackgroundResourceImporter.importIfSafe(
                context, database, incoming, parsedFile, incoming.getName(),
                incomingPng ? "image/png" : "application/json");
            assertEquals(result.toString(), "imported", result.getString("state"));
            JSONObject active = database.getRecord("resources", currentKey);
            assertEquals(currentName, active.getString("fileName"));
            assertTrue(active.getBoolean("favorite"));
            JSONArray versions = database.getRecords("resourceVersions", null, 20);
            assertEquals(2, versions.length());
            boolean matchedHistoricalPng = false;
            boolean incomingJson = false;
            for (int index = 0; index < versions.length(); index++) {
                JSONObject version = versions.getJSONObject(index).getJSONObject("value");
                matchedHistoricalPng |= historicalName.equals(version.optString("fileName"));
                incomingJson |= incomingName.equals(version.optString("fileName"))
                    && "container".equals(version.optJSONObject("metadata").optString("versionVariantKind"));
            }
            assertTrue(matchedHistoricalPng);
            assertTrue(incomingJson);
            assertNotNull(database.getRecord("resourceVersions", historicalKey));
        } finally {
            database.close();
            context.deleteDatabase(databaseName);
            File[] children = directory.listFiles();
            if (children != null) for (File child : children) child.delete();
            directory.delete();
        }
    }

    private void runContainerPreferenceCase(boolean incomingPng) throws Exception {
        String databaseName = "srl-png-pref-" + java.util.UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, databaseName);
        File directory = new File(context.getCacheDir(), "srl-png-pref-" + java.util.UUID.randomUUID());
        assertTrue(directory.mkdir());
        try {
            database.putState("migration:appdb:v1:active", new JSONObject()
                .put("version", 1).put("mode", "active").toString());
            database.putState("migration:appdb:indexes:v1:active", "verified-v1");
            database.putRecords("settings", new JSONArray().put(new JSONObject()
                .put("key", JSONObject.quote("discordInbox.automation.v1"))
                .put("value", new JSONObject().put("id", "discordInbox.automation.v1")
                    .put("value", new JSONObject().put("preferPngContainer", true)))));

            JSONObject card = card();
            String currentName = incomingPng ? "same.json" : "same.png";
            File currentPayload = new File(directory, currentName);
            writeCard(currentPayload, currentName.endsWith(".png"), card, false);
            JSONObject parsedCurrent = parse(currentPayload, currentName, directory);
            String currentId = "current-resource";
            String currentKey = JSONObject.quote(currentId);
            JSONObject current = new JSONObject(parsedCurrent.toString())
                .put("id", currentId).put("fileName", currentName)
                .put("createdAt", 100L).put("updatedAt", 100L)
                .put("versionCount", 1).put("favorite", true);
            JSONObject oldBlob = storeBlob(database, "resources", currentKey, currentPayload);
            current.put("originalBlob", blobReference(currentKey, currentPayload.length(), oldBlob));
            JSONObject summary = new JSONObject(current.toString());
            summary.remove("originalBlob");
            database.applyBatch(new JSONArray()
                .put(put("resources", currentKey, current))
                .put(put("resourceSummaries", currentKey, summary, true))
                .put(put("resourceListSummaries", currentKey, summary, false)));

            String importName = incomingPng ? "incoming.png" : "incoming.json";
            File payload = new File(directory, importName);
            writeCard(payload, incomingPng, card, true);
            JSONObject parsed = parse(payload, importName, directory);
            File parsedFile = new File(directory, importName + ".parsed.json");
            try (FileOutputStream output = new FileOutputStream(parsedFile)) {
                output.write(parsed.toString().getBytes(StandardCharsets.UTF_8));
            }
            JSONObject result = NativeBackgroundResourceImporter.importIfSafe(
                context, database, payload, parsedFile, importName,
                incomingPng ? "image/png" : "application/json");
            assertEquals(result.toString(), "imported", result.getString("state"));
            assertEquals("current-resource", result.getString("resourceId"));

            JSONObject active = database.getRecord("resources", currentKey);
            assertNotNull(active);
            assertEquals(incomingPng ? "incoming.png" : "same.png", active.getString("fileName"));
            assertTrue(active.getBoolean("favorite"));
            if (incomingPng)
                assertEquals("container", active.getJSONObject("metadata").getString("versionVariantKind"));

            JSONArray versions = database.getRecords("resourceVersions", null, 20);
            assertEquals(1, versions.length());
            JSONObject archived = versions.getJSONObject(0).getJSONObject("value");
            assertEquals(incomingPng ? "same.json" : "incoming.json", archived.getString("fileName"));
            assertEquals("container", archived.getJSONObject("metadata").getString("versionVariantKind"));
            assertNull(archived.getJSONObject("originalBlob").optString("blobOwnerKey", null));
            String archivedKey = versions.getJSONObject(0).getString("key");
            JSONObject archivedBytes = database.readBlobChunk(
                "resourceVersions", archivedKey, "$/originalBlob", 0L,
                (int) archived.getJSONObject("originalBlob").getLong("size"));
            assertNotNull(archivedBytes);
            String archivedPayload = new String(Base64.decode(archivedBytes.getString("data"), Base64.NO_WRAP),
                StandardCharsets.UTF_8);
            assertTrue(archivedPayload.length() > 10);
            JSONObject activeBytes = database.readBlobChunk("resources", currentKey, "$/originalBlob", 0L,
                (int) active.getJSONObject("originalBlob").getLong("size"));
            assertNotNull(activeBytes);
            assertEquals("image/png", active.getJSONObject("originalBlob").getString("mimeType"));
        } finally {
            database.close();
            context.deleteDatabase(databaseName);
            File[] children = directory.listFiles();
            if (children != null) for (File child : children) child.delete();
            directory.delete();
        }
    }

    private JSONObject card() throws Exception {
        return card("Hello from the same card.");
    }

    private JSONObject card(String greeting) throws Exception {
        JSONObject data = new JSONObject().put("name", "PNG Preference Fixture")
            .put("description", "A stable exact-content fixture.")
            .put("first_mes", greeting);
        return new JSONObject().put("spec", "chara_card_v2").put("spec_version", "2.0").put("data", data);
    }

    private void writeCard(File output, boolean png, JSONObject card, boolean alternateWhitespace) throws Exception {
        String json = alternateWhitespace ? card.toString(2) : card.toString();
        try (FileOutputStream file = new FileOutputStream(output)) {
            if (png) {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                try (DataOutputStream data = new DataOutputStream(bytes)) {
                    data.write(new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10});
                    String payload = "chara\0" + Base64.encodeToString(
                        json.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
                    byte[] text = payload.getBytes(StandardCharsets.ISO_8859_1);
                    data.writeInt(text.length); data.writeBytes("tEXt"); data.write(text); data.writeInt(0);
                    data.writeInt(0); data.writeBytes("IEND"); data.writeInt(0);
                }
                file.write(bytes.toByteArray());
            } else file.write(json.getBytes(StandardCharsets.UTF_8));
        }
    }

    private JSONObject parse(File payload, String fileName, File directory) throws Exception {
        File sidecar = new File(directory, fileName + ".parsed.json");
        JSONObject result = NativeCharacterCardProcessor.parseOnly(payload, fileName, sidecar);
        assertEquals("parsed", result.getString("state"));
        try {
            return new JSONObject(new String(java.nio.file.Files.readAllBytes(sidecar.toPath()), StandardCharsets.UTF_8));
        } finally { sidecar.delete(); }
    }

    private JSONObject storeBlob(NativeAppDatabase database, String store, String key, File payload) throws Exception {
        NativeAppDatabase.BlobTransfer transfer = database.beginBlob(
            store, key, "$/originalBlob", payload.length(), payload.getName().endsWith(".png") ? "image/png" : "application/json");
        byte[] bytes = java.nio.file.Files.readAllBytes(payload.toPath());
        database.appendBlob(transfer.token, 0L, bytes);
        return database.completeBlob(transfer.token);
    }

    private JSONObject blobReference(String key, long size, JSONObject attachment) throws Exception {
        return new JSONObject().put("__srlAppDatabaseValueV1", "blob").put("fieldPath", "$/originalBlob")
            .put("blobOwnerKey", key).put("size", size)
            .put("mimeType", attachment.optString("mimeType"))
            .put("sha256", attachment.getString("sha256"));
    }

    private JSONObject put(String store, String key, JSONObject value) throws Exception {
        return put(store, key, value, false);
    }

    private JSONObject put(String store, String key, JSONObject value, boolean typeIndex) throws Exception {
        JSONObject row = new JSONObject().put("key", key).put("value", value);
        if (typeIndex) row.put("indexes", new JSONArray().put(new JSONObject()
            .put("name", "type").put("keys", new JSONArray().put(JSONObject.quote("characterCard")))));
        return new JSONObject().put("type", "put").put("store", store).put("rows", new JSONArray().put(row));
    }
}
