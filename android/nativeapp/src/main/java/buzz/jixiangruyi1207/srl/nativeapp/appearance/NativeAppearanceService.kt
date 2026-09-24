package buzz.jixiangruyi1207.srl.nativeapp.appearance

import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import org.json.JSONArray
import org.json.JSONObject

data class NativeAppearanceState(
    val theme: String = "light",
    val layoutMode: String = "grid",
    val customCss: String = "",
    val activePresetId: String = "",
    val presetCount: Int = 0,
    val blurThumbnails: Boolean = true,
    val cabinetColumns: Int = 4,
)

class NativeAppearanceService(private val store: NativeResourceStore) {
    fun load(): NativeAppearanceState {
        val appearance = store.readPortableSection("appearance") ?: JSONObject()
        val general = store.readPortableSection("generalPreferences") ?: JSONObject()
        val theme = appearance.optString("theme").takeIf { it in setOf("light", "dark") } ?: "light"
        val layout = appearance.optString("layoutMode").takeIf { it in setOf("grid", "list", "split") } ?: "grid"
        val columns = general.optInt("cabinetColumns", 4).takeIf { it in setOf(2, 3, 4) } ?: 4
        return NativeAppearanceState(
            theme = theme,
            layoutMode = layout,
            customCss = appearance.optString("customCss").take(200_000),
            activePresetId = appearance.optString("activePresetId"),
            presetCount = appearance.optJSONArray("presets")?.length() ?: 0,
            blurThumbnails = general.optBoolean("blurThumbnails", true),
            cabinetColumns = columns,
        )
    }

    fun save(theme: String, layoutMode: String, blurThumbnails: Boolean, cabinetColumns: Int): NativeAppearanceState {
        require(theme in setOf("light", "dark")) { "主题无效" }
        require(layoutMode in setOf("grid", "list", "split")) { "资源排版无效" }
        require(cabinetColumns in setOf(2, 3, 4)) { "收藏柜列数无效" }
        val existingAppearance = store.readPortableSection("appearance") ?: JSONObject()
        val appearance = JSONObject(existingAppearance.toString())
            .put("theme", theme)
            .put("layoutMode", layoutMode)
        if (!appearance.has("customCss")) appearance.put("customCss", "")
        if (!appearance.has("presets")) appearance.put("presets", JSONArray())
        if (!appearance.has("activePresetId")) appearance.put("activePresetId", "")
        store.writePortableSection("appearance", appearance)

        val existingGeneral = store.readPortableSection("generalPreferences") ?: JSONObject()
        val general = JSONObject(existingGeneral.toString())
            .put("blurThumbnails", blurThumbnails)
            .put("cabinetColumns", cabinetColumns)
        store.writePortableSection("generalPreferences", general)
        return load()
    }
}
