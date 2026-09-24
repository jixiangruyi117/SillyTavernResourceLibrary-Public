package buzz.jixiangruyi1207.srl;

import android.util.Base64;
import androidx.annotation.NonNull;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSink;

/**
 * 图床专用的 Android 原生流式上传器。
 *
 * Vue 只按小块把 Blob 暂存进应用 cache；最终 multipart 由 OkHttp 直接从临时文件读取，
 * 避免整张图片转换成 Base64 后跨 WebView Bridge。只允许用户明确配置的 HTTPS
 * POST multipart(file)，不是任意方法的通用代理。
 */
@CapacitorPlugin(name = "NativeHostedUpload")
public class NativeHostedUploadPlugin extends Plugin {
    private static final long MAX_SELF_HOSTED_IMAGE_BYTES = 128L * 1024L * 1024L;
    private static final int MAX_CHUNK_BYTES = 1024 * 1024;
    private static final int STREAM_BUFFER_BYTES = 256 * 1024;
    private static final int MAX_RESPONSE_BYTES = 16 * 1024;
    private static final int MAX_URL_LENGTH = 4096;
    private static final int MAX_AUTHORIZATION_LENGTH = 4096;
    private static final long STALE_TEMP_MS = 60L * 60L * 1000L;
    private static final Set<String> ALLOWED_IMAGE_TYPES = new HashSet<>(Arrays.asList(
        "image/png", "image/jpeg", "image/webp", "image/gif"
    ));

    private final ConcurrentHashMap<String, PendingUpload> pending = new ConcurrentHashMap<>();

    @PluginMethod
    public void beginSelfHostedImageUpload(PluginCall call) {
        runIo(call, () -> {
            String uploadUrl = validatedHttpsUrl(call.getString("url"));
            String authorization = call.getString("authorization", "");
            if (authorization == null) authorization = "";
            if (!authorization.isBlank()) {
                if (authorization.length() > MAX_AUTHORIZATION_LENGTH || !authorization.startsWith("Bearer ")) {
                    throw new IllegalArgumentException("自建图床 Authorization 无效");
                }
            }
            stageUpload(
                call,
                uploadUrl,
                authorization
            );
        });
    }

    private void stageUpload(
        PluginCall call,
        String uploadUrl,
        String authorization
    ) throws Exception {
        long size = NativeBridgeNumber.bounded(
            call.getData().opt("size"),
            1L,
            MAX_SELF_HOSTED_IMAGE_BYTES,
            "自建图床图片大小无效（最大 128 MiB）"
        );
        String mimeType = required(call.getString("mimeType"), "图片类型", 80);
        if (!ALLOWED_IMAGE_TYPES.contains(mimeType)) {
            throw new IllegalArgumentException("图床不支持这种图片格式");
        }
        String fileName = safeFileName(required(call.getString("fileName"), "图片文件名", 160));

        File root = uploadRoot();
        deleteStaleFiles(root);
        String token = UUID.randomUUID().toString();
        File temporary = new File(root, token + ".part");
        PendingUpload upload = new PendingUpload(
            token,
            uploadUrl,
            authorization,
            fileName,
            mimeType,
            size,
            temporary,
            new FileOutputStream(temporary)
        );
        pending.put(token, upload);
        JSObject result = new JSObject();
        result.put("token", token);
        call.resolve(result);
    }

    @PluginMethod
    public void appendImageUpload(PluginCall call) {
        runIo(call, () -> {
            PendingUpload upload = pending(call.getString("token"));
            String encoded = required(call.getString("data"), "图片分块", MAX_CHUNK_BYTES * 2);
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length == 0 || bytes.length > MAX_CHUNK_BYTES) {
                throw new IllegalArgumentException("图床原生分块超过 1 MiB");
            }
            synchronized (upload) {
                if (upload.written + bytes.length > upload.expectedSize) {
                    throw new IllegalArgumentException("图床暂存数据超过声明大小");
                }
                upload.output.write(bytes);
                upload.written += bytes.length;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void commitImageUpload(PluginCall call) {
        String token = call.getString("token", "");
        NativeExecutors.network().execute(() -> {
            PendingUpload upload = pending.remove(token);
            if (upload == null) {
                call.reject("图床原生上传令牌已失效");
                return;
            }
            try {
                synchronized (upload) {
                    upload.output.flush();
                    upload.output.close();
                }
                if (upload.written != upload.expectedSize ||
                    !upload.temporary.isFile() ||
                    upload.temporary.length() != upload.expectedSize) {
                    throw new IllegalStateException("图床图片暂存不完整，已取消上传");
                }

                RequestBody fileBody = fileBody(upload.temporary, upload.mimeType, upload.expectedSize);
                MultipartBody.Builder multipart = new MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart("file", upload.fileName, fileBody);

                Request.Builder request = new Request.Builder()
                    .url(upload.uploadUrl)
                    .post(multipart.build())
                    .header("Accept", "application/json");
                if (!upload.authorization.isBlank()) {
                    request.header("Authorization", upload.authorization);
                }


                try (Response response = NativeHttpClients.CLOUD.newCall(request.build()).execute()) {
                    JSObject result = new JSObject();
                    result.put("status", response.code());
                    JSObject headers = new JSObject();
                    for (String name : response.headers().names()) {
                        // Web Fetch 不允许页面脚本读取 Set-Cookie；原生桥保持同一安全边界。
                        if ("set-cookie".equalsIgnoreCase(name) || "set-cookie2".equalsIgnoreCase(name)) {
                            continue;
                        }
                        headers.put(name, String.join(", ", response.headers(name)));
                    }
                    result.put("headers", headers);
                    ResponseBody responseBody = response.body();
                    result.put(
                        "body",
                        responseBody == null
                            ? ""
                            : new String(
                                readLimited(responseBody.byteStream(), MAX_RESPONSE_BYTES),
                                StandardCharsets.UTF_8
                            )
                    );
                    call.resolve(result);
                }
            } catch (Exception error) {
                call.reject(
                    "自建图床原生上传失败",
                    error
                );
            } finally {
                upload.temporary.delete();
            }
        });
    }

    @PluginMethod
    public void abortImageUpload(PluginCall call) {
        runIo(call, () -> {
            PendingUpload upload = pending.remove(call.getString("token", ""));
            if (upload != null) closeAndDelete(upload);
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        for (PendingUpload upload : pending.values()) closeAndDelete(upload);
        pending.clear();
    }

    private RequestBody fileBody(File file, String mimeType, long expectedSize) {
        return new RequestBody() {
            @Override
            public MediaType contentType() {
                return MediaType.parse(mimeType);
            }

            @Override
            public long contentLength() {
                return expectedSize;
            }

            @Override
            public void writeTo(@NonNull BufferedSink sink) throws IOException {
                byte[] buffer = new byte[STREAM_BUFFER_BYTES];
                try (InputStream input = new FileInputStream(file)) {
                    long written = 0L;
                    while (true) {
                        int count = input.read(buffer);
                        if (count < 0) break;
                        if (count == 0) continue;
                        sink.write(buffer, 0, count);
                        written += count;
                    }
                    if (written != expectedSize) {
                        throw new IOException("图床原生图片读取大小不一致");
                    }
                }
            }
        };
    }

    private String validatedHttpsUrl(String value) {
        String raw = required(value, "自建图床地址", MAX_URL_LENGTH);
        try {
            URI uri = new URI(raw);
            if (!"https".equalsIgnoreCase(uri.getScheme()) ||
                uri.getHost() == null ||
                uri.getUserInfo() != null ||
                uri.getFragment() != null) {
                throw new IllegalArgumentException("自建图床只允许无 URL 凭据的 HTTPS 地址");
            }
            return uri.toASCIIString();
        } catch (IllegalArgumentException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalArgumentException("自建图床 HTTPS 地址无效");
        }
    }

    private File uploadRoot() {
        File root = new File(getContext().getCacheDir(), "srl-image-hosting-upload");
        if (!root.exists() && !root.mkdirs()) {
            throw new IllegalStateException("无法创建图床原生暂存目录");
        }
        return root;
    }

    private void deleteStaleFiles(File root) {
        File[] files = root.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - STALE_TEMP_MS;
        for (File file : files) {
            if (file.isFile() && file.lastModified() < cutoff) file.delete();
        }
    }

    private PendingUpload pending(String token) {
        PendingUpload upload = token == null ? null : pending.get(token);
        if (upload == null) throw new IllegalArgumentException("图床原生上传令牌已失效");
        return upload;
    }

    private String required(String value, String label, int maxLength) {
        if (value == null || value.isBlank() || value.length() > maxLength) {
            throw new IllegalArgumentException(label + "无效");
        }
        return value;
    }

    private String safeFileName(String value) {
        String normalized = value.replaceAll("[^A-Za-z0-9._-]", "_");
        if (normalized.isBlank() || ".".equals(normalized) || "..".equals(normalized)) {
            return "generated-image.bin";
        }
        return normalized;
    }

    private byte[] readLimited(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(limit, 4096));
        byte[] buffer = new byte[4096];
        int remaining = limit;
        while (remaining > 0) {
            int count = input.read(buffer, 0, Math.min(buffer.length, remaining));
            if (count < 0) break;
            if (count == 0) continue;
            output.write(buffer, 0, count);
            remaining -= count;
        }
        return output.toByteArray();
    }

    private void closeAndDelete(PendingUpload upload) {
        synchronized (upload) {
            try { upload.output.close(); } catch (Exception ignored) {}
            upload.temporary.delete();
        }
    }

    private void runIo(PluginCall call, CheckedAction action) {
        NativeExecutors.ioSerial().execute(() -> {
            try {
                action.run();
            } catch (Exception error) {
                call.reject(
                    error.getMessage() == null ? "图床原生操作失败" : error.getMessage(),
                    error
                );
            }
        });
    }

    @FunctionalInterface
    private interface CheckedAction {
        void run() throws Exception;
    }

    private static final class PendingUpload {
        final String token;
        final String uploadUrl;
        final String authorization;
        final String fileName;
        final String mimeType;
        final long expectedSize;
        final File temporary;
        final FileOutputStream output;
        long written;

        PendingUpload(
            String token,
            String uploadUrl,
            String authorization,
            String fileName,
            String mimeType,
            long expectedSize,
            File temporary,
            FileOutputStream output
        ) {
            this.token = token;
            this.uploadUrl = uploadUrl;
            this.authorization = authorization;
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.expectedSize = expectedSize;
            this.temporary = temporary;
            this.output = output;
        }
    }
}
