package buzz.jixiangruyi1207.srl;

import android.net.Uri;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.getcapacitor.JSArray;
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
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;
import java.util.Collections;
import java.util.TreeSet;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Pattern;
import java.util.regex.Matcher;
import org.json.JSONObject;
import okhttp3.Dns;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.Call;

/** 把开场白展示素材流式下载到 Android 缓存，避免二进制经 JS/Base64 桥接。 */
@CapacitorPlugin(name = "NativePreviewAsset")
public class NativePreviewAssetPlugin extends Plugin {
    private static final long MAX_RESOURCE_BYTES = 12L * 1024L * 1024L;
    private static final long MAX_CACHE_BYTES = 64L * 1024L * 1024L;
    private static final long CACHE_TTL_MS = TimeUnit.HOURS.toMillis(6);
    private static final long PART_STALE_MS = TimeUnit.MINUTES.toMillis(15);
    private static final int MAX_DOWNLOAD_ATTEMPTS = 2;
    private static final long RETRY_DELAY_MS = 600L;
    private static volatile NativePreviewAssetPlugin activePlugin;
    private static final Pattern CSS_DEPENDENCY = Pattern.compile(
        "url\\(\\s*['\"]?([^'\"()\\s]+)['\"]?\\s*\\)|@import\\s+['\"]([^'\"]+)['\"]", Pattern.CASE_INSENSITIVE);
    private final Map<String, Set<String>> sessions = new HashMap<>();
    private final Map<String, CacheEntry> cacheIndex = new HashMap<>();
    private final TreeSet<CacheEntry> cacheOrder = new TreeSet<>(
        Comparator.comparingLong((CacheEntry entry) -> entry.modified).thenComparing(entry -> entry.key));
    private long cacheBytes;
    private File cacheRoot;
    private boolean cacheIndexed;
    private volatile boolean destroyed;
    private final NativePreviewAssetRequests<DownloadedAsset> requests = new NativePreviewAssetRequests<>(
        NativeExecutors.previewNetwork(), (url, control) -> {
            File cached = findFreshCache(url);
            DownloadedAsset asset = cached == null
                ? downloadWithRetry(url, cacheRoot, sha256(url), MAX_RESOURCE_BYTES, control)
                : readCachedAsset(cached, url);
            return asset;
        });
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
    public void prepare(PluginCall call) {
        try {
            String sessionId = requiredId(call, "sessionId");
            JSArray urls = call.getArray("urls", new JSArray());
            Set<String> registered = new HashSet<>();
            for (int index = 0; index < urls.length(); index++) {
                String url = urls.getString(index);
                validateUrl(url);
                registered.add(url);
            }
            synchronized (this) {
                if (destroyed) throw new IOException("预览会话已结束");
                sessions.put(sessionId, registered);
                activePlugin = this;
            }
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public void release(PluginCall call) {
        try {
            String sessionId = requiredId(call, "sessionId");
            synchronized (this) {
                sessions.remove(sessionId);
                requests.release("session:" + sessionId);
            }
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage()); }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        try {
            requests.release("request:" + requiredId(call, "requestId"));
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage()); }
    }

    @PluginMethod
    public void download(PluginCall call) {
        try {
            if (destroyed) throw new IOException("预览会话已结束");
            initializeCache();
            String rawUrl = call.getString("url", "").trim();
            validateUrl(rawUrl);
            // Older optional APP bundles used download({url,maxBytes}) without cancellation.
            String requestId = call.getString("requestId", "").isEmpty()
                ? UUID.randomUUID().toString() : requiredId(call, "requestId");
            long requestedLimit = NativeBridgeNumber.boundedOrDefault(
                call.getData().opt("maxBytes"), MAX_RESOURCE_BYTES, 1L,
                MAX_RESOURCE_BYTES, "预览资源大小限制无效"
            );
            long maxBytes = Math.max(1L, Math.min(MAX_RESOURCE_BYTES, requestedLimit));
            acquireAsset(rawUrl, Collections.singleton("request:" + requestId))
                .whenComplete((asset, error) -> {
                    if (error != null) { call.reject(error.getMessage(), new Exception(error)); return; }
                    try {
                        if (asset.file.length() > maxBytes) throw new IOException("资源超过预下载大小限制");
                        call.resolve(result(asset.file, asset.resolvedUrl, asset.contentType, asset.cached));
                    } catch (Exception failure) { call.reject(failure.getMessage(), failure); }
                });
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    private DownloadedAsset downloadWithRetry(String rawUrl, File cacheRoot, String key, long maxBytes,
            NativePreviewAssetRequests.Control control) throws Exception {
        SocketTimeoutException timeout = null;
        for (int attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
            try {
                control.check();
                return downloadOnce(rawUrl, cacheRoot, key, maxBytes, control);
            } catch (SocketTimeoutException error) {
                control.check();
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

    private DownloadedAsset downloadOnce(String rawUrl, File cacheRoot, String key, long maxBytes,
            NativePreviewAssetRequests.Control control) throws IOException {
        Request request = new Request.Builder()
                .url(rawUrl)
                .header("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,text/css,*/*;q=0.8")
                .header("User-Agent", "SRL-Android/" + BuildConfig.VERSION_NAME)
                .build();
        Call transport = CLIENT.newCall(request);
        control.attach(transport);
        try (Response response = transport.execute()) {
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
                        control.check();
                        written += count;
                        if (written > maxBytes) throw new IOException("资源超过预下载大小限制");
                        output.write(buffer, 0, count);
                    }
                } catch (Exception error) {
                    temporary.delete();
                    throw error;
                }
            File destination = new File(cacheRoot, key + extension);
            synchronized (this) {
                try { control.check(); }
                catch (IOException error) { temporary.delete(); throw error; }
                CacheEntry previous = removeCacheEntry(key);
                if (previous != null) deleteCachedFile(previous.file);
                if (!temporary.renameTo(destination)) {
                    temporary.delete();
                    throw new IOException("无法提交预览资源缓存");
                }
                destination.setLastModified(System.currentTimeMillis());
                Map<String, String> headers = publicResponseHeaders(response);
                DownloadedAsset asset = new DownloadedAsset(destination, response.request().url().toString(), contentType, headers, false);
                try { writeCacheMetadata(asset); }
                catch (IOException error) { deleteCachedFile(destination); throw error; }
                putCacheEntry(key, destination);
                pruneIndexedCache();
                return asset;
            }
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

    private synchronized void initializeCache() throws IOException {
        if (cacheIndexed) return;
        indexCache(new File(getContext().getCacheDir(), "srl-preview-assets"));
    }

    synchronized void indexCache(File root) throws IOException {
        if (cacheIndexed) return;
        cacheRoot = root;
        if (!ensureCacheDirectory(cacheRoot)) throw new IOException("无法创建预览资源缓存");
        File[] files = cacheRoot.listFiles(File::isFile);
        if (files == null) throw new IOException("无法读取预览资源缓存");
        long now = System.currentTimeMillis();
        for (File file : files) {
            if (file.getName().matches("[a-f0-9]{64}\\.[a-z0-9]{1,8}\\.meta")) {
                File asset = new File(file.getPath().substring(0, file.getPath().length() - 5));
                if (!asset.isFile()) file.delete();
                continue;
            }
            if (file.getName().endsWith(".part")) {
                if (now - file.lastModified() > PART_STALE_MS) file.delete();
                continue;
            }
            if (!file.getName().matches("[a-f0-9]{64}\\.[a-z0-9]{1,8}")) continue;
            String key = file.getName().substring(0, 64);
            CacheEntry previous = cacheIndex.get(key);
            if (previous == null || previous.modified < file.lastModified()) {
                if (previous != null) { removeCacheEntry(key); deleteCachedFile(previous.file); }
                putCacheEntry(key, file);
            } else deleteCachedFile(file);
        }
        pruneIndexedCache();
        cacheIndexed = true;
    }

    synchronized File findFreshCache(String url) throws Exception {
        String key = sha256(url);
        CacheEntry entry = cacheIndex.get(key);
        if (entry == null) return null;
        File file = entry.file;
        if (file.isFile() && file.length() > 0 && file.length() <= MAX_RESOURCE_BYTES
                && System.currentTimeMillis() - entry.modified <= CACHE_TTL_MS) return file;
        removeCacheEntry(key);
        deleteCachedFile(file);
        return null;
    }

    private synchronized CompletableFuture<DownloadedAsset> acquireAsset(String url, Set<String> owners) throws Exception {
        File cached = findFreshCache(url);
        if (cached != null) {
            try {
                DownloadedAsset asset = readCachedAsset(cached, url);
                return CompletableFuture.completedFuture(asset);
            } catch (IOException error) {
                removeCacheEntry(sha256(url));
                deleteCachedFile(cached);
            }
        }
        return requests.acquire(url, owners, priority(url));
    }

    private synchronized void pruneIndexedCache() {
        long now = System.currentTimeMillis();
        while (!cacheOrder.isEmpty()) {
            CacheEntry oldest = cacheOrder.first();
            if (now - oldest.modified <= CACHE_TTL_MS && cacheBytes <= MAX_CACHE_BYTES) break;
            if (!deleteCachedFile(oldest.file)) break;
            removeCacheEntry(oldest.key);
        }
    }

    private void putCacheEntry(String key, File file) {
        removeCacheEntry(key);
        CacheEntry entry = new CacheEntry(key, file, file.lastModified(), cachedFileBytes(file));
        cacheIndex.put(key, entry);
        cacheOrder.add(entry);
        cacheBytes += entry.bytes;
    }

    private CacheEntry removeCacheEntry(String key) {
        CacheEntry entry = cacheIndex.remove(key);
        if (entry != null) { cacheOrder.remove(entry); cacheBytes -= entry.bytes; }
        return entry;
    }

    private static final class CacheEntry {
        final String key;
        final File file;
        final long modified;
        final long bytes;
        CacheEntry(String key, File file, long modified, long bytes) {
            this.key = key; this.file = file; this.modified = modified; this.bytes = bytes;
        }
    }

    private static long cachedFileBytes(File file) { return file.length() + new File(file.getPath() + ".meta").length(); }

    private static boolean deleteCachedFile(File file) {
        boolean deleted = !file.exists() || file.delete();
        if (deleted) new File(file.getPath() + ".meta").delete();
        return deleted;
    }

    static Map<String, String> publicResponseHeaders(Response response) {
        Map<String, String> headers = new HashMap<>();
        for (String name : new String[] { "Access-Control-Allow-Origin", "Access-Control-Allow-Credentials",
                "Access-Control-Expose-Headers", "Cross-Origin-Resource-Policy", "Timing-Allow-Origin" }) {
            String value = response.header(name);
            if (value != null) headers.put(name, value);
        }
        headers.put("Cache-Control", "no-store");
        return headers;
    }

    static void writeCacheMetadata(DownloadedAsset asset) throws IOException {
        try {
            JSONObject metadata = new JSONObject();
            metadata.put("resolvedUrl", asset.resolvedUrl);
            metadata.put("contentType", asset.contentType);
            metadata.put("headers", new JSONObject(asset.headers));
            try (FileOutputStream output = new FileOutputStream(asset.file.getPath() + ".meta")) {
                output.write(metadata.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception error) { throw new IOException("无法保存素材缓存元数据", error); }
    }

    static DownloadedAsset readCachedAsset(File file, String url) throws IOException {
        File metadataFile = new File(file.getPath() + ".meta");
        if (!metadataFile.isFile()) {
            // Old caches cannot prove the final CSS base or the original CORS/CORP policy.
            // Refresh this asset once through the normal public request before serving it.
            throw new IOException("素材缓存缺少响应元数据");
        }
        try {
            JSONObject metadata = new JSONObject(readUtf8(metadataFile));
            JSONObject storedHeaders = metadata.optJSONObject("headers");
            Map<String, String> headers = new HashMap<>();
            if (storedHeaders != null) {
                java.util.Iterator<String> names = storedHeaders.keys();
                while (names.hasNext()) { String name = names.next(); headers.put(name, storedHeaders.getString(name)); }
            }
            return new DownloadedAsset(file, metadata.getString("resolvedUrl"), metadata.getString("contentType"), headers, true);
        } catch (Exception error) { throw new IOException("素材缓存元数据无效", error); }
    }

    private void registerCssDependencies(String url, DownloadedAsset asset) throws IOException {
        if (!isCss(asset.file.getName(), asset.contentType)) return;
        Set<String> dependencies = new HashSet<>();
        Matcher matcher = CSS_DEPENDENCY.matcher(readUtf8(asset.file));
        while (matcher.find()) {
            String raw = matcher.group(1) == null ? matcher.group(2) : matcher.group(1);
            try {
                if (raw.startsWith("#")) continue;
                String dependency = URI.create(asset.resolvedUrl).resolve(raw).toString();
                int fragment = dependency.indexOf('#');
                if (fragment >= 0) dependency = dependency.substring(0, fragment);
                validateUrl(dependency);
                dependencies.add(dependency);
            } catch (IllegalArgumentException ignored) { /* data/blob/fragments stay browser-owned. */ }
        }
        synchronized (this) {
            for (Set<String> urls : sessions.values()) if (urls.contains(url)) urls.addAll(dependencies);
        }
    }

    static WebResourceResponse intercept(WebResourceRequest request) {
        NativePreviewAssetPlugin plugin = activePlugin;
        if (plugin == null || request.isForMainFrame() || !"GET".equals(request.getMethod())) return null;
        for (String name : request.getRequestHeaders().keySet()) {
            if (name.equalsIgnoreCase("Range") || name.equalsIgnoreCase("Cookie") || name.equalsIgnoreCase("Authorization")) return null;
        }
        String url = request.getUrl().toString();
        CompletableFuture<DownloadedAsset> future;
        try {
            synchronized (plugin) {
                Set<String> owners = new HashSet<>();
                for (Map.Entry<String, Set<String>> session : plugin.sessions.entrySet()) {
                    if (session.getValue().contains(url)) owners.add("session:" + session.getKey());
                }
                if (owners.isEmpty()) return null;
                plugin.initializeCache();
                future = plugin.acquireAsset(url, owners);
            }
            DownloadedAsset asset = future.get();
            plugin.registerCssDependencies(url, asset);
            String mime = asset.contentType.split(";", 2)[0].trim();
            return new WebResourceResponse(mime, mime.startsWith("text/") ? "UTF-8" : null,
                200, "OK", asset.headers, new FileInputStream(asset.file));
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return null;
        } catch (Exception error) {
            if (error.getCause() instanceof IOException && "预览资源下载已取消".equals(error.getCause().getMessage())) {
                return new WebResourceResponse("text/plain", "UTF-8", 410, "Gone", Collections.emptyMap(), null);
            }
            // A provider may reject native headers while accepting normal WebView requests.
            // Keep the original public URL as the browser's fallback, with no host credentials.
            return null;
        }
    }

    private static int priority(String url) { return url.matches("(?i).*\\.css(?:[?#].*)?$") ? 0 : 1; }

    private static String requiredId(PluginCall call, String name) {
        String id = call.getString(name, "");
        if (!id.matches("[A-Za-z0-9-]{1,80}")) throw new IllegalArgumentException("预览请求标识无效");
        return id;
    }

    private static void validateUrl(String rawUrl) {
        URI uri = URI.create(rawUrl);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!("https".equals(scheme) || "http".equals(scheme)) || uri.getHost() == null || uri.getRawUserInfo() != null) {
            throw new IllegalArgumentException("预览资源只允许公开 HTTP 或 HTTPS 地址");
        }
    }

    @Override protected void handleOnDestroy() {
        synchronized (this) {
            destroyed = true;
            requests.close();
            sessions.clear();
        }
        if (activePlugin == this) activePlugin = null;
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

    static final class DownloadedAsset {
        final File file;
        final String resolvedUrl;
        final String contentType;
        final Map<String, String> headers;
        final boolean cached;

        DownloadedAsset(File file, String resolvedUrl, String contentType, Map<String, String> headers, boolean cached) {
            this.file = file;
            this.resolvedUrl = resolvedUrl;
            this.contentType = contentType;
            this.headers = headers;
            this.cached = cached;
        }
    }
}
