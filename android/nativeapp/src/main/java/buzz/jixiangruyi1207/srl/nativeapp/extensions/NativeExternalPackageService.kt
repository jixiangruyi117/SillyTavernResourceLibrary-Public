package buzz.jixiangruyi1207.srl.nativeapp.extensions

import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.zip.ZipInputStream

data class NativeExternalPackage(
    val resourceId: String,
    val id: String,
    val name: String,
    val version: String,
    val entry: String,
    val author: String,
    val description: String,
    val permissions: List<String>,
    val permissionLevel: String,
    val inspectedAt: Long,
)

class NativeExternalPackageService(private val store: NativeResourceStore) {
    companion object {
        private const val MAX_PACKAGE_BYTES = 10L * 1024L * 1024L
        private const val MAX_EXTRACTED_BYTES = 20L * 1024L * 1024L
        private const val MAX_SINGLE_FILE_BYTES = 5L * 1024L * 1024L
        private const val MAX_FILES = 100
        private val idPattern = Regex("^[a-z0-9](?:[a-z0-9.-]{1,118}[a-z0-9])?$")
        private val versionPattern = Regex("^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$")
        private val safePathPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._/-]*$")
        private val permissions = setOf(
            "app.storage", "resources.selected.read", "resources.library.read", "resources.content.read",
            "resources.write", "resources.delete", "network.https", "files.importExport", "tavern.transfer",
        )
    }

    fun load(): List<NativeExternalPackage> {
        val root = store.readPortableSection("externalApps") ?: return emptyList()
        val array = root.optJSONArray("nativePackages") ?: return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val id = item.optString("id")
            val resourceId = item.optString("resourceId")
            if (id.isBlank() || resourceId.isBlank()) return@mapNotNull null
            NativeExternalPackage(
                resourceId, id, item.optString("name", id), item.optString("version"), item.optString("entry"),
                item.optString("author"), item.optString("description"), stringList(item.optJSONArray("permissions") ?: JSONArray()),
                item.optString("permissionLevel", "isolated"), item.optLong("inspectedAt"),
            )
        }
    }

    fun inspectAndRegister(resourceId: String): NativeExternalPackage {
        val resource = store.loadResources().firstOrNull { it.id == resourceId } ?: error("未找到扩展安装包资源")
        require(resource.fileName.endsWith(".srlapp", true)) { "请选择 .srlapp 安装包" }
        val inspected = inspect(resource)
        val root = store.readPortableSection("externalApps") ?: JSONObject().put("apps", JSONArray()).put("data", JSONArray())
        val retained = load().filter { it.id != inspected.id }
        val array = JSONArray()
        (retained + inspected).sortedBy(NativeExternalPackage::name).forEach { array.put(encode(it)) }
        store.writePortableSection("externalApps", JSONObject(root.toString()).put("nativePackages", array))
        return inspected
    }

    fun unregister(appId: String) {
        val root = store.readPortableSection("externalApps") ?: return
        val array = JSONArray()
        load().filter { it.id != appId }.forEach { array.put(encode(it)) }
        store.writePortableSection("externalApps", JSONObject(root.toString()).put("nativePackages", array))
    }

    private fun inspect(resource: NativeResource): NativeExternalPackage {
        val file = File(resource.localPath)
        require(file.isFile && file.length() in 1..MAX_PACKAGE_BYTES) { "安装包为空或超过 10 MiB 限制" }
        val paths = mutableSetOf<String>()
        var count = 0
        var extracted = 0L
        var manifestBytes: ByteArray? = null
        ZipInputStream(file.inputStream().buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (entry.isDirectory) continue
                require(entry.method == java.util.zip.ZipEntry.STORED || entry.method == java.util.zip.ZipEntry.DEFLATED) { "安装包使用了不支持的压缩算法" }
                val path = safePath(entry.name)
                require(paths.add(path)) { "安装包包含重复文件" }
                count += 1
                require(count <= MAX_FILES) { "安装包文件数量超过限制" }
                val bytes = readLimited(zip, MAX_SINGLE_FILE_BYTES)
                extracted += bytes.size
                require(extracted <= MAX_EXTRACTED_BYTES) { "安装包解压后的内容超过限制" }
                if (path == "manifest.json") manifestBytes = bytes
            }
        }
        val manifest = manifestBytes?.toString(Charsets.UTF_8)?.let(::JSONObject) ?: error("安装包缺少有效 manifest.json")
        val schema = manifest.optInt("schemaVersion", -1)
        require(schema == 1 || schema == 2) { "暂不支持 APP 清单版本 $schema" }
        if (schema == 2) require(manifest.optString("apiVersion") == "srl-app-api@1") { "APP 必须声明 API 版本 srl-app-api@1" }
        val id = manifest.optString("id").trim()
        val name = manifest.optString("name").trim()
        val version = manifest.optString("version").trim()
        val entry = safePath(manifest.optString("entry").trim())
        require(idPattern.matches(id)) { "APP ID 只能使用小写字母、数字、点和连字符" }
        require(name.length in 1..80) { "APP 名称必须为 1 到 80 个字符" }
        require(versionPattern.matches(version)) { "APP 版本必须使用 x.y.z 格式" }
        require(entry.endsWith(".html") && entry in paths) { "安装包缺少清单指定的 HTML 入口文件" }
        val requested = stringList(manifest.optJSONArray("permissions") ?: JSONArray()).distinct()
        require(requested.all(permissions::contains)) { "APP 声明了暂不支持的权限" }
        if (schema == 1) require(requested.all { it == "app.storage" }) { "清单版本 1 仅支持 APP 自己的本地存储权限" }
        val level = permissionLevel(requested)
        if (manifest.has("permissionLevel")) require(manifest.optString("permissionLevel") == level) { "APP 声明的权限等级与实际权限不一致" }
        return NativeExternalPackage(
            resource.id, id, name, version, entry, manifest.optString("author").trim().take(80),
            manifest.optString("description").trim().take(500), requested, level, System.currentTimeMillis(),
        )
    }

    private fun safePath(value: String): String {
        val normalized = value.replace('\\', '/')
        require(normalized.isNotBlank() && !normalized.startsWith('/') && !normalized.contains("//") &&
            normalized.split('/').none { it == "." || it == ".." } && safePathPattern.matches(normalized)) { "安装包包含不安全路径" }
        return normalized
    }

    private fun readLimited(zip: ZipInputStream, limit: Long): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(32 * 1024)
        var total = 0L
        while (true) {
            val read = zip.read(buffer)
            if (read < 0) break
            total += read
            require(total <= limit) { "安装包包含过大的文件" }
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }

    private fun permissionLevel(values: List<String>): String = when {
        values.any { it in setOf("resources.delete", "network.https", "files.importExport", "tavern.transfer") } -> "fullControl"
        values.any { it in setOf("resources.library.read", "resources.write") } -> "resourceAssistant"
        values.any { it in setOf("resources.selected.read", "resources.content.read") } -> "selectedRead"
        else -> "isolated"
    }

    private fun encode(value: NativeExternalPackage): JSONObject = JSONObject()
        .put("resourceId", value.resourceId).put("id", value.id).put("name", value.name).put("version", value.version)
        .put("entry", value.entry).put("author", value.author).put("description", value.description)
        .put("permissions", JSONArray(value.permissions)).put("permissionLevel", value.permissionLevel).put("inspectedAt", value.inspectedAt)

    private fun stringList(array: JSONArray): List<String> = (0 until array.length()).map { array.optString(it) }.filter(String::isNotBlank)
}
