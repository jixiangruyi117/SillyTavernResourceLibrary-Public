package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.util.zip.CRC32;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

@RunWith(AndroidJUnit4.class)
public class NativeBackgroundPngPreferenceTest {
    @Test public void standaloneWorldBookImportsInBackgroundAndSurvivesReopenWithoutBindingOrDuplicate() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-world-book-" + java.util.UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(app, name);
        File directory = new File(app.getCacheDir(), name);
        assertTrue(directory.mkdir());
        try {
            database.putState("migration:appdb:v1:active", "{\"version\":1,\"mode\":\"active\"}");
            database.putState("migration:appdb:indexes:v1:active", "verified-v1");
            database.putRecords("settings", new JSONArray().put(new JSONObject().put("key", JSONObject.quote("discordInbox.automation.v1"))
                .put("value", new JSONObject().put("id", "discordInbox.automation.v1").put("value", new JSONObject().put("bindNextPng", true)))));
            JSONObject original = new JSONObject().put("name", "后台世界书")
                .put("entries", new JSONObject().put("0", new JSONObject().put("content", "完整世界设定").put("unknownExtension", true)));
            File payload = new File(directory, "world.json");
            byte[] bytes = original.toString().getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream output = new FileOutputStream(payload)) { output.write(bytes); }
            File parsedFile = new File(directory, "world.character-card.json");
            assertEquals("not_character_card", NativeCharacterCardProcessor.parseOnly(payload, payload.getName(), parsedFile).getString("state"));
            assertFalse(parsedFile.exists());
            JSONObject processed = NativeCharacterCardProcessor.parseBackgroundResource(payload, payload.getName(), parsedFile);
            assertEquals("parsed", processed.getString("state"));
            assertEquals("worldBook", processed.getString("resourceType"));
            JSONObject result = NativeBackgroundResourceImporter.importIfSafe(app, database, payload, parsedFile, payload.getName(), "application/json");
            assertEquals("imported", result.getString("state"));
            assertEquals("worldBook", result.getString("resourceType"));
            String key = JSONObject.quote(result.getString("resourceId"));
            database.close();
            database = new NativeAppDatabase(app, name);
            JSONObject resource = database.getRecord("resources", key);
            assertEquals("worldBook", resource.getString("type"));
            assertEquals(1, resource.getJSONObject("metadata").getInt("itemCount"));
            assertEquals("worldBook", database.getRecord("resourceSummaries", key).getString("type"));
            assertEquals("worldBook", database.getRecord("resourceListSummaries", key).getString("type"));
            JSONObject stored = database.readBlobChunk("resources", key, "$/originalBlob", 0L, bytes.length);
            org.junit.Assert.assertArrayEquals(bytes, Base64.decode(stored.getString("data"), Base64.DEFAULT));
            JSONObject repeated = NativeBackgroundResourceImporter.importIfSafe(app, database, payload, parsedFile, payload.getName(), "application/json");
            assertEquals("duplicate_file", repeated.getString("state"));
            assertEquals(result.getString("resourceId"), repeated.getString("resourceId"));
            assertEquals(1L, database.countRecords("resources"));
            assertEquals(0L, database.countRecords("resourceSourceBindings"));
        } finally {
            database.close(); app.deleteDatabase(name);
            File[] children = directory.listFiles();
            if (children != null) for (File child : children) child.delete();
            directory.delete();
        }
    }
    @Test public void twoPostsBindSequentiallyAndSecondAuthorMatchIgnoresCommittedFirstPost() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-two-posts-" + java.util.UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(app, name);
        File directory = new File(app.getCacheDir(), name);
        assertTrue(directory.mkdir());
        android.app.NotificationManager manager = (android.app.NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        java.util.Set<String> bindingTags = new java.util.HashSet<>();
        try {
            database.putState("migration:appdb:v1:active", "{\"version\":1,\"mode\":\"active\"}");
            database.putState("migration:appdb:indexes:v1:active", "verified-v1");
            database.putRecords("settings", new JSONArray().put(new JSONObject().put("key", JSONObject.quote("discordInbox.automation.v1"))
                .put("value", new JSONObject().put("id", "discordInbox.automation.v1").put("value", new JSONObject().put("bindSameName", true).put("bindSameAuthor", true)))));
            for (String id : new String[] {"post-a", "post-b"}) {
                JSONObject source = new JSONObject().put("id", id).put("title", "post-a".equals(id) ? "PNG Preference Fixture 的帖子" : "第二篇故事")
                    .put("createdAt", 1L).put("updatedAt", 10L).put("autoBindScan", new JSONObject().put("version", 1).put("status", "scanning"));
                database.putRecords("communitySources", new JSONArray().put(new JSONObject().put("key", JSONObject.quote(id)).put("value", source)
                    .put("indexes", new JSONArray().put(new JSONObject().put("name", "updatedAt").put("keys", new JSONArray().put("10"))))));
                database.putRecords("communitySourceMessages", new JSONArray().put(new JSONObject().put("key", JSONObject.quote(id + "-starter"))
                    .put("value", new JSONObject().put("content", "作者：作者乙"))
                    .put("indexes", new JSONArray().put(new JSONObject().put("name", "[sourceId+kind]").put("keys", new JSONArray().put(new JSONArray().put(id).put("starter").toString()))))));
            }
            for (int index = 0; index < 2; index++) {
                JSONObject payloadCard = card();
                payloadCard.getJSONObject("data").put("creator", "作者乙");
                if (index == 1) payloadCard.getJSONObject("data").put("name", "另一张角色卡");
                File payload = new File(directory, "card-" + index + ".png");
                writeCard(payload, true, payloadCard, false);
                File parsedFile = new File(directory, "card-" + index + ".json");
                try (FileOutputStream output = new FileOutputStream(parsedFile)) { output.write(parse(payload, payload.getName(), directory).toString().getBytes(StandardCharsets.UTF_8)); }
                JSONObject result = NativeBackgroundResourceImporter.importIfSafe(app, database, payload, parsedFile, payload.getName(), "image/png");
                String expected = index == 0 ? "post-a" : "post-b";
                assertEquals(expected, result.getString("autoBoundSourceId"));
                assertEquals(1L, database.countIndexEntries("resourceSourceBindings", "sourceId", JSONObject.quote(expected)));
                assertFalse(database.getRecord("communitySources", JSONObject.quote(expected)).has("autoBindScan"));
                String bindingTag = NativeDiscordInboxService.autoBindingNotificationTag(new JSONObject()
                    .put("sourceId", expected).put("resourceId", result.getString("resourceId")));
                bindingTags.add(bindingTag);
                boolean notified = false;
                for (android.service.notification.StatusBarNotification active : manager.getActiveNotifications())
                    if (bindingTag.equals(active.getTag())) notified = active.getNotification().extras.getString(android.app.Notification.EXTRA_TEXT).contains(index == 0 ? "PNG Preference Fixture 的帖子" : "第二篇故事");
                assertTrue("Each committed automatic binding must immediately publish its system result", notified);
            }
            assertEquals(2L, database.countRecords("resourceSourceBindings"));
            java.util.Set<String> visibleTags = new java.util.HashSet<>();
            for (android.service.notification.StatusBarNotification active : manager.getActiveNotifications())
                visibleTags.add(active.getTag());
            assertTrue("The second binding must not replace the first system result", visibleTags.containsAll(bindingTags));
        } finally {
            for (String tag : bindingTags) manager.cancel(tag, 2133);
            database.close(); app.deleteDatabase(name);
            File[] children = directory.listFiles();
            if (children != null) for (File child : children) child.delete();
            directory.delete();
        }
    }
    @Test public void newPngAndDuplicateRepairUseCanonicalAssetsAndPublishStandaloneBindingNotification() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String databaseName = "srl-png-asset-" + java.util.UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(app, databaseName);
        File directory = new File(app.getCacheDir(), databaseName);
        assertTrue(directory.mkdir());
        android.app.NotificationManager manager = (android.app.NotificationManager)
            app.getSystemService(Context.NOTIFICATION_SERVICE);
        String bindingTag = null;
        try {
            database.putState("migration:appdb:v1:active", "{\"version\":1,\"mode\":\"active\"}");
            database.putState("migration:appdb:indexes:v1:active", "verified-v1");
            database.putRecords("settings", new JSONArray().put(new JSONObject()
                .put("key", JSONObject.quote("discordInbox.automation.v1"))
                .put("value", new JSONObject().put("id", "discordInbox.automation.v1")
                    .put("value", new JSONObject().put("bindNextPng", true).put("preferPngContainer", true)))));
            String sourceKey = JSONObject.quote("thumbnail-post");
            database.putRecords("communitySources", new JSONArray().put(new JSONObject()
                .put("key", sourceKey).put("value", new JSONObject().put("id", "thumbnail-post")
                    .put("title", "Thumbnail Fixture Post").put("updatedAt", 10L).put("autoBindPendingPng", true))
                .put("indexes", new JSONArray().put(new JSONObject().put("name", "updatedAt")
                    .put("keys", new JSONArray().put("10"))))));
            File payload = new File(directory, "new.png");
            writeCard(payload, true, card(), false);
            JSONObject parsed = parse(payload, "new.png", directory);
            File parsedFile = new File(directory, "new.parsed.json");
            try (FileOutputStream output = new FileOutputStream(parsedFile)) {
                output.write(parsed.toString().getBytes(StandardCharsets.UTF_8));
            }
            JSONObject result = NativeBackgroundResourceImporter.importIfSafe(app, database,
                payload, parsedFile, "new.png", "image/png");
            assertEquals("imported", result.getString("state"));
            String key = JSONObject.quote(result.getString("resourceId"));
            JSONObject resource = database.getRecord("resources", key);
            String assetId = resource.getString("thumbnailAssetId");
            assertEquals(assetId, database.getRecord("resourceSummaries", key).getString("thumbnailAssetId"));
            assertEquals(assetId, database.getRecord("resourceListSummaries", key).getString("thumbnailAssetId"));
            assertFalse(database.getRecord("resourceListSummaries", key).has("thumbnailBlob"));
            assertEquals(1, database.verifyStore("assetFiles").getInt("files"));
            assertEquals(1, database.verifyStore("resources").getInt("files"));
            assertEquals("thumbnail-post", result.getString("autoBoundSourceId"));
            bindingTag = NativeDiscordInboxService.autoBindingNotificationTag(new JSONObject()
                .put("sourceId", "thumbnail-post").put("resourceId", result.getString("resourceId")));
            android.service.notification.StatusBarNotification bindingNotification = null;
            for (android.service.notification.StatusBarNotification active : manager.getActiveNotifications())
                if (bindingTag.equals(active.getTag())) bindingNotification = active;
            assertNotNull("Committed background binding must publish an OS notification", bindingNotification);
            assertNull(bindingNotification.getNotification().getGroup());
            assertEquals("srl_auto_binding", bindingNotification.getNotification().getChannelId());
            assertTrue(bindingNotification.getNotification().extras.getString(android.app.Notification.EXTRA_TEXT)
                .contains("Thumbnail Fixture Post"));

            // Emulate old imports whose preview was absent from resources/summaries.
            resource.remove("thumbnailAssetId");
            String assetKey = JSONObject.quote(assetId);
            JSONObject existingAsset = database.getRecord("assets", assetKey);
            existingAsset.put("vaultProtected", false);
            database.putRecords("assets", new JSONArray().put(new JSONObject().put("key", assetKey).put("value", existingAsset)));
            database.putRecords("resources", new JSONArray().put(new JSONObject().put("key", key).put("value", resource)));
            JSONObject duplicate = NativeBackgroundResourceImporter.importIfSafe(app, database,
                payload, parsedFile, "new.png", "image/png");
            assertEquals("duplicate_file", duplicate.getString("state"));
            assertEquals(assetId, database.getRecord("resources", key).getString("thumbnailAssetId"));
            assertEquals(assetId, database.getRecord("resourceListSummaries", key).getString("thumbnailAssetId"));
            assertEquals(1L, database.countRecords("assets"));
            assertTrue(database.getRecord("assets", assetKey).getBoolean("vaultProtected"));
        } finally {
            if (bindingTag != null) manager.cancel(bindingTag, 2133);
            for (String store : new String[] {"resources", "resourceSummaries", "resourceListSummaries",
                "assets", "assetFiles", "communitySources", "resourceSourceBindings", "settings"}) database.clearStore(store);
            database.close(); app.deleteDatabase(databaseName);
            File[] children = directory.listFiles();
            if (children != null) for (File child : children) child.delete();
            directory.delete();
        }
    }
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
            if (incomingPng) {
                JSONObject list = database.getRecord("resourceListSummaries", currentKey);
                String assetId = list.getString("thumbnailAssetId");
                assertEquals(assetId, active.getString("thumbnailAssetId"));
                assertEquals(assetId, database.getRecord("resourceSummaries", currentKey).getString("thumbnailAssetId"));
                assertFalse(list.has("thumbnailBlob"));
                String assetKey = JSONObject.quote(assetId);
                assertEquals("thumbnail", database.getRecord("assets", assetKey).getString("source"));
                JSONObject thumbnail = database.getRecord("assetFiles", assetKey).getJSONObject("blob");
                assertEquals("$/blob", thumbnail.getString("fieldPath"));
                assertEquals("image/jpeg", thumbnail.getString("mimeType"));
                assertFalse(thumbnail.has("blobOwnerKey"));
                JSONObject thumbnailBytes = database.readBlobChunk("assetFiles", assetKey,
                    "$/blob", 0L, (int) thumbnail.getLong("size"));
                byte[] decodedThumbnail = Base64.decode(thumbnailBytes.getString("data"), Base64.NO_WRAP);
                assertTrue(decodedThumbnail.length > 4);
                assertEquals((byte) 0xff, decodedThumbnail[0]);
                assertEquals((byte) 0xd8, decodedThumbnail[1]);
                assertEquals(1L, database.countIndexEntries("assets", "contentHash",
                    JSONObject.quote(assetId.substring("asset-".length()))));
                assertEquals(1, database.verifyStore("assetFiles").getInt("files"));
            }

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
                Bitmap bitmap = Bitmap.createBitmap(48, 32, Bitmap.Config.ARGB_8888);
                try {
                    new Canvas(bitmap).drawColor(Color.rgb(74, 156, 168));
                    ByteArrayOutputStream image = new ByteArrayOutputStream();
                    assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, image));
                    byte[] encoded = image.toByteArray();
                    String payload = "chara\0" + Base64.encodeToString(
                        json.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
                    byte[] text = payload.getBytes(StandardCharsets.ISO_8859_1);
                    int iend = findChunk(encoded, "IEND");
                    ByteArrayOutputStream result = new ByteArrayOutputStream(encoded.length + text.length + 16);
                    result.write(encoded, 0, iend);
                    try (DataOutputStream data = new DataOutputStream(result)) {
                        data.writeInt(text.length); data.writeBytes("tEXt"); data.write(text);
                        CRC32 crc = new CRC32();
                        crc.update("tEXt".getBytes(StandardCharsets.US_ASCII)); crc.update(text);
                        data.writeInt((int) crc.getValue());
                        data.write(encoded, iend, encoded.length - iend);
                    }
                    file.write(result.toByteArray());
                } finally { bitmap.recycle(); }
            } else file.write(json.getBytes(StandardCharsets.UTF_8));
        }
    }

    private int findChunk(byte[] png, String target) {
        int offset = 8;
        while (offset + 12 <= png.length) {
            int length = ((png[offset] & 0xff) << 24) | ((png[offset + 1] & 0xff) << 16)
                | ((png[offset + 2] & 0xff) << 8) | (png[offset + 3] & 0xff);
            String type = new String(png, offset + 4, 4, StandardCharsets.US_ASCII);
            if (target.equals(type)) return offset;
            offset += length + 12;
        }
        throw new AssertionError("PNG chunk not found: " + target);
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
