package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class DiscordAttachmentUrlTest {
    @Test public void parsesOneDiscordAttachmentAndKeepsSignedQuery() {
        String url = "https://cdn.discordapp.com/attachments/123/456/%E8%A7%92%E8%89%B2%E5%8D%A1.json?ex=abc&hm=def";

        DiscordAttachmentUrl parsed = DiscordAttachmentUrl.fromSharedText("下载角色卡：" + url + "。");

        assertEquals("角色卡.json", parsed.fileName);
        assertEquals(url, parsed.url);
    }

    @Test public void acceptsDiscordMediaCdnAndEphemeralAttachmentPaths() {
        String url = "https://media.discordapp.net/ephemeral-attachments/123/456/character%20card.png?width=1024";

        DiscordAttachmentUrl parsed = DiscordAttachmentUrl.fromSharedText(url);

        assertEquals("character card.png", parsed.fileName);
        assertEquals(url, parsed.url);
    }

    @Test public void acceptsAttachmentPathWithOneNumericIdentifier() {
        String url = "https://cdn.discordapp.com/attachments/123/card.json?ex=abc";

        DiscordAttachmentUrl parsed = DiscordAttachmentUrl.fromSharedText(url);

        assertEquals("card.json", parsed.fileName);
        assertEquals(url, parsed.url);
    }

    @Test public void acceptsCommunitySpecificPathsUnderDiscordCdnPrefix() {
        String url = "https://cdn.discordapp.com/community-downloads/character-card?id=123&sig=abc";

        DiscordAttachmentUrl parsed = DiscordAttachmentUrl.fromSharedText(url);

        assertEquals("character-card", parsed.fileName);
        assertEquals(url, parsed.url);
    }

    @Test public void rejectsOtherHostsUnsafeAuthoritiesAndMultipleLinks() {
        assertThrows(IllegalArgumentException.class, () -> DiscordAttachmentUrl.fromSharedText(
            "https://example.com/attachments/123/456/card.json"));
        assertThrows(IllegalArgumentException.class, () -> DiscordAttachmentUrl.fromSharedText(
            "https://fake-cdn.discordapp.com/attachments/123/456/card.json"));
        assertThrows(IllegalArgumentException.class, () -> DiscordAttachmentUrl.fromSharedText(
            "https://user@cdn.discordapp.com/attachments/123/456/card.json"));
        assertThrows(IllegalArgumentException.class, () -> DiscordAttachmentUrl.fromSharedText(
            "https://cdn.discordapp.com:8443/attachments/123/456/card.json"));
        assertThrows(IllegalArgumentException.class, () -> DiscordAttachmentUrl.fromSharedText(
            "https://cdn.discordapp.com/attachments/123/456/a.json https://cdn.discordapp.com/attachments/123/789/b.json"));
    }

    @Test public void batchKeepsOrderAndSignedQueriesAndDeduplicatesRepeatedLinks() {
        String first = "https://cdn.discordapp.com/attachments/123/456/a.json?ex=1&hm=one";
        String second = "https://media.discordapp.net/attachments/123/789/b.png?ex=2&hm=two";
        java.util.List<DiscordAttachmentUrl> batch = DiscordAttachmentUrl.fromSharedTexts(first + "\n" + second + "。\n" + first);
        assertEquals(2, batch.size());
        assertEquals(first, batch.get(0).url);
        assertEquals(second, batch.get(1).url);
    }

    @Test public void supportsLargeBatchWithoutDroppingTheTail() {
        StringBuilder text = new StringBuilder();
        for (int index = 0; index < 200; index++) text.append("https://cdn.discordapp.com/attachments/123/")
            .append(index).append("/card.json?ex=abc&hm=").append(index).append('\n');
        java.util.List<DiscordAttachmentUrl> batch = DiscordAttachmentUrl.fromSharedTexts(text.toString());
        assertEquals(200, batch.size());
        assertEquals("https://cdn.discordapp.com/attachments/123/199/card.json?ex=abc&hm=199", batch.get(199).url);
    }
}
