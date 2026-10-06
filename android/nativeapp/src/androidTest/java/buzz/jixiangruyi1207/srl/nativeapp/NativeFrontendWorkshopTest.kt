package buzz.jixiangruyi1207.srl.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import buzz.jixiangruyi1207.srl.nativeapp.workshop.NativeFrontendWorkshopService
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeFrontendWorkshopTest {
    @Test
    fun compilesReplyTemplateIntoLinkedRegexAndWorldBook() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        NativeResourceStore(context).use { store ->
            val service = NativeFrontendWorkshopService(store)
            val result = service.compileAndSave(
                fieldSource = "姓名：林言\n状态[标签]：平静、专注",
                designSource = """<SRL_META>{"title":"测试状态栏-$seed"}</SRL_META>
<SRL_TEMPLATE><style>.card { color: #123456; }</style><section class="card"><b>{{field_1}}</b><i>{{field_2}}</i></section></SRL_TEMPLATE>""",
                requestedTitle = "测试状态栏-$seed",
                dataMode = "reply",
            )
            val output = store.loadResources().filter { it.id in listOf(result.regexResourceId, result.worldBookResourceId) }
            assertEquals(setOf("regex", "worldBook"), output.map { it.type }.toSet())
            assertTrue(output.all { other -> output.filter { it.id != other.id }.single().id in other.relatedResourceIds })
            val regex = JSONObject(store.readResourceText(result.regexResourceId))
            assertTrue(regex.getString("replaceString").contains("color: #123456"))
            assertTrue(regex.getString("replaceString").contains("\$1"))
            assertTrue(regex.getString("findRegex").contains("StatusPlaceHolder"))
            val world = JSONObject(store.readResourceText(result.worldBookResourceId))
            assertTrue(world.getJSONObject("entries").getJSONObject("0").getString("content").contains("状态栏输出协议"))
        }
    }

    @Test
    fun rejectsUnsafeOrIncompleteTemplateBeforeWriting() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        NativeResourceStore(context).use { store ->
            val service = NativeFrontendWorkshopService(store)
            val before = store.loadResources().size
            val unsafe = runCatching {
                service.compileAndSave("姓名：林言", "<style>@import 'http://bad.test/a.css';</style><section onclick=\"x()\"><script>x()</script>{{field_1}}</section>", "坏模板", "reply")
            }.exceptionOrNull()
            assertTrue(unsafe?.message?.contains("脚本") == true)
            val missing = runCatching {
                service.compileAndSave("姓名：林言\n心情：平静", "<style>.x{color:red}</style><section>{{field_1}}</section>", "缺字段", "reply")
            }.exceptionOrNull()
            assertTrue(missing?.message?.contains("第 2 个字段") == true)
            assertEquals(before, store.loadResources().size)
        }
    }

    @Test
    fun compilesMvuTemplateAgainstTavernHelperVariables() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        NativeResourceStore(context).use { store ->
            val service = NativeFrontendWorkshopService(store)
            val result = service.compileAndSave(
                fieldSource = "【角色】\n生命[数字]：80",
                designSource = "<style>.mvu{width:80%}</style><section class=\"mvu\">{{field_1}}</section>",
                requestedTitle = "MVU-$seed",
                dataMode = "mvu",
            )
            val regex = JSONObject(store.readResourceText(result.regexResourceId))
            assertTrue(regex.getString("replaceString").contains("TavernHelper.getVariables").not())
            assertTrue(regex.getString("replaceString").contains("TavernHelper"))
            assertTrue(regex.getString("replaceString").contains("角色.生命"))
            val world = JSONObject(store.readResourceText(result.worldBookResourceId))
            assertTrue(world.getJSONObject("entries").getJSONObject("0").getString("comment").contains("MVU"))
        }
    }
}
