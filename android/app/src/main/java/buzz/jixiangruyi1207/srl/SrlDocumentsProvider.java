package buzz.jixiangruyi1207.srl;

import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.graphics.Point;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import org.json.JSONObject;

/** 在 Android 系统文件选择器中只读展示 APK 的本机去重资源库。 */
public class SrlDocumentsProvider extends DocumentsProvider {
    private static final String ROOT_ID = "srl-library";
    private static final String DOC_ROOT = "root";
    private static final String RECENT_ID = "virtual:recent";
    private static final String TYPE_PREFIX = "virtual:type:";
    private static final String[][] TYPE_DIRECTORIES = {
        {"characterCard", "角色卡"}, {"worldBook", "世界书"}, {"preset", "预设"},
        {"regex", "正则"}, {"quickReply", "快速回复"}, {"script", "脚本"},
        {"beautification", "美化"}, {"userPersona", "用户人设"}, {"other", "其他"}
    };
    private static final String[] ROOT_COLUMNS = {
        DocumentsContract.Root.COLUMN_ROOT_ID, DocumentsContract.Root.COLUMN_DOCUMENT_ID,
        DocumentsContract.Root.COLUMN_TITLE, DocumentsContract.Root.COLUMN_SUMMARY,
        DocumentsContract.Root.COLUMN_FLAGS, DocumentsContract.Root.COLUMN_MIME_TYPES,
        DocumentsContract.Root.COLUMN_AVAILABLE_BYTES
    };
    private static final String[] DOCUMENT_COLUMNS = {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED, DocumentsContract.Document.COLUMN_FLAGS
    };

    @Override public boolean onCreate() { return true; }

    @Override public Cursor queryRoots(String[] projection) {
        MatrixCursor cursor = new MatrixCursor(projection == null ? ROOT_COLUMNS : projection);
        MatrixCursor.RowBuilder row = cursor.newRow();
        add(row, DocumentsContract.Root.COLUMN_ROOT_ID, ROOT_ID);
        add(row, DocumentsContract.Root.COLUMN_DOCUMENT_ID, DOC_ROOT);
        add(row, DocumentsContract.Root.COLUMN_TITLE, "SRL 酒馆资源库");
        add(row, DocumentsContract.Root.COLUMN_SUMMARY, "APK 本机原件（只读）");
        add(row, DocumentsContract.Root.COLUMN_FLAGS,
            DocumentsContract.Root.FLAG_LOCAL_ONLY |
            DocumentsContract.Root.FLAG_SUPPORTS_IS_CHILD |
            DocumentsContract.Root.FLAG_SUPPORTS_RECENTS |
            DocumentsContract.Root.FLAG_SUPPORTS_SEARCH);
        add(row, DocumentsContract.Root.COLUMN_MIME_TYPES, "*/*");
        add(row, DocumentsContract.Root.COLUMN_AVAILABLE_BYTES, libraryRoot().getUsableSpace());
        return cursor;
    }

    @Override public Cursor queryDocument(String documentId, String[] projection) throws java.io.FileNotFoundException {
        MatrixCursor cursor = new MatrixCursor(projection == null ? DOCUMENT_COLUMNS : projection);
        includeDocument(cursor, documentId);
        return cursor;
    }

    @Override public Cursor queryChildDocuments(String parentDocumentId, String[] projection, String sortOrder) throws java.io.FileNotFoundException {
        MatrixCursor cursor = new MatrixCursor(projection == null ? DOCUMENT_COLUMNS : projection);
        if (DOC_ROOT.equals(parentDocumentId)) {
            includeDocument(cursor, RECENT_ID);
            for (String[] type : TYPE_DIRECTORIES) includeDocument(cursor, TYPE_PREFIX + type[0]);
            includeDocument(cursor, "scope:versions");
            return cursor;
        }
        if (RECENT_ID.equals(parentDocumentId)) {
            includeCurrentEntries(cursor, null, 40, true);
            return cursor;
        }
        if (parentDocumentId.startsWith(TYPE_PREFIX)) {
            includeCurrentEntries(cursor, parentDocumentId.substring(TYPE_PREFIX.length()), 0, false);
            return cursor;
        }
        if (!parentDocumentId.startsWith("scope:")) throw new java.io.FileNotFoundException("目录编号无效");
        String scope = parentDocumentId.substring(6);
        File[] entries = new File(libraryRoot(), scope).listFiles(File::isDirectory);
        if (entries != null) for (File entry : entries) includeDocument(cursor, "file:" + scope + ":" + entry.getName());
        return cursor;
    }

    @Override public Cursor queryRecentDocuments(String rootId, String[] projection) throws java.io.FileNotFoundException {
        MatrixCursor cursor = new MatrixCursor(projection == null ? DOCUMENT_COLUMNS : projection);
        if (ROOT_ID.equals(rootId)) includeCurrentEntries(cursor, null, 40, true);
        return cursor;
    }

    @Override public Cursor querySearchDocuments(String rootId, String query, String[] projection) throws java.io.FileNotFoundException {
        MatrixCursor cursor = new MatrixCursor(projection == null ? DOCUMENT_COLUMNS : projection);
        if (!ROOT_ID.equals(rootId)) return cursor;
        String normalized = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        File[] entries = new File(libraryRoot(), "current").listFiles(File::isDirectory);
        if (entries == null) return cursor;
        int count = 0;
        for (File entry : entries) {
            JSONObject item = readMetadata(entry);
            if (item == null || item.optBoolean("hiddenFromDocuments", false)) continue;
            String name = item.optString("fileName", "").toLowerCase(Locale.ROOT);
            if (!normalized.isEmpty() && !name.contains(normalized)) continue;
            includeDocument(cursor, "file:current:" + entry.getName());
            if (++count >= 80) break;
        }
        return cursor;
    }

    @Override public ParcelFileDescriptor openDocument(String documentId, String mode, CancellationSignal signal) throws java.io.FileNotFoundException {
        if (!"r".equals(mode)) throw new java.io.FileNotFoundException("SRL 系统目录只允许读取");
        JSONObject metadata = metadata(documentId);
        String objectPath = metadata.optString("objectPath", "");
        File payload = objectPath.isBlank()
            ? new File(entryDirectory(documentId), metadata.optString("storedName", "resource.bin"))
            : new File(libraryRoot(), objectPath);
        String rootPath;
        String payloadPath;
        try { rootPath = libraryRoot().getCanonicalPath() + File.separator; payloadPath = payload.getCanonicalPath(); }
        catch (Exception error) { throw new java.io.FileNotFoundException("资源路径不可用"); }
        if (!payloadPath.startsWith(rootPath) || !payload.isFile()) throw new java.io.FileNotFoundException("资源原件不存在");
        return ParcelFileDescriptor.open(payload, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public AssetFileDescriptor openDocumentThumbnail(
        String documentId, Point sizeHint, CancellationSignal signal
    ) throws java.io.FileNotFoundException {
        JSONObject item = metadata(documentId);
        if (!item.optString("mimeType", "").startsWith("image/")) {
            throw new java.io.FileNotFoundException("该资源没有图片缩略图");
        }
        ParcelFileDescriptor descriptor = openDocument(documentId, "r", signal);
        return new AssetFileDescriptor(descriptor, 0, item.optLong("size", AssetFileDescriptor.UNKNOWN_LENGTH));
    }

    @Override public boolean isChildDocument(String parentDocumentId, String documentId) {
        if (DOC_ROOT.equals(parentDocumentId)) {
            return documentId.startsWith("scope:") || documentId.startsWith("virtual:") || documentId.startsWith("file:");
        }
        if (RECENT_ID.equals(parentDocumentId) || parentDocumentId.startsWith(TYPE_PREFIX)) {
            return documentId.startsWith("file:current:");
        }
        return parentDocumentId.startsWith("scope:") && documentId.startsWith("file:" + parentDocumentId.substring(6) + ":");
    }

    private void includeDocument(MatrixCursor cursor, String documentId) throws java.io.FileNotFoundException {
        MatrixCursor.RowBuilder row = cursor.newRow();
        add(row, DocumentsContract.Document.COLUMN_DOCUMENT_ID, documentId);
        if (DOC_ROOT.equals(documentId)) {
            directory(row, "SRL 酒馆资源库"); return;
        }
        if (documentId.startsWith("scope:")) {
            directory(row, documentId.endsWith("current") ? "当前资源" : "历史版本"); return;
        }
        if (RECENT_ID.equals(documentId)) { directory(row, "最近"); return; }
        if (documentId.startsWith(TYPE_PREFIX)) {
            directory(row, typeLabel(documentId.substring(TYPE_PREFIX.length()))); return;
        }
        JSONObject metadata = metadata(documentId);
        add(row, DocumentsContract.Document.COLUMN_DISPLAY_NAME, metadata.optString("fileName", "resource.bin"));
        add(row, DocumentsContract.Document.COLUMN_MIME_TYPE, metadata.optString("mimeType", "application/octet-stream"));
        add(row, DocumentsContract.Document.COLUMN_SIZE, metadata.optLong("size", 0));
        add(row, DocumentsContract.Document.COLUMN_LAST_MODIFIED, metadata.optLong("updatedAt", 0));
        add(row, DocumentsContract.Document.COLUMN_FLAGS,
            metadata.optString("mimeType", "").startsWith("image/")
                ? DocumentsContract.Document.FLAG_SUPPORTS_THUMBNAIL : 0);
    }

    private void directory(MatrixCursor.RowBuilder row, String name) {
        add(row, DocumentsContract.Document.COLUMN_DISPLAY_NAME, name);
        add(row, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.MIME_TYPE_DIR);
        add(row, DocumentsContract.Document.COLUMN_FLAGS, DocumentsContract.Document.FLAG_DIR_PREFERS_GRID);
    }

    private JSONObject metadata(String documentId) throws java.io.FileNotFoundException {
        JSONObject metadata = readMetadata(entryDirectory(documentId));
        if (metadata == null) throw new java.io.FileNotFoundException("资源清单不存在");
        return metadata;
    }

    private JSONObject readMetadata(File entry) {
        File file = new File(entry, "resource.json");
        if (!file.isFile() || file.length() > 64 * 1024) return null;
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) file.length()]; int offset = 0;
            while (offset < bytes.length) { int read = input.read(bytes, offset, bytes.length - offset); if (read < 0) break; offset += read; }
            return new JSONObject(new String(bytes, 0, offset, StandardCharsets.UTF_8));
        } catch (Exception error) { return null; }
    }

    private void includeCurrentEntries(MatrixCursor cursor, String resourceType, int limit, boolean newestFirst)
        throws java.io.FileNotFoundException {
        File[] entries = new File(libraryRoot(), "current").listFiles(File::isDirectory);
        if (entries == null) return;
        List<File> visible = new ArrayList<>();
        for (File entry : entries) {
            JSONObject item = readMetadata(entry);
            if (item == null || item.optBoolean("hiddenFromDocuments", false)) continue;
            String type = item.optString("resourceType", inferResourceType(item));
            if (resourceType == null || resourceType.equals(type)) visible.add(entry);
        }
        if (newestFirst) visible.sort(Comparator.comparingLong((File entry) -> {
            JSONObject item = readMetadata(entry);
            return item == null ? 0 : item.optLong("updatedAt", 0);
        }).reversed());
        int count = 0;
        for (File entry : visible) {
            includeDocument(cursor, "file:current:" + entry.getName());
            if (limit > 0 && ++count >= limit) break;
        }
    }

    private String inferResourceType(JSONObject item) {
        String name = item.optString("fileName", "").toLowerCase(Locale.ROOT);
        String mime = item.optString("mimeType", "");
        if (mime.equals("image/png") || name.endsWith(".png")) return "characterCard";
        return "other";
    }

    private String typeLabel(String type) {
        for (String[] item : TYPE_DIRECTORIES) if (item[0].equals(type)) return item[1];
        return "其他";
    }

    private File entryDirectory(String documentId) throws java.io.FileNotFoundException {
        String[] parts = documentId.split(":", 3);
        if (parts.length != 3 || !"file".equals(parts[0]) || !("current".equals(parts[1]) || "versions".equals(parts[1])) || !parts[2].matches("[A-Za-z0-9._-]{1,160}"))
            throw new java.io.FileNotFoundException("资源编号无效");
        return new File(new File(libraryRoot(), parts[1]), parts[2]);
    }

    private File libraryRoot() {
        File documents = getContext().getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (documents == null) documents = getContext().getFilesDir();
        return new File(documents, "SRL/library");
    }
    private void add(MatrixCursor.RowBuilder row, String column, Object value) { try { row.add(column, value); } catch (IllegalArgumentException ignored) {} }
}
