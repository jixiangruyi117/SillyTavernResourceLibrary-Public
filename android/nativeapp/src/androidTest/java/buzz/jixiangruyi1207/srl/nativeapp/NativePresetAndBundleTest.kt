package buzz.jixiangruyi1207.srl.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResourceBundle
import buzz.jixiangruyi1207.srl.nativeapp.preset.NativePresetStitchService
import buzz.jixiangruyi1207.srl.nativeapp.preset.NativeStitchRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativePresetAndBundleTest {
    @Test
    fun stitchesPresetWithoutDroppingUnknownFieldsAndResolvesIds() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        NativeResourceStore(context).use { store ->
            val base = store.importGeneratedJson("base-$seed.json", presetJson("主预设-$seed", "shared", "主段", "主正文", true))
            val source = store.importGeneratedJson("source-$seed.json", presetJson("来源-$seed", "shared", "来源段", "{{if ok}}来源正文{{/if}}", false))
            val service = NativePresetStitchService(store)
            val picked = service.listSegments(source.id).single { !it.marker }
            val result = service.stitch(NativeStitchRequest(base.id, listOf(picked), listOf(source.id), "成品-$seed"))
            val output = JSONObject(store.readResourceText(result.id))
            assertEquals("保留未知字段", output.getString("future_root"))
            assertEquals("成品-$seed", output.getString("name"))
            val prompts = output.getJSONArray("prompts")
            assertEquals(2, prompts.length())
            val appendedId = prompts.getJSONObject(1).getString("identifier")
            assertTrue("冲突提示词 ID 必须换新", appendedId != "shared")
            val groups = output.getJSONArray("prompt_order")
            assertTrue(groups.getJSONObject(0).getJSONArray("order").let { order ->
                (0 until order.length()).map { order.getJSONObject(it).getString("identifier") }.contains(appendedId)
            })
            assertTrue("其他 character 组私有顺序必须保留", groups.getJSONObject(1).getJSONArray("order").let { order ->
                (0 until order.length()).map { order.getJSONObject(it).getString("identifier") }.contains("private-only")
            })
            val regex = output.getJSONObject("extensions").getJSONArray("regex_scripts")
            assertEquals(2, regex.length())
            assertTrue(regex.getJSONObject(0).getString("id") != regex.getJSONObject(1).getString("id"))
            val annotated = store.loadResources().single { it.id == result.id }
            assertTrue(JSONObject(annotated.metadataJson).getJSONArray("stitchedFrom").length() == 2)
            assertEquals(setOf(base.id, source.id), annotated.relatedResourceIds.toSet())
        }
    }

    @Test
    fun rejectsBrokenMacroBeforeWritingStitchedPreset() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        NativeResourceStore(context).use { store ->
            val base = store.importGeneratedJson("macro-base-$seed.json", presetJson("主-$seed", "base-$seed", "主段", "正常", true))
            val source = store.importGeneratedJson("macro-source-$seed.json", presetJson("来源-$seed", "source-$seed", "坏段", "{{if test}}没有关闭", false))
            val service = NativePresetStitchService(store)
            val before = store.loadResources().size
            val failure = runCatching { service.stitch(NativeStitchRequest(base.id, listOf(service.listSegments(source.id).first()), emptyList(), "坏输出-$seed")) }.exceptionOrNull()
            assertTrue(failure?.message?.contains("条件块没有关闭") == true)
            assertEquals(before, store.loadResources().size)
        }
    }

    @Test
    fun persistsBundleInPortableDataAndLinksBothDirections() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        var bundleId = ""
        var firstId = ""
        var secondId = ""
        NativeResourceStore(context).use { store ->
            firstId = store.importGeneratedJson("bundle-a-$seed.json", presetJson("套装甲-$seed", "a-$seed", "甲", "甲", true)).id
            secondId = store.importGeneratedJson("bundle-b-$seed.json", presetJson("套装乙-$seed", "b-$seed", "乙", "乙", true)).id
            val now = System.currentTimeMillis()
            val saved = store.saveResourceBundle(NativeResourceBundle("", "测试套装-$seed", firstId, listOf(secondId), now, now))
            bundleId = saved.id
            val resources = store.loadResources().associateBy { it.id }
            assertTrue(secondId in resources.getValue(firstId).relatedResourceIds)
            assertTrue(firstId in resources.getValue(secondId).relatedResourceIds)
            assertTrue(JSONObject(store.portableDataJson()).getJSONArray("resourceBundles").length() >= 1)
        }
        NativeResourceStore(context).use { reopened ->
            val loaded = reopened.loadResourceBundles().single { it.id == bundleId }
            assertEquals(firstId, loaded.primaryResourceId)
            assertEquals(listOf(secondId), loaded.resourceIds)
            reopened.deleteResourceBundle(bundleId)
            assertTrue(reopened.loadResourceBundles().none { it.id == bundleId })
            assertTrue("删除套装记录不应静默删除既有资源关联", secondId in reopened.loadResources().single { it.id == firstId }.relatedResourceIds)
        }
    }

    private fun presetJson(name: String, promptId: String, promptName: String, content: String, base: Boolean): String {
        val prompt = JSONObject().put("identifier", promptId).put("name", promptName).put("role", "system").put("content", content)
        val primaryOrder = JSONArray().put(JSONObject().put("identifier", promptId).put("enabled", true))
        val secondaryOrder = JSONArray().put(JSONObject().put("identifier", promptId).put("enabled", true))
            .put(JSONObject().put("identifier", "private-only").put("enabled", false))
        val regexId = if (base) "regex-shared" else "regex-shared"
        return JSONObject().put("name", name).put("future_root", "保留未知字段")
            .put("prompts", JSONArray().put(prompt))
            .put("prompt_order", JSONArray()
                .put(JSONObject().put("character_id", 100001).put("order", primaryOrder))
                .put(JSONObject().put("character_id", 100002).put("order", secondaryOrder)))
            .put("extensions", JSONObject().put("regex_scripts", JSONArray().put(JSONObject().put("id", regexId).put("scriptName", "正则-$name"))))
            .toString(2)
    }
}
