package buzz.jixiangruyi1207.srl.nativeapp.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.net.Uri
import android.os.Environment
import android.provider.OpenableColumns
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeCategory
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeSnapshot
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResourceBundle
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.ZipInputStream

abstract class NativeResourcePersistence(protected val context: Context) : SQLiteOpenHelper(
    context,
    "srl-native.db",
    null,
    2,
) {
    companion object {
        protected const val MAX_FILE_BYTES = 512L * 1024L * 1024L
        protected const val MAX_MANIFEST_BYTES = 16L * 1024L * 1024L
        protected const val ARCHIVE_FORMAT = "srl-archive"
        protected const val ARCHIVE_VERSION = 4
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE resource_items (
                id TEXT PRIMARY KEY NOT NULL,
                is_version INTEGER NOT NULL DEFAULT 0,
                manifest_json TEXT NOT NULL,
                local_path TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )""".trimIndent(),
        )
        db.execSQL("CREATE INDEX resource_items_hash ON resource_items(content_hash)")
        db.execSQL("CREATE INDEX resource_items_version ON resource_items(is_version)")
        db.execSQL("CREATE TABLE app_state (state_key TEXT PRIMARY KEY NOT NULL, state_value TEXT NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    protected fun readManifest(file: File): JSONObject {
        ZipInputStream(BufferedInputStream(FileInputStream(file), 128 * 1024)).use { archive ->
            while (true) {
                val entry = archive.nextEntry ?: break
                if (entry.name == "manifest.json" && !entry.isDirectory) {
                    val bytes = readLimited(archive, MAX_MANIFEST_BYTES)
                    return JSONObject(bytes.toString(Charsets.UTF_8))
                }
                archive.closeEntry()
            }
        }
        throw IllegalArgumentException("备份包缺少 manifest.json")
    }

    protected fun mergeCategories(imported: JSONArray, database: SQLiteDatabase): Map<String, String> {
        val current = readState(database, "categories")?.let(::JSONArray) ?: JSONArray()
        val categories = (0 until current.length()).mapNotNull(current::optJSONObject).toMutableList()
        val byId = categories.associateBy { it.optString("id") }.toMutableMap()
        val byName = categories.associateBy { it.optString("name").trim().lowercase() }.toMutableMap()
        val idMap = mutableMapOf<String, String>()
        for (index in 0 until imported.length()) {
            val source = imported.optJSONObject(index) ?: throw IllegalArgumentException("备份分类清单无效")
            val sourceId = source.optString("id").trim()
            val sourceName = source.optString("name").trim()
            if (sourceId.isBlank() || sourceName.isBlank()) throw IllegalArgumentException("备份分类清单无效")
            val sameId = byId[sourceId]
            val sameName = byName[sourceName.lowercase()]
            val target = when {
                sameId != null && sameId.optString("name") == sourceName && sameId.optString("color") == source.optString("color") -> sameId
                sameName != null -> sameName
                else -> JSONObject(source.toString()).also { copy ->
                    if (sameId != null) copy.put("id", UUID.randomUUID().toString())
                    categories += copy
                    byId[copy.optString("id")] = copy
                    byName[sourceName.lowercase()] = copy
                }
            }
            idMap[sourceId] = target.optString("id")
        }
        writeState(database, "categories", JSONArray(categories).toString())
        return idMap
    }

    protected fun writeCategories(categories: List<NativeCategory>) {
        writeState(writableDatabase, "categories", categoriesJson(categories).toString())
    }

    protected fun categoriesJson(categories: List<NativeCategory>): JSONArray = JSONArray(categories.map { category ->
            JSONObject()
                .put("id", category.id).put("name", category.name).put("color", category.color)
                .put("sortOrder", category.sortOrder).put("hidden", category.hidden)
                .put("createdAt", category.createdAt).put("updatedAt", category.updatedAt)
        })

    protected fun writeSnapshots(snapshots: List<NativeSnapshot>) {
        val values = JSONArray(snapshots.map { snapshot ->
            JSONObject().put("id", snapshot.id).put("reason", snapshot.reason)
                .put("resourceCount", snapshot.resourceCount).put("categoryCount", snapshot.categoryCount)
                .put("size", snapshot.size).put("createdAt", snapshot.createdAt).put("filePath", snapshot.filePath)
        })
        writeState(writableDatabase, "historySnapshots", values.toString())
    }

    protected fun normalizeCategoryName(value: String): String {
        val normalized = value.trim()
        require(normalized.isNotBlank()) { "文件夹名称不能为空" }
        require(normalized.length <= 40) { "文件夹名称不能超过 40 个字符" }
        return normalized
    }

    protected fun jsonStrings(array: JSONArray?): List<String> = if (array == null) emptyList() else
        (0 until array.length()).mapNotNull { array.optString(it).trim().takeIf(String::isNotBlank) }

    protected fun normalizeCategoryColor(value: String): String {
        require(Regex("^#[0-9a-fA-F]{6}$").matches(value)) { "文件夹颜色格式无效" }
        return value.lowercase()
    }

    protected fun remapStringArray(target: JSONObject, key: String, idMap: Map<String, String>) {
        val original = target.optJSONArray(key) ?: return
        val mapped = JSONArray()
        for (index in 0 until original.length()) {
            val value = original.optString(index)
            if (value.isNotBlank()) mapped.put(idMap[value] ?: value)
        }
        target.put(key, mapped)
    }

    protected fun loadRows(isVersion: Boolean): List<StoredRow> {
        val result = mutableListOf<StoredRow>()
        readableDatabase.query(
            "resource_items",
            arrayOf("id", "is_version", "manifest_json", "local_path", "content_hash", "created_at", "updated_at"),
            "is_version = ?",
            arrayOf(if (isVersion) "1" else "0"),
            null,
            null,
            "updated_at DESC",
        ).use { cursor ->
            while (cursor.moveToNext()) {
                result += StoredRow(
                    cursor.getString(0), cursor.getInt(1) == 1, cursor.getString(2), cursor.getString(3),
                    cursor.getString(4), cursor.getLong(5), cursor.getLong(6),
                )
            }
        }
        return result
    }

    protected fun toResource(row: StoredRow): NativeResource {
        val value = JSONObject(row.manifestJson)
        val tags = value.optJSONArray("tags") ?: JSONArray()
        val categoryIds = value.optJSONArray("categoryIds") ?: JSONArray()
        val relatedIds = value.optJSONArray("relatedResourceIds") ?: JSONArray()
        return NativeResource(
            id = row.id,
            type = value.optString("type", "other"),
            name = value.optString("name", "未命名资源"),
            description = value.optString("description"),
            fileName = value.optString("fileName", "resource.bin"),
            mimeType = value.optString("mimeType", "application/octet-stream"),
            fileSize = value.optLong("fileSize", File(row.localPath).length()),
            contentHash = row.contentHash,
            favorite = value.optBoolean("favorite", false),
            tags = (0 until tags.length()).mapNotNull { tags.optString(it).takeIf(String::isNotBlank) },
            categoryIds = (0 until categoryIds.length()).mapNotNull { categoryIds.optString(it).takeIf(String::isNotBlank) },
            versionGroupId = value.optString("versionGroupId").takeIf(String::isNotBlank),
            versionLabel = value.optString("versionLabel").ifBlank { value.optString("fileName", "未命名版本").substringBeforeLast('.') },
            versionNote = value.optString("versionNote"),
            versionImportedAt = value.optLong("versionImportedAt", row.createdAt),
            metadataJson = value.optJSONObject("metadata")?.toString() ?: "{}",
            localPath = row.localPath,
            createdAt = row.createdAt,
            updatedAt = row.updatedAt,
            relatedResourceIds = (0 until relatedIds.length()).mapNotNull { relatedIds.optString(it).takeIf(String::isNotBlank) },
        )
    }

    protected fun writeResourceBundles(bundles: List<NativeResourceBundle>) {
        val portable = readState("portableData")?.let(::JSONObject) ?: JSONObject().put("version", 1)
        portable.put("resourceBundles", JSONArray(bundles.map { bundle ->
            JSONObject().put("id", bundle.id).put("name", bundle.name).put("primaryResourceId", bundle.primaryResourceId)
                .put("resourceIds", JSONArray(bundle.resourceIds)).put("createdAt", bundle.createdAt).put("updatedAt", bundle.updatedAt)
        }))
        writeState(writableDatabase, "portableData", portable.toString())
        writePortableIndex()
    }

    protected fun readRow(id: String): StoredRow? {
        readableDatabase.query("resource_items", null, "id = ?", arrayOf(id), null, null, null).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return StoredRow(
                cursor.getString(cursor.getColumnIndexOrThrow("id")),
                cursor.getInt(cursor.getColumnIndexOrThrow("is_version")) == 1,
                cursor.getString(cursor.getColumnIndexOrThrow("manifest_json")),
                cursor.getString(cursor.getColumnIndexOrThrow("local_path")),
                cursor.getString(cursor.getColumnIndexOrThrow("content_hash")),
                cursor.getLong(cursor.getColumnIndexOrThrow("created_at")),
                cursor.getLong(cursor.getColumnIndexOrThrow("updated_at")),
            )
        }
    }

    protected fun insertRow(id: String, isVersion: Boolean, manifest: JSONObject, file: File, hash: String, createdAt: Long, updatedAt: Long) {
        insertRow(writableDatabase, id, isVersion, manifest, file, hash, createdAt, updatedAt)
    }

    protected fun insertRow(db: SQLiteDatabase, id: String, isVersion: Boolean, manifest: JSONObject, file: File, hash: String, createdAt: Long, updatedAt: Long) {
        val values = ContentValues().apply {
            put("id", id)
            put("is_version", if (isVersion) 1 else 0)
            put("manifest_json", manifest.toString())
            put("local_path", file.absolutePath)
            put("content_hash", hash)
            put("created_at", createdAt)
            put("updated_at", updatedAt)
        }
        if (db.insertOrThrow("resource_items", null, values) < 0) throw IllegalStateException("资源保存失败")
    }

    protected fun hashIdMap(): MutableMap<String, String> {
        val result = mutableMapOf<String, String>()
        readableDatabase.query("resource_items", arrayOf("content_hash", "id"), null, null, null, null, null).use { cursor ->
            while (cursor.moveToNext()) result.putIfAbsent(cursor.getString(0), cursor.getString(1))
        }
        return result
    }

    protected fun allIds(): Set<String> {
        val result = mutableSetOf<String>()
        readableDatabase.query("resource_items", arrayOf("id"), null, null, null, null, null).use { cursor ->
            while (cursor.moveToNext()) result += cursor.getString(0)
        }
        return result
    }

    protected fun findIdByHash(hash: String): String? {
        readableDatabase.query("resource_items", arrayOf("id"), "content_hash = ?", arrayOf(hash), null, null, null, "1").use { cursor ->
            return if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }

    protected fun readState(key: String): String? = readState(readableDatabase, key)

    protected fun readState(db: SQLiteDatabase, key: String): String? {
        db.query("app_state", arrayOf("state_value"), "state_key = ?", arrayOf(key), null, null, null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }

    protected fun writeState(db: SQLiteDatabase, key: String, value: String) {
        val values = ContentValues().apply { put("state_key", key); put("state_value", value) }
        db.insertWithOnConflict("app_state", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    protected fun destinationFile(id: String, fileName: String): File {
        val folder = File(resourceRoot(), "resources/$id")
        if (!folder.exists() && !folder.mkdirs()) throw IllegalStateException("无法创建资源目录")
        return File(folder, safeFileName(fileName))
    }

    protected fun resourceRoot(): File {
        val documentsDirectory = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
            ?: context.filesDir
        val folder = File(documentsDirectory, "SRL")
        if (!folder.exists() && !folder.mkdirs()) throw IllegalStateException("无法创建 SRL 本地目录")
        return folder
    }

    /**
     * SQLite 只承担查询索引；此文件与 resources/ 一同构成可带走的本机数据快照。
     * 先写入临时文件再原子替换，避免中途退出留下半截清单。
     */
    protected fun writePortableIndex() {
        val rows = loadRows(false) + loadRows(true)
        val items = JSONArray()
        rows.forEach { row ->
            val item = JSONObject(row.manifestJson)
                .put("isVersion", row.isVersion)
                .put("contentHash", row.contentHash)
                .put("localPath", File(row.localPath).relativeTo(resourceRoot()).invariantSeparatorsPath)
            items.put(item)
        }
        val index = JSONObject()
            .put("format", "srl-native-local")
            .put("version", 1)
            .put("updatedAt", System.currentTimeMillis())
            .put("resources", items)
            .put("categories", readState("categories")?.let(::JSONArray) ?: JSONArray())
        readState("portableData")?.let { index.put("portableData", JSONObject(it)) }

        val target = File(resourceRoot(), "library-index.json")
        val temporary = File(resourceRoot(), "library-index.json.tmp")
        try {
            FileOutputStream(temporary).use { it.write(index.toString(2).toByteArray(Charsets.UTF_8)) }
            if (target.exists() && !target.delete()) throw IllegalStateException("无法替换本地资源清单")
            if (!temporary.renameTo(target)) {
                temporary.inputStream().use { input -> target.outputStream().use { output -> input.copyTo(output) } }
                temporary.delete()
            }
        } catch (error: Exception) {
            temporary.delete()
            throw error
        }
    }

    protected fun moveFile(source: File, destination: File) {
        if (!source.renameTo(destination)) {
            source.inputStream().use { input -> destination.outputStream().use { output -> input.copyTo(output, 128 * 1024) } }
            if (!source.delete()) source.deleteOnExit()
        }
    }

    protected fun copyFile(source: File, destination: File) {
        source.inputStream().buffered(128 * 1024).use { input ->
            destination.outputStream().buffered(128 * 1024).use { output -> input.copyTo(output, 128 * 1024) }
        }
    }

    protected fun copyUriToCache(uri: Uri): File {
        val target = File(context.cacheDir, "native-intake-${UUID.randomUUID()}.tmp")
        try {
            val input = context.contentResolver.openInputStream(uri) ?: throw IllegalArgumentException("无法打开所选文件")
            copyLimited(input, FileOutputStream(target), MAX_FILE_BYTES)
            return target
        } catch (error: Exception) {
            target.delete()
            throw error
        }
    }

    protected fun copyLimited(input: InputStream, output: OutputStream, maxBytes: Long, closeInput: Boolean = true) {
        val copy: () -> Unit = {
            output.use { destination ->
                val buffer = ByteArray(128 * 1024)
                var total = 0L
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > maxBytes) throw IllegalArgumentException("单个文件超过 ${maxBytes / 1024 / 1024} MB 限制")
                    destination.write(buffer, 0, count)
                }
            }
        }
        if (closeInput) input.use { copy() } else copy()
    }

    protected fun readLimited(input: InputStream, maxBytes: Long): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(32 * 1024)
        var total = 0L
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > maxBytes) throw IllegalArgumentException("备份清单超过 ${maxBytes / 1024 / 1024} MB 限制")
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    protected fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).buffered(128 * 1024).use { input ->
            val buffer = ByteArray(128 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
    }

    protected fun isZip(file: File): Boolean {
        if (file.length() < 4) return false
        FileInputStream(file).use { input ->
            val signature = ByteArray(4)
            if (input.read(signature) != 4) return false
            return signature[0] == 0x50.toByte() && signature[1] == 0x4b.toByte() &&
                signature[2] in byteArrayOf(0x03, 0x05, 0x07) && signature[3] in byteArrayOf(0x04, 0x06, 0x08)
        }
    }

    protected fun displayName(uri: Uri): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val name = cursor.getString(0)
                if (!name.isNullOrBlank()) return name
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "resource.bin"
    }

    protected fun safeFileName(name: String): String {
        val safe = name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().trim('.')
        return safe.ifBlank { "resource.bin" }
    }

    protected data class StoredRow(
        val id: String,
        val isVersion: Boolean,
        val manifestJson: String,
        val localPath: String,
        val contentHash: String,
        val createdAt: Long,
        val updatedAt: Long,
    )

    protected data class ArchiveItem(
        val manifest: JSONObject,
        val archivePath: String,
        val isVersion: Boolean,
        val contentHash: String,
    )
}
