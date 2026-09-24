package buzz.jixiangruyi1207.srl.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import buzz.jixiangruyi1207.srl.nativeapp.tavern.NativeTavernBridgeService
import buzz.jixiangruyi1207.srl.nativeapp.tavern.NativeTavernResourceItem
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class NativeTavernBridgeTest {
    @Test
    fun receivesOutOfOrderRelayChunksIntoFileAndVerifiesShaBeforeReturning() {
        val server = MockWebServer()
        val queue = ConcurrentLinkedQueue<JSONObject>()
        val bytes = ByteArray(NativeTavernBridgeService.CHUNK_SIZE + 117) { (it % 239).toByte() }
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val requestIdRef = arrayOf("")
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = request.body.readUtf8().takeIf(String::isNotBlank)?.let(::JSONObject) ?: JSONObject()
                return when (request.path) {
                    "/api/bridge/join" -> MockResponse().setResponseCode(200).setBody(
                        JSONObject().put("pairCode", "654321").put("participantToken", "participant-token")
                            .put("relayBase", "/api/bridge/").toString(),
                    )
                    "/api/bridge/messages" -> {
                        val message = body.optJSONObject("message") ?: JSONObject()
                        when (message.optString("type")) {
                            "srl-accept" -> queue += envelope("st-ready", JSONObject().put("bridgeVersion", "0.3.0").put("capabilities", JSONArray()))
                            "pull-request" -> {
                                val requestId = message.getString("requestId")
                                requestIdRef[0] = requestId
                                val transferId = "transfer-pull"
                                queue += envelope("file-start", JSONObject().put("requestId", requestId).put("transferId", transferId)
                                    .put("direction", "to-srl").put("name", "pulled.json").put("mimeType", "application/json")
                                    .put("size", bytes.size).put("sha256", hash))
                                queue += chunkEnvelope(requestId, transferId, 1, bytes.copyOfRange(NativeTavernBridgeService.CHUNK_SIZE, bytes.size))
                                queue += chunkEnvelope(requestId, transferId, 0, bytes.copyOfRange(0, NativeTavernBridgeService.CHUNK_SIZE))
                                queue += envelope("file-end", JSONObject().put("requestId", requestId).put("transferId", transferId))
                                queue += envelope("pull-complete", JSONObject().put("requestId", requestId))
                            }
                        }
                        MockResponse().setResponseCode(204)
                    }
                    "/api/bridge/poll" -> {
                        Thread.sleep(20)
                        val batch = JSONArray()
                        while (true) batch.put(queue.poll() ?: break)
                        MockResponse().setResponseCode(200).setBody(JSONObject().put("messages", batch).toString())
                    }
                    "/api/bridge/close" -> MockResponse().setResponseCode(204)
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        NativeTavernBridgeService(context, server.url("/").toString()).use { bridge ->
            bridge.join("CD34EF56").get(5, TimeUnit.SECONDS)
            bridge.accept().get(5, TimeUnit.SECONDS)
            waitUntil(5_000) { bridge.state.status == "connected" }
            val item = NativeTavernResourceItem("remote-1", "preset", "远端预设", "pulled.json", "")
            val files = bridge.pullResources(listOf(item)).get(15, TimeUnit.SECONDS)
            assertTrue(requestIdRef[0].isNotBlank())
            assertTrue(files.single().readBytes().contentEquals(bytes))
            files.forEach(File::delete)
        }
        server.shutdown()
    }

    @Test
    fun secureRelayKeepsControlOrderAndUsesBoundedAckWindowForFileChunks() {
        val server = MockWebServer()
        val messages = ConcurrentLinkedQueue<JSONObject>()
        val observedTypes = ConcurrentLinkedQueue<String>()
        val activeChunks = AtomicInteger(0)
        val maxActiveChunks = AtomicInteger(0)
        val chunkCount = AtomicInteger(0)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = request.body.readUtf8().takeIf(String::isNotBlank)?.let(::JSONObject) ?: JSONObject()
                return when (request.path) {
                    "/api/bridge/join" -> MockResponse().setResponseCode(200).setBody(
                        JSONObject().put("pairCode", "123456").put("participantToken", "participant-token")
                            .put("relayBase", "/api/bridge/").toString(),
                    )
                    "/api/bridge/messages" -> {
                        val message = body.optJSONObject("message") ?: JSONObject()
                        val type = message.optString("type")
                        observedTypes += type
                        when (type) {
                            "srl-accept" -> messages += envelope("st-ready", JSONObject().put("bridgeVersion", "0.3.0").put("capabilities", JSONArray()))
                            "file-chunk" -> {
                                val active = activeChunks.incrementAndGet()
                                maxActiveChunks.accumulateAndGet(active, ::maxOf)
                                Thread.sleep(60)
                                chunkCount.incrementAndGet()
                                activeChunks.decrementAndGet()
                                messages += envelope("file-chunk-ack", JSONObject().put("transferId", message.getString("transferId")).put("index", message.getInt("index")))
                            }
                            "file-end" -> messages += envelope("file-result", JSONObject().put("transferId", message.getString("transferId"))
                                .put("result", JSONObject().put("name", "测试资源").put("status", "完成")))
                        }
                        MockResponse().setResponseCode(204)
                    }
                    "/api/bridge/poll" -> {
                        Thread.sleep(20)
                        val batch = JSONArray()
                        while (true) batch.put(messages.poll() ?: break)
                        MockResponse().setResponseCode(200).setBody(JSONObject().put("messages", batch).toString())
                    }
                    "/api/bridge/close" -> MockResponse().setResponseCode(204)
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(context.cacheDir, "bridge-${UUID.randomUUID()}.json").apply {
            writeBytes(ByteArray(NativeTavernBridgeService.CHUNK_SIZE * 9 + 31) { (it % 251).toByte() })
        }
        val hash = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }
        val resource = NativeResource(
            UUID.randomUUID().toString(), "preset", "测试资源", "", file.name, "application/json", file.length(), hash,
            false, emptyList(), emptyList(), null, "", "", 0, "{}", file.absolutePath, System.currentTimeMillis(), System.currentTimeMillis(),
        )
        NativeTavernBridgeService(context, server.url("/").toString()).use { bridge ->
            bridge.join("AB23CD45").get(5, TimeUnit.SECONDS)
            assertTrue(bridge.state.status == "pairing" && bridge.state.pairCode == "123456")
            bridge.accept().get(5, TimeUnit.SECONDS)
            waitUntil(5_000) { bridge.state.status == "connected" }
            val result = bridge.sendResources(listOf(resource), "copy").get(30, TimeUnit.SECONDS)
            assertTrue(result.single().contains("完成"))
            assertTrue(chunkCount.get() == 10)
            assertTrue("文件块必须并发但不能超过协议上限", maxActiveChunks.get() in 2..8)
            val order = observedTypes.toList()
            assertTrue(order.indexOf("file-start") in 0 until order.indexOf("file-chunk"))
            assertTrue(order.lastIndexOf("file-end") > order.lastIndexOf("file-chunk"))
        }
        file.delete()
        server.shutdown()
    }

    private fun envelope(type: String, payload: JSONObject): JSONObject {
        val value = JSONObject().put("protocol", NativeTavernBridgeService.PROTOCOL).put("version", NativeTavernBridgeService.VERSION).put("type", type)
        payload.keys().forEach { value.put(it, payload.get(it)) }
        return value
    }

    private fun chunkEnvelope(requestId: String, transferId: String, index: Int, bytes: ByteArray): JSONObject =
        envelope("file-chunk", JSONObject().put("requestId", requestId).put("transferId", transferId).put("index", index)
            .put("data", JSONObject().put("__srlBuffer", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))))

    private fun waitUntil(timeoutMs: Long, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!condition() && System.currentTimeMillis() < deadline) Thread.sleep(25)
        assertTrue("等待中继状态超时", condition())
    }
}
