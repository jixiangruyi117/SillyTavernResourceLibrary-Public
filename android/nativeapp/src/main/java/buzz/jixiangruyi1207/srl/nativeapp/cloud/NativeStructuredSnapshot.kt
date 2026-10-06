package buzz.jixiangruyi1207.srl.nativeapp.cloud

import android.content.Context
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeCloudSource
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import java.util.zip.GZIPOutputStream

data class NativeChunkPart(val name: String, val size: Long, val sha256: String, val offset: Long? = null, val storedSize: Long? = null) {
    fun json(): JSONObject = JSONObject().put("name", name).put("size", size).put("sha256", sha256).also {
        if (offset != null) it.put("offset", offset)
        if (storedSize != null) it.put("storedSize", storedSize)
    }
}

data class BuiltNativeSnapshot(
    val objectKey: String,
    val snapshotFile: File,
    val chunks: Map<String, File>,
    val totalSize: Long,
    val buildDirectory: File,
)

class NativeStructuredSnapshotBuilder(private val context: Context) {
    companion object {
        private const val SMALL_OBJECT_LIMIT = 4L * 1024L * 1024L
        private const val MIN_PART_SIZE = 8L * 1024L * 1024L
        private const val AVERAGE_PART_SIZE = 16 * 1024 * 1024
        private const val MAX_PART_SIZE = 32L * 1024L * 1024L
        private val GEAR_TABLE = IntArray(256).also { values ->
            var state = 0x9e3779b9.toInt()
            for (index in values.indices) {
                state = state xor (state shl 13); state = state xor (state ushr 17); state = state xor (state shl 5)
                values[index] = state
            }
        }
    }

    fun build(sources: List<NativeCloudSource>, categoriesJson: String, portableDataJson: String): BuiltNativeSnapshot {
        val directory = File(context.cacheDir, "native-cloud-${UUID.randomUUID()}").apply { mkdirs() }
        try {
            val chunks = linkedMapOf<String, File>()
            val resources = JSONArray()
            val versions = JSONArray()
            for (source in sources) {
                val objectManifest = if (source.fileSize <= SMALL_OBJECT_LIMIT) {
                    smallObject(source, chunks)
                } else {
                    largeObject(source, directory, chunks)
                }
                target(source, resources, versions).put(structuredResource(source, objectManifest))
            }
            val createdAt = Instant.now().toString()
            val snapshot = JSONObject().put("format", "srl-structured-cloud-snapshot").put("version", 3)
                .put("createdAt", createdAt).put("categories", JSONArray(categoriesJson))
                .put("resources", resources).put("versions", versions).put("portableData", JSONObject(portableDataJson))
                .put("objectContract", JSONObject().put("algorithm", "SHA-256").put("immutable", true).put("naming", "srl-chunk--sha256-{hash}"))
            val objectKey = "srl-snapshot-${createdAt.replace(':', '-').replace('.', '-').take(23)}.srlmanifest.v3.json.gz"
            val snapshotFile = File(directory, objectKey)
            GZIPOutputStream(BufferedOutputStream(FileOutputStream(snapshotFile), 128 * 1024)).use { it.write(snapshot.toString().toByteArray()) }
            return BuiltNativeSnapshot(objectKey, snapshotFile, chunks, sources.sumOf { it.fileSize }, directory)
        } catch (error: Exception) {
            directory.deleteRecursively()
            throw error
        }
    }

    private fun target(source: NativeCloudSource, resources: JSONArray, versions: JSONArray) = if (source.isVersion) versions else resources

    private fun structuredResource(source: NativeCloudSource, objectManifest: JSONObject): JSONObject {
        val record = JSONObject(source.manifestJson)
        record.remove("archivePath")
        record.put("fileSize", source.fileSize).put("contentHash", source.contentHash)
        if (record.optString("type") == "characterCard") record.optJSONObject("metadata")?.remove("card")
        return record.put("object", objectManifest)
    }

    private fun objectManifest(source: NativeCloudSource, parts: List<NativeChunkPart>): JSONObject =
        JSONObject().put("format", "srl-github-backup-bundle").put("version", 2).put("createdAt", Instant.now().toString())
            .put("fileName", JSONObject(source.manifestJson).optString("fileName", File(source.filePath).name))
            .put("totalSize", source.fileSize).put("totalSha256", source.contentHash.lowercase())
            .put("parts", JSONArray(parts.map(NativeChunkPart::json)))

    private fun largeObject(source: NativeCloudSource, directory: File, chunks: MutableMap<String, File>): JSONObject {
        val parts = mutableListOf<NativeChunkPart>()
        val totalDigest = MessageDigest.getInstance("SHA-256")
        var current = File(directory, "part-${UUID.randomUUID()}.tmp")
        var output = BufferedOutputStream(FileOutputStream(current), 128 * 1024)
        var currentSize = 0L
        var rolling = 0
        fun flush() {
            output.close()
            val hash = sha256(current)
            val name = "srl-chunk--sha256-$hash"
            val stored = chunks[name]
            if (stored == null) chunks[name] = current else current.delete()
            parts += NativeChunkPart(name, currentSize, hash)
            current = File(directory, "part-${UUID.randomUUID()}.tmp")
            output = BufferedOutputStream(FileOutputStream(current), 128 * 1024)
            currentSize = 0; rolling = 0
        }
        BufferedInputStream(FileInputStream(source.filePath), 128 * 1024).use { input ->
            val buffer = ByteArray(128 * 1024)
            while (true) {
                val count = input.read(buffer); if (count < 0) break
                totalDigest.update(buffer, 0, count)
                for (index in 0 until count) {
                    val byte = buffer[index].toInt() and 0xff
                    output.write(byte); currentSize += 1
                    rolling = rolling * 2 + GEAR_TABLE[byte]
                    if (currentSize >= MIN_PART_SIZE && ((rolling and (AVERAGE_PART_SIZE - 1)) == 0 || currentSize >= MAX_PART_SIZE)) flush()
                }
            }
        }
        if (currentSize > 0 || parts.isEmpty()) flush()
        output.close(); current.delete()
        val actual = totalDigest.digest().toHex()
        require(actual == source.contentHash.lowercase()) { "资源原文件摘要与索引不一致：${File(source.filePath).name}" }
        return objectManifest(source, parts)
    }

    private fun smallObject(source: NativeCloudSource, chunks: MutableMap<String, File>): JSONObject {
        val file = File(source.filePath)
        val hash = sha256(file)
        require(hash == source.contentHash.lowercase()) { "资源原文件摘要与索引不一致：${file.name}" }
        val name = "srl-chunk--sha256-$hash"
        chunks.putIfAbsent(name, file)
        return objectManifest(source, listOf(NativeChunkPart(name, source.fileSize, hash)))
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).buffered(128 * 1024).use { input -> val buffer = ByteArray(128 * 1024); while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) } }
        return digest.digest().toHex()
    }

    private fun ByteArray.toHex(): String = joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
}
