package buzz.jixiangruyi1207.srl;

import java.net.URI;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Validates explicitly shared Discord CDN attachment URLs without changing signed queries. */
final class DiscordAttachmentUrl {
    private static final Pattern SHARED_URL = Pattern.compile(
        "https://(?:cdn\\.discordapp\\.com|media\\.discordapp\\.net)/[^\\s<>\\\"']+",
        Pattern.CASE_INSENSITIVE
    );

    final String url;
    final String fileName;

    private DiscordAttachmentUrl(String url, String fileName) {
        this.url = url;
        this.fileName = fileName;
    }

    static DiscordAttachmentUrl fromSharedText(String text) {
        List<DiscordAttachmentUrl> attachments = fromSharedTexts(text);
        if (attachments.size() != 1) throw new IllegalArgumentException("下载地址必须是单个 Discord 附件链接");
        return attachments.get(0);
    }

    static List<DiscordAttachmentUrl> fromSharedTexts(String text) {
        if (text == null || text.isBlank()) throw new IllegalArgumentException("没有收到 Discord 附件链接");
        Matcher matcher = SHARED_URL.matcher(text);
        LinkedHashMap<String, DiscordAttachmentUrl> attachments = new LinkedHashMap<>();
        while (matcher.find()) {
            DiscordAttachmentUrl attachment = parse(matcher.group());
            attachments.putIfAbsent(attachment.url, attachment);
        }
        if (attachments.isEmpty()) throw new IllegalArgumentException("只支持 Discord CDN 的附件链接");
        return new ArrayList<>(attachments.values());
    }

    private static DiscordAttachmentUrl parse(String candidate) {
        while (!candidate.isEmpty() && "),.;!?]}。，；！？".indexOf(candidate.charAt(candidate.length() - 1)) >= 0) {
            candidate = candidate.substring(0, candidate.length() - 1);
        }

        URI parsed;
        try { parsed = new URI(candidate); }
        catch (Exception error) { throw new IllegalArgumentException("Discord 附件链接格式不受支持"); }
        if (!"https".equalsIgnoreCase(parsed.getScheme()) ||
            !isDiscordAttachmentHost(parsed.getHost()) ||
            parsed.getPort() != -1 || parsed.getUserInfo() != null ||
            parsed.getRawPath() == null || parsed.getRawPath().length() <= 1) {
            throw new IllegalArgumentException("Discord 附件链接格式不受支持");
        }
        String rawPath = parsed.getRawPath();
        int lastSlash = rawPath.lastIndexOf('/');
        String pathName = lastSlash < 0 ? "" : rawPath.substring(lastSlash + 1);
        String fileName;
        try { fileName = URLDecoder.decode(pathName.replace("+", "%2B"), "UTF-8"); }
        catch (Exception error) { fileName = pathName; }
        fileName = fileName.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (fileName.isBlank() || fileName.equals(".") || fileName.equals("..")) fileName = "discord-attachment";
        return new DiscordAttachmentUrl(candidate, fileName);
    }

    private static boolean isDiscordAttachmentHost(String host) {
        return "cdn.discordapp.com".equalsIgnoreCase(host) ||
            "media.discordapp.net".equalsIgnoreCase(host);
    }
}
