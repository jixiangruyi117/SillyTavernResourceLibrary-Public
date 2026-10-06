package buzz.jixiangruyi1207.srl.nativeapp.cabinet

import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import org.json.JSONArray
import org.json.JSONObject

data class NativeCabinetState(
    val resourceIds: List<String> = emptyList(),
    val columns: Int = 4,
)

class NativeCabinetService(private val store: NativeResourceStore) {
    fun load(): NativeCabinetState {
        val general = store.readPortableSection("generalPreferences") ?: JSONObject()
        val ids = general.optJSONArray("cabinetResourceIds")?.let(::stringList).orEmpty().distinct().take(5_000)
        val columns = general.optInt("cabinetColumns", 4).takeIf { it in setOf(2, 3, 4) } ?: 4
        return NativeCabinetState(ids, columns)
    }

    fun save(resourceIds: List<String>): NativeCabinetState {
        val normalized = resourceIds.filter(String::isNotBlank).distinct().take(5_000)
        val general = store.readPortableSection("generalPreferences") ?: JSONObject()
        val existingLayout = general.optJSONArray("cabinetLayout") ?: JSONArray()
        val folderEntries = (0 until existingLayout.length()).mapNotNull(existingLayout::optJSONObject)
            .filter { it.optString("kind") == "folder" }
            .map { JSONObject(it.toString()) }
        val previousResources = (0 until existingLayout.length()).mapNotNull(existingLayout::optJSONObject)
            .filter { it.optString("kind") == "resource" }
            .associateBy { it.optString("id") }
        val layout = JSONArray()
        folderEntries.forEach(layout::put)
        normalized.forEachIndexed { index, id ->
            val previous = previousResources[id]
            layout.put(JSONObject()
                .put("kind", "resource")
                .put("id", id)
                .put("slot", index)
                .put("columnSpan", previous?.optInt("columnSpan", 1)?.takeIf { it in setOf(1, 2, 4) } ?: 1)
                .put("rowSpan", previous?.optInt("rowSpan", 1)?.takeIf { it in setOf(1, 2) } ?: 1))
        }
        val updated = JSONObject(general.toString())
            .put("cabinetResourceIds", JSONArray(normalized))
            .put("cabinetLayout", layout)
        store.writePortableSection("generalPreferences", updated)
        return load()
    }

    private fun stringList(array: JSONArray): List<String> =
        (0 until array.length()).map { array.optString(it) }.filter(String::isNotBlank)
}
