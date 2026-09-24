package buzz.jixiangruyi1207.srl.nativeapp

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import buzz.jixiangruyi1207.srl.nativeapp.cloud.NativeSecretStore
import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import buzz.jixiangruyi1207.srl.nativeapp.tagging.NativeAiConfig
import buzz.jixiangruyi1207.srl.nativeapp.tagging.NativeAiTaggingService
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeAiTaggingTest {
    @Test
    fun keepsSuggestionAsDraftThenAppliesAndPreciselyUndoesOnlyNewTags() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        val file = File(context.cacheDir, "ai-$seed.json").apply {
            writeText("""{"name":"测试角色","description":"她生活在现代都市，明确喜欢女性。","personality":"温柔","scenario":"都市","first_mes":"你好","mes_example":"示例","tags":["现代"]}""")
        }
        MockWebServer().use { server ->
            server.start()
            NativeResourceStore(context).use { store ->
                val report = store.importUris(listOf(Uri.fromFile(file)))
                val resource = store.loadResources().firstOrNull { it.fileName == file.name }
                    ?: error("${report.summary()}；现有文件：${store.loadResources().joinToString { it.fileName }}")
                store.writePortableSection("aiTaggingState", JSONObject().put("futureState", "保留"))
                val service = NativeAiTaggingService(store, NativeSecretStore(context))
                service.saveConfig(NativeAiConfig(url = server.url("/v1").toString(), model = "test-model"), "top-secret-$seed")
                server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(
                    """{"choices":[{"message":{"content":"{\"resources\":[{\"resourceId\":\"${resource.id}\",\"tags\":[{\"name\":\"现代\",\"evidence\":\"已有\",\"level\":\"explicit\"},{\"name\":\"百合\",\"evidence\":\"明确喜欢女性\",\"level\":\"明确证据\"}]}]}"}}],"usage":{"prompt_tokens":120,"completion_tokens":30}}""",
                ))

                val result = service.recognize(listOf(resource.id), 4, "", "story-resource", true)
                assertEquals(listOf("GL"), result.draft.reviewItems.single().tags.map { it.name })
                assertEquals(listOf("现代"), store.loadResources().single { it.id == resource.id }.tags)
                assertEquals("保留", JSONObject(store.portableDataJson()).getJSONObject("aiTaggingState").getString("futureState"))
                val request = server.takeRequest()
                assertTrue(request.path?.endsWith("/v1/chat/completions") == true)
                assertEquals("Bearer top-secret-$seed", request.getHeader("Authorization"))
                val storedSecrets = context.getSharedPreferences("srl-native-cloud-secrets", 0).all.values.map { it.toString() }
                assertFalse(storedSecrets.any { it.contains("top-secret-$seed") })

                val additions = service.applyReviewed(result.draft.reviewItems)
                assertEquals(listOf("GL"), additions.single().tags)
                assertEquals(listOf("现代", "GL"), store.loadResources().single { it.id == resource.id }.tags)
                assertTrue(service.load().draft == null)
                assertEquals(1, service.load().undo.size)
                val undone = service.undoLast()
                assertEquals(1, undone.resourceCount)
                assertEquals(1, undone.tagCount)
                assertEquals(listOf("现代"), store.loadResources().single { it.id == resource.id }.tags)
            }
        }
        file.delete()
    }

    @Test
    fun retainsFailuresAndCanRetryOnlyFailedResources() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        val file = File(context.cacheDir, "retry-$seed.json").apply { writeText("""{"story":"校园双人剧情-$seed"}""") }
        MockWebServer().use { server ->
            server.start()
            NativeResourceStore(context).use { store ->
                val report = store.importUris(listOf(Uri.fromFile(file)))
                val resource = store.loadResources().firstOrNull { it.fileName == file.name }
                    ?: error("${report.summary()}；现有文件：${store.loadResources().joinToString { it.fileName }}")
                val service = NativeAiTaggingService(store, NativeSecretStore(context))
                service.saveConfig(NativeAiConfig(url = server.url("/v1").toString(), model = "test-model"), null)
                server.enqueue(MockResponse().setBody("""{"choices":[{"message":{"content":"{\"resources\":[]}"}}]}"""))
                val failed = service.recognize(listOf(resource.id), 1, "", "free", false)
                assertTrue(failed.draft.reviewItems.isEmpty())
                assertEquals(listOf(resource.id), failed.draft.failures.single().resourceIds)

                server.enqueue(MockResponse().setBody(
                    """{"choices":[{"message":{"content":"{\"resources\":[{\"resourceId\":\"${resource.id}\",\"tags\":[{\"name\":\"校园\",\"evidence\":\"正文\",\"level\":\"explicit\"}]}]}"}}]}""",
                ))
                val retried = service.recognize(listOf(resource.id), 1, "", "free", false, preserveExisting = true)
                assertTrue(retried.draft.failures.isEmpty())
                assertEquals("校园", retried.draft.reviewItems.single().tags.single().name)
                assertTrue(store.loadResources().single { it.id == resource.id }.tags.isEmpty())
            }
        }
        file.delete()
    }
}
