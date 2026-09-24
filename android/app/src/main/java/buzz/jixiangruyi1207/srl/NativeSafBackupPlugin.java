package buzz.jixiangruyi1207.srl;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.documentfile.provider.DocumentFile;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import android.util.Base64;

/** 用户明确选择的 SAF 文件夹。只保存 SRL 导出的 ZIP，不申请全盘文件权限。 */
@CapacitorPlugin(name = "NativeSafBackup")
public class NativeSafBackupPlugin extends Plugin {
    private static final String PREFS = "srl-saf-backup";
    private static final String TREE_URI = "tree-uri";
    private static final String LAST_BACKUP_AT = "last-backup-at";
    private static final int MAX_CHUNK_BYTES = 1024 * 1024;
    private final ConcurrentHashMap<String, PendingWrite> pendingWrites = new ConcurrentHashMap<>();

    @PluginMethod
    public void chooseDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            .addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "directorySelected");
    }

    @ActivityCallback
    private void directorySelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(status());
            return;
        }
        Uri treeUri = result.getData().getData();
        int flags = result.getData().getFlags();
        try {
            boolean canRead = (flags & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0;
            boolean canWrite = (flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0;
            if (canRead && canWrite) {
                getContext().getContentResolver().takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } else if (canRead) {
                getContext().getContentResolver().takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else if (canWrite) {
                getContext().getContentResolver().takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } else {
                throw new SecurityException("系统没有授予所选文件夹的读写权限");
            }
            prefs().edit().putString(TREE_URI, treeUri.toString()).apply();
            call.resolve(status());
        } catch (Exception error) {
            call.reject("无法保留系统备份文件夹授权：" + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void clearDirectory(PluginCall call) {
        prefs().edit().remove(TREE_URI).remove(LAST_BACKUP_AT).apply();
        call.resolve(status());
    }

    @PluginMethod
    public void beginWrite(PluginCall call) {
        try {
            Uri treeUri = treeUri();
            DocumentFile tree = treeUri == null ? null : DocumentFile.fromTreeUri(getContext(), treeUri);
            if (tree == null || !tree.canWrite()) throw new IllegalStateException("系统备份文件夹不可写，请重新选择");
            String name = safeName(call.getString("fileName", "SRL-备份.zip"));
            DocumentFile output = tree.createFile("application/zip", name);
            if (output == null) throw new IllegalStateException("无法在系统备份文件夹创建文件");
            OutputStream stream = getContext().getContentResolver().openOutputStream(output.getUri(), "w");
            if (stream == null) throw new IllegalStateException("无法写入系统备份文件");
            String token = UUID.randomUUID().toString();
            pendingWrites.put(token, new PendingWrite(output, stream));
            JSObject value = new JSObject(); value.put("token", token); call.resolve(value);
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public void appendWrite(PluginCall call) {
        try {
            PendingWrite write = pending(call.getString("token"));
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.NO_WRAP);
            if (bytes.length > MAX_CHUNK_BYTES) throw new IllegalArgumentException("备份分块超过 1 MiB");
            synchronized (write) { write.stream.write(bytes); write.bytes += bytes.length; }
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public void commitWrite(PluginCall call) {
        try {
            PendingWrite write = pendingWrites.remove(call.getString("token"));
            if (write == null) throw new IllegalArgumentException("系统备份写入令牌已失效");
            synchronized (write) { write.stream.flush(); write.stream.close(); }
            prefs().edit().putLong(LAST_BACKUP_AT, System.currentTimeMillis()).apply();
            JSObject value = new JSObject(); value.put("uri", write.file.getUri().toString()); value.put("bytes", write.bytes); call.resolve(value);
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public void abortWrite(PluginCall call) {
        PendingWrite write = pendingWrites.remove(call.getString("token"));
        try {
            if (write != null) { synchronized (write) { write.stream.close(); } write.file.delete(); }
            call.resolve();
        } catch (Exception error) { call.reject("取消系统备份写入失败：" + error.getMessage(), error); }
    }

    @Override protected void handleOnDestroy() {
        for (PendingWrite write : pendingWrites.values()) try { write.stream.close(); } catch (Exception ignored) {}
        pendingWrites.clear();
    }

    private JSObject status() {
        JSObject result = new JSObject();
        Uri uri = treeUri();
        DocumentFile tree = uri == null ? null : DocumentFile.fromTreeUri(getContext(), uri);
        boolean available = tree != null && tree.exists() && tree.canRead() && tree.canWrite();
        result.put("configured", uri != null);
        result.put("available", available);
        if (uri != null) result.put("uri", uri.toString());
        if (tree != null && tree.getName() != null) result.put("name", tree.getName());
        long availableBytes = availableBytes(uri);
        if (availableBytes >= 0) result.put("availableBytes", availableBytes);
        result.put("lastBackupAt", prefs().getLong(LAST_BACKUP_AT, 0));
        return result;
    }
    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE); }
    private Uri treeUri() { String value = prefs().getString(TREE_URI, null); return value == null || value.isBlank() ? null : Uri.parse(value); }
    /** 外部存储提供器会公开根目录余量；第三方云盘未公开时返回 -1，由页面如实标为未知。 */
    private long availableBytes(Uri uri) {
        if (uri == null || uri.getAuthority() == null) return -1;
        try (Cursor cursor = getContext().getContentResolver().query(
            DocumentsContract.buildRootsUri(uri.getAuthority()), null, null, null, null
        )) {
            if (cursor == null) return -1;
            String treeId = DocumentsContract.getTreeDocumentId(uri);
            String rootId = treeId.contains(":") ? treeId.substring(0, treeId.indexOf(':')) : treeId;
            int idIndex = cursor.getColumnIndex(DocumentsContract.Root.COLUMN_DOCUMENT_ID);
            int bytesIndex = cursor.getColumnIndex(DocumentsContract.Root.COLUMN_AVAILABLE_BYTES);
            while (cursor.moveToNext()) {
                if (idIndex >= 0 && rootId.equals(cursor.getString(idIndex)) && bytesIndex >= 0 && !cursor.isNull(bytesIndex)) return cursor.getLong(bytesIndex);
            }
        } catch (Exception ignored) {}
        return -1;
    }
    private PendingWrite pending(String token) { PendingWrite value = token == null ? null : pendingWrites.get(token); if (value == null) throw new IllegalArgumentException("系统备份写入令牌已失效"); return value; }
    private String safeName(String value) { String name = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim(); return name.isBlank() ? "SRL-备份.zip" : name; }
    private static final class PendingWrite { final DocumentFile file; final OutputStream stream; long bytes; PendingWrite(DocumentFile file, OutputStream stream) { this.file=file; this.stream=stream; } }
}
