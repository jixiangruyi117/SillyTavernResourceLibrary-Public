package buzz.jixiangruyi1207.srl.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import buzz.jixiangruyi1207.srl.nativeapp.draw.NativeCharacterDrawService
import buzz.jixiangruyi1207.srl.nativeapp.draw.NativeDrawFreshness
import buzz.jixiangruyi1207.srl.nativeapp.draw.NativeDrawOptions
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeCharacterDrawTest {
    @Test
    fun filtersDrawsPersistsPortableStateAndClearsWithoutDeletingCards() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        NativeResourceStore(context).use { store ->
            val first = store.importGeneratedJson("draw-a-$seed.json", card("甲-$seed", listOf("冒险-$seed")))
            val second = store.importGeneratedJson("draw-b-$seed.json", card("乙-$seed", listOf("日常")))
            store.toggleFavorite(first.id)
            val service = NativeCharacterDrawService(store) { 0.0 }
            service.clear()
            val options = NativeDrawOptions(1, tag = "冒险-$seed", favoritesOnly = true, freshness = NativeDrawFreshness.NEVER)
            val result = service.draw(store.loadResources(), options, now = 1_800_000_000_000)
            assertEquals(listOf(first.id), result.resourceIds)
            assertEquals(1, result.state.totalDraws)
            assertTrue(service.filterPool(store.loadResources(), result.state, options, 1_800_000_000_001).isEmpty())
            val section = JSONObject(store.portableDataJson()).getJSONObject("characterDraw")
            assertEquals(1, section.getJSONObject("state").getInt("totalDraws"))
            assertTrue(section.getJSONObject("state").getJSONObject("records").has(first.id))
            val reopened = NativeCharacterDrawService(store).load()
            assertEquals(result.state.totalSessions, reopened.totalSessions)
            service.clear()
            assertEquals(0, service.load().totalDraws)
            val ids = store.loadResources().map { it.id }
            assertTrue(first.id in ids && second.id in ids)
        }
    }

    @Test
    fun tenDrawCyclesPoolWithoutDroppingHistoryShape() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        NativeResourceStore(context).use { store ->
            val cards = (1..3).map { index -> store.importGeneratedJson("ten-$index-$seed.json", card("十连-$index-$seed", listOf("十连-$seed"))) }
            val service = NativeCharacterDrawService(store) { 0.5 }
            service.clear()
            val result = service.draw(store.loadResources(), NativeDrawOptions(10, tag = "十连-$seed"), now = 1_810_000_000_000)
            assertEquals(10, result.resourceIds.size)
            assertEquals(cards.map { it.id }.toSet(), result.resourceIds.toSet())
            assertEquals(10, result.state.records.values.sumOf { it.count })
            assertEquals(1, result.state.history.size)
            assertEquals("#十连-$seed", result.state.history.single().filterLabel)
        }
    }

    private fun card(name: String, tags: List<String>): String = JSONObject()
        .put("spec", "chara_card_v2")
        .put("data", JSONObject().put("name", name).put("description", "测试角色")
            .put("personality", "").put("scenario", "").put("first_mes", "").put("mes_example", "")
            .put("tags", JSONArray(tags)))
        .toString(2)
}
