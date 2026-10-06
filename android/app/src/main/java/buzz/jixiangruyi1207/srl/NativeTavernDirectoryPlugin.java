package buzz.jixiangruyi1207.srl;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;

/** Only the explicitly selected Tavern user directory; no arbitrary content URI or path API. */
@CapacitorPlugin(name = "NativeTavernDirectory")
public class NativeTavernDirectoryPlugin extends Plugin {
    private static final String PREFS = "srl-tavern-directory";
    private static final long LIMIT = 256L * 1024 * 1024;
    private final Map<String, InputStream> reads = new HashMap<>();
    private final Map<String, Write> writes = new HashMap<>();
    private final java.util.concurrent.ExecutorService io = java.util.concurrent.Executors.newSingleThreadExecutor();
    private interface Work { JSObject run() throws Exception; }
    private void execute(PluginCall call, Work work) {
        io.execute(() -> { try { call.resolve(work.run()); } catch (Exception error) { call.reject(error.getMessage(), error); } });
    }
    private String storedUri() { return getContext().getSharedPreferences(PREFS, 0).getString("tree", null); }
    private DocumentFile root() throws IOException {
        String value = storedUri();
        DocumentFile root = value == null ? null : DocumentFile.fromTreeUri(getContext(), Uri.parse(value));
        String userPath = getContext().getSharedPreferences(PREFS, 0).getString("userPath", "");
        if (root != null && !userPath.isEmpty()) for (String part : parts(userPath)) { root = root.findFile(part); if (root == null) break; }
        if (root == null || !root.canRead() || !root.canWrite()) throw new IOException("酒馆目录授权失效，请重新选择文件夹");
        return root;
    }
    private String[] parts(String path) {
        if (path == null || path.isEmpty()) throw new IllegalArgumentException("资源路径为空");
        String[] parts = path.split("/", -1);
        for (String part : parts) if (part.isEmpty() || part.equals(".") || part.equals("..") || part.matches(".*[\\\\\u0000-\u001f].*")) throw new IllegalArgumentException("资源路径无效");
        return parts;
    }
    private DocumentFile find(String path) throws IOException {
        DocumentFile file = root();
        if (path == null || path.isEmpty()) return file;
        allowed(path);
        for (String part : parts(path)) { file = file.findFile(part); if (file == null) return null; }
        return file;
    }
    private void allowed(String path) {
        String[] parts = parts(path); int start = 0;
        if (parts[0].equals(".srl-backups")) {
            if (parts.length < 3 || !parts[1].matches("[a-fA-F0-9-]{36}")) throw new IllegalArgumentException("恢复副本路径无效");
            start = 2;
        }
        List<String> folders = Arrays.asList("characters", "worlds", "OpenAI Settings", "TextGen Settings", "NovelAI Settings", "KoboldAI Settings", "themes", "QuickReplies", "User Avatars");
        int count = parts.length - start;
        if (!((count == 1 && (parts[start].equals("settings.json") || folders.contains(parts[start]))) || (count == 2 && folders.contains(parts[start])))) throw new IllegalArgumentException("路径不属于支持的酒馆资源目录");
    }
    private DocumentFile parent(String path) throws IOException {
        String[] parts = parts(path);
        DocumentFile dir = root();
        for (int i = 0; i < parts.length - 1; i++) {
            DocumentFile next = dir.findFile(parts[i]);
            if (next == null) next = dir.createDirectory(parts[i]);
            if (next == null || !next.isDirectory()) throw new IOException("无法创建资源目录");
            dir = next;
        }
        return dir;
    }
    private String hash(InputStream input) throws Exception {
        try (InputStream stream = input) {
            if (stream == null) throw new IOException("无法读取文件");
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024]; int count; long total = 0;
            while ((count = stream.read(buffer)) != -1) { total += count; if (total > LIMIT) throw new IOException("文件超过 256 MiB"); hash.update(buffer, 0, count); }
            StringBuilder value = new StringBuilder(); for (byte b : hash.digest()) value.append(String.format("%02x", b & 255)); return value.toString();
        }
    }
    private String hash(DocumentFile file) throws Exception { return file == null ? null : hash(getContext().getContentResolver().openInputStream(file.getUri())); }
    private boolean isUserDirectory(DocumentFile dir) {
        if (dir == null || !dir.isDirectory()) return false;
        DocumentFile settings = dir.findFile("settings.json"), characters = dir.findFile("characters");
        return settings != null && settings.isFile() && characters != null && characters.isDirectory();
    }
    private String locateUser(DocumentFile selected) throws IOException {
        if (isUserDirectory(selected)) return "";
        DocumentFile data = selected.findFile("data"); String prefix = "data/";
        if (data == null || !data.isDirectory()) { data = selected; prefix = ""; }
        List<String> candidates = new ArrayList<>(); int inspected = 0;
        for (DocumentFile child : data.listFiles()) {
            if (!child.isDirectory() || child.getName() == null || child.getName().startsWith(".")) continue;
            if (++inspected > 100) throw new IOException("目录范围太大，请进入 SillyTavern/data 后重新选择");
            if (isUserDirectory(child)) candidates.add(child.getName());
        }
        if (candidates.size() == 1) return prefix + candidates.get(0);
        if (candidates.size() > 1) throw new IOException("找到多个酒馆用户：" + String.join("、", candidates) + "。请进入其中一个目录重新选择，避免写错用户。");
        throw new IOException("未找到酒馆用户目录。请选择 SillyTavern/data/default-user；应同时包含 settings.json 与 characters。");
    }
    @PluginMethod public void chooseDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        if (android.os.Build.VERSION.SDK_INT >= 26 && storedUri() != null) intent.putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(storedUri()));
        startActivityForResult(call, intent, "selected");
    }
    @ActivityCallback private void selected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.reject("已取消选择酒馆目录"); return; }
        Uri uri = result.getData().getData();
        execute(call, () -> {
            if (!reads.isEmpty() || !writes.isEmpty()) throw new IOException("资源任务进行中，请结束后再更换目录");
            DocumentFile selected = DocumentFile.fromTreeUri(getContext(), uri);
            if (selected == null || !selected.canRead() || !selected.canWrite()) throw new IOException("此文件夹不可读写，请选择酒馆用户目录");
            String userPath = locateUser(selected);
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getContext().getSharedPreferences(PREFS, 0).edit().putString("tree", uri.toString()).putString("userPath", userPath).apply();
            JSObject value = new JSObject(); value.put("name", root().getName()); return value;
        });
    }
    @PluginMethod public void status(PluginCall call) { execute(call, () -> { JSObject value = new JSObject(); value.put("name", root().getName()); return value; }); }
    @PluginMethod public void list(PluginCall call) { execute(call, () -> {
        DocumentFile dir = find(call.getString("path", "")); JSArray entries = new JSArray();
        if (dir != null && dir.isDirectory()) for (DocumentFile file : dir.listFiles()) { JSObject entry = new JSObject(); entry.put("name", file.getName()); entry.put("directory", file.isDirectory()); entries.put(entry); }
        JSObject value = new JSObject(); value.put("entries", entries); return value;
    }); }
    @PluginMethod public void beginRead(PluginCall call) { execute(call, () -> {
        DocumentFile file = find(call.getString("path")); JSObject value = new JSObject();
        if (file == null) { value.put("missing", true); return value; }
        if (!file.isFile() || file.length() > LIMIT || reads.size() >= 4) throw new IOException("文件不可读取或任务过多");
        InputStream input = getContext().getContentResolver().openInputStream(file.getUri());
        if (input == null) throw new IOException("无法读取酒馆文件");
        String token = UUID.randomUUID().toString(); reads.put(token, input);
        value.put("token", token); value.put("name", file.getName()); value.put("size", file.length()); value.put("type", file.getType()); value.put("modified", file.lastModified()); return value;
    }); }
    @PluginMethod public void readChunk(PluginCall call) { execute(call, () -> {
        InputStream stream = reads.get(call.getString("token")); if (stream == null) throw new IOException("读取任务已失效");
        byte[] buffer = new byte[256 * 1024]; int count = stream.read(buffer); JSObject value = new JSObject();
        value.put("done", count < 0); value.put("data", count < 0 ? "" : Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)); return value;
    }); }
    @PluginMethod public void endRead(PluginCall call) { execute(call, () -> { InputStream stream = reads.remove(call.getString("token")); if (stream != null) stream.close(); return new JSObject(); }); }
    @PluginMethod public void beginWrite(PluginCall call) { execute(call, () -> {
        String path = call.getString("path"); allowed(path);
        if (writes.size() >= 2) throw new IOException("写入任务过多");
        String expected = call.getString("expectedHash");
        if (!Objects.equals(expected, hash(find(path)))) throw new IOException("酒馆文件已变化，请重新读取后再写入");
        File temp = File.createTempFile("srl-tavern-", ".part", getContext().getCacheDir());
        String token = UUID.randomUUID().toString(); writes.put(token, new Write(path, expected, temp));
        JSObject value = new JSObject(); value.put("token", token); return value;
    }); }
    @PluginMethod public void appendWrite(PluginCall call) { execute(call, () -> {
        Write write = writes.get(call.getString("token")); if (write == null) throw new IOException("写入任务已失效");
        String encoded = call.getString("data", ""); if (encoded.length() > 800000) throw new IOException("文件块过大");
        byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP); write.size += bytes.length;
        if (write.size > LIMIT) throw new IOException("文件超过 256 MiB"); write.output.write(bytes); return new JSObject();
    }); }
    @PluginMethod public void commitWrite(PluginCall call) { execute(call, () -> {
        Write write = writes.remove(call.getString("token")); if (write == null) throw new IOException("写入任务已失效");
        try {
            write.output.close();
            DocumentFile existing = find(write.path);
            if (!Objects.equals(write.expected, hash(existing))) throw new IOException("酒馆文件已变化，请重新读取后再写入");
            DocumentFile parent = parent(write.path); String[] parts = parts(write.path);
            DocumentFile target = existing == null ? parent.createFile("application/octet-stream", parts[parts.length - 1]) : existing;
            if (target == null || !parts[parts.length - 1].equals(target.getName())) throw new IOException("文件提供器改变了文件名，停止写入");
            // SAF does not guarantee atomic replacement; the caller has already verified a recovery copy.
            try (InputStream input = new FileInputStream(write.temp); OutputStream output = getContext().getContentResolver().openOutputStream(target.getUri(), "wt")) {
                if (output == null) throw new IOException("无法写入酒馆文件");
                byte[] buffer = new byte[64 * 1024]; int count; while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            if (!hash(new FileInputStream(write.temp)).equals(hash(target))) throw new IOException("写入校验失败，请从 .srl-backups 恢复原件");
            return new JSObject();
        } finally { try { write.output.close(); } catch (Exception ignored) {} write.temp.delete(); }
    }); }
    @PluginMethod public void abortWrite(PluginCall call) { execute(call, () -> { Write write = writes.remove(call.getString("token")); if (write != null) { write.output.close(); write.temp.delete(); } return new JSObject(); }); }
    @Override protected void handleOnDestroy() {
        io.execute(() -> { for (InputStream stream : reads.values()) try { stream.close(); } catch (Exception ignored) {} reads.clear();
            for (Write write : writes.values()) { try { write.output.close(); } catch (Exception ignored) {} write.temp.delete(); } writes.clear(); });
        io.shutdown();
    }
    private static class Write {
        final String path, expected; final File temp; final OutputStream output; long size;
        Write(String path, String expected, File temp) throws IOException { this.path = path; this.expected = expected; this.temp = temp; this.output = new FileOutputStream(temp); }
    }
}
