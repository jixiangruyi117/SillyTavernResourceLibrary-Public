package buzz.jixiangruyi1207.srl.nativeapp.cloud

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.time.Instant
import java.util.zip.GZIPInputStream

object NativeCloudSnapshotCodec {
    private const val SNAPSHOT_FORMAT = "srl-structured-cloud-snapshot"
    private const val BUNDLE_FORMAT = "srl-github-backup-bundle"
    private const val MAX_SNAPSHOT_BYTES = 32L * 1024L * 1024L
    private val hashPattern = Regex("^[a-fA-F0-9]{64}$")

    fun decode(file: File): JSONObject {
        require(file.isFile) { "对象级云备份清单不存在" }
        require(file.length() <= MAX_SNAPSHOT_BYTES) { "对象级云备份清单过大" }
        val input = BufferedInputStream(FileInputStream(file), 128 * 1024)
        val stream = if (input.markSupported().also { input.mark(2) } && input.read() == 0x1f && input.read() == 0x8b) {
            input.reset()
            GZIPInputStream(input, 128 * 1024)
        } else {
            input.reset()
            input
        }
        val bytes = stream.use { value ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(128 * 1024)
            var total = 0L
            while (true) {
                val count = value.read(buffer)
                if (count < 0) break
                total += count
                require(total <= MAX_SNAPSHOT_BYTES) { "对象级云备份清单解压后过大" }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
        return validateSnapshot(JSONObject(bytes.toString(Charsets.UTF_8)))
    }

    fun validateSnapshot(snapshot: JSONObject): JSONObject {
        require(snapshot.optString("format") == SNAPSHOT_FORMAT) { "对象级云备份清单格式无效" }
        require(snapshot.optInt("version") in 1..3) { "对象级云备份清单版本不受支持" }
        runCatching { Instant.parse(snapshot.getString("createdAt")) }.getOrElse { throw IllegalArgumentException("对象级云备份时间无效") }
        val resources = snapshot.optJSONArray("resources") ?: throw IllegalArgumentException("对象级云备份缺少资源清单")
        val versions = snapshot.optJSONArray("versions") ?: throw IllegalArgumentException("对象级云备份缺少历史版本清单")
        require(snapshot.optJSONArray("categories") != null) { "对象级云备份缺少分类清单" }
        require(snapshot.optJSONObject("portableData")?.optInt("version") == 1) { "对象级云备份便携数据无效" }
        val ids = mutableSetOf<String>()
        for (array in listOf(resources, versions)) for (index in 0 until array.length()) {
            val record = array.optJSONObject(index) ?: throw IllegalArgumentException("对象级云备份包含无效资源")
            val id = record.optString("id")
            require(id.isNotBlank() && ids.add(id)) { "对象级云备份包含无效或重复资源 ID" }
            val fileSize = record.optLong("fileSize", -1)
            val contentHash = record.optString("contentHash")
            require(fileSize >= 0 && hashPattern.matches(contentHash)) { "对象级云备份资源校验信息无效" }
            val objectManifest = validateBundle(record.optJSONObject("object") ?: throw IllegalArgumentException("对象级云备份资源缺少对象清单"))
            require(objectManifest.getLong("totalSize") == fileSize && objectManifest.getString("totalSha256").equals(contentHash, true)) {
                "对象级云备份资源校验信息不一致：${record.optString("fileName")}"
            }
        }
        return snapshot
    }

    fun validateBundle(bundle: JSONObject): JSONObject {
        require(bundle.optString("format") == BUNDLE_FORMAT) { "云端分块清单无效" }
        val version = bundle.optInt("version")
        require(version in 1..2) { "云端分块清单版本不受支持" }
        runCatching { Instant.parse(bundle.getString("createdAt")) }.getOrElse { throw IllegalArgumentException("云端分块清单时间无效") }
        val fileName = bundle.optString("fileName")
        val totalSize = bundle.optLong("totalSize", -1)
        val totalHash = bundle.optString("totalSha256")
        val parts = bundle.optJSONArray("parts") ?: throw IllegalArgumentException("云端分块清单缺少分块")
        require(fileName.isNotBlank() && totalSize >= 0 && hashPattern.matches(totalHash) && parts.length() > 0) { "云端分块清单格式不受支持" }
        val names = mutableSetOf<String>()
        var logicalSize = 0L
        for (index in 0 until parts.length()) {
            val part = parts.optJSONObject(index) ?: throw IllegalArgumentException("云端分块清单包含无效分块")
            val name = part.optString("name")
            val size = part.optLong("size", -1)
            val hash = part.optString("sha256")
            val hasOffset = part.has("offset")
            val hasStoredSize = part.has("storedSize")
            val offset = if (hasOffset) part.optLong("offset", -1) else 0
            val storedSize = if (hasStoredSize) part.optLong("storedSize", -1) else size
            require(size >= 0 && hashPattern.matches(hash) && hasOffset == hasStoredSize && offset >= 0 && storedSize >= size && storedSize >= offset + size) {
                "云端分块清单包含无效分块"
            }
            if (version == 1) require(name.startsWith("$fileName.part-") && names.add(name)) { "旧版云端分块名称无效" }
            else require(name == "srl-chunk--sha256-${hash.lowercase()}") { "云端内容块名称与摘要不一致" }
            logicalSize += size
        }
        require(logicalSize == totalSize) { "云端分块清单总大小不一致" }
        return bundle
    }

    fun referencedParts(snapshot: JSONObject, providerName: String = ""): Map<String, Long> {
        val result = linkedMapOf<String, Long>()
        for (key in listOf("resources", "versions")) {
            val records = snapshot.getJSONArray(key)
            for (index in 0 until records.length()) {
                val parts = records.getJSONObject(index).getJSONObject("object").getJSONArray("parts")
                for (partIndex in 0 until parts.length()) {
                    val part = parts.getJSONObject(partIndex)
                    result[providerObjectKey(part, providerName)] = if (part.has("storedSize")) part.getLong("storedSize") else part.getLong("size")
                }
            }
        }
        return result
    }

    fun providerObjectKey(part: JSONObject, providerName: String): String {
        val storage = part.optJSONObject("storage")
        val objectKey = storage?.optString("objectKey")?.takeIf(String::isNotBlank) ?: part.getString("name")
        return if (providerName == "github" && storage?.optString("kind") == "github-release") {
            "${storage.getString("container")}::$objectKey"
        } else objectKey
    }

    fun sha256(file: File): String {
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
}
