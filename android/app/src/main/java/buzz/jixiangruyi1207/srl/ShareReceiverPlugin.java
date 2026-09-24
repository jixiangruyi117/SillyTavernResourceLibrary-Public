package buzz.jixiangruyi1207.srl;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.lang.ref.WeakReference;

@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {
    private static final int MAX_SHARED_FILE_BYTES = 256 * 1024 * 1024;
    private static final long STALE_FILE_AGE_MS = 7L * 24L * 60L * 60L * 1000L;
    static final String CACHE_FOLDER = "srl-shared-intake";
    private static final Object LISTENER_LOCK = new Object();
    private static WeakReference<ShareReceiverPlugin> activePlugin = new WeakReference<>(null);

    @Override public void load() { synchronized (LISTENER_LOCK) { activePlugin = new WeakReference<>(this); } }

    static void notifyShareReady() {
        ShareReceiverPlugin plugin;
        synchronized (LISTENER_LOCK) { plugin = activePlugin.get(); }
        if (plugin != null) plugin.notifyListeners("ready", new JSObject());
    }

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        NativeExecutors.ioLimited().execute(() -> {
          try {
            Intent intent = getActivity().getIntent();
            String action = intent == null ? null : intent.getAction();
            List<Uri> uris = new ArrayList<>();
            if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> shared = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (shared != null) uris.addAll(shared);
            } else {
                Uri shared = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (shared != null) uris.add(shared);
            }
            Uri sharedData = intent.getData();
            if (sharedData != null && !uris.contains(sharedData)) uris.add(sharedData);

            if (isShareIntent(action, sharedData)) {
                List<String> created = new ArrayList<>();
                try {
                    for (Uri uri : uris) created.add(readFile(uri));
                } catch (Exception error) {
                    for (String token : created) deleteToken(token);
                    throw error;
                }
                getActivity().setIntent(new Intent());
            }
            JSArray files = listPendingFiles();
            JSObject result = new JSObject();
            result.put("files", files);
            call.resolve(result);
          } catch (Exception error) {
            call.reject("读取系统分享文件失败：" + error.getMessage(), error);
          }
        });
    }

    private boolean isShareIntent(String action, Uri data) {
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) return true;
        if (!Intent.ACTION_VIEW.equals(action) || data == null) return false;
        String scheme = data.getScheme();
        return "content".equalsIgnoreCase(scheme) || "file".equalsIgnoreCase(scheme);
    }

    @PluginMethod
    public void cleanupPendingShare(PluginCall call) {
        JSArray tokens = call.getArray("tokens", new JSArray());
        File cacheFolder = shareCacheFolder();
        try {
            String cachePrefix = cacheFolder.getCanonicalPath() + File.separator;
            for (int index = 0; index < tokens.length(); index++) {
                String token = tokens.optString(index, "");
                if (token.isBlank() || token.contains("/") || token.contains("\\")) continue;
                File target = new File(cacheFolder, token);
                File metadata = new File(cacheFolder, token + ".json");
                if (target.getCanonicalPath().startsWith(cachePrefix)) target.delete();
                if (metadata.getCanonicalPath().startsWith(cachePrefix)) metadata.delete();
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("清理系统分享临时文件失败：" + error.getMessage(), error);
        }
    }

    private String readFile(Uri uri) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        String name = fileName(resolver, uri);
        String mime = resolver.getType(uri);
        File cacheFolder = shareCacheFolder();
        deleteStaleFiles(cacheFolder);
        String token = UUID.randomUUID() + "-" + safeFileName(name);
        File target = new File(cacheFolder, token + ".part");
        File committed = new File(cacheFolder, token);
        try (InputStream input = resolver.openInputStream(uri);
             FileOutputStream output = new FileOutputStream(target)) {
            if (input == null) throw new IllegalArgumentException("无法打开分享文件");
            byte[] buffer = new byte[64 * 1024];
            int total = 0;
            int length;
            while ((length = input.read(buffer)) >= 0) {
                total += length;
                if (total > MAX_SHARED_FILE_BYTES) {
                    throw new IllegalArgumentException("单个分享文件超过 256 MB，请在应用内导入");
                }
                output.write(buffer, 0, length);
            }
            if (!target.renameTo(committed)) throw new IllegalStateException("无法提交系统分享暂存文件");
            JSObject metadata = new JSObject();
            metadata.put("version", 1);
            metadata.put("name", name);
            metadata.put("type", mime == null ? "application/octet-stream" : mime);
            metadata.put("cleanupToken", token);
            metadata.put("size", committed.length());
            metadata.put("createdAt", System.currentTimeMillis());
            try (FileOutputStream metadataOutput = new FileOutputStream(new File(cacheFolder, token + ".json"))) {
                metadataOutput.write(metadata.toString().getBytes(StandardCharsets.UTF_8));
            }
            return token;
        } catch (Exception error) {
            target.delete();
            committed.delete();
            new File(cacheFolder, token + ".json").delete();
            throw error;
        }
    }

    private void deleteToken(String token) {
        if (token == null || token.isBlank() || token.contains("/") || token.contains("\\")) return;
        File folder = shareCacheFolder();
        new File(folder, token).delete();
        new File(folder, token + ".json").delete();
    }

    private File shareCacheFolder() {
        File folder = new File(getContext().getFilesDir(), CACHE_FOLDER);
        if (!folder.exists() && !folder.mkdirs()) {
            throw new IllegalStateException("无法创建系统分享临时目录");
        }
        return folder;
    }

    private void deleteStaleFiles(File folder) {
        File[] files = folder.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - STALE_FILE_AGE_MS;
        for (File file : files) {
            if (file.isFile() && file.lastModified() < cutoff) file.delete();
        }
    }

    private JSArray listPendingFiles() throws Exception {
        File folder = shareCacheFolder();
        deleteStaleFiles(folder);
        JSArray result = new JSArray();
        File[] metadataFiles = folder.listFiles((dir, name) -> name.endsWith(".json"));
        if (metadataFiles == null) return result;
        for (File metadataFile : metadataFiles) {
            String token = metadataFile.getName().substring(0, metadataFile.getName().length() - 5);
            File payload = new File(folder, token);
            if (!payload.isFile() || metadataFile.length() > 64 * 1024) continue;
            byte[] bytes = new byte[(int) metadataFile.length()];
            try (FileInputStream input = new FileInputStream(metadataFile)) {
                int offset = 0;
                while (offset < bytes.length) {
                    int read = input.read(bytes, offset, bytes.length - offset);
                    if (read < 0) break;
                    offset += read;
                }
            }
            JSObject file = new JSObject(new String(bytes, StandardCharsets.UTF_8));
            if (file.optLong("size", -1L) != payload.length()) continue;
            file.put("uri", Uri.fromFile(payload).toString());
            result.put(file);
        }
        return result;
    }

    private String safeFileName(String name) {
        String safe = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        return safe.isBlank() ? "shared-file" : safe;
    }

    private String fileName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        }
        String fallback = uri.getLastPathSegment();
        return fallback == null || fallback.isBlank() ? "shared-file" : fallback;
    }
}
