package buzz.jixiangruyi1207.srl;

import com.getcapacitor.JSObject;
import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.Iterator;
import java.util.Locale;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

final class NativeCloudWebDav {
    private NativeCloudWebDav() {}
    private static final int MAX_WEBDAV_RESPONSE_BYTES = 8 * 1024 * 1024;
    private static final Set<String> WEBDAV_METHODS = new HashSet<>(Arrays.asList("MKCOL", "PROPFIND"));
    private static final Set<String> WEBDAV_HEADERS = new HashSet<>(Arrays.asList("authorization", "depth", "accept"));
    static JSObject request(String rawUrl, String rawMethod, JSObject headers) throws Exception {
            URI uri = URI.create(rawUrl);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
                throw new IllegalArgumentException("WebDAV 原生请求只允许 HTTPS 地址");
            }
            String method = rawMethod.toUpperCase(Locale.ROOT);
            if (!WEBDAV_METHODS.contains(method)) throw new IllegalArgumentException("WebDAV 请求方法不在允许范围内");

            Request.Builder request = new Request.Builder().url(rawUrl).method(method, null);
            Iterator<String> headerNames = headers.keys();
            while (headerNames.hasNext()) {
                String name = headerNames.next();
                String normalized = name.toLowerCase(Locale.ROOT);
                if (!WEBDAV_HEADERS.contains(normalized)) continue;
                String value = headers.optString(name, "");
                if (!value.isBlank() && value.length() <= 8192 && value.indexOf('\r') < 0 && value.indexOf('\n') < 0) {
                    request.header(name, value);
                }
            }

            try (Response response = NativeHttpClients.METADATA.newCall(request.build()).execute()) {
                JSObject result = new JSObject();
                result.put("status", response.code());
                JSObject responseHeaders = new JSObject();
                for (String name : response.headers().names()) {
                    responseHeaders.put(name, String.join(", ", response.headers(name)));
                }
                result.put("headers", responseHeaders);
                ResponseBody body = response.body();
                if (body != null) {
                    byte[] bytes = readLimited(body.byteStream(), MAX_WEBDAV_RESPONSE_BYTES);
                    if (bytes.length > 0) result.put("body", new String(bytes, StandardCharsets.UTF_8));
                }
                return result;
            }
    }
    private static byte[] readLimited(InputStream input, int maximum) throws Exception {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int total = 0;
            int read;
            while ((read = source.read(buffer)) >= 0) {
                total += read;
                if (total > maximum) throw new IllegalStateException("WebDAV 响应超过 8 MiB 安全上限");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }
}
