package buzz.jixiangruyi1207.srl;

import android.net.Uri;
import android.webkit.MimeTypeMap;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import okhttp3.Dns;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** 把开场白展示素材流式下载到 Android 缓存，避免二进制经 JS/Base64 桥接。 */
@CapacitorPlugin(name = "NativePreviewAsset")
public class NativePreviewAssetPlugin extends Plugin {
    private static final long MAX_RESOURCE_BYTES = 12L * 1024L * 1024L;
    private static final long MAX_CACHE_BYTES = 64L * 1024L * 1024L;
    private static final long CACHE_TTL_MS = TimeUnit.HOURS.toMillis(6);
    private static final long PART_STALE_MS = TimeUnit.MINUTES.toMillis(15);
    private static final int MAX_DOWNLOAD_ATTEMPTS = 2;
    private static final long RETRY_DELAY_MS = 600L;
    private static final ConcurrentHashMap<String, Object> CACHE_LOCKS = new ConcurrentHashMap<>();
    private static final Dns PUBLIC_DNS = hostname -> {
        List<InetAddress> addresses = Dns.SYSTEM.lookup(hostname);
        for (InetAddress address : addresses) {
            if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isSiteLocalAddress()) {
                throw new UnknownHostException("预览资源地址不能指向本机或私有网络");
            }
        }
        return addresses;
    };
    private static final OkHttpClient CLIENT = NativeHttpClients.METADATA.newBuilder()
        .dns(PUBLIC_DNS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(25, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build();

    @PluginMethod
    public void download(PluginCall call) {
        runIo(call, () -> {
            String rawUrl = call.getString("url", "").trim();
            URI uri = URI.create(rawUrl);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!("https".equals(scheme) || "http".equals(scheme)) || uri.getHost() == null) {
                throw new IllegalArgumentException("预览资源只允许 HTTP 或 HTTPS 地址");
            }
            long requestedLimit = NativeBridgeNumber.boundedOrDefault(
                call.getData().opt("maxBytes"), MAX_RESOURCE_BYTES, 1L,
                MAX_RESOURCE_BYTES, "预览资源大小限制无效"
            );
            long maxBytes = Math.max(1L, Math.min(MAX_RESOURCE_BYTES, requestedLimit));
            File cacheRoot = new File(getContext().getCacheDir(), "srl-preview-assets");
            if (!ensureCacheDirectory(cacheRoot)) throw new IOException("无法创建预览资源缓存");
            pruneCache(cacheRoot);

            String key = sha256(rawUrl);
            Object cacheLock = CACHE_LOCKS.computeIfAbsent(key, ignored -> new Object());
            try {
                synchronized (cacheLock) {
                    File cached = findFreshCache(cacheRoot, key, maxBytes);
                    if (cached != null) {
                        call.resolve(result(cached, rawUrl, mimeType(cached.getName()), true));
                        return;
                    }

                    DownloadedAsset downloaded = downloadWithRetry(rawUrl, cacheRoot, key, maxBytes);
                    call.resolve(result(downloaded.file, downloaded.resolvedUrl, downloaded.contentType, false));
                }
            } finally {
                CACHE_LOCKS.remove(key, cacheLock);
            }
        });
    }

    private DownloadedAsset downloadWithRetry(String rawUrl, File cacheRoot, String key, long maxBytes) throws Exception {
        SocketTimeoutException timeout = null;
        for (int attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
            try {
                return downloadOnce(rawUrl, cacheRoot, key, maxBytes);
            } catch (SocketTimeoutException error) {
                timeout = error;
                if (attempt == MAX_DOWNLOAD_ATTEMPTS) break;
                try {
                    Thread.sleep(RETRY_DELAY_MS);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IOException("预览资源下载已取消", interrupted);
                }
            }
        }
        throw new IOException("资源读取超时（已重试一次）", timeout);
    }

    private DownloadedAsset downloadOnce(String rawUrl, File cacheRoot, String key, long maxBytes) throws IOException {
        Request request = new Request.Builder()
                .url(rawUrl)
                .header("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,text/css,*/*;q=0.8")
                .header("User-Agent", "SRL-Android/" + BuildConfig.VERSION_NAME)
                .build();
        try (Response response = CLIENT.newCall(request).execute()) {
                if (!response.isSuccessful()) throw new IOException("资源请求失败（" + response.code() + "）");
                ResponseBody body = response.body();
                if (body == null) throw new IOException("资源响应为空");
                long declaredSize = body.contentLength();
                if (declaredSize > maxBytes) throw new IOException("资源超过预下载大小限制");
                String contentType = body.contentType() == null ? "application/octet-stream" : body.contentType().toString();
                String extension = extensionFor(response.request().url().encodedPath(), contentType);
                File temporary = new File(cacheRoot, key + "." + UUID.randomUUID() + ".part");
                long written;
                try (InputStream input = body.byteStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                    byte[] buffer = new byte[32 * 1024];
                    written = 0;
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        written += count;
                        if (written > maxBytes) throw new IOException("资源超过预下载大小限制");
                        output.write(buffer, 0, count);
                    }
                } catch (Exception error) {
                    temporary.delete();
                    throw error;
                }
            File destination = new File(cacheRoot, key + extension);
            deleteCacheVariants(cacheRoot, key, temporary);
            if (!temporary.renameTo(destination)) {
                temporary.delete();
                throw new IOException("无法提交预览资源缓存");
            }
            destination.setLastModified(System.currentTimeMillis());
            pruneCache(cacheRoot);
            return new DownloadedAsset(destination, response.request().url().toString(), contentType);
        }
    }

    private static boolean ensureCacheDirectory(File root) {
        return root.isDirectory() || (root.mkdirs() && root.isDirectory()) || root.isDirectory();
    }

    private JSObject result(File file, String resolvedUrl, String contentType, boolean cached) throws IOException {
        JSObject value = new JSObject();
        value.put("path", Uri.fromFile(file).toString());
        value.put("resolvedUrl", resolvedUrl);
        value.put("contentType", contentType);
        value.put("size", file.length());
        value.put("cached", cached);
        if (isCss(file.getName(), contentType)) value.put("text", readUtf8(file));
        return value;
    }

    private static File findFreshCache(File root, String key, long maxBytes) {
        long oldest = System.currentTimeMillis() - CACHE_TTL_MS;
        File[] candidates = root.listFiles(file -> file.isFile() && file.getName().startsWith(key + ".") && !file.getName().endsWith(".part"));
        if (candidates == null) return null;
        return Arrays.stream(candidates)
            .filter(file -> file.lastModified() >= oldest && file.length() > 0 && file.length() <= maxBytes)
            .max(Comparator.comparingLong(File::lastModified))
            .orElse(null);
    }

    private static void deleteCacheVariants(File root, String key, File keep) {
        File[] candidates = root.listFiles(file -> file.isFile() && file.getName().startsWith(key + ".") && !file.getName().endsWith(".part"));
        if (candidates == null) return;
        for (File file : candidates) if (!file.equals(keep)) file.delete();
    }

    private static void pruneCache(File root) {
        File[] files = root.listFiles(File::isFile);
        if (files == null) return;
        long now = System.currentTimeMillis();
        for (File file : files) {
            if ((file.getName().endsWith(".part") && now - file.lastModified() > PART_STALE_MS) || now - file.lastModified() > CACHE_TTL_MS) file.delete();
        }
        files = root.listFiles(file -> file.isFile() && !file.getName().endsWith(".part"));
        if (files == null) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        long total = Arrays.stream(files).mapToLong(File::length).sum();
        for (File file : files) {
            if (total <= MAX_CACHE_BYTES) break;
            long size = file.length();
            if (file.delete()) total -= size;
        }
    }

    private static String extensionFor(String path, String contentType) {
        String suffix = path == null ? "" : path.substring(path.lastIndexOf('/') + 1);
        int query = suffix.indexOf('?');
        if (query >= 0) suffix = suffix.substring(0, query);
        int dot = suffix.lastIndexOf('.');
        if (dot >= 0) {
            String extension = suffix.substring(dot).toLowerCase(Locale.ROOT);
            if (extension.matches("\\.[a-z0-9]{1,8}")) return extension;
        }
        String bareType = contentType.split(";", 2)[0].trim();
        String guessed = MimeTypeMap.getSingleton().getExtensionFromMimeType(bareType);
        return guessed == null || guessed.isBlank() ? ".bin" : "." + guessed;
    }

    private static String mimeType(String name) {
        int dot = name.lastIndexOf('.');
        String extension = dot < 0 ? "" : name.substring(dot + 1);
        String value = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return value == null ? "application/octet-stream" : value;
    }

    private static boolean isCss(String name, String contentType) {
        return contentType.toLowerCase(Locale.ROOT).contains("text/css") || name.toLowerCase(Locale.ROOT).endsWith(".css");
    }

    private static String readUtf8(File file) throws IOException {
        if (file.length() > MAX_RESOURCE_BYTES) throw new IOException("样式资源超过预下载大小限制");
        byte[] bytes = new byte[(int) file.length()];
        try (FileInputStream input = new FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int count = input.read(bytes, offset, bytes.length - offset);
                if (count < 0) break;
                offset += count;
            }
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static String sha256(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder output = new StringBuilder(digest.length * 2);
        for (byte item : digest) output.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return output.toString();
    }

    private void runIo(PluginCall call, CheckedAction action) {
        NativeExecutors.ioLimited().execute(() -> {
            try {
                action.run();
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "原生预览资源下载失败" : error.getMessage(), error);
            }
        });
    }

    @FunctionalInterface
    private interface CheckedAction {
        void run() throws Exception;
    }

    private static final class DownloadedAsset {
        private final File file;
        private final String resolvedUrl;
        private final String contentType;

        private DownloadedAsset(File file, String resolvedUrl, String contentType) {
            this.file = file;
            this.resolvedUrl = resolvedUrl;
            this.contentType = contentType;
        }
    }
}
