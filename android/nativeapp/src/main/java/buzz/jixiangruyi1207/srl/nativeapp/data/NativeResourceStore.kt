package buzz.jixiangruyi1207.srl.nativeapp.data

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import buzz.jixiangruyi1207.srl.nativeapp.model.ExportReport
import buzz.jixiangruyi1207.srl.nativeapp.model.ImportReport
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeCategory
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeSnapshot
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeCloudSource
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeBackupSelection
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResourceBundle
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeTagMutation
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeTagMutationResult
import buzz.jixiangruyi1207.srl.nativeapp.parser.NativeResourceParser
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

data class NativePreparedCloudResource(
    val manifest: JSONObject,
    val file: File,
    val isVersion: Boolean,
)

class NativeResourceStore(context: Context) : NativeResourcePersistence(context) {
    @Synchronized
    fun loadResources(): List<NativeResource> = loadRows(false).map(::toResource)

    /** 直接读取与网页 SRL ZIP 相同的分类字段，保留手动排序和隐藏状态。 */
    @Synchronized
    fun loadCategories(): List<NativeCategory> {
        val stored = readState("categories")?.let(::JSONArray) ?: JSONArray()
        return (0 until stored.length()).mapNotNull { index ->
            stored.optJSONObject(index)?.let { value ->
                val id = value.optString("id").trim()
                val name = value.optString("name").trim()
                if (id.isBlank() || name.isBlank()) null else NativeCategory(
                    id = id,
                    name = name,
                    color = value.optString("color", "#1F777D"),
                    sortOrder = value.optInt("sortOrder", index),
                    hidden = value.optBoolean("hidden", false),
                    createdAt = value.optLong("createdAt", 0L),
                    updatedAt = value.optLong("updatedAt", value.optLong("createdAt", 0L)),
                )
            }
        }.sortedWith(compareBy<NativeCategory> { it.sortOrder }.thenBy { it.name })
    }

    @Synchronized
    fun loadVersions(resourceId: String): List<NativeResource> = loadRows(true)
        .filter { JSONObject(it.manifestJson).optString("versionGroupId") == resourceId }
        .map(::toResource)

    @Synchronized
    fun loadAllVersions(): List<NativeResource> = loadRows(true).map(::toResource)

    @Synchronized
    fun loadCloudSources(): List<NativeCloudSource> = (loadRows(false) + loadRows(true)).map { row ->
        NativeCloudSource(row.manifestJson, row.localPath, row.isVersion, row.contentHash, File(row.localPath).length())
    }

    @Synchronized
    fun cloudCategoriesJson(): String = (readState("categories")?.let(::JSONArray) ?: JSONArray()).toString()

    @Synchronized
    fun portableDataJson(): String = (readState("portableData")?.let(::JSONObject) ?: JSONObject().put("version", 1)).toString()

    @Synchronized
    fun readPortableSection(key: String): JSONObject? =
        (readState("portableData")?.let(::JSONObject) ?: JSONObject().put("version", 1)).optJSONObject(key)

    @Synchronized
    fun writePortableSection(key: String, value: JSONObject?) {
        require(key.isNotBlank() && key != "version") { "便携设置键无效" }
        val portable = readState("portableData")?.let(::JSONObject) ?: JSONObject().put("version", 1)
        if (value == null) portable.remove(key) else portable.put(key, value)
        writableDatabase.beginTransaction()
        try {
            writeState(writableDatabase, "portableData", portable.toString())
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
        writePortableIndex()
    }

    @Synchronized
    fun loadResourceBundles(): List<NativeResourceBundle> {
        val portable = readState("portableData")?.let(::JSONObject) ?: JSONObject()
        val stored = portable.optJSONArray("resourceBundles") ?: JSONArray()
        val ids = mutableSetOf<String>()
        return (0 until stored.length()).mapNotNull { index ->
            val value = stored.optJSONObject(index) ?: return@mapNotNull null
            val id = value.optString("id").trim().take(120)
            val name = value.optString("name").trim().take(80)
            val primaryId = value.optString("primaryResourceId").trim().take(160)
            val resourceIds = value.optJSONArray("resourceIds")?.let { array ->
                (0 until array.length()).mapNotNull { array.optString(it).trim().take(160).takeIf(String::isNotBlank) }
                    .filter { it != primaryId }.distinct().take(100)
            }.orEmpty()
            if (id.isBlank() || name.isBlank() || primaryId.isBlank() || resourceIds.isEmpty() || !ids.add(id)) null
            else NativeResourceBundle(id, name, primaryId, resourceIds, value.optLong("createdAt", System.currentTimeMillis()), value.optLong("updatedAt", System.currentTimeMillis()))
        }.take(50)
    }

    @Synchronized
    fun saveResourceBundle(bundle: NativeResourceBundle): NativeResourceBundle {
        val name = bundle.name.trim().take(80)
        val primaryId = bundle.primaryResourceId.trim().take(160)
        val relatedIds = bundle.resourceIds.map(String::trim).filter(String::isNotBlank).filter { it != primaryId }.distinct().take(100)
        require(name.isNotBlank() && primaryId.isNotBlank() && relatedIds.isNotEmpty()) { "套装必须包含名称、主资源和至少一项配套资源" }
        val existingResources = loadResources().mapTo(mutableSetOf()) { it.id }
        require(primaryId in existingResources && relatedIds.all { it in existingResources }) { "套装中有资源已经不存在" }
        val now = System.currentTimeMillis()
        val existing = loadResourceBundles().firstOrNull { it.id == bundle.id }
        val normalized = NativeResourceBundle(
            id = bundle.id.trim().take(120).ifBlank { UUID.randomUUID().toString() },
            name = name,
            primaryResourceId = primaryId,
            resourceIds = relatedIds,
            createdAt = existing?.createdAt ?: bundle.createdAt.takeIf { it > 0 } ?: now,
            updatedAt = now,
        )
        val retained = listOf(normalized) + loadResourceBundles().filterNot { it.id == normalized.id }
        writeResourceBundles(retained.take(50))
        linkResources(listOf(primaryId) + relatedIds)
        return normalized
    }

    @Synchronized
    fun deleteResourceBundle(bundleId: String) {
        writeResourceBundles(loadResourceBundles().filterNot { it.id == bundleId })
    }

    @Synchronized
    fun linkResources(resourceIds: List<String>) {
        val ids = resourceIds.map(String::trim).filter(String::isNotBlank).distinct()
        require(ids.size >= 2) { "至少选择两项资源才能建立关联" }
        val rows = ids.associateWith { readRow(it) ?: throw IllegalArgumentException("资源已经不存在") }
        val database = writableDatabase
        database.beginTransaction()
        try {
            rows.forEach { (id, row) ->
                val manifest = JSONObject(row.manifestJson)
                val existing = manifest.optJSONArray("relatedResourceIds")?.let { array ->
                    (0 until array.length()).mapNotNull { array.optString(it).takeIf(String::isNotBlank) }
                }.orEmpty()
                val next = (existing + ids.filter { it != id }).distinct()
                manifest.put("relatedResourceIds", JSONArray(next)).put("updatedAt", System.currentTimeMillis())
                val values = ContentValues().apply { put("manifest_json", manifest.toString()); put("updated_at", manifest.optLong("updatedAt")) }
                require(database.update("resource_items", values, "id = ? AND is_version = 0", arrayOf(id)) == 1) { "资源关联保存失败" }
            }
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
        writePortableIndex()
    }

    @Synchronized
    fun annotateResource(resourceId: String, metadata: JSONObject, relatedIds: List<String>) {
        val row = readRow(resourceId) ?: throw IllegalArgumentException("资源不存在")
        require(!row.isVersion) { "历史版本不能直接标注" }
        val manifest = JSONObject(row.manifestJson)
        val currentMetadata = manifest.optJSONObject("metadata") ?: JSONObject()
        metadata.keys().forEach { key -> currentMetadata.put(key, metadata.get(key)) }
        val normalizedRelated = relatedIds.map(String::trim).filter(String::isNotBlank).filter { it != resourceId }.distinct()
        val now = System.currentTimeMillis()
        manifest.put("metadata", currentMetadata).put("relatedResourceIds", JSONArray(normalizedRelated)).put("updatedAt", now)
        val values = ContentValues().apply { put("manifest_json", manifest.toString()); put("updated_at", now) }
        require(writableDatabase.update("resource_items", values, "id = ? AND is_version = 0", arrayOf(resourceId)) == 1) { "资源标注保存失败" }
        writePortableIndex()
    }

    @Synchronized
    fun createCategory(name: String, color: String): NativeCategory {
        val normalizedName = normalizeCategoryName(name)
        val normalizedColor = normalizeCategoryColor(color)
        val categories = loadCategories().toMutableList()
        require(categories.none { it.name.equals(normalizedName, ignoreCase = true) }) { "已存在同名文件夹" }
        val now = System.currentTimeMillis()
        val category = NativeCategory(UUID.randomUUID().toString(), normalizedName, normalizedColor, categories.size, false, now, now)
        categories += category
        writeCategories(categories)
        writePortableIndex()
        return category
    }

    @Synchronized
    fun updateCategory(categoryId: String, name: String, color: String, hidden: Boolean) {
        val normalizedName = normalizeCategoryName(name)
        val normalizedColor = normalizeCategoryColor(color)
        val categories = loadCategories().toMutableList()
        require(categories.none { it.id != categoryId && it.name.equals(normalizedName, ignoreCase = true) }) { "已存在同名文件夹" }
        val index = categories.indexOfFirst { it.id == categoryId }
        require(index >= 0) { "文件夹不存在" }
        categories[index] = categories[index].copy(name = normalizedName, color = normalizedColor, hidden = hidden, updatedAt = System.currentTimeMillis())
        writeCategories(categories)
        writePortableIndex()
    }

    @Synchronized
    fun deleteCategory(categoryId: String) {
        val categories = loadCategories()
        val target = categories.find { it.id == categoryId } ?: throw IllegalArgumentException("文件夹不存在")
        captureSnapshot("删除文件夹“${target.name}”前自动快照")
        val database = writableDatabase
        database.beginTransaction()
        try {
            writeState(database, "categories", categoriesJson(categories.filterNot { it.id == categoryId }).toString())
            for (row in loadRows(false) + loadRows(true)) {
                val manifest = JSONObject(row.manifestJson)
                val ids = manifest.optJSONArray("categoryIds") ?: JSONArray()
                val retained = (0 until ids.length()).mapNotNull { ids.optString(it).takeIf { id -> id.isNotBlank() && id != categoryId } }
                manifest.put("categoryIds", JSONArray(retained))
                    .put("categoryId", retained.firstOrNull() ?: JSONObject.NULL)
                    .put("updatedAt", System.currentTimeMillis())
                val values = ContentValues().apply { put("manifest_json", manifest.toString()); put("updated_at", manifest.optLong("updatedAt")) }
                database.update("resource_items", values, "id = ?", arrayOf(row.id))
            }
            database.setTransactionSuccessful()
        } finally { database.endTransaction() }
        writePortableIndex()
    }

    @Synchronized
    fun deleteResource(resourceId: String) {
        val current = readRow(resourceId)?.takeIf { !it.isVersion } ?: throw IllegalArgumentException("资源已经不存在")
        captureSnapshot("删除资源“${JSONObject(current.manifestJson).optString("name", "未命名资源")}”前自动快照")
        val ownedVersions = loadRows(true).filter { JSONObject(it.manifestJson).optString("versionGroupId") == resourceId }
        val database = writableDatabase
        database.beginTransaction()
        try {
            database.delete("resource_items", "id = ?", arrayOf(resourceId))
            ownedVersions.forEach { database.delete("resource_items", "id = ? AND is_version = 1", arrayOf(it.id)) }
            for (row in loadRows(false) + loadRows(true)) {
                val manifest = JSONObject(row.manifestJson)
                val related = manifest.optJSONArray("relatedResourceIds") ?: continue
                val retained = (0 until related.length()).mapNotNull { related.optString(it).takeIf { id -> id.isNotBlank() && id != resourceId } }
                if (retained.size != related.length()) {
                    manifest.put("relatedResourceIds", JSONArray(retained)).put("updatedAt", System.currentTimeMillis())
                    val values = ContentValues().apply { put("manifest_json", manifest.toString()); put("updated_at", manifest.optLong("updatedAt")) }
                    database.update("resource_items", values, "id = ?", arrayOf(row.id))
                }
            }
            database.setTransactionSuccessful()
        } finally { database.endTransaction() }
        (listOf(current) + ownedVersions).forEach { File(it.localPath).parentFile?.deleteRecursively() }
        writePortableIndex()
    }

    @Synchronized
    fun setResourceCategories(resourceId: String, categoryIds: List<String>) {
        val validIds = loadCategories().mapTo(mutableSetOf()) { it.id }
        val normalized = categoryIds.distinct().filter(validIds::contains)
        val row = readRow(resourceId) ?: throw IllegalArgumentException("资源不存在")
        require(!row.isVersion) { "历史版本不能单独移动文件夹" }
        val manifest = JSONObject(row.manifestJson)
            .put("categoryIds", JSONArray(normalized))
            .put("categoryId", normalized.firstOrNull() ?: JSONObject.NULL)
            .put("updatedAt", System.currentTimeMillis())
        val values = ContentValues().apply {
            put("manifest_json", manifest.toString())
            put("updated_at", manifest.optLong("updatedAt"))
        }
        writableDatabase.update("resource_items", values, "id = ?", arrayOf(resourceId))
        writePortableIndex()
    }

    @Synchronized
    fun activateVersion(resourceId: String, versionId: String) {
        val current = readRow(resourceId) ?: throw IllegalArgumentException("当前资源已经不存在")
        val selected = readRow(versionId)?.takeIf { it.isVersion && JSONObject(it.manifestJson).optString("versionGroupId") == resourceId }
            ?: throw IllegalArgumentException("历史版本已经不存在")
        val currentManifest = JSONObject(current.manifestJson)
        val selectedManifest = JSONObject(selected.manifestJson)
        val archivedId = UUID.randomUUID().toString()
        val archivedManifest = JSONObject(currentManifest.toString())
            .put("id", archivedId)
            .put("versionGroupId", resourceId)
            .put("versionImportedAt", currentManifest.optLong("versionImportedAt", current.createdAt))
            .put("versionLabel", currentManifest.optString("versionLabel").ifBlank { currentManifest.optString("fileName").substringBeforeLast('.') })
        val archivedFile = destinationFile(archivedId, currentManifest.optString("fileName", "resource.bin"))
        val activatedFile = destinationFile(resourceId, "activated-${UUID.randomUUID()}-${selectedManifest.optString("fileName", "resource.bin")}")
        copyFile(File(current.localPath), archivedFile)
        copyFile(File(selected.localPath), activatedFile)
        val activeManifest = JSONObject(currentManifest.toString())
        listOf("type", "name", "description", "fileName", "mimeType", "fileSize", "contentHash", "metadata", "versionImportedAt", "versionLabel", "versionNote").forEach { key ->
            if (selectedManifest.has(key)) activeManifest.put(key, selectedManifest.get(key)) else activeManifest.remove(key)
        }
        activeManifest.put("id", resourceId).remove("versionGroupId")
        val now = System.currentTimeMillis()
        activeManifest.put("updatedAt", now)
        val database = writableDatabase
        database.beginTransaction()
        try {
            insertRow(database, archivedId, true, archivedManifest, archivedFile, current.contentHash, current.createdAt, now)
            val values = ContentValues().apply {
                put("manifest_json", activeManifest.toString()); put("local_path", activatedFile.absolutePath)
                put("content_hash", selected.contentHash); put("updated_at", now)
            }
            database.update("resource_items", values, "id = ?", arrayOf(resourceId))
            database.delete("resource_items", "id = ? AND is_version = 1", arrayOf(versionId))
            database.setTransactionSuccessful()
        } catch (error: Exception) {
            archivedFile.parentFile?.deleteRecursively()
            activatedFile.delete()
            throw error
        } finally {
            database.endTransaction()
        }
        File(current.localPath).takeIf { it.absolutePath != activatedFile.absolutePath }?.delete()
        File(selected.localPath).parentFile?.deleteRecursively()
        writePortableIndex()
    }

    @Synchronized
    fun updateVersionNote(resourceId: String, versionId: String, note: String) {
        val row = readRow(versionId) ?: throw IllegalArgumentException("版本已经不存在")
        require(versionId == resourceId || row.isVersion && JSONObject(row.manifestJson).optString("versionGroupId") == resourceId) { "版本不属于当前资源" }
        val manifest = JSONObject(row.manifestJson).put("versionNote", note.trim().take(240)).put("updatedAt", System.currentTimeMillis())
        val values = ContentValues().apply { put("manifest_json", manifest.toString()); put("updated_at", manifest.optLong("updatedAt")) }
        writableDatabase.update("resource_items", values, "id = ?", arrayOf(versionId))
        writePortableIndex()
    }

    @Synchronized
    fun deleteVersion(resourceId: String, versionId: String) {
        val row = readRow(versionId)?.takeIf { it.isVersion && JSONObject(it.manifestJson).optString("versionGroupId") == resourceId }
            ?: throw IllegalArgumentException("历史版本已经不存在")
        if (writableDatabase.delete("resource_items", "id = ? AND is_version = 1", arrayOf(versionId)) != 1) throw IllegalStateException("历史版本删除失败")
        File(row.localPath).parentFile?.deleteRecursively()
        writePortableIndex()
    }

    /**
     * 原始资源与可恢复索引的实际保存目录。
     *
     * 使用应用专属的外部 Documents/SRL，避免申请“管理所有文件”权限；Android 11+
     * 的文件管理器可能限制直接浏览 Android/data，但可通过 USB 或应用导出取得文件。
     */
    fun storageDirectory(): File = resourceRoot()

    @Synchronized
    fun toggleFavorite(resourceId: String): Boolean {
        val row = readRow(resourceId) ?: return false
        val manifest = JSONObject(row.manifestJson)
        val next = !manifest.optBoolean("favorite", false)
        manifest.put("favorite", next)
        manifest.put("updatedAt", System.currentTimeMillis())
        val values = ContentValues().apply {
            put("manifest_json", manifest.toString())
            put("updated_at", manifest.optLong("updatedAt"))
        }
        writableDatabase.update("resource_items", values, "id = ?", arrayOf(resourceId))
        runCatching(::writePortableIndex)
        return next
    }

    @Synchronized
    fun updateResourceDetails(resourceId: String, name: String, description: String, tags: List<String>) {
        val row = readRow(resourceId) ?: throw IllegalArgumentException("资源不存在")
        require(!row.isVersion) { "历史版本不能直接编辑" }
        val normalizedName = name.trim()
        require(normalizedName.isNotBlank()) { "资源名称不能为空" }
        val normalizedTags = tags.map(String::trim).filter(String::isNotBlank).distinct().take(100)
        val now = System.currentTimeMillis()
        val manifest = JSONObject(row.manifestJson).put("name", normalizedName).put("description", description.trim().take(20_000))
            .put("tags", JSONArray(normalizedTags)).put("updatedAt", now)
        val values = ContentValues().apply { put("manifest_json", manifest.toString()); put("updated_at", now) }
        require(writableDatabase.update("resource_items", values, "id = ? AND is_version = 0", arrayOf(resourceId)) == 1) { "资源详情保存失败" }
        writePortableIndex()
    }

    @Synchronized
    fun addTagsPerResource(entries: Map<String, List<String>>): List<NativeTagMutation> {
        val database = writableDatabase
        val additions = mutableListOf<NativeTagMutation>()
        database.beginTransaction()
        try {
            entries.forEach { (resourceId, requested) ->
                val row = readRow(resourceId) ?: return@forEach
                if (row.isVersion) return@forEach
                val manifest = JSONObject(row.manifestJson)
                val existing = jsonStrings(manifest.optJSONArray("tags")).toMutableList()
                val existingKeys = existing.mapTo(mutableSetOf()) { it.lowercase() }
                val added = requested.map(String::trim).filter(String::isNotBlank).map { it.take(40) }
                    .filter { existingKeys.add(it.lowercase()) }.distinct().take(12)
                if (added.isEmpty()) return@forEach
                val now = System.currentTimeMillis()
                manifest.put("tags", JSONArray((existing + added).take(100))).put("updatedAt", now)
                val values = ContentValues().apply { put("manifest_json", manifest.toString()); put("updated_at", now) }
                require(database.update("resource_items", values, "id = ? AND is_version = 0", arrayOf(resourceId)) == 1) { "资源标签保存失败" }
                additions += NativeTagMutation(resourceId, manifest.optString("name", resourceId), added)
            }
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
        writePortableIndex()
        return additions
    }

    @Synchronized
    fun undoAddedTags(entries: List<NativeTagMutation>): NativeTagMutationResult {
        val database = writableDatabase
        var resourceCount = 0
        var tagCount = 0
        database.beginTransaction()
        try {
            entries.forEach { entry ->
                val row = readRow(entry.resourceId) ?: return@forEach
                if (row.isVersion) return@forEach
                val manifest = JSONObject(row.manifestJson)
                val removable = entry.tags.toSet()
                val existing = jsonStrings(manifest.optJSONArray("tags"))
                val retained = existing.filterNot(removable::contains)
                val removed = existing.size - retained.size
                if (removed == 0) return@forEach
                val now = System.currentTimeMillis()
                manifest.put("tags", JSONArray(retained)).put("updatedAt", now)
                val values = ContentValues().apply { put("manifest_json", manifest.toString()); put("updated_at", now) }
                require(database.update("resource_items", values, "id = ? AND is_version = 0", arrayOf(entry.resourceId)) == 1) { "资源标签撤销失败" }
                resourceCount += 1
                tagCount += removed
            }
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
        writePortableIndex()
        return NativeTagMutationResult(resourceCount, tagCount)
    }

    @Synchronized
    fun readResourceText(resourceId: String, maxBytes: Long = 32L * 1024L * 1024L): String {
        val row = readRow(resourceId) ?: throw IllegalArgumentException("资源不存在")
        require(!row.isVersion) { "历史版本不能直接编辑" }
        val file = File(row.localPath)
        require(file.isFile) { "资源原文件不存在" }
        require(file.length() <= maxBytes) { "资源文件过大，不能在编辑器中展开" }
        return file.readText(Charsets.UTF_8)
    }

    @Synchronized
    fun importGeneratedJson(fileName: String, content: String): NativeResource {
        val normalizedName = safeFileName(fileName).let { if (it.endsWith(".json", true)) it else "$it.json" }
        val bytes = content.toByteArray(Charsets.UTF_8)
        require(bytes.size <= 32 * 1024 * 1024) { "JSON 超过 32 MB" }
        val temporary = File(context.cacheDir, "generated-${UUID.randomUUID()}.json")
        temporary.writeBytes(bytes)
        return try {
            val hash = sha256(temporary)
            val existingId = findIdByHash(hash)
            if (existingId != null) {
                loadResources().firstOrNull { it.id == existingId } ?: throw IllegalStateException("重复资源索引异常")
            } else {
                val result = importDirect(temporary, normalizedName, "application/json")
                require(result.first == 1) { "生成资源导入失败" }
                val id = findIdByHash(hash) ?: throw IllegalStateException("生成资源保存后无法读取")
                writePortableIndex()
                loadResources().first { it.id == id }
            }
        } finally {
            temporary.delete()
        }
    }

    @Synchronized
    fun replaceJsonResource(resourceId: String, content: String, note: String = "内容编辑") {
        val current = readRow(resourceId) ?: throw IllegalArgumentException("资源不存在")
        require(!current.isVersion) { "历史版本不能直接编辑" }
        val currentManifest = JSONObject(current.manifestJson)
        val fileName = currentManifest.optString("fileName", "resource.json")
        val temporary = File(context.cacheDir, "edited-${UUID.randomUUID()}.json")
        temporary.writeText(content, Charsets.UTF_8)
        try {
            require(temporary.length() <= 32L * 1024L * 1024L) { "JSON 超过 32 MB" }
            val parsed = NativeResourceParser.parse(temporary, fileName)
            require(parsed.type == currentManifest.optString("type")) { "编辑后的文件类型发生变化，已拒绝覆盖" }
            val now = System.currentTimeMillis()
            val nextHash = sha256(temporary)
            val versionId = UUID.randomUUID().toString()
            val versionFile = destinationFile(versionId, fileName)
            val nextFile = destinationFile(resourceId, "edited-${UUID.randomUUID()}-$fileName")
            copyFile(File(current.localPath), versionFile)
            copyFile(temporary, nextFile)
            val versionManifest = JSONObject(currentManifest.toString())
                .put("id", versionId)
                .put("versionGroupId", resourceId)
                .put("versionImportedAt", now)
                .put("versionLabel", currentManifest.optString("versionLabel").ifBlank { fileName.substringBeforeLast('.') })
                .put("versionNote", note.trim().take(240))
            val nextManifest = JSONObject(currentManifest.toString())
                .put("id", resourceId)
                .put("description", parsed.description)
                .put("fileSize", nextFile.length())
                .put("contentHash", nextHash)
                .put("metadata", JSONObject(parsed.metadataJson))
                .put("updatedAt", now)
            nextManifest.remove("versionGroupId")
            val database = writableDatabase
            database.beginTransaction()
            try {
                insertRow(database, versionId, true, versionManifest, versionFile, current.contentHash, current.createdAt, now)
                val values = ContentValues().apply {
                    put("manifest_json", nextManifest.toString())
                    put("local_path", nextFile.absolutePath)
                    put("content_hash", nextHash)
                    put("updated_at", now)
                }
                require(database.update("resource_items", values, "id = ? AND is_version = 0", arrayOf(resourceId)) == 1) { "资源内容保存失败" }
                database.setTransactionSuccessful()
            } catch (error: Exception) {
                versionFile.parentFile?.deleteRecursively()
                nextFile.delete()
                throw error
            } finally {
                database.endTransaction()
            }
            File(current.localPath).takeIf { it.absolutePath != nextFile.absolutePath }?.delete()
            writePortableIndex()
        } finally {
            temporary.delete()
        }
    }

    @Synchronized
    fun exportResource(resourceId: String, destination: Uri) {
        val row = readRow(resourceId) ?: throw IllegalArgumentException("资源不存在")
        require(!row.isVersion) { "历史版本不能直接导出" }
        val output = context.contentResolver.openOutputStream(destination, "wt")
            ?: throw IllegalArgumentException("无法创建导出文件")
        output.use { target -> FileInputStream(row.localPath).buffered(128 * 1024).use { it.copyTo(target, 128 * 1024) } }
    }

    @Synchronized
    fun importUris(uris: List<Uri>): ImportReport {
        var imported = 0
        var skipped = 0
        var failed = 0
        val messages = mutableListOf<String>()
        for (uri in uris.distinct()) {
            val displayName = displayName(uri)
            try {
                val temporary = copyUriToCache(uri)
                try {
                    val result = if (!displayName.endsWith(".srlapp", true) &&
                        (displayName.endsWith(".zip", true) || isZip(temporary))
                    ) {
                        importArchive(temporary)
                    } else {
                        importDirect(temporary, displayName, context.contentResolver.getType(uri))
                    }
                    imported += result.first
                    skipped += result.second
                } finally {
                    temporary.delete()
                }
            } catch (error: Exception) {
                failed += 1
                messages += "$displayName：${error.message ?: "导入失败"}"
            }
        }
        if (imported > 0) {
            runCatching(::writePortableIndex).exceptionOrNull()?.let { error ->
                messages += "资源已导入，但本机便携清单更新失败：${error.message ?: "未知错误"}"
            }
        }
        return ImportReport(imported, skipped, failed, messages)
    }

    @Synchronized
    fun exportAll(destination: Uri, selection: NativeBackupSelection = NativeBackupSelection()): ExportReport {
        selection.requireContent()
        val output = context.contentResolver.openOutputStream(destination, "wt")
            ?: throw IllegalArgumentException("无法创建导出文件")
        return writeArchive(output, selection)
    }

    @Synchronized
    fun importArchiveFile(file: File, replace: Boolean = false): Pair<Int, Int> {
        require(file.isFile) { "备份文件不存在" }
        val result = importArchive(file, replace)
        writePortableIndex()
        return result
    }

    /**
     * V3 云恢复的原生提交边界。每个资源已经由 OkHttp/object assembler 流式落盘并完成
     * size + SHA-256 校验；这里直接原子移动到正式资源目录并提交 SQLite，不创建巨型 ZIP。
     */
    @Synchronized
    fun importCloudSnapshot(
        snapshot: JSONObject,
        prepared: List<NativePreparedCloudResource>,
        replace: Boolean = false,
    ): Pair<Int, Int> {
        require(snapshot.optString("format") == "srl-structured-cloud-snapshot" && snapshot.optInt("version") == 3) {
            "不是 Cloud Backup V3 快照"
        }
        prepared.forEach { item ->
            val expectedHash = item.manifest.optString("contentHash").lowercase()
            val expectedSize = item.manifest.optLong("fileSize", -1L)
            require(Regex("^[0-9a-f]{64}$").matches(expectedHash)) { "云恢复资源摘要无效" }
            require(item.file.isFile && item.file.length() == expectedSize && sha256(item.file) == expectedHash) {
                "云恢复资源完整性校验失败：${item.manifest.optString("fileName")}"
            }
        }

        val existingHashIds = if (replace) mutableMapOf() else hashIdMap()
        val designatedHashIds = existingHashIds.toMutableMap()
        val usedIds = if (replace) mutableSetOf() else allIds().toMutableSet()
        val idMap = mutableMapOf<String, String>()
        for (item in prepared) {
            val oldId = item.manifest.optString("id")
            require(oldId.isNotBlank()) { "云恢复资源 ID 无效" }
            val hash = item.manifest.getString("contentHash").lowercase()
            val existingId = designatedHashIds[hash]
            val newId = existingId ?: oldId.takeIf { usedIds.add(it) }
                ?: UUID.randomUUID().toString().also { usedIds.add(it) }
            designatedHashIds.putIfAbsent(hash, newId)
            idMap[oldId] = newId
        }

        var imported = 0
        var skipped = 0
        val createdPaths = mutableListOf<File>()
        val database = writableDatabase
        val resourceDirectory = File(resourceRoot(), "resources")
        val backupDirectory = File(resourceRoot(), ".resources-cloud-restore-${UUID.randomUUID()}")
        if (replace && resourceDirectory.exists() && !resourceDirectory.renameTo(backupDirectory)) {
            throw IllegalStateException("无法保护云恢复前的本机资源目录")
        }
        if (replace && !resourceDirectory.exists() && !resourceDirectory.mkdirs()) {
            if (backupDirectory.exists()) backupDirectory.renameTo(resourceDirectory)
            throw IllegalStateException("无法创建云恢复资源目录")
        }
        database.beginTransaction()
        try {
            if (replace) {
                database.delete("resource_items", null, null)
                database.delete("app_state", "state_key IN (?, ?)", arrayOf("categories", "portableData"))
            }
            val categoryIdMap = mergeCategories(snapshot.optJSONArray("categories") ?: JSONArray(), database)
            for (item in prepared) {
                val hash = item.manifest.getString("contentHash").lowercase()
                if (existingHashIds[hash] != null) {
                    skipped += 1
                    continue
                }
                val adjusted = JSONObject(item.manifest.toString())
                adjusted.remove("object")
                val oldId = adjusted.getString("id")
                val newId = idMap.getValue(oldId)
                adjusted.put("id", newId)
                remapStringArray(adjusted, "categoryIds", categoryIdMap)
                remapStringArray(adjusted, "relatedResourceIds", idMap)
                val categoryId = adjusted.optString("categoryId").takeIf { it.isNotBlank() && it != "null" }
                if (categoryId == null) adjusted.put("categoryId", JSONObject.NULL)
                else adjusted.put("categoryId", categoryIdMap[categoryId] ?: categoryId)
                val groupId = adjusted.optString("versionGroupId")
                if (groupId.isNotBlank()) adjusted.put("versionGroupId", idMap[groupId] ?: groupId)
                val destination = destinationFile(newId, adjusted.optString("fileName", "resource.bin"))
                moveFile(item.file, destination)
                createdPaths += destination
                val createdAt = adjusted.optLong("createdAt", System.currentTimeMillis())
                val updatedAt = adjusted.optLong("updatedAt", createdAt)
                insertRow(database, newId, item.isVersion, adjusted, destination, hash, createdAt, updatedAt)
                existingHashIds[hash] = newId
                imported += 1
            }
            snapshot.optJSONObject("portableData")?.let { writeState(database, "portableData", it.toString()) }
            database.setTransactionSuccessful()
        } catch (error: Exception) {
            createdPaths.forEach { it.parentFile?.deleteRecursively() }
            if (replace) {
                resourceDirectory.deleteRecursively()
                if (backupDirectory.exists() && !backupDirectory.renameTo(resourceDirectory)) {
                    throw IllegalStateException("云恢复失败，且无法还原恢复前资源目录", error)
                }
            }
            throw error
        } finally {
            database.endTransaction()
        }
        if (replace) backupDirectory.deleteRecursively()
        writePortableIndex()
        return imported to skipped
    }

    @Synchronized
    fun listSnapshots(): List<NativeSnapshot> {
        val stored = readState("historySnapshots")?.let(::JSONArray) ?: JSONArray()
        return (0 until stored.length()).mapNotNull { index ->
            stored.optJSONObject(index)?.let { value ->
                val file = File(value.optString("filePath"))
                if (!file.isFile) null else NativeSnapshot(
                    id = value.optString("id"), reason = value.optString("reason", "本地快照"),
                    resourceCount = value.optInt("resourceCount"), categoryCount = value.optInt("categoryCount"),
                    size = file.length(), createdAt = value.optLong("createdAt"), filePath = file.absolutePath,
                )
            }
        }.sortedByDescending { it.createdAt }
    }

    @Synchronized
    fun captureSnapshot(reason: String): NativeSnapshot {
        val id = UUID.randomUUID().toString()
        val createdAt = System.currentTimeMillis()
        val history = File(resourceRoot(), "history").apply { if (!exists() && !mkdirs()) throw IllegalStateException("无法创建历史快照目录") }
        val temporary = File(history, "$id.zip.tmp")
        val target = File(history, "$id.zip")
        val report = try { FileOutputStream(temporary).use { writeArchive(it) } } catch (error: Exception) { temporary.delete(); throw error }
        if (!temporary.renameTo(target)) { temporary.delete(); throw IllegalStateException("无法提交历史快照") }
        val snapshot = NativeSnapshot(id, reason.trim().ifBlank { "手动快照" }, report.resourceCount, loadCategories().size, target.length(), createdAt, target.absolutePath)
        val retained = (listOf(snapshot) + listSnapshots()).sortedByDescending { it.createdAt }.take(8)
        val retainedIds = retained.mapTo(mutableSetOf()) { it.id }
        listSnapshots().filterNot { retainedIds.contains(it.id) }.forEach { File(it.filePath).delete() }
        writeSnapshots(retained)
        return snapshot
    }

    @Synchronized
    fun deleteSnapshot(snapshotId: String) {
        val snapshots = listSnapshots()
        val target = snapshots.find { it.id == snapshotId } ?: throw IllegalArgumentException("历史快照不存在")
        if (!File(target.filePath).delete()) throw IllegalStateException("历史快照删除失败")
        writeSnapshots(snapshots.filterNot { it.id == snapshotId })
    }

    @Synchronized
    fun restoreSnapshot(snapshotId: String) {
        val snapshot = listSnapshots().find { it.id == snapshotId } ?: throw IllegalArgumentException("历史快照不存在")
        val protectedCopy = File(context.cacheDir, "snapshot-restore-${UUID.randomUUID()}.zip")
        copyFile(File(snapshot.filePath), protectedCopy)
        try {
            captureSnapshot("恢复历史快照前自动保存")
            importArchiveFile(protectedCopy, replace = true)
        } finally {
            protectedCopy.delete()
        }
    }

    private fun writeArchive(output: OutputStream, selection: NativeBackupSelection = NativeBackupSelection()): ExportReport {
        val resources = if (selection.resources) loadRows(false) else emptyList()
        val versions = if (selection.versions) loadRows(true) else emptyList()
        val categories = if (selection.categories) readState("categories")?.let(::JSONArray) ?: JSONArray() else JSONArray()
        val portableData = if (selection.portableData) readState("portableData")?.let(::JSONObject) ?: JSONObject().put("version", 1) else null
        val now = System.currentTimeMillis()
        val resourceManifest = JSONArray()
        val versionManifest = JSONArray()
        ZipOutputStream(BufferedOutputStream(output, 128 * 1024)).use { archive ->
            archive.setLevel(6)
            for (row in resources + versions) {
                val manifest = JSONObject(row.manifestJson)
                val prefix = if (row.isVersion) "versions" else "files"
                val path = "$prefix/${manifest.optString("type", "other")}/${row.id}-${safeFileName(manifest.optString("fileName", "resource.bin"))}"
                manifest.put("archivePath", path)
                manifest.put("fileSize", File(row.localPath).length())
                val target = if (row.isVersion) versionManifest else resourceManifest
                target.put(manifest)
                val entry = ZipEntry(path).apply { time = row.updatedAt.coerceAtLeast(315532800000L) }
                archive.putNextEntry(entry)
                FileInputStream(row.localPath).buffered(128 * 1024).use { it.copyTo(archive, 128 * 1024) }
                archive.closeEntry()
            }
            val manifest = JSONObject()
                .put("format", ARCHIVE_FORMAT)
                .put("version", ARCHIVE_VERSION)
                .put("mode", "full")
                .put("resourceContent", "original")
                .put("createdAt", java.time.Instant.ofEpochMilli(now).toString())
                .put("resourceCount", resourceManifest.length())
                .put("categoryCount", categories.length())
                .put("categories", categories)
                .put("resources", resourceManifest)
                .put("versionCount", versionManifest.length())
                .put("versions", versionManifest)
            if (portableData != null) manifest.put("portableData", portableData)
            archive.putNextEntry(ZipEntry("manifest.json").apply { time = now })
            archive.write(manifest.toString(2).toByteArray(Charsets.UTF_8))
            archive.closeEntry()
        }
        return ExportReport(resources.size, versions.size)
    }

    private fun importDirect(file: File, displayName: String, providedMime: String?): Pair<Int, Int> {
        val hash = sha256(file)
        if (findIdByHash(hash) != null) return 0 to 1
        val parsed = NativeResourceParser.parse(file, displayName)
        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        val mime = providedMime?.takeIf { it.isNotBlank() } ?: when {
            displayName.endsWith(".png", true) -> "image/png"
            displayName.endsWith(".json", true) -> "application/json"
            else -> "application/octet-stream"
        }
        val manifest = JSONObject()
            .put("id", id)
            .put("type", parsed.type)
            .put("name", parsed.name)
            .put("description", parsed.description)
            .put("fileName", displayName)
            .put("mimeType", mime)
            .put("fileSize", file.length())
            .put("contentHash", hash)
            .put("favorite", false)
            .put("categoryId", JSONObject.NULL)
            .put("categoryIds", JSONArray())
            .put("relatedResourceIds", JSONArray())
            .put("sourceLinks", JSONArray())
            .put("tags", JSONArray(parsed.tags))
            .put("metadata", JSONObject(parsed.metadataJson))
            .put("createdAt", now)
            .put("updatedAt", now)
        val destination = destinationFile(id, displayName)
        moveFile(file, destination)
        try {
            insertRow(id, false, manifest, destination, hash, now, now)
        } catch (error: Exception) {
            destination.parentFile?.deleteRecursively()
            throw error
        }
        return 1 to 0
    }

    private fun importArchive(file: File, replace: Boolean = false): Pair<Int, Int> {
        val manifest = readManifest(file)
        if (manifest.optString("format") != ARCHIVE_FORMAT) throw IllegalArgumentException("不是酒馆资源库备份包")
        val version = manifest.optInt("version", -1)
        if (version !in 1..ARCHIVE_VERSION) throw IllegalArgumentException("暂不支持备份版本 $version")
        val resources = manifest.optJSONArray("resources") ?: throw IllegalArgumentException("备份缺少资源清单")
        val versions = if (version >= 3) manifest.optJSONArray("versions") ?: JSONArray() else JSONArray()
        if (manifest.optInt("resourceCount", -1) != resources.length()) throw IllegalArgumentException("备份资源数量不一致")
        if (version >= 3 && manifest.optInt("versionCount", -1) != versions.length()) throw IllegalArgumentException("备份历史版本数量不一致")

        val items = mutableListOf<ArchiveItem>()
        fun collect(array: JSONArray, isVersion: Boolean) {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: throw IllegalArgumentException("备份资源清单无效")
                val path = item.optString("archivePath")
                val prefix = if (isVersion) "versions/" else "files/"
                if (!path.startsWith(prefix) || path.split('/').contains("..")) throw IllegalArgumentException("备份资源路径无效")
                val hash = item.optString("contentHash")
                if (!Regex("^[0-9a-fA-F]{64}$").matches(hash)) throw IllegalArgumentException("备份资源校验值无效")
                items += ArchiveItem(item, path, isVersion, hash.lowercase())
            }
        }
        collect(resources, false)
        collect(versions, true)
        if (items.map { it.archivePath }.toSet().size != items.size) throw IllegalArgumentException("备份中存在重复文件路径")

        val stageDirectory = File(context.cacheDir, "native-archive-${UUID.randomUUID()}").apply { mkdirs() }
        val staged = mutableMapOf<String, File>()
        try {
            val expected = items.associateBy { it.archivePath }
            ZipInputStream(BufferedInputStream(FileInputStream(file), 128 * 1024)).use { archive ->
                while (true) {
                    val entry = archive.nextEntry ?: break
                    val item = expected[entry.name]
                    if (item != null && !entry.isDirectory) {
                        val target = File(stageDirectory, UUID.randomUUID().toString())
                        copyLimited(archive, FileOutputStream(target), MAX_FILE_BYTES, closeInput = false)
                        if (sha256(target) != item.contentHash) throw IllegalArgumentException("${item.manifest.optString("fileName")} 的 SHA-256 不匹配")
                        staged[item.archivePath] = target
                    }
                    archive.closeEntry()
                }
            }
            if (staged.size != items.size) throw IllegalArgumentException("备份包缺少 ${items.size - staged.size} 个资源文件")

            val existingHashIds = if (replace) mutableMapOf() else hashIdMap()
            val designatedHashIds = existingHashIds.toMutableMap()
            val usedIds = if (replace) mutableSetOf() else allIds().toMutableSet()
            val idMap = mutableMapOf<String, String>()
            for (item in items) {
                val oldId = item.manifest.optString("id")
                if (oldId.isBlank()) throw IllegalArgumentException("备份资源 ID 无效")
                val existingId = designatedHashIds[item.contentHash]
                val newId = existingId ?: oldId.takeIf { usedIds.add(it) } ?: UUID.randomUUID().toString().also { usedIds.add(it) }
                designatedHashIds.putIfAbsent(item.contentHash, newId)
                idMap[oldId] = newId
            }

            var imported = 0
            var skipped = 0
            val createdPaths = mutableListOf<File>()
            val database = writableDatabase
            val resourceDirectory = File(resourceRoot(), "resources")
            val backupDirectory = File(resourceRoot(), ".resources-restore-${UUID.randomUUID()}")
            if (replace && resourceDirectory.exists() && !resourceDirectory.renameTo(backupDirectory)) {
                throw IllegalStateException("无法保护恢复前的本机资源目录")
            }
            if (replace && !resourceDirectory.exists() && !resourceDirectory.mkdirs()) {
                if (backupDirectory.exists()) backupDirectory.renameTo(resourceDirectory)
                throw IllegalStateException("无法创建恢复资源目录")
            }
            database.beginTransaction()
            try {
                if (replace) {
                    database.delete("resource_items", null, null)
                    database.delete("app_state", "state_key IN (?, ?)", arrayOf("categories", "portableData"))
                }
                val categoryIdMap = mergeCategories(manifest.optJSONArray("categories") ?: JSONArray(), database)
                for (item in items) {
                    val existingId = existingHashIds[item.contentHash]
                    if (existingId != null) {
                        skipped += 1
                        continue
                    }
                    val adjusted = JSONObject(item.manifest.toString())
                    val oldId = adjusted.optString("id")
                    val newId = idMap.getValue(oldId)
                    adjusted.put("id", newId)
                    remapStringArray(adjusted, "categoryIds", categoryIdMap)
                    remapStringArray(adjusted, "relatedResourceIds", idMap)
                    val categoryId = adjusted.optString("categoryId").takeIf { it.isNotBlank() && it != "null" }
                    if (categoryId == null) adjusted.put("categoryId", JSONObject.NULL)
                    else adjusted.put("categoryId", categoryIdMap[categoryId] ?: categoryId)
                    val oldGroupId = adjusted.optString("versionGroupId")
                    if (oldGroupId.isNotBlank()) adjusted.put("versionGroupId", idMap[oldGroupId] ?: oldGroupId)
                    adjusted.remove("archivePath")
                    val fileName = adjusted.optString("fileName", "resource.bin")
                    val destination = destinationFile(newId, fileName)
                    moveFile(staged.getValue(item.archivePath), destination)
                    createdPaths += destination
                    val createdAt = adjusted.optLong("createdAt", System.currentTimeMillis())
                    val updatedAt = adjusted.optLong("updatedAt", createdAt)
                    insertRow(database, newId, item.isVersion, adjusted, destination, item.contentHash, createdAt, updatedAt)
                    existingHashIds[item.contentHash] = newId
                    imported += 1
                }
                manifest.optJSONObject("portableData")?.let { writeState(database, "portableData", it.toString()) }
                database.setTransactionSuccessful()
            } catch (error: Exception) {
                createdPaths.forEach { it.parentFile?.deleteRecursively() }
                if (replace) {
                    resourceDirectory.deleteRecursively()
                    if (backupDirectory.exists() && !backupDirectory.renameTo(resourceDirectory)) {
                        throw IllegalStateException("恢复失败，且无法还原恢复前资源目录", error)
                    }
                }
                throw error
            } finally {
                database.endTransaction()
            }
            if (replace) backupDirectory.deleteRecursively()
            return imported to skipped
        } finally {
            stageDirectory.deleteRecursively()
        }
    }

}
