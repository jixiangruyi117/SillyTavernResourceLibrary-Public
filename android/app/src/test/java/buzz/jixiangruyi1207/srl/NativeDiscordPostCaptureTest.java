package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class NativeDiscordPostCaptureTest {
    static JSONObject capture() throws Exception {
        return new JSONObject().put("guildId", " guild ").put("channelId", "channel").put("threadId", "thread")
            .put("messageId", "message").put("authorId", "author").put("authorName", "作者")
            .put("canonicalUrl", "https://discord.com/channels/guild/thread/message")
            .put("timestamp", "2026-10-08T00:00:00Z").put("isStarter", true).put("title", "小明的故事")
            .put("content", "作者：作者甲\n小明的完整设定");
    }
    @Test public void preservesWholeBodyAndTextAttachmentsButNeverTrustsRemoteLocalFields() throws Exception {
        String body = "完整正文\n".repeat(60000);
        JSONObject input = capture().put("content", body).put("authorBot", true).put("pinned", false)
            .put("forumTags", new JSONArray().put(" tag ").put("tag").put("second"))
            .put("attachments", new JSONArray().put(new JSONObject().put("id", "file").put("name", "设定.txt")
                .put("url", "https://cdn.discordapp.com/attachments/a/b/file.txt").put("size", -1)
                .put("textContent", body).put("localAssetId", "untrusted").put("localState", "local"))
                .put(new JSONObject().put("id", "bad").put("name", "bad").put("url", "javascript:alert(1)")));
        JSONObject normalized = NativeDiscordPostCapture.normalize(input);
        assertEquals(body, normalized.getString("content"));
        assertEquals(2, normalized.getJSONArray("forumTags").length());
        assertTrue(normalized.getBoolean("authorBot"));
        assertFalse(normalized.getBoolean("pinned"));
        JSONObject attachment = normalized.getJSONArray("attachments").getJSONObject(0);
        assertEquals(1, normalized.getJSONArray("attachments").length());
        assertEquals(body, attachment.getString("textContent"));
        assertEquals(0, attachment.getInt("size"));
        assertFalse(attachment.has("localAssetId"));
        assertFalse(attachment.has("localState"));
        JSONObject message = NativeDiscordPostCapture.message(normalized, "source", 10L, 20L);
        assertEquals(body, message.getString("content"));
        assertEquals("remoteOnly", message.getJSONArray("attachments").getJSONObject(0).getString("localState"));
        assertEquals("starter", message.getString("kind"));
        assertEquals(10L, message.getLong("deliveryCapturedAt"));
        assertEquals("source:message:" + NativeDiscordPostCapture.hash("source\0message"), message.getString("id"));
    }
    @Test public void identityAndAutomationMatchForegroundRecordsWithoutWaitingForReview() throws Exception {
        JSONObject normalized = NativeDiscordPostCapture.normalize(capture());
        assertEquals(NativeDiscordPostCapture.hash("discord:guild:thread"), NativeDiscordPostCapture.sourceHash(normalized));
        JSONObject source = NativeDiscordPostCapture.source(normalized, "source", 10, 20,
            new JSONObject().put("bindSameName", true).put("bindNextPng", true));
        assertEquals("小明的故事", source.getString("title"));
        assertEquals("message", source.getString("starterMessageId"));
        assertEquals("author", source.getString("starterAuthorId"));
        assertEquals("scanning", source.getJSONObject("autoBindScan").getString("status"));
        assertTrue(source.getBoolean("autoBindPendingPng"));
        assertFalse(source.has("autoBindingRule"));
        JSONObject plain = NativeDiscordPostCapture.source(normalized, "source", 10, 20, new JSONObject());
        assertFalse(plain.has("autoBindScan"));
        assertFalse(plain.has("autoBindPendingPng"));
    }
    @Test public void invalidCaptureCannotBecomeASavedReceiptAndPendingNoticesNameThePost() throws Exception {
        for (String field : new String[]{"messageId", "channelId", "authorId", "authorName", "timestamp"}) {
            JSONObject input = capture().put(field, " ");
            assertThrows(IllegalArgumentException.class, () -> NativeDiscordPostCapture.normalize(input));
        }
        assertThrows(IllegalArgumentException.class, () -> NativeDiscordPostCapture.normalize(capture().put("canonicalUrl", "file:///private")));
        assertEquals("小明的故事", NativeDiscordInboxService.postDisplayTitle(capture()));
        assertEquals("未命名帖子", NativeDiscordInboxService.postDisplayTitle(new JSONObject()));
        assertEquals("甲 乙", NativeDiscordInboxService.postDisplayTitle(new JSONObject().put("title", " 甲\n乙 ")));
    }
}
