package buzz.jixiangruyi1207.srl.nativeapp.tavern

import android.content.Context
import android.util.Base64
import buzz.jixiangruyi1207.srl.nativeapp.BuildConfig
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

data class NativeTavernBridgeState(
    val status: String = "idle",
    val detail: String = "输入酒馆扩展生成的 8 位设备码",
    val pairCode: String = "",
    val bridgeVersion: String = "",
)

data class NativeTavernResourceItem(
    val id: String,
    val kind: String,
    val name: String,
    val fileName: String,
    val detail: String,
)

/**
 * 纯原生 HTTPS 设备码中继。
 *
 * 控制消息严格串行；只有已经带 index/ACK 回压的 file-chunk 使用独立请求，
 * 窗口按 ACK 耗时在 2..8 之间调整，避免再次落回逐块串行，也不引入无界并发。
 */
class NativeTavernBridgeService(
    context: Context,
    private val serviceOrigin: String = BuildConfig.SRL_BRIDGE_ORIGIN,
    client: OkHttpClient? = null,
) : AutoCloseable {
    companion object {
        const val PROTOCOL = "srl-tavern-bridge"
        const val VERSION = 2
        const val CHUNK_SIZE = 256 * 1024
        const val MAX_FILE_SIZE = 256L * 1024 * 1024
        private const val MIN_WINDOW = 2
        private const val DEFAULT_WINDOW = 4
        private const val MAX_WINDOW = 8
    }

    private val appContext = context.applicationContext
    private val http = client ?: OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS)
        .writeTimeout(90, TimeUnit.SECONDS)
        .callTimeout(100, TimeUnit.SECONDS)
        .build()
    private val controlExecutor = Executors.newSingleThreadExecutor()
    private val transferExecutor = Executors.newSingleThreadExecutor()
    private val pollExecutor = Executors.newSingleThreadExecutor()
    private val chunkExecutor = Executors.newFixedThreadPool(MAX_WINDOW)
    private val closed = AtomicBoolean(false)
    private val connected = AtomicBoolean(false)
    private var code = ""
    private var token = ""
    private var relayBase = ""
    private var peerCapabilities = emptySet<String>()
    private val pendingLists = ConcurrentHashMap<String, CompletableFuture<List<NativeTavernResourceItem>>>()
    private val pendingPulls = ConcurrentHashMap<String, PendingPull>()
    private val pendingSends = ConcurrentHashMap<String, CompletableFuture<String>>()
    private val incoming = ConcurrentHashMap<String, IncomingTransfer>()
    private val chunkAcks = ConcurrentHashMap<String, CompletableFuture<Unit>>()

    @Volatile
    var state: NativeTavernBridgeState = NativeTavernBridgeState()
        private set

    var onStateChanged: ((NativeTavernBridgeState) -> Unit)? = null
    var onProgress: ((String) -> Unit)? = null

    fun join(codeValue: String): CompletableFuture<Unit> {
        val normalized = codeValue.trim().uppercase()
        require(Regex("^[2-9A-HJ-NP-Z]{8}$").matches(normalized)) { "设备码格式无效" }
        require(serviceOrigin.startsWith("https://")) {
            "尚未配置自建 Cloudflare Worker 地址；请用 -PsrlBridgeOrigin=https://你的-worker.workers.dev 构建 Android 应用"
        }
        disconnectInternal("正在连接 HTTPS 安全中继", notify = false)
        setState("joining", "正在连接 HTTPS 安全中继")
        return submitControl {
            val endpoint = resolveUrl("api/bridge/join", serviceOrigin)
            val response = executeJson(endpoint, JSONObject().put("code", normalized))
            val pairCode = response.optString("pairCode")
            val participantToken = response.optString("participantToken")
            val returnedBase = response.optString("relayBase")
            require(Regex("^\\d{6}$").matches(pairCode)) { "HTTPS 中继返回的配对码无效" }
            require(participantToken.isNotBlank() && returnedBase.isNotBlank()) { "HTTPS 中继返回的数据不完整" }
            val resolvedBase = resolveUrl(returnedBase, serviceOrigin)
            val expectedOrigin = serviceOrigin.toHttpUrl()
            val actualOrigin = resolvedBase.toHttpUrl()
            require(expectedOrigin.scheme == actualOrigin.scheme && expectedOrigin.host == actualOrigin.host && expectedOrigin.port == actualOrigin.port) {
                "HTTPS 中继地址来源不一致"
            }
            code = normalized
            token = participantToken
            relayBase = if (resolvedBase.endsWith('/')) resolvedBase else "$resolvedBase/"
            setState("pairing", "请核对酒馆扩展中显示的六位数字", pairCode = pairCode)
            startPolling()
        }
    }

    fun accept(): CompletableFuture<Unit> {
        require(state.status == "pairing") { "酒馆通信通道尚未准备好" }
        return sendControl("srl-accept", JSONObject().put("pairCode", state.pairCode).put("capabilities", JSONArray()))
    }

    fun listResources(): CompletableFuture<List<NativeTavernResourceItem>> {
        assertConnected()
        val requestId = UUID.randomUUID().toString()
        val result = CompletableFuture<List<NativeTavernResourceItem>>()
        pendingLists[requestId] = result
        sendControl("list-request", JSONObject().put("requestId", requestId)).whenComplete { _, error ->
            if (error != null) pendingLists.remove(requestId)?.completeExceptionally(error)
        }
        return withTimeout(result, 35, "读取酒馆资源超时").whenComplete { _, _ -> pendingLists.remove(requestId) }
    }

    fun pullResources(items: List<NativeTavernResourceItem>): CompletableFuture<List<File>> {
        assertConnected()
        require(items.isNotEmpty()) { "请先选择要接收的酒馆资源" }
        val requestId = UUID.randomUUID().toString()
        val result = CompletableFuture<List<File>>()
        pendingPulls[requestId] = PendingPull(CopyOnWriteArrayList(), result)
        val requested = JSONArray(items.map { JSONObject().put("id", it.id) })
        sendControl("pull-request", JSONObject().put("requestId", requestId).put("items", requested)).whenComplete { _, error ->
            if (error != null) pendingPulls.remove(requestId)?.future?.completeExceptionally(error)
        }
        return withTimeout(result, 180, "从酒馆接收资源超时").whenComplete { _, _ -> pendingPulls.remove(requestId) }
    }

    fun sendResources(resources: List<NativeResource>, conflictPolicy: String): CompletableFuture<List<String>> {
        assertConnected()
        require(resources.isNotEmpty()) { "请先选择要发送的本机资源" }
        require(conflictPolicy in setOf("copy", "overwrite", "skip")) { "冲突策略无效" }
        return CompletableFuture.supplyAsync({
            val requestId = UUID.randomUUID().toString()
            resources.mapIndexed { fileIndex, resource ->
                val file = File(resource.localPath)
                require(file.isFile) { "${resource.fileName} 的本机原文件不存在" }
                require(file.length() <= MAX_FILE_SIZE) { "${resource.fileName} 超过单文件 256 MB 限制" }
                val transferId = UUID.randomUUID().toString()
                val result = CompletableFuture<String>()
                pendingSends[transferId] = result
                val start = JSONObject()
                    .put("requestId", requestId)
                    .put("transferId", transferId)
                    .put("direction", "to-tavern")
                    .put("name", resource.fileName)
                    .put("displayName", resource.name)
                    .put("mimeType", resource.mimeType)
                    .put("kind", resource.bridgeKind())
                    .put("conflictPolicy", conflictPolicy)
                    .put("size", file.length())
                    .put("sha256", sha256(file))
                sendControl("file-start", start).get(100, TimeUnit.SECONDS)
                onProgress?.invoke("正在上传 ${resource.name} · 0 / ${file.length()} bytes")
                sendFileChunks(file, requestId, transferId) { uploaded ->
                    onProgress?.invoke("正在上传 ${resource.name} · $uploaded / ${file.length()} bytes")
                }
                sendControl("file-end", JSONObject().put("requestId", requestId).put("transferId", transferId)).get(100, TimeUnit.SECONDS)
                onProgress?.invoke("等待酒馆导入 ${resource.name}（${fileIndex + 1}/${resources.size}）")
                try {
                    withTimeout(result, 100, "${resource.fileName} 导入酒馆超时").get(105, TimeUnit.SECONDS)
                } finally {
                    pendingSends.remove(transferId)
                }
            }
        }, transferExecutor)
    }

    fun disconnect(detail: String = "连接已断开") {
        val currentCode = code
        val currentToken = token
        val currentBase = relayBase
        disconnectInternal(detail, notify = true)
        if (currentCode.isNotBlank() && currentToken.isNotBlank() && currentBase.isNotBlank() && !closed.get()) {
            controlExecutor.execute {
                runCatching { executeJson(resolveUrl("close", currentBase), sessionBody(currentCode, currentToken)) }
            }
        }
    }

    private fun startPolling() {
        pollExecutor.execute {
            while (!closed.get() && code.isNotBlank() && token.isNotBlank()) {
                try {
                    val result = executeJson(resolveUrl("poll", relayBase), sessionBody())
                    val messages = result.optJSONArray("messages") ?: JSONArray()
                    for (index in 0 until messages.length()) {
                        val message = messages.optJSONObject(index) ?: continue
                        handleMessage(message)
                    }
                } catch (error: Exception) {
                    if (!closed.get() && code.isNotBlank()) {
                        disconnectInternal(error.cause?.message ?: error.message ?: "设备码中继已断开", notify = true)
                    }
                }
            }
        }
    }

    private fun handleMessage(message: JSONObject) {
        if (message.optString("protocol") != PROTOCOL || message.optInt("version") != VERSION) return
        val type = message.optString("type")
        val requestId = message.optString("requestId")
        val transferId = message.optString("transferId")
        when (type) {
            "st-ready" -> {
                peerCapabilities = message.optJSONArray("capabilities")?.stringSet().orEmpty()
                connected.set(true)
                setState("connected", "已连接酒馆页面扩展 ${message.optString("bridgeVersion")}，可以双向传输", bridgeVersion = message.optString("bridgeVersion"))
            }
            "list-response" -> {
                val items = message.optJSONArray("items") ?: JSONArray()
                val parsed = (0 until items.length()).mapNotNull { index ->
                    items.optJSONObject(index)?.let {
                        NativeTavernResourceItem(it.optString("id"), it.optString("kind"), it.optString("name"), it.optString("fileName"), it.optString("detail"))
                    }?.takeIf { it.id.isNotBlank() }
                }
                pendingLists.remove(requestId)?.complete(parsed)
            }
            "file-start" -> if (message.optString("direction") == "to-srl") beginIncoming(message)
            "file-chunk" -> receiveChunk(message)
            "file-chunk-ack" -> chunkAcks.remove("$transferId:${message.optInt("index", -1)}")?.complete(Unit)
            "file-end" -> finishIncoming(requestId, transferId)
            "pull-complete" -> pendingPulls.remove(requestId)?.let { it.future.complete(it.files.toList()) }
            "file-result" -> {
                val result = message.optJSONObject("result")
                pendingSends.remove(transferId)?.complete("${result?.optString("name").orEmpty().ifBlank { "资源" }}：${result?.optString("status").orEmpty().ifBlank { "完成" }}")
            }
            "operation-error" -> {
                val error = IllegalStateException(message.optString("error", "酒馆操作失败"))
                if (transferId.isNotBlank()) pendingSends.remove(transferId)?.completeExceptionally(error)
                else if (requestId.isNotBlank()) {
                    pendingPulls.remove(requestId)?.future?.completeExceptionally(error)
                    pendingLists.remove(requestId)?.completeExceptionally(error)
                }
            }
            "disconnect" -> disconnectInternal("酒馆扩展已断开", notify = true)
        }
    }

    private fun beginIncoming(message: JSONObject) {
        val transferId = message.optString("transferId")
        val size = message.optLong("size", -1)
        require(transferId.isNotBlank() && size in 0..MAX_FILE_SIZE) { "酒馆发送的文件大小无效" }
        val directory = File(appContext.cacheDir, "tavern-bridge").apply { mkdirs() }
        val file = File(directory, "$transferId.part")
        incoming.remove(transferId)?.closeAndDelete()
        incoming[transferId] = IncomingTransfer(message, file, RandomAccessFile(file, "rw"), ConcurrentHashMap.newKeySet(), AtomicLong(0))
    }

    private fun receiveChunk(message: JSONObject) {
        val transferId = message.optString("transferId")
        val index = message.optInt("index", -1)
        val encoded = message.optJSONObject("data")?.optString("__srlBuffer").orEmpty()
        val bytes = Base64.decode(encoded, Base64.DEFAULT)
        val transfer = incoming[transferId] ?: return
        require(index >= 0 && bytes.size <= CHUNK_SIZE) { "酒馆发送了无效文件分块" }
        synchronized(transfer) {
            if (transfer.indices.add(index)) {
                transfer.output.seek(index.toLong() * CHUNK_SIZE)
                transfer.output.write(bytes)
                require(transfer.received.addAndGet(bytes.size.toLong()) <= transfer.meta.optLong("size")) { "接收数据超过声明大小" }
            }
        }
        sendControl("file-chunk-ack", JSONObject().put("transferId", transferId).put("index", index)).get(100, TimeUnit.SECONDS)
    }

    private fun finishIncoming(requestId: String, transferId: String) {
        val transfer = incoming.remove(transferId) ?: return
        transfer.output.fd.sync()
        transfer.output.close()
        val expectedSize = transfer.meta.optLong("size")
        require(transfer.received.get() == expectedSize && transfer.file.length() == expectedSize) { "${transfer.meta.optString("name")} 完整性校验失败" }
        require(sha256(transfer.file).equals(transfer.meta.optString("sha256"), ignoreCase = true)) { "${transfer.meta.optString("name")} SHA-256 校验失败" }
        val safeName = File(transfer.meta.optString("name", "resource.bin")).name.ifBlank { "resource.bin" }
        val complete = File(transfer.file.parentFile, "${UUID.randomUUID()}-$safeName")
        require(transfer.file.renameTo(complete)) { "无法保存酒馆传入文件" }
        pendingPulls[requestId]?.files?.add(complete) ?: complete.delete()
    }

    private fun sendFileChunks(file: File, requestId: String, transferId: String, onAck: (Long) -> Unit) {
        val pending = mutableListOf<ChunkPending>()
        var window = DEFAULT_WINDOW
        var fastAckStreak = 0
        var offset = 0L
        var index = 0
        var uploaded = 0L
        FileInputStream(file).use { input ->
            while (offset < file.length()) {
                val buffer = ByteArray(min(CHUNK_SIZE.toLong(), file.length() - offset).toInt())
                var read = 0
                while (read < buffer.size) {
                    val count = input.read(buffer, read, buffer.size - read)
                    if (count < 0) throw IllegalStateException("读取本机资源时提前结束")
                    read += count
                }
                val sentAt = System.nanoTime()
                val future = sendChunkAndWait(requestId, transferId, index, buffer)
                pending += ChunkPending(future, sentAt, buffer.size)
                offset += buffer.size
                index += 1
                if (pending.size >= window) {
                    val completed = waitForAny(pending)
                    uploaded += completed.size
                    val elapsedMs = (System.nanoTime() - completed.sentAt) / 1_000_000
                    if (elapsedMs < 350 && window < MAX_WINDOW) {
                        fastAckStreak += 1
                        if (fastAckStreak >= window * 2) { window += 1; fastAckStreak = 0 }
                    } else {
                        fastAckStreak = 0
                        if (elapsedMs > 1_500 && window > MIN_WINDOW) window -= 1
                    }
                    onAck(min(uploaded, file.length()))
                }
            }
        }
        while (pending.isNotEmpty()) {
            val completed = waitForAny(pending)
            uploaded += completed.size
            onAck(min(uploaded, file.length()))
        }
    }

    private fun sendChunkAndWait(requestId: String, transferId: String, index: Int, data: ByteArray): CompletableFuture<Unit> {
        val ack = CompletableFuture<Unit>()
        val key = "$transferId:$index"
        chunkAcks[key] = ack
        val message = envelope("file-chunk", JSONObject().put("requestId", requestId).put("transferId", transferId).put("index", index)
            .put("data", JSONObject().put("__srlBuffer", Base64.encodeToString(data, Base64.NO_WRAP))))
        CompletableFuture.runAsync({
            try {
                executeJson(resolveUrl("messages", relayBase), sessionBody().put("message", message), allowEmpty = true)
            } catch (error: Exception) {
                chunkAcks.remove(key)?.completeExceptionally(error)
            }
        }, chunkExecutor)
        return withTimeout(ack, 90, "文件分块确认超时")
    }

    private fun waitForAny(pending: MutableList<ChunkPending>): ChunkPending {
        CompletableFuture.anyOf(*pending.map { it.future }.toTypedArray()).get(95, TimeUnit.SECONDS)
        val completed = pending.firstOrNull { it.future.isDone } ?: error("文件分块状态异常")
        completed.future.get(1, TimeUnit.SECONDS)
        pending.remove(completed)
        return completed
    }

    private fun sendControl(type: String, payload: JSONObject): CompletableFuture<Unit> = submitControl {
        executeJson(resolveUrl("messages", relayBase), sessionBody().put("message", envelope(type, payload)), allowEmpty = true)
    }

    private fun envelope(type: String, payload: JSONObject): JSONObject {
        val result = JSONObject().put("protocol", PROTOCOL).put("version", VERSION).put("type", type)
        payload.keys().forEach { key -> result.put(key, payload.get(key)) }
        return result
    }

    private fun sessionBody(sessionCode: String = code, sessionToken: String = token): JSONObject =
        JSONObject().put("code", sessionCode).put("token", sessionToken)

    private fun executeJson(url: String, body: JSONObject, allowEmpty: Boolean = false): JSONObject {
        val request = Request.Builder().url(url).post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType())).build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val detail = runCatching { JSONObject(text).optString("message").ifBlank { JSONObject(text).optString("error") } }.getOrDefault("")
                throw IllegalStateException(detail.ifBlank { "设备码中继请求失败（HTTP ${response.code}）" })
            }
            if (text.isBlank()) return if (allowEmpty) JSONObject() else JSONObject()
            return JSONObject(text)
        }
    }

    private fun resolveUrl(path: String, base: String): String = java.net.URI(base).resolve(path).toString()

    private fun <T> submitControl(block: () -> T): CompletableFuture<T> = CompletableFuture.supplyAsync({
        check(!closed.get()) { "设备码中继已经关闭" }
        block()
    }, controlExecutor)

    private fun <T> withTimeout(future: CompletableFuture<T>, seconds: Long, message: String): CompletableFuture<T> =
        future.orTimeout(seconds, TimeUnit.SECONDS).exceptionallyCompose { error ->
            CompletableFuture.failedFuture(if (error is java.util.concurrent.TimeoutException) IllegalStateException(message) else error)
        }

    private fun assertConnected() = require(connected.get() && state.status == "connected") { "请先完成酒馆配对" }

    private fun setState(status: String, detail: String, pairCode: String = state.pairCode, bridgeVersion: String = state.bridgeVersion) {
        state = NativeTavernBridgeState(status, detail, pairCode, bridgeVersion)
        onStateChanged?.invoke(state)
    }

    private fun disconnectInternal(detail: String, notify: Boolean) {
        connected.set(false)
        code = ""
        token = ""
        relayBase = ""
        peerCapabilities = emptySet()
        val error = IllegalStateException(detail)
        pendingLists.values.forEach { it.completeExceptionally(error) }
        pendingPulls.values.forEach { it.future.completeExceptionally(error); it.files.forEach(File::delete) }
        pendingSends.values.forEach { it.completeExceptionally(error) }
        incoming.values.forEach(IncomingTransfer::closeAndDelete)
        pendingLists.clear(); pendingPulls.clear(); pendingSends.clear(); incoming.clear(); chunkAcks.clear()
        if (notify) setState("idle", detail, pairCode = "", bridgeVersion = "")
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        disconnectInternal("连接已关闭", notify = false)
        controlExecutor.shutdownNow()
        transferExecutor.shutdownNow()
        pollExecutor.shutdownNow()
        chunkExecutor.shutdownNow()
    }

    private data class PendingPull(val files: CopyOnWriteArrayList<File>, val future: CompletableFuture<List<File>>)
    private data class ChunkPending(val future: CompletableFuture<Unit>, val sentAt: Long, val size: Int)
    private data class IncomingTransfer(
        val meta: JSONObject,
        val file: File,
        val output: RandomAccessFile,
        val indices: MutableSet<Int>,
        val received: AtomicLong,
    ) {
        fun closeAndDelete() { runCatching { output.close() }; file.delete() }
    }
}

private fun JSONArray.stringSet(): Set<String> = (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }.toSet()

private fun NativeResource.bridgeKind(): String = when (type) {
    "characterCard" -> "character"
    "worldBook" -> "worldBook"
    "preset" -> "preset"
    "regex" -> "regexGlobal"
    "quickReply" -> "quickReply"
    "beautification" -> "theme"
    "script" -> "scriptGlobal"
    "userPersona" -> "userPersona"
    else -> throw IllegalArgumentException("${name} 的类型暂不支持发送到酒馆")
}

private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
        val buffer = ByteArray(1024 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}
