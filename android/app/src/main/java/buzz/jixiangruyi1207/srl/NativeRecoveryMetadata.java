package buzz.jixiangruyi1207.srl;

import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileInputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Bounded, read-only recovery inspection. Format interpretation remains with the existing parsers. */
final class NativeRecoveryMetadata {
    static JSObject inspect(File file, String hash, long size, boolean verify) throws Exception {
        if (!file.isFile() || file.length() != size
            || (verify && !NativeCloudRestoreTransport.verifyFile(file, hash, size))) {
            throw new IllegalArgumentException("找回原件的大小或 SHA-256 校验失败");
        }
        JSObject result = new JSObject();
        result.put("kind", "unknown");
        byte[] prefix = new byte[8];
        try (FileInputStream input = new FileInputStream(file)) {
            int count = input.read(prefix);
            if (count == 8 && Arrays.equals(prefix, NativeCloudCardMetadata.PNG_SIGNATURE)) {
                result.put("kind", "png");
                result.put("text", NativeCloudCardMetadata.readCharacterCard(file, "recovered.png").toString());
                if (verify) {
                    String thumbnail = NativeCloudCardMetadata.createCharacterCardThumbnail(file);
                    if (thumbnail != null) result.put("thumbnailBase64", thumbnail);
                }
                return result;
            }
        }
        // Unknown binary/large JSON remains untouched and is never treated as disposable data.
        if (size > NativeCloudCardMetadata.MAX_CARD_METADATA_BYTES) return result;
        byte[] bytes = new byte[(int) size];
        try (FileInputStream input = new FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int count = input.read(bytes, offset, bytes.length - offset);
                if (count < 0) throw new IllegalArgumentException("找回文本原件被截断");
                offset += count;
            }
        }
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString();
        } catch (java.nio.charset.CharacterCodingException invalidText) {
            return result;
        }
        if (text.indexOf('\0') >= 0) return result;
        text = text.replaceFirst("^\\uFEFF", "").trim();
        result.put("kind", text.startsWith("{") || text.startsWith("[") ? "json" : "css");
        result.put("text", text);
        return result;
    }
}
