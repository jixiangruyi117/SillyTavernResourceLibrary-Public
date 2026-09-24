package buzz.jixiangruyi1207.srl.nativeapp.draw

import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

enum class NativeDrawFreshness { ALL, NOT_SEVEN_DAYS, NEVER }

data class NativeDrawOptions(
    val count: Int,
    val categoryId: String? = null,
    val tag: String? = null,
    val favoritesOnly: Boolean = false,
    val freshness: NativeDrawFreshness = NativeDrawFreshness.ALL,
)

data class NativeDrawRecord(
    val resourceId: String,
    val count: Int,
    val firstDrawnAt: Long,
    val lastDrawnAt: Long,
)

data class NativeDrawHistoryItem(
    val id: String,
    val drawnAt: Long,
    val resourceIds: List<String>,
    val filterLabel: String,
)

data class NativeDrawState(
    val totalDraws: Int = 0,
    val totalSessions: Int = 0,
    val records: Map<String, NativeDrawRecord> = emptyMap(),
    val history: List<NativeDrawHistoryItem> = emptyList(),
)

data class NativeDrawResult(val resourceIds: List<String>, val state: NativeDrawState)

class NativeCharacterDrawService(
    private val store: NativeResourceStore,
    private val random: () -> Double = { Math.random() },
) {
    companion object {
        private const val HISTORY_LIMIT = 50
        private const val SEVEN_DAYS = 7L * 24L * 60L * 60L * 1000L
    }

    fun load(): NativeDrawState {
        val section = store.readPortableSection("characterDraw") ?: return NativeDrawState()
        return decodeState(section.optJSONObject("state") ?: JSONObject())
    }

    fun clear(): NativeDrawState {
        val existing = store.readPortableSection("characterDraw")
        if (existing == null) return NativeDrawState()
        store.writePortableSection("characterDraw", JSONObject(existing.toString()).put("state", encodeState(NativeDrawState())))
        return NativeDrawState()
    }

    fun draw(resources: List<NativeResource>, options: NativeDrawOptions, now: Long = System.currentTimeMillis()): NativeDrawResult {
        require(options.count == 1 || options.count == 10) { "每次只能抽取 1 张或 10 张" }
        val state = load()
        val pool = filterPool(resources, state, options, now)
        require(pool.isNotEmpty()) { "当前筛选下没有可抽取的角色卡" }
        val selected = mutableListOf<NativeResource>()
        var bag = shuffled(pool)
        while (selected.size < options.count) {
            if (bag.isEmpty()) bag = shuffled(pool)
            selected += bag.removeAt(bag.lastIndex)
        }
        val records = state.records.toMutableMap()
        selected.forEach { resource ->
            val previous = records[resource.id]
            records[resource.id] = NativeDrawRecord(
                resourceId = resource.id,
                count = (previous?.count ?: 0) + 1,
                firstDrawnAt = previous?.firstDrawnAt ?: now,
                lastDrawnAt = now,
            )
        }
        val ids = selected.map(NativeResource::id)
        val next = NativeDrawState(
            totalDraws = state.totalDraws + ids.size,
            totalSessions = state.totalSessions + 1,
            records = records,
            history = (listOf(NativeDrawHistoryItem(UUID.randomUUID().toString(), now, ids, filterLabel(options))) + state.history).take(HISTORY_LIMIT),
        )
        val existing = store.readPortableSection("characterDraw") ?: JSONObject()
        store.writePortableSection("characterDraw", JSONObject(existing.toString()).put("state", encodeState(next)).put("showNames", existing.optBoolean("showNames", true)))
        return NativeDrawResult(ids, next)
    }

    fun filterPool(
        resources: List<NativeResource>,
        state: NativeDrawState,
        options: NativeDrawOptions,
        now: Long = System.currentTimeMillis(),
    ): List<NativeResource> = resources.filter { resource ->
        if (resource.type != "characterCard") return@filter false
        if (!options.categoryId.isNullOrBlank() && options.categoryId !in resource.categoryIds) return@filter false
        if (!options.tag.isNullOrBlank() && options.tag !in resource.tags) return@filter false
        if (options.favoritesOnly && !resource.favorite) return@filter false
        val record = state.records[resource.id]
        if (options.freshness == NativeDrawFreshness.NEVER && record != null) return@filter false
        if (options.freshness == NativeDrawFreshness.NOT_SEVEN_DAYS && record != null && now - record.lastDrawnAt < SEVEN_DAYS) return@filter false
        true
    }

    private fun shuffled(resources: List<NativeResource>): MutableList<NativeResource> {
        val next = resources.toMutableList()
        for (index in next.lastIndex downTo 1) {
            val target = (random().coerceIn(0.0, 0.999999999) * (index + 1)).toInt()
            val value = next[index]
            next[index] = next[target]
            next[target] = value
        }
        return next
    }

    private fun filterLabel(options: NativeDrawOptions): String = listOf(
        if (options.categoryId != null) "指定文件夹" else "",
        options.tag?.let { "#$it" }.orEmpty(),
        if (options.favoritesOnly) "仅收藏" else "",
        when (options.freshness) {
            NativeDrawFreshness.NEVER -> "从未抽到"
            NativeDrawFreshness.NOT_SEVEN_DAYS -> "七日未见"
            NativeDrawFreshness.ALL -> ""
        },
    ).filter(String::isNotBlank).joinToString(" · ").ifBlank { "全部角色卡" }

    private fun encodeState(state: NativeDrawState): JSONObject {
        val records = JSONObject()
        state.records.forEach { (id, record) ->
            records.put(id, JSONObject().put("resourceId", record.resourceId).put("count", record.count)
                .put("firstDrawnAt", record.firstDrawnAt).put("lastDrawnAt", record.lastDrawnAt))
        }
        val history = JSONArray()
        state.history.take(HISTORY_LIMIT).forEach { item ->
            history.put(JSONObject().put("id", item.id).put("drawnAt", item.drawnAt)
                .put("resourceIds", JSONArray(item.resourceIds)).put("filterLabel", item.filterLabel))
        }
        return JSONObject().put("totalDraws", state.totalDraws).put("totalSessions", state.totalSessions)
            .put("records", records).put("history", history)
    }

    private fun decodeState(value: JSONObject): NativeDrawState {
        val records = mutableMapOf<String, NativeDrawRecord>()
        value.optJSONObject("records")?.let { source ->
            source.keys().forEach { id ->
                val item = source.optJSONObject(id) ?: return@forEach
                records[id] = NativeDrawRecord(id, item.optInt("count").coerceAtLeast(0), item.optLong("firstDrawnAt"), item.optLong("lastDrawnAt"))
            }
        }
        val history = value.optJSONArray("history")?.let { source ->
            (0 until minOf(source.length(), HISTORY_LIMIT)).mapNotNull { index ->
                val item = source.optJSONObject(index) ?: return@mapNotNull null
                val ids = item.optJSONArray("resourceIds")?.let { array -> (0 until array.length()).mapNotNull(array::optString).filter(String::isNotBlank) }.orEmpty()
                NativeDrawHistoryItem(item.optString("id").ifBlank { UUID.randomUUID().toString() }, item.optLong("drawnAt"), ids, item.optString("filterLabel", "全部角色卡"))
            }
        }.orEmpty()
        return NativeDrawState(value.optInt("totalDraws").coerceAtLeast(0), value.optInt("totalSessions").coerceAtLeast(0), records, history)
    }
}
