package buzz.jixiangruyi1207.srl.nativeapp.cloud

import android.net.Uri
import android.util.Base64
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.File
import java.io.FileOutputStream
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

class NativeWebDavProvider(
    private val config: NativeWebDavConfig,
    private val password: String,
    private val client: OkHttpClient = defaultClient(),
    private val sleeper: (Long) -> Unit = Thread::sleep,
) : NativeObjectProvider {
    override val providerName = "webdav"
    private val authorization = "Basic " + Base64.encodeToString("${config.username}:$password".toByteArray(), Base64.NO_WRAP)

    override fun test(): String { ensureFolder(); listObjects(); return "Koofr WebDAV 连接成功" }

    override fun listObjects(): List<NativeCloudObject> {
        return listOf("", "objects", "snapshots").flatMap(::listFolder)
    }

    private fun listFolder(directory: String): List<NativeCloudObject> {
        val request = request(if (directory.isBlank()) folderUrl() else objectUrl(directory)).header("Depth", "1").method("PROPFIND", ByteArray(0).toRequestBody(null)).build()
        client.newCall(request).execute().use { response ->
            if (response.code != 207 && !response.isSuccessful) throw error("WebDAV 列表读取失败", response.code, response.body?.string())
            val body = response.body ?: throw IllegalStateException("WebDAV 列表响应为空")
            val folderName = if (directory.isBlank()) normalizeFolder(config.folder).substringAfterLast('/') else directory
            val results = mutableListOf<NativeCloudObject>()
            val parser = XmlPullParserFactory.newInstance().newPullParser().apply { setInput(body.byteStream(), "UTF-8") }
            var href = ""; var size = -1L; var modified = 0L; var event = parser.eventType
            while (event != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG) when (parser.name.substringAfter(':').lowercase()) {
                    "response" -> { href = ""; size = -1; modified = 0 }
                    "href" -> href = parser.nextText()
                    "getcontentlength" -> size = parser.nextText().trim().toLongOrNull() ?: -1
                    "getlastmodified" -> modified = runCatching { ZonedDateTime.parse(parser.nextText().trim(), DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() }.getOrDefault(0)
                } else if (event == XmlPullParser.END_TAG && parser.name.substringAfter(':').equals("response", true)) {
                    val name = Uri.decode(href.substringBefore('?').trimEnd('/').substringAfterLast('/'))
                    if (name.isNotBlank() && name != folderName && size >= 0) {
                        val locator = if (directory.isBlank()) name else "$directory/$name"
                        results += NativeCloudObject(locator, locator, size, modified)
                    }
                }
                event = parser.next()
            }
            return results
        }
    }

    override fun upload(name: String, file: File, contentType: String): NativeCloudObject {
        ensureFolder()
        val objectKey = when {
            name.contains('/') -> name
            name.startsWith("srl-chunk--sha256-") -> "objects/$name"
            name.endsWith(".srlmanifest.v3.json.gz", true) || name.endsWith(".srlmanifest.v3.json", true) -> "snapshots/$name"
            else -> name
        }
        var lastError: Exception? = null
        repeat(3) { attempt ->
            try {
                val request = request(objectUrl(objectKey)).put(file.asRequestBody(contentType.toMediaType())).build()
                client.newCall(request).execute().use { response -> if (!response.isSuccessful) throw error("WebDAV 上传失败", response.code, response.body?.string()) }
                if (!confirmSize(objectKey, file.length())) throw IllegalStateException("Koofr 已接收上传，但远端大小确认失败")
                return NativeCloudObject(objectKey, objectKey, file.length(), System.currentTimeMillis())
            } catch (error: Exception) {
                lastError = error
                if (attempt < 2) sleeper((attempt + 1) * 800L)
            }
        }
        throw IllegalStateException("Koofr 对象连续 3 次上传或校验失败；未提交快照清单", lastError)
    }

    override fun download(name: String, destination: File): File {
        client.newCall(request(objectUrl(name)).get().build()).execute().use { response ->
            if (!response.isSuccessful) throw error("WebDAV 下载失败", response.code, response.body?.string())
            val body = response.body ?: throw IllegalStateException("WebDAV 下载响应为空")
            body.byteStream().buffered(128 * 1024).use { input -> FileOutputStream(destination).buffered(128 * 1024).use { input.copyTo(it, 128 * 1024) } }
        }
        return destination
    }

    override fun delete(name: String) {
        client.newCall(request(objectUrl(name)).delete().build()).execute().use { response ->
            if (response.code != 404 && !response.isSuccessful) throw error("WebDAV 删除失败", response.code, response.body?.string())
        }
    }

    private fun ensureFolder() {
        for (url in listOf(folderUrl(), objectUrl("objects"), objectUrl("snapshots"))) {
            client.newCall(request(url).method("MKCOL", null).build()).execute().use { response ->
                if (!response.isSuccessful && response.code != 405) throw error("WebDAV 备份目录创建失败", response.code, response.body?.string())
            }
        }
    }

    private fun confirmSize(name: String, expected: Long): Boolean {
        client.newCall(request(objectUrl(name)).header("Range", "bytes=0-0").get().build()).execute().use { response ->
            if (response.code == 206 && response.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull() == expected) return true
        }
        client.newCall(request(objectUrl(name)).head().build()).execute().use { response -> if (response.isSuccessful && response.header("Content-Length")?.toLongOrNull() == expected) return true }
        return listObjects().any { it.name == name && it.size == expected }
    }

    private fun request(url: String): Request.Builder = Request.Builder().url(url).header("Authorization", authorization).header("User-Agent", "SRL-Native-Android/0.0.5")
    private fun folderUrl(): String = config.baseUrl.trimEnd('/') + "/" + normalizeFolder(config.folder).split('/').joinToString("/") { Uri.encode(it) }
    private fun objectUrl(name: String): String = folderUrl() + "/" + name.split('/').filter(String::isNotBlank).joinToString("/") { Uri.encode(it) }
    private fun normalizeFolder(value: String) = value.trim().trim('/').ifBlank { "SRL-Backups" }
    private fun error(prefix: String, status: Int, detail: String?) = NativeCloudHttpException(status, "$prefix（$status）${detail?.take(600)?.takeIf(String::isNotBlank)?.let { "：$it" } ?: ""}")

    companion object {
        private fun defaultClient() = OkHttpClient.Builder().connectTimeout(45, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.MINUTES).writeTimeout(10, TimeUnit.MINUTES).build()
    }
}
