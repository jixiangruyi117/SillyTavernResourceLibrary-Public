package buzz.jixiangruyi1207.srl.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import buzz.jixiangruyi1207.srl.nativeapp.appearance.NativeAppearanceService
import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeAppearanceTest {
    @Test
    fun savesNativeChoicesWithoutDroppingWebCssOrFutureFields() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        NativeResourceStore(context).use { store ->
            store.writePortableSection("appearance", JSONObject()
                .put("theme", "light").put("layoutMode", "list").put("customCss", ".future { color: red; }")
                .put("presets", JSONArray().put(JSONObject().put("id", "preset-1").put("name", "网页预设")))
                .put("activePresetId", "preset-1").put("futureAppearance", "保留"))
            store.writePortableSection("generalPreferences", JSONObject()
                .put("blurThumbnails", true).put("cabinetColumns", 4).put("futureGeneral", "保留"))
            val saved = NativeAppearanceService(store).save("dark", "grid", false, 3)
            assertEquals("dark", saved.theme)
            assertEquals("grid", saved.layoutMode)
            assertEquals(3, saved.cabinetColumns)
            assertEquals(1, saved.presetCount)
            val portable = JSONObject(store.portableDataJson())
            val appearance = portable.getJSONObject("appearance")
            val general = portable.getJSONObject("generalPreferences")
            assertEquals(".future { color: red; }", appearance.getString("customCss"))
            assertEquals("保留", appearance.getString("futureAppearance"))
            assertEquals("保留", general.getString("futureGeneral"))
            assertTrue(!general.getBoolean("blurThumbnails"))
        }
        NativeResourceStore(context).use { reopened ->
            val state = NativeAppearanceService(reopened).load()
            assertEquals("dark", state.theme)
            assertEquals(3, state.cabinetColumns)
        }
    }
}
