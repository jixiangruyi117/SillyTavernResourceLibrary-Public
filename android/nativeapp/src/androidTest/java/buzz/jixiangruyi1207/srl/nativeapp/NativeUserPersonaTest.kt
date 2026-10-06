package buzz.jixiangruyi1207.srl.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import buzz.jixiangruyi1207.srl.nativeapp.persona.NativePersonaEntry
import buzz.jixiangruyi1207.srl.nativeapp.persona.NativeUserPersonaService
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeUserPersonaTest {
    @Test
    fun editsPersonaWithoutDroppingUnknownTavernFieldsAndKeepsVersion() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        val avatarId = "persona-$seed.png"
        val source = JSONObject()
            .put("personas", JSONObject().put(avatarId, "原名-$seed"))
            .put("persona_descriptions", JSONObject().put(avatarId, JSONObject()
                .put("description", "原描述")
                .put("position", 0)
                .put("depth", 2)
                .put("role", 0)
                .put("future_setting", JSONObject().put("enabled", true))))
            .put("default_persona", avatarId)
            .put("future_root", "必须保留")
        var resourceId = ""
        NativeResourceStore(context).use { store ->
            val resource = store.importGeneratedJson("persona-$seed.json", "${source.toString(2)}\n")
            resourceId = resource.id
            val service = NativeUserPersonaService(store)
            val before = service.load(resource.id).entries.single()
            service.save(resource.id, avatarId, before.copy(name = "新名-$seed", description = "新描述", title = "新标题"))
            val written = JSONObject(store.readResourceText(resource.id))
            assertEquals("必须保留", written.getString("future_root"))
            assertTrue(written.getJSONObject("persona_descriptions").getJSONObject(avatarId)
                .getJSONObject("future_setting").getBoolean("enabled"))
            assertEquals("新名-$seed", written.getJSONObject("personas").getString(avatarId))
            assertTrue("编辑前原文件必须进入历史版本", store.loadVersions(resource.id).isNotEmpty())
        }
        NativeResourceStore(context).use { reopened ->
            val loaded = NativeUserPersonaService(reopened).load(resourceId)
            assertEquals("新名-$seed", loaded.entries.single().name)
            assertEquals("新描述", loaded.entries.single().description)
        }
    }

    @Test
    fun createsAddsDefaultsAndRemovesPersonaWithRecoverableHistory() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        NativeResourceStore(context).use { store ->
            val service = NativeUserPersonaService(store)
            val first = entry("first-$seed.png", "第一人设")
            val resource = service.create(first)
            val second = entry("second-$seed.png", "第二人设")
            service.save(resource.id, null, second)
            service.setDefault(resource.id, second.avatarId)
            assertEquals(second.avatarId, service.load(resource.id).defaultPersona)
            service.remove(resource.id, second.avatarId)
            val final = service.load(resource.id)
            assertEquals(listOf(first.avatarId), final.entries.map { it.avatarId })
            assertEquals(first.avatarId, final.defaultPersona)
            assertTrue("每次内容修改都应形成历史版本", store.loadVersions(resource.id).size >= 3)
        }
    }

    private fun entry(avatarId: String, name: String) = NativePersonaEntry(
        avatarId = avatarId,
        name = name,
        title = "",
        description = "测试人设",
        position = 0,
        depth = 2,
        role = 0,
        lorebook = "",
        connections = emptyList(),
        invalidConnectionCount = 0,
    )
}
