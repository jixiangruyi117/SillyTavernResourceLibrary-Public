package buzz.jixiangruyi1207.srl.nativeapp.parser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.io.path.createTempDirectory

class NativeResourceParserTest {
    @Test
    fun `recognizes v3 character card without changing its source file`() {
        val file = writeJson(
            "luna.json",
            """{"spec":"chara_card_v3","data":{"name":"Luna","description":"A test card","tags":["mage","night"]}}""",
        )

        val result = NativeResourceParser.parse(file, file.name)

        assertEquals("characterCard", result.type)
        assertEquals("Luna", result.name)
        assertEquals(listOf("mage", "night"), result.tags)
        assertTrue(file.readText().contains("chara_card_v3"))
    }

    @Test
    fun `recognizes common SillyTavern resource formats`() {
        val worldBook = NativeResourceParser.parse(
            writeJson("world.json", """{"name":"Lore","entries":{"a":{"key":["moon"]}}}"""),
            "world.json",
        )
        val regex = NativeResourceParser.parse(
            writeJson("rules.json", """{"scriptName":"Rules","findRegex":"a","replaceString":"b"}"""),
            "rules.json",
        )
        val preset = NativeResourceParser.parse(
            writeJson("preset.json", """{"name":"Creative","temperature":1.1,"top_p":0.9,"top_k":40}"""),
            "preset.json",
        )

        assertEquals("worldBook", worldBook.type)
        assertEquals("regex", regex.type)
        assertEquals("preset", preset.type)
    }

    private fun writeJson(name: String, contents: String): File {
        val folder = createTempDirectory("srl-native-parser-").toFile()
        return File(folder, name).apply { writeText(contents) }
    }
}
