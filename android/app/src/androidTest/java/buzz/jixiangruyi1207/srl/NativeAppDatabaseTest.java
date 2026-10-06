package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.util.Base64;
import java.util.UUID;
import java.io.File;
import java.io.FileOutputStream;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class NativeAppDatabaseTest {
    @Test public void persistsPagedRowsAndDeletesOnlyRequestedKeys() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-app-data-test-" + UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, name);
        database.putRecords("settings", new JSONArray()
            .put(new JSONObject().put("key", "a").put("value", new JSONObject().put("id", "a").put("value", true)))
            .put(new JSONObject().put("key", "b").put("value", new JSONObject().put("id", "b").put("value", 2))));

        assertEquals(2L, database.countRecords("settings"));
        database.putState("migration:settings", "{\"copied\":2}");
        JSONArray firstPage = database.getRecords("settings", null, 1);
        assertEquals("a", firstPage.getJSONObject(0).getString("key"));
        JSONArray secondPage = database.getRecords("settings", "a", 1);
        assertEquals("b", secondPage.getJSONObject(0).getString("key"));
        assertEquals(1, secondPage.length());

        database.close();
        database = new NativeAppDatabase(context, name);
        assertEquals(2L, database.countRecords("settings"));
        assertEquals("{\"copied\":2}", database.getState("migration:settings"));
        assertEquals(2, database.getRecordsByKeys("settings", new JSONArray().put("a").put("b")).length());
        assertNotNull(database.getRecord("settings", "a"));
        database.deleteRecords("settings", new JSONArray().put("a"));
        assertEquals(1L, database.countRecords("settings"));
        assertNull(database.getRecord("settings", "a"));
        assertTrue(database.getRecord("settings", "b") != null);
        database.close();
        context.deleteDatabase(name);
    }

    @Test public void rejectsUnknownStoresAndRollsBackMalformedBatches() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-app-data-test-" + UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, name);
        assertThrows(IllegalArgumentException.class, () -> database.countRecords("arbitrary"));

        JSONArray rows = new JSONArray()
            .put(new JSONObject().put("key", "first").put("value", new JSONObject().put("id", "first")))
            .put(new JSONObject().put("key", "invalid").put("value", "not-an-object"));
        assertThrows(IllegalArgumentException.class, () -> database.putRecords("resources", rows));
        assertEquals(0L, database.countRecords("resources"));
        database.close();
        context.deleteDatabase(name);
    }

    @Test public void appliesCrossStoreChangesAtomically() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-app-data-test-" + UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, name);
        JSONArray operations = new JSONArray()
            .put(new JSONObject().put("type", "put").put("store", "resources")
                .put("rows", new JSONArray().put(new JSONObject().put("key", "r1")
                    .put("value", new JSONObject().put("id", "r1")))))
            .put(new JSONObject().put("type", "put").put("store", "resourceSummaries")
                .put("rows", new JSONArray().put(new JSONObject().put("key", "r1")
                    .put("value", new JSONObject().put("id", "r1")))))
            .put(new JSONObject().put("type", "delete").put("store", "resourceListSummaries")
                .put("keys", new JSONArray().put("stale")));
        database.applyBatch(operations);
        assertNotNull(database.getRecord("resources", "r1"));
        assertNotNull(database.getRecord("resourceSummaries", "r1"));

        JSONArray invalid = new JSONArray()
            .put(new JSONObject().put("type", "put").put("store", "resources")
                .put("rows", new JSONArray().put(new JSONObject().put("key", "r2")
                    .put("value", new JSONObject().put("id", "r2")))))
            .put(new JSONObject().put("type", "invalid").put("store", "categories"));
        assertThrows(IllegalArgumentException.class, () -> database.applyBatch(invalid));
        assertNull(database.getRecord("resources", "r2"));
        assertEquals(1L, database.countRecords("resources"));
        database.close();
        context.deleteDatabase(name);
    }

    @Test public void appliesRestoreSizedWriteWithoutSplittingItsTransaction() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-app-data-large-batch-test-" + UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, name);
        JSONArray rows = new JSONArray();
        for (int index = 0; index < 1_001; index++) {
            String id = "setting-" + index;
            rows.put(new JSONObject().put("key", JSONObject.quote(id))
                .put("value", new JSONObject().put("id", id).put("value", index)));
        }
        database.applyBatch(new JSONArray().put(new JSONObject()
            .put("type", "put").put("store", "settings").put("rows", rows)));

        assertEquals(1_001L, database.countRecords("settings"));
        assertEquals(1_001, database.getRecords("settings", null, 1_001).length());
        database.close();
        context.deleteDatabase(name);
    }

    @Test public void replacesAndDeletesSecondaryIndexEntriesWithTheirRecords() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-app-data-index-test-" + UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, name);
        JSONObject row = new JSONObject().put("key", "resource-1")
            .put("value", new JSONObject().put("id", "resource-1").put("type", "characterCard"))
            .put("indexes", new JSONArray().put(new JSONObject().put("name", "type")
                .put("keys", new JSONArray().put(JSONObject.quote("characterCard")))));
        database.putRecords("resources", new JSONArray().put(row));
        assertEquals(1, database.getIndexEntries("resources", "type", JSONObject.quote("characterCard")).length());
        assertEquals(0, database.getIndexEntries("resources", "type", JSONObject.quote("chat")).length());

        database.deleteRecords("resources", new JSONArray().put("resource-1"));
        assertEquals(0, database.getIndexEntries("resources", "type", JSONObject.quote("characterCard")).length());
        database.close();
        context.deleteDatabase(name);
    }

    @Test public void guardedBackgroundBatchCannotCommitDuringRollbackAndClearRemovesIndexes() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-app-data-guard-test-" + UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, name);
        JSONObject active = new JSONObject().put("version", 1).put("mode", "active");
        database.putState("migration:appdb:v1:active", active.toString());
        database.putState("migration:appdb:indexes:v1:active", "verified-v1");
        JSONArray rows = new JSONArray().put(new JSONObject().put("key", "r1")
            .put("value", new JSONObject().put("id", "r1"))
            .put("indexes", new JSONArray().put(new JSONObject().put("name", "type")
                .put("keys", new JSONArray().put(JSONObject.quote("characterCard"))))));
        JSONArray write = new JSONArray().put(new JSONObject().put("type", "put")
            .put("store", "resources").put("rows", rows));

        database.applyBatch(write, true);
        assertEquals(1, database.getIndexEntries("resources", "type", JSONObject.quote("characterCard")).length());
        database.putState("migration:appdb:v1:active",
            new JSONObject().put("version", 1).put("mode", "rolling-back").toString());
        assertThrows(IllegalStateException.class, () -> database.applyBatch(write, true));
        assertEquals(1L, database.countRecords("resources"));

        database.applyBatch(new JSONArray().put(new JSONObject().put("type", "clear")
            .put("store", "resources")));
        assertEquals(0, database.getIndexEntries("resources", "type", JSONObject.quote("characterCard")).length());
        database.close();
        context.deleteDatabase(name);
    }

    @Test public void importsParsedCloudCardDirectlyAndIdempotentlyIntoNativeLibrary() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-app-data-import-test-" + UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, name);
        database.putState("migration:appdb:v1:active",
            new JSONObject().put("version", 1).put("databaseVersion", 25).put("activatedAt", 1).toString());
        database.putState("migration:appdb:indexes:v1:active", "verified-v1");
        File payload = new File(context.getCacheDir(), "native-import-" + UUID.randomUUID() + ".json");
        File parsed = new File(context.getCacheDir(), "native-import-" + UUID.randomUUID() + ".parsed.json");
        try {
            try (FileOutputStream output = new FileOutputStream(payload)) {
                output.write("{\"spec\":\"chara_card_v2\",\"data\":{\"name\":\"Mira\",\"description\":\"A test card\",\"creator\":\"SRL\",\"tags\":[\"test\"]}}"
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            JSONObject card = new JSONObject().put("spec", "chara_card_v2")
                .put("data", new JSONObject().put("name", "Mira").put("description", "A test card")
                    .put("creator", "SRL").put("tags", new JSONArray().put("test")));
            JSONObject metadata = new JSONObject().put("card", card).put("cardContentHash", "a".repeat(64))
                .put("cardCoreHash", "b".repeat(64)).put("characterVersion", "1");
            try (FileOutputStream output = new FileOutputStream(parsed)) {
                output.write(new JSONObject().put("type", "characterCard").put("name", "Mira")
                    .put("description", "A test card").put("tags", new JSONArray().put("test"))
                    .put("metadata", metadata).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }

            JSONObject imported = NativeBackgroundResourceImporter.importIfSafe(
                context, database, payload, parsed, "Mira.json", "application/json");
            assertEquals("imported", imported.getString("state"));
            String key = JSONObject.quote(imported.getString("resourceId"));
            JSONObject resource = database.getRecord("resources", key);
            assertEquals("characterCard", resource.getString("type"));
            assertEquals("Mira", resource.getString("name"));
            assertEquals("blob", resource.getJSONObject("originalBlob").getString("__srlAppDatabaseValueV1"));
            assertEquals("Mira", database.getRecord("resourceSummaries", key).getString("name"));
            assertEquals("Mira", database.getRecord("resourceListSummaries", key).getString("name"));
            assertEquals(1, database.getIndexEntries("resourceSummaries", "type",
                JSONObject.quote("characterCard")).length());
            assertEquals(1, database.getIndexEntries("resourceSummaries", "contentHash",
                JSONObject.quote(resource.getString("contentHash"))).length());

            JSONObject duplicate = NativeBackgroundResourceImporter.importIfSafe(
                context, database, payload, parsed, "Mira.json", "application/json");
            assertEquals("duplicate_file", duplicate.getString("state"));
            assertEquals(1L, database.countRecords("resources"));
        } finally {
            payload.delete(); parsed.delete(); database.close(); context.deleteDatabase(name);
        }
    }

    @Test public void activeExactCardDuplicateSkipsUnrelatedHistoricalRows() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-app-data-import-shortcut-test-" + UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, name);
        database.putState("migration:appdb:v1:active",
            new JSONObject().put("version", 1).put("databaseVersion", 25).put("activatedAt", 1).toString());
        database.putState("migration:appdb:indexes:v1:active", "verified-v1");
        File payload = new File(context.getCacheDir(), "native-import-shortcut-" + UUID.randomUUID() + ".json");
        File parsed = new File(context.getCacheDir(), "native-import-shortcut-" + UUID.randomUUID() + ".parsed.json");
        try {
            try (FileOutputStream output = new FileOutputStream(payload)) {
                output.write("{\"spec\":\"chara_card_v2\",\"data\":{\"name\":\"Mira\",\"description\":\"A test card\",\"creator\":\"SRL\"}}"
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            NativeCharacterCardProcessor.parseOnly(payload, "Mira.json", parsed);
            JSONObject existing = NativeShareImportService.readMetadata(parsed)
                .put("id", "existing-card").put("fileName", "Mira.json")
                .put("contentHash", "0".repeat(64));
            JSONArray indexes = new JSONArray()
                .put(new JSONObject().put("name", "type")
                    .put("keys", new JSONArray().put(JSONObject.quote("characterCard"))))
                .put(new JSONObject().put("name", "contentHash")
                    .put("keys", new JSONArray().put(JSONObject.quote("0".repeat(64)))));
            database.putRecords("resourceSummaries", new JSONArray().put(new JSONObject()
                .put("key", JSONObject.quote("existing-card")).put("value", existing).put("indexes", indexes)));
            database.putRecords("resourceVersionSummaries", new JSONArray().put(new JSONObject()
                .put("key", JSONObject.quote("unrelated-history"))
                .put("value", new JSONObject().put("encrypted", true))));

            JSONObject result = NativeBackgroundResourceImporter.importIfSafe(
                context, database, payload, parsed, "Mira.json", "application/json");
            assertEquals("duplicate_card", result.getString("state"));
        } finally {
            payload.delete(); parsed.delete(); database.close(); context.deleteDatabase(name);
        }
    }

    @Test public void resumesLargeBlobTransferAndVerifiesContentBeforePublishing() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-app-data-test-" + UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, name);
        byte[] first = "hello ".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] second = "world".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        NativeAppDatabase.BlobTransfer started = database.beginBlob("assetFiles", "asset-1", "blob", 11L, "text/plain");
        assertEquals(0L, started.offset);
        assertEquals(6L, database.appendBlob(started.token, 0L, first));
        database.close();

        database = new NativeAppDatabase(context, name);
        NativeAppDatabase.BlobTransfer resumed = database.beginBlob("assetFiles", "asset-1", "blob", 11L, "text/plain");
        assertEquals(started.token, resumed.token);
        assertEquals(6L, resumed.offset);
        assertEquals(11L, database.appendBlob(resumed.token, 6L, second));
        JSONObject metadata = database.completeBlob(resumed.token);
        assertEquals("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", metadata.getString("sha256"));
        JSONObject chunk = database.readBlobChunk("assetFiles", "asset-1", "blob", 0L, 11);
        assertEquals("hello world", new String(Base64.decode(chunk.getString("data"), Base64.NO_WRAP), java.nio.charset.StandardCharsets.UTF_8));
        assertTrue(chunk.getBoolean("eof"));
        database.putRecords("assetFiles", new JSONArray().put(new JSONObject().put("key", "asset-1")
            .put("value", new JSONObject().put("assetId", "asset-1").put("blob", new JSONObject()
                .put("__srlAppDatabaseValueV1", "blob").put("fieldPath", "blob")
                .put("sha256", metadata.getString("sha256"))))));
        database.putRecords("assetFiles", new JSONArray().put(new JSONObject()
            .put("key", "asset-1").put("value", new JSONObject().put("assetId", "asset-1"))));
        assertNull(database.readBlobChunk("assetFiles", "asset-1", "blob", 0L, 11));
        database.deleteRecords("assetFiles", new JSONArray().put("asset-1"));
        assertEquals(0L, database.countRecords("assetFiles"));
        assertNull(database.readBlobChunk("assetFiles", "asset-1", "blob", 0L, 11));
        database.close();
        context.deleteDatabase(name);
    }

    @Test public void stagedBlobReferencesMoveOnlyWithCommittedRows() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-app-data-test-" + UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(context, name);
        String stagingKey = "__srl_tx_" + UUID.randomUUID();
        String destinationKey = "resource-1";
        String fieldPath = "$/originalBlob";
        byte[] contents = "staged attachment".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        NativeAppDatabase.BlobTransfer transfer = database.beginBlob(
            "resources", stagingKey, fieldPath, contents.length, "application/octet-stream");
        database.appendBlob(transfer.token, 0L, contents);
        JSONObject staged = database.completeBlob(transfer.token);

        JSONObject descriptor = new JSONObject()
            .put("__srlAppDatabaseValueV1", "blob")
            .put("fieldPath", fieldPath)
            .put("blobOwnerKey", stagingKey)
            .put("size", contents.length)
            .put("mimeType", "application/octet-stream")
            .put("sha256", staged.getString("sha256"));
        JSONArray rejected = new JSONArray()
            .put(new JSONObject().put("type", "put").put("store", "resources")
                .put("rows", new JSONArray().put(new JSONObject().put("key", destinationKey)
                    .put("value", new JSONObject().put("id", destinationKey).put("original", descriptor)))))
            .put(new JSONObject().put("type", "invalid").put("store", "categories"));
        assertThrows(IllegalArgumentException.class, () -> database.applyBatch(rejected));
        assertNull(database.getRecord("resources", destinationKey));
        JSONObject stillStaged = database.readBlobChunk("resources", stagingKey, fieldPath, 0L, contents.length);
        assertNotNull(stillStaged);

        JSONArray committed = new JSONArray().put(new JSONObject()
            .put("type", "put").put("store", "resources")
            .put("rows", new JSONArray().put(new JSONObject().put("key", destinationKey)
                .put("value", new JSONObject().put("id", destinationKey).put("original", descriptor)))));
        database.applyBatch(committed);
        assertNull(database.readBlobChunk("resources", stagingKey, fieldPath, 0L, contents.length));
        JSONObject attached = database.readBlobChunk("resources", destinationKey, fieldPath, 0L, contents.length);
        assertEquals(new String(contents, java.nio.charset.StandardCharsets.UTF_8),
            new String(Base64.decode(attached.getString("data"), Base64.NO_WRAP), java.nio.charset.StandardCharsets.UTF_8));
        assertFalse(database.getRecord("resources", destinationKey).getJSONObject("original").has("blobOwnerKey"));

        database.deleteRecords("resources", new JSONArray().put(destinationKey));
        assertNull(database.readBlobChunk("resources", destinationKey, fieldPath, 0L, contents.length));
        database.close();
        context.deleteDatabase(name);
    }
}
