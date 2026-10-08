package buzz.jixiangruyi1207.srl;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import org.json.JSONArray;
import org.json.JSONObject;

/** Discord capture normalization only. Persistence belongs to NativeBackgroundResourceImporter. */
final class NativeDiscordPostCapture {
    private NativeDiscordPostCapture() {}

    static String hash(String text) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
    static String sourceHash(JSONObject capture) throws Exception {
        String thread = capture.optString("threadId", "");
        if (thread.isEmpty()) thread = capture.optString("starterMessageId", "");
        if (thread.isEmpty()) thread = capture.getString("messageId");
        return hash("discord:" + capture.optString("guildId", "@me") + ":" + thread);
    }
    private static void copyText(JSONObject input, JSONObject output, String field, int limit, boolean required) throws Exception {
        Object raw = input.opt(field);
        String value = raw instanceof String ? ((String) raw).trim() : "";
        if (required && value.isEmpty()) throw new IllegalArgumentException("Discord 来源数据不完整：" + field);
        if (!value.isEmpty()) output.put(field, value.substring(0, Math.min(limit, value.length())));
    }
    private static String safeUrl(String text) {
        try {
            URI uri = new URI(text.trim());
            return ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                && uri.getHost() != null ? uri.toASCIIString() : "";
        } catch (Exception ignored) { return ""; }
    }
    static JSONObject normalize(JSONObject input) throws Exception {
        JSONObject capture = new JSONObject();
        for (String field : new String[]{"channelId", "messageId", "authorId"}) copyText(input, capture, field, 64, true);
        copyText(input, capture, "authorName", 160, true);
        for (String field : new String[]{"guildId", "threadId", "starterMessageId"}) copyText(input, capture, field, 64, false);
        for (String field : new String[]{"guildName", "channelName"}) copyText(input, capture, field, 200, false);
        copyText(input, capture, "title", 500, false);
        copyText(input, capture, "editedTimestamp", 80, false);
        copyText(input, capture, "timestamp", 80, true);
        String url = safeUrl(input.optString("canonicalUrl", ""));
        if (url.isEmpty()) throw new IllegalArgumentException("Discord 原消息链接无效");
        capture.put("canonicalUrl", url).put("isStarter", input.opt("isStarter") == Boolean.TRUE)
            .put("authorBot", input.opt("authorBot") == Boolean.TRUE)
            .put("content", input.opt("content") instanceof String ? input.getString("content") : "");
        if (input.opt("pinned") instanceof Boolean) capture.put("pinned", input.getBoolean("pinned"));
        JSONArray tags = new JSONArray(), rawTags = input.optJSONArray("forumTags");
        HashSet<String> seen = new HashSet<>();
        if (rawTags != null) for (int i = 0; i < rawTags.length() && tags.length() < 64; i++) {
            Object raw = rawTags.opt(i);
            String tag = raw instanceof String ? ((String) raw).trim() : "";
            if (!tag.isEmpty() && seen.add(tag)) tags.put(tag);
        }
        capture.put("forumTags", tags);
        JSONArray embeds = new JSONArray(), rawEmbeds = input.optJSONArray("embeds");
        if (rawEmbeds != null) for (int i = 0; i < rawEmbeds.length(); i++)
            if (rawEmbeds.optJSONObject(i) != null) embeds.put(new JSONObject(rawEmbeds.getJSONObject(i).toString()));
        capture.put("embeds", embeds);
        JSONArray attachments = new JSONArray(), rawAttachments = input.optJSONArray("attachments");
        if (rawAttachments != null) for (int i = 0; i < rawAttachments.length(); i++) {
            JSONObject raw = rawAttachments.optJSONObject(i);
            if (raw == null) continue;
            String attachmentUrl = safeUrl(raw.optString("url", ""));
            if (raw.optString("id", "").trim().isEmpty() || raw.optString("name", "").trim().isEmpty() || attachmentUrl.isEmpty()) continue;
            JSONObject attachment = new JSONObject();
            copyText(raw, attachment, "id", 128, true);
            copyText(raw, attachment, "name", 500, true);
            copyText(raw, attachment, "contentType", 200, false);
            double size = raw.optDouble("size", 0);
            attachment.put("size", Double.isFinite(size) && size >= 0 ? size : 0).put("url", attachmentUrl);
            String proxy = safeUrl(raw.optString("proxyUrl", ""));
            if (!proxy.isEmpty()) attachment.put("proxyUrl", proxy);
            if (raw.opt("textContent") instanceof String) attachment.put("textContent", raw.getString("textContent"));
            for (String field : new String[]{"width", "height"})
                if (raw.opt(field) instanceof Number && Double.isFinite(raw.getDouble(field))) attachment.put(field, raw.get(field));
            attachments.put(attachment);
        }
        return capture.put("attachments", attachments);
    }
    static JSONObject source(JSONObject capture, String id, long capturedAt, long now, JSONObject settings) throws Exception {
        JSONObject source = new JSONObject().put("id", id).put("platform", "discord").put("sourceKeyHash", sourceHash(capture))
            .put("canonicalUrl", capture.getString("canonicalUrl")).put("forumTags", capture.getJSONArray("forumTags"))
            .put("metadataCapturedAt", capturedAt).put("createdAt", now).put("updatedAt", now)
            .put("messageCount", 1).put("missingMessageCount", 0);
        for (String field : new String[]{"guildId", "guildName", "channelId", "channelName", "threadId", "title"})
            if (capture.has(field)) source.put(field, capture.get(field));
        if (capture.optBoolean("isStarter") || capture.has("starterMessageId"))
            source.put("starterMessageId", capture.optString("starterMessageId", capture.getString("messageId")));
        if (capture.optBoolean("isStarter")) source.put("starterAuthorId", capture.getString("authorId")).put("starterAuthorName", capture.getString("authorName"));
        if (settings.optBoolean("bindSameName") || settings.optBoolean("bindSameAuthor"))
            source.put("nativeInitialAutoBindPending", true).put("autoBindScan", new JSONObject().put("version", 1).put("status", "scanning")
                .put("scannedResourceIds", new JSONArray()).put("futureResourceIds", new JSONArray()));
        if (settings.optBoolean("bindNextPng")) source.put("autoBindPendingPng", true);
        return source;
    }
    static JSONObject message(JSONObject capture, String sourceId, long capturedAt, long now) throws Exception {
        JSONObject message = new JSONObject(capture.toString());
        String key = hash(sourceId + "\0" + capture.getString("messageId"));
        message.put("id", sourceId + ":message:" + key).put("sourceId", sourceId).put("messageKeyHash", key)
            .put("kind", capture.optBoolean("isStarter") || capture.getString("messageId").equals(capture.optString("starterMessageId")) ? "starter" : "selectedComment")
            .put("capturedAt", now).put("deliveryCapturedAt", capturedAt).put("updatedAt", now);
        for (String field : new String[]{"guildId", "guildName", "channelId", "channelName", "threadId", "title", "forumTags", "isStarter", "starterMessageId"}) message.remove(field);
        JSONArray attachments = message.getJSONArray("attachments");
        for (int i = 0; i < attachments.length(); i++) attachments.getJSONObject(i).put("localState", "remoteOnly");
        return message;
    }
}
