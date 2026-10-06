package buzz.jixiangruyi1207.srl.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import buzz.jixiangruyi1207.srl.nativeapp.cabinet.NativeCabinetService
import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeCabinetTest {
    @Test
    fun persistsResourceOrderAndKeepsFolderLayoutAndUnknownPreferences() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        NativeResourceStore(context).use { store ->
            val first = store.importGeneratedJson("cabinet-a-$seed.json", JSONObject().put("name", "甲-$seed").toString())
            val second = store.importGeneratedJson("cabinet-b-$seed.json", JSONObject().put("name", "乙-$seed").toString())
            val folder = JSONObject().put("kind", "folder").put("id", "folder-$seed").put("slot", 7).put("columnSpan", 2).put("rowSpan", 1)
            store.writePortableSection("generalPreferences", JSONObject()
                .put("cabinetColumns", 3).put("cabinetResourceIds", JSONArray().put(first.id))
                .put("cabinetLayout", JSONArray().put(folder)).put("futureCabinet", "保留"))
            val saved = NativeCabinetService(store).save(listOf(second.id, first.id, second.id))
            assertEquals(listOf(second.id, first.id), saved.resourceIds)
            assertEquals(3, saved.columns)
            val general = JSONObject(store.portableDataJson()).getJSONObject("generalPreferences")
            assertEquals("保留", general.getString("futureCabinet"))
            val layout = general.getJSONArray("cabinetLayout")
            assertTrue((0 until layout.length()).map { layout.getJSONObject(it) }.any { it.getString("kind") == "folder" && it.getString("id") == "folder-$seed" })
            val resources = (0 until layout.length()).map { layout.getJSONObject(it) }.filter { it.getString("kind") == "resource" }
            assertEquals(listOf(second.id, first.id), resources.map { it.getString("id") })
            assertEquals(listOf(0, 1), resources.map { it.getInt("slot") })
        }
        NativeResourceStore(context).use { reopened ->
            assertEquals(2, NativeCabinetService(reopened).load().resourceIds.size)
        }
    }
}
