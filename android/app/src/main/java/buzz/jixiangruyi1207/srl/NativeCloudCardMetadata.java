package buzz.jixiangruyi1207.srl;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;
import org.json.JSONObject;
import org.json.JSONTokener;


final class NativeCloudCardMetadata {
    static final int MAX_CARD_METADATA_BYTES = 32 * 1024 * 1024;
    static final int CARD_THUMBNAIL_EDGE = 512;
    static final byte[] PNG_SIGNATURE = new byte[]{-119, 80, 78, 71, 13, 10, 26, 10};
    static JSONObject readCharacterCard(File file, String fileName) throws Exception {
        if (fileName.toLowerCase(Locale.ROOT).endsWith(".json")) {
            if (file.length() > MAX_CARD_METADATA_BYTES) {
                throw new IllegalArgumentException("角色卡 JSON 元数据超过 32 MiB 安全上限");
            }
            byte[] bytes = new byte[(int) file.length()];
            try (FileInputStream input = new FileInputStream(file)) {
                int offset = 0;
                while (offset < bytes.length) {
                    int count = input.read(bytes, offset, bytes.length - offset);
                    if (count < 0) throw new IOException("角色卡 JSON 被截断");
                    offset += count;
                }
            }
            Object value = new JSONTokener(new String(bytes, StandardCharsets.UTF_8)).nextValue();
            if (value instanceof JSONObject) return (JSONObject) value;
            throw new IllegalArgumentException("角色卡 JSON 根节点不是对象");
        }
        try (DataInputStream input = new DataInputStream(new BufferedInputStream(new FileInputStream(file)))) {
            JSONObject legacyCard = null;
            byte[] signature = new byte[PNG_SIGNATURE.length];
            input.readFully(signature);
            if (!Arrays.equals(signature, PNG_SIGNATURE)) {
                throw new IllegalArgumentException("角色卡原文件不是有效 PNG/JSON");
            }
            while (true) {
                int length = input.readInt();
                if (length < 0) throw new IllegalArgumentException("角色卡 PNG 数据块大小无效");
                byte[] typeBytes = new byte[4];
                input.readFully(typeBytes);
                String type = new String(typeBytes, StandardCharsets.US_ASCII);
                if ("tEXt".equals(type)) {
                    if (length > MAX_CARD_METADATA_BYTES) {
                        throw new IllegalArgumentException("角色卡 PNG 元数据超过 32 MiB 安全上限");
                    }
                    byte[] data = new byte[length];
                    input.readFully(data);
                    skipFully(input, 4L);
                    int separator = -1;
                    for (int index = 0; index < data.length; index++) {
                        if (data[index] == 0) { separator = index; break; }
                    }
                    if (separator > 0) {
                        String keyword = new String(data, 0, separator, StandardCharsets.ISO_8859_1);
                        if ("chara".equalsIgnoreCase(keyword) || "ccv3".equalsIgnoreCase(keyword)) {
                            String encoded = new String(
                                data,
                                separator + 1,
                                data.length - separator - 1,
                                StandardCharsets.ISO_8859_1
                            );
                            byte[] decoded = Base64.decode(encoded, Base64.DEFAULT);
                            if (decoded.length > MAX_CARD_METADATA_BYTES) {
                                throw new IllegalArgumentException("角色卡解码元数据超过 32 MiB 安全上限");
                            }
                            Object value = new JSONTokener(new String(decoded, StandardCharsets.UTF_8)).nextValue();
                            if (value instanceof JSONObject) {
                                if ("ccv3".equalsIgnoreCase(keyword)) return (JSONObject) value;
                                legacyCard = (JSONObject) value;
                                continue;
                            }
                            throw new IllegalArgumentException("角色卡 PNG 元数据根节点不是对象");
                        }
                    }
                } else {
                    skipFully(input, length);
                    skipFully(input, 4L);
                }
                if ("IEND".equals(type)) {
                    if (legacyCard != null) return legacyCard;
                    break;
                }
            }
        }
        throw new IllegalArgumentException("已校验角色卡原文件缺少 chara/ccv3 元数据");
    }

    static String createCharacterCardThumbnail(File file) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        int sample = 1;
        while (Math.max(bounds.outWidth / sample, bounds.outHeight / sample) > CARD_THUMBNAIL_EDGE * 2) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap decoded = BitmapFactory.decodeFile(file.getAbsolutePath(), options);
        if (decoded == null) return null;
        Bitmap thumbnail = decoded;
        try {
            int width = decoded.getWidth();
            int height = decoded.getHeight();
            double scale = Math.min(1.0, (double) CARD_THUMBNAIL_EDGE / Math.max(width, height));
            if (scale < 1.0) {
                thumbnail = Bitmap.createScaledBitmap(
                    decoded,
                    Math.max(1, (int) Math.round(width * scale)),
                    Math.max(1, (int) Math.round(height * scale)),
                    true
                );
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (!thumbnail.compress(Bitmap.CompressFormat.PNG, 100, output)) return null;
            byte[] bytes = output.toByteArray();
            if (bytes.length > 4 * 1024 * 1024) {
                throw new IllegalArgumentException("角色卡缩略图超过 4 MiB Bridge 上限");
            }
            return Base64.encodeToString(bytes, Base64.NO_WRAP);
        } finally {
            if (thumbnail != decoded) thumbnail.recycle();
            decoded.recycle();
        }
    }

    private static void skipFully(DataInputStream input, long byteCount) throws Exception {
        long remaining = byteCount;
        while (remaining > 0) {
            long skipped = input.skip(remaining);
            if (skipped > 0) {
                remaining -= skipped;
            } else {
                if (input.read() < 0) throw new IOException("角色卡 PNG 数据块被截断");
                remaining--;
            }
        }
    }

}
