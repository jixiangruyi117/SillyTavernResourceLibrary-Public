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
    @Test public void inboxCheckIsolatesBadPostAndMediaThenAcknowledgesLaterPostWithoutReplayingResults() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-inbox-chain-" + java.util.UUID.randomUUID();
        File directory = new File(app.getCacheDir(), name); assertTrue(directory.mkdir());
        Context fixture = new android.content.ContextWrapper(app) {
            @Override public Context getApplicationContext() { return this; }
            @Override public File getFilesDir() { return directory; }
            @Override public File getDatabasePath(String ignored) { return app.getDatabasePath(name); }
        };
        NativeAppDatabase database = new NativeAppDatabase(fixture);
        NativeDiscordInboxService service = new NativeDiscordInboxService();
        java.lang.reflect.Method attach = android.content.ContextWrapper.class.getDeclaredMethod("attachBaseContext", Context.class);
        attach.setAccessible(true); attach.invoke(service, fixture);
        java.util.Map<String, Integer> requests = new java.util.HashMap<>();
        java.util.Set<String> acknowledged = new java.util.HashSet<>();
        String bad = java.util.UUID.randomUUID().toString(), first = java.util.UUID.randomUUID().toString(), next = java.util.UUID.randomUUID().toString();
        String library = "test-library";
        android.app.NotificationManager manager = (android.app.NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        try {
            database.putState("migration:appdb:v1:active", "{\"version\":1,\"mode\":\"active\"}");
            database.putState("migration:appdb:indexes:v1:active", "verified-v1");
            database.putRecords("settings", new JSONArray().put(new JSONObject().put("key", JSONObject.quote("discordInbox.automation.v1"))
                .put("value", new JSONObject().put("id", "discordInbox.automation.v1").put("value", new JSONObject().put("bindSameName", true).put("downloadPostMedia", true)))));
            java.util.Map<String, JSONObject> envelopes = new java.util.HashMap<>();
            for (int index = 0; index < 2; index++) {
                String id = index == 0 ? first : next, title = index == 0 ? "链路小明" : "链路小红", cardId = "chain-card-" + index;
                JSONObject card = new JSONObject().put("id", cardId).put("name", title).put("type", "characterCard").put("fileName", "card.png")
                    .put("createdAt", index + 1).put("updatedAt", index + 1).put("metadata", new JSONObject());
                database.putRecords("resourceListSummaries", new JSONArray().put(new JSONObject().put("key", JSONObject.quote(cardId)).put("value", card)
                    .put("indexes", new JSONArray().put(new JSONObject().put("name", "type").put("keys", new JSONArray().put(JSONObject.quote("characterCard"))))
                        .put(new JSONObject().put("name", "updatedAt").put("keys", new JSONArray().put(Integer.toString(index + 1)))))));
                JSONArray attachments = new JSONArray();
                for (String file : index == 0 ? new String[] {"bad.png", "good.png"} : new String[] {"next.png"})
                    attachments.put(new JSONObject().put("id", file).put("name", file).put("url", "https://cdn.discordapp.com/attachments/a/b/" + file).put("size", 3).put("contentType", "image/png"));
                JSONObject capture = new JSONObject().put("guildId", "guild").put("channelId", "channel").put("threadId", id).put("messageId", id)
                    .put("isStarter", true).put("authorId", "author").put("authorName", "作者").put("title", title).put("content", title + "正文")
                    .put("canonicalUrl", "https://discord.com/channels/guild/channel/" + id).put("timestamp", "2026-10-09T00:00:00Z").put("attachments", attachments);
                envelopes.put(id, new JSONObject().put("capture", capture).put("delivery", new JSONObject().put("id", id).put("libraryId", library).put("capturedAt", index + 10)));
            }
            okhttp3.OkHttpClient transport = new okhttp3.OkHttpClient.Builder().addInterceptor(chain -> {
                String path = chain.request().url().encodedPath(); requests.merge(path, 1, Integer::sum);
                String body = "{}"; int code = 200; String mime = "application/json";
                try {
                    if (path.startsWith("/attachments/")) {
                        // All bodies and bindings must commit before the first media request, including after the bad body.
                        assertEquals(2L, database.countRecords("communitySources")); assertEquals(2L, database.countRecords("resourceSourceBindings"));
                        code = path.endsWith("bad.png") ? 403 : 200; body = code == 200 ? "img" : ""; mime = "image/png";
                    } else if (path.equals("/inbox/status")) body = new JSONObject().put("libraryId", library).put("paired", true).put("isDefault", true).toString();
                    else if (path.equals("/inbox/resources")) body = "{\"jobs\":[],\"hasMore\":false}";
                    else if (path.equals("/inbox/waiting-sources")) body = "{\"sourceKeyHashes\":[],\"nextCursor\":null}";
                    else if (path.equals("/inbox/jobs")) {
                        JSONArray jobs = new JSONArray();
                        for (String id : new String[] {bad, first, next}) if (!acknowledged.contains(id)) jobs.put(new JSONObject().put("id", id).put("createdAt", 1).put("title", "链路帖子"));
                        body = new JSONObject().put("jobs", jobs).put("hasMore", false).toString();
                    } else if (path.endsWith("/ack")) acknowledged.add(path.split("/")[3]);
                    else if (path.startsWith("/inbox/jobs/")) { JSONObject envelope = envelopes.get(path.substring("/inbox/jobs/".length())); body = envelope == null ? "{}" : envelope.toString(); }
                } catch (Exception error) { throw new java.io.IOException(error); }
                return new okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1).code(code).message("fixture")
                    .body(okhttp3.ResponseBody.create(body, okhttp3.MediaType.parse(mime))).build();
            }).build();
            for (String field : new String[] {"worker", "library", "secret", "client", "mediaClient"}) {
                java.lang.reflect.Field target = NativeDiscordInboxService.class.getDeclaredField(field); target.setAccessible(true);
                target.set(service, "worker".equals(field) ? "https://worker.example" : "library".equals(field) ? library : "secret".equals(field) ? "S".repeat(40) : transport);
            }
            java.lang.reflect.Method check = NativeDiscordInboxService.class.getDeclaredMethod("check"); check.setAccessible(true); check.invoke(service);
            assertFalse(acknowledged.contains(bad)); assertFalse(acknowledged.contains(first)); assertTrue(acknowledged.contains(next));
            assertEquals(1L, database.countRecords("assets"));
            java.util.Map<String, Integer> before = new java.util.HashMap<>(requests);
            java.util.Map<String, Long> resultTimes = new java.util.HashMap<>();
            for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications())
                if (notification.getId() == 2131 || notification.getId() == 2133) resultTimes.put(notification.getTag(), notification.getPostTime());
            assertTrue(resultTimes.size() >= 4);
            check.invoke(service);
            for (String path : before.keySet()) if (path.startsWith("/attachments/") || path.startsWith("/inbox/jobs/")) assertEquals(before.get(path), requests.get(path));
            for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications())
                if (resultTimes.containsKey(notification.getTag())) assertEquals(resultTimes.get(notification.getTag()).longValue(), notification.getPostTime());
        } finally {
            service.onDestroy();
            for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications())
                if (notification.getId() == 2130 || notification.getNotification().extras.toString().contains("链路")) manager.cancel(notification.getTag(), notification.getId());
            database.close(); app.deleteDatabase(name);
            try (java.util.stream.Stream<java.nio.file.Path> paths = java.nio.file.Files.walk(directory.toPath())) {
                for (java.nio.file.Path path : paths.sorted(java.util.Comparator.reverseOrder()).toArray(java.nio.file.Path[]::new)) path.toFile().delete();
            }
        }
    }
    @Test public void cloudPostAfterCardPersistsReopensAndBindsWithoutForegroundReview() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String name = "srl-background-post-" + java.util.UUID.randomUUID();
        NativeAppDatabase database = new NativeAppDatabase(app, name);
        File directory = new File(app.getCacheDir(), name);
        assertTrue(directory.mkdir());
        String library = "test-library", id = java.util.UUID.randomUUID().toString();
        String bindingTag = null;
        java.util.ArrayList<String> extraBindingTags = new java.util.ArrayList<>();
        File media = new File(directory, "post-media.png");
        try {
            database.putState("migration:appdb:v1:active", "{\"version\":1,\"mode\":\"active\"}");
            database.putState("migration:appdb:indexes:v1:active", "verified-v1");
            database.putRecords("settings", new JSONArray().put(new JSONObject().put("key", JSONObject.quote("discordInbox.automation.v1"))
                .put("value", new JSONObject().put("id", "discordInbox.automation.v1").put("value", new JSONObject().put("bindSameName", true).put("downloadPostMedia", true)))));
            JSONObject card = new JSONObject().put("id", "card-before-post").put("name", "小明").put("type", "characterCard")
                .put("fileName", "card.png").put("createdAt", 1).put("versionImportedAt", 1).put("updatedAt", 2).put("metadata", new JSONObject());
            database.putRecords("resourceListSummaries", new JSONArray().put(new JSONObject().put("key", JSONObject.quote("card-before-post"))
                .put("value", card).put("indexes", new JSONArray().put(new JSONObject().put("name", "type").put("keys", new JSONArray().put(JSONObject.quote("characterCard"))))
                    .put(new JSONObject().put("name", "updatedAt").put("keys", new JSONArray().put("2"))))));
            JSONObject capture = new JSONObject().put("guildId", "guild").put("channelId", "channel").put("threadId", "thread")
                .put("messageId", "message").put("isStarter", true).put("authorId", "author").put("authorName", "作者")
                .put("title", "小明的故事").put("content", "小明的完整正文\n".repeat(1000))
                .put("canonicalUrl", "https://discord.com/channels/guild/thread/message").put("timestamp", "2026-10-08T00:00:00Z");
            capture.put("attachments", new JSONArray().put(new JSONObject().put("id", "image").put("name", "image.png")
                .put("url", "https://cdn.discordapp.com/attachments/a/b/image.png").put("size", 100).put("contentType", "image/png")));
            JSONObject envelope = new JSONObject().put("capture", capture).put("delivery", new JSONObject().put("id", id).put("libraryId", library).put("capturedAt", 10));
            JSONObject saved = NativeBackgroundResourceImporter.saveCloudPostIfSafe(database, envelope, id, library, "https://worker.example");
            assertEquals("saved", saved.getString("state"));
            assertFalse(saved.getBoolean("alreadySaved"));
            assertTrue(saved.getBoolean("attachmentDownloadPending"));
            String sourceId = saved.getString("sourceId");
            database.close();
            database = new NativeAppDatabase(app, name);
            String messageKey = JSONObject.quote(sourceId + ":message:" + NativeDiscordPostCapture.hash(sourceId + "\0message"));
            assertEquals(capture.getString("content"), database.getRecord("communitySourceMessages", messageKey).getString("content"));
            assertEquals(1L, database.countIndexEntries("communitySourceMessages", "[sourceId+kind]", new JSONArray().put(sourceId).put("starter").toString()));
            String sourceHash = NativeDiscordPostCapture.sourceHash(NativeDiscordPostCapture.normalize(capture));
            assertFalse(NativeBackgroundResourceImporter.canConfirmCloudSourceBound(database, sourceHash));
            NativeBackgroundResourceImporter.reconcileAutoReceiveCycle(app, database, "0", directory);
            assertEquals(1L, database.countIndexEntries("resourceSourceBindings", "sourceId", JSONObject.quote(sourceId)));
            assertTrue(NativeBackgroundResourceImporter.canConfirmCloudSourceBound(database, sourceHash));
            assertFalse(NativeBackgroundResourceImporter.canConfirmCloudSourceBound(database, "a".repeat(64)));
            assertEquals("same-name", database.getRecord("resourceSourceBindings", JSONObject.quote("card-before-post:source:" + sourceId)).getString("autoBindingRule"));
            assertFalse(database.getRecord("communitySources", JSONObject.quote(sourceId)).has("autoBindScan"));
            bindingTag = NativeDiscordInboxService.autoBindingNotificationTag(new JSONObject().put("sourceId", sourceId).put("resourceId", "card-before-post"));
            android.app.NotificationManager manager = (android.app.NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            boolean notified = false;
            for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications())
                if (bindingTag.equals(notification.getTag())) notified = notification.getNotification().extras.getString(android.app.Notification.EXTRA_TEXT).contains("小明的故事");
            assertTrue("Binding result must appear before any foreground review", notified);
            try (FileOutputStream output = new FileOutputStream(media)) { output.write(new byte[100]); }
            NativeAppDatabase reopened = database;
            JSONObject mediaIdentity = capture.getJSONArray("attachments").getJSONObject(0);
            org.junit.Assert.assertThrows(java.io.InterruptedIOException.class, () -> NativeBackgroundResourceImporter.savePostAttachment(
                reopened, saved.getString("messageKey"), mediaIdentity, media, "image/png", () -> true));
            assertEquals(0L, database.countRecords("assets"));
            NativeBackgroundResourceImporter.savePostAttachment(database, saved.getString("messageKey"), mediaIdentity, media, "image/png", () -> false);
            assertEquals(0, NativeBackgroundResourceImporter.pendingPostAttachments(database, saved.getString("messageKey")).length());
            JSONObject localMedia = database.getRecord("communitySourceMessages", messageKey).getJSONArray("attachments").getJSONObject(0);
            assertEquals("local", localMedia.getString("localState"));
            assertNotNull(database.getBlobPath("assetFiles", JSONObject.quote(localMedia.getString("localAssetId")), "$/blob"));
            NativeBackgroundResourceImporter.setPostAttachmentState(database, saved.getString("messageKey"), "complete");
            assertFalse(NativeBackgroundResourceImporter.saveCloudPostIfSafe(database, envelope, id, library, "https://worker.example").getBoolean("attachmentDownloadPending"));
            assertTrue(NativeBackgroundResourceImporter.saveCloudPostIfSafe(database, envelope, id, library, "https://worker.example").getBoolean("alreadySaved"));
            assertFalse(NativeBackgroundResourceImporter.saveCloudPostIfSafe(database, envelope, id, library, "https://worker.example").getBoolean("notificationPosted"));
            NativeBackgroundResourceImporter.cloudPostNotificationState(database, saved.getString("messageKey"), id, "https://worker.example", library, "saved");
            database.close();
            database = new NativeAppDatabase(app, name);
            assertTrue(NativeBackgroundResourceImporter.saveCloudPostIfSafe(database, envelope, id, library, "https://worker.example").getBoolean("notificationPosted"));
            assertEquals("foreground_required", NativeBackgroundResourceImporter.saveCloudPostIfSafe(database, envelope, id, library, "https://other.example").getString("state"));
            assertEquals(1L, database.countRecords("communitySources"));
            assertEquals(1L, database.countRecords("communitySourceMessages"));
            capture.put("content", "后来更新的正文");
            assertEquals("foreground_required", NativeBackgroundResourceImporter.saveCloudPostIfSafe(database, envelope, id, library, "https://worker.example").getString("state"));
            assertTrue(database.getRecord("communitySourceMessages", messageKey).getString("content").startsWith("小明的完整正文"));
            for (int index = 0; index < 2; index++) {
                String nameOfCard = index == 0 ? "小红" : "小兰", cardId = "following-card-" + index;
                JSONObject followingCard = new JSONObject(card.toString()).put("id", cardId).put("name", nameOfCard).put("updatedAt", index + 3);
                database.putRecords("resourceListSummaries", new JSONArray().put(new JSONObject().put("key", JSONObject.quote(cardId)).put("value", followingCard)
                    .put("indexes", new JSONArray().put(new JSONObject().put("name", "type").put("keys", new JSONArray().put(JSONObject.quote("characterCard"))))
                        .put(new JSONObject().put("name", "updatedAt").put("keys", new JSONArray().put(Integer.toString(index + 3)))))));
                JSONObject followingCapture = new JSONObject(capture.toString()).put("threadId", "following-thread-" + index)
                    .put("messageId", "following-message-" + index).put("title", nameOfCard + "的故事").put("content", nameOfCard + "的正文");
                String followingId = java.util.UUID.randomUUID().toString();
                JSONObject following = NativeBackgroundResourceImporter.saveCloudPostIfSafe(database,
                    new JSONObject().put("capture", followingCapture).put("delivery", new JSONObject().put("id", followingId).put("libraryId", library).put("capturedAt", index + 11)),
                    followingId, library, "https://worker.example");
                assertEquals("saved", following.getString("state"));
                assertTrue(following.getBoolean("attachmentDownloadPending"));
                NativeBackgroundResourceImporter.reconcileAutoReceiveCycle(app, database, "0", directory);
                assertEquals(1L, database.countIndexEntries("resourceSourceBindings", "sourceId", JSONObject.quote(following.getString("sourceId"))));
                String followingTag = NativeDiscordInboxService.autoBindingNotificationTag(new JSONObject().put("sourceId", following.getString("sourceId")).put("resourceId", cardId));
                extraBindingTags.add(followingTag);
                boolean followingNotified = false;
                for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications())
                    if (followingTag.equals(notification.getTag())) followingNotified = notification.getNotification().extras.getString(android.app.Notification.EXTRA_TEXT).contains(nameOfCard + "的故事");
                assertTrue("Each following post must bind and notify without foreground", followingNotified);
                NativeBackgroundResourceImporter.savePostAttachment(database, following.getString("messageKey"), mediaIdentity, media, "image/png", () -> false);
                NativeBackgroundResourceImporter.setPostAttachmentState(database, following.getString("messageKey"), "complete");
                assertEquals(0, NativeBackgroundResourceImporter.pendingPostAttachments(database, following.getString("messageKey")).length());
            }
            assertEquals(3L, database.countRecords("communitySources"));
            assertEquals(1L, database.countRecords("assets"));
            assertEquals(1L, database.countRecords("assetFiles"));
        } finally {
            database.clearStore("assetFiles"); database.clearStore("assets");
            database.close(); app.deleteDatabase(name);
            if (bindingTag != null) ((android.app.NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(bindingTag, 2133);
            for (String tag : extraBindingTags) ((android.app.NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(tag, 2133);
            media.delete(); directory.delete();
        }
    }

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
