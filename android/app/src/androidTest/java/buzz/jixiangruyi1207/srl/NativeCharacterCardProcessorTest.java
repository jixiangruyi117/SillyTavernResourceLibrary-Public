package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

@RunWith(AndroidJUnit4.class)
public class NativeCharacterCardProcessorTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test public void nativeJsonAndPngParsingFeedsDuplicateAndVersionMatching() throws Exception {
        File directory = new File(context.getCacheDir(), "native-card-" + java.util.UUID.randomUUID());
        assertTrue(directory.mkdir());
        try {
            JSONObject first = card("Mewo Native Test", "hello v1");
            JSONObject second = card("Mewo Native Test", "hello v2");
            JSONObject parsedFirst = parse(directory, "first.json", first);
            JSONObject parsedSecond = parse(directory, "second.json", second);
            assertEquals("json", parsedFirst.getJSONObject("metadata").getString("format"));
            assertEquals(10, parsedFirst.getJSONObject("metadata").getInt("parserVersion"));

            JSONObject current = row("current-card", "Mewo Native Test.json", parsedFirst, false);
            JSONArray duplicate = NativeCharacterCardProcessor.matchParsedResource(
                parsedFirst, "copy.json", new JSONArray().put(current), false);
            assertEquals("contentDuplicate", duplicate.getJSONObject(0).getString("matchKind"));

            JSONObject history = row("historical-card", "Mewo Native Test.json", parsedFirst, true);
            JSONArray version = NativeCharacterCardProcessor.matchParsedResource(
                parsedSecond, "Mewo Native Test latest.json", new JSONArray().put(history), false);
            assertEquals(90, version.getJSONObject(0).getInt("score"));
            assertEquals("version", version.getJSONObject(0).getString("matchKind"));
            assertTrue(version.getJSONObject(0).getBoolean("historical"));

            File png = new File(directory, "card.png");
            writePngCard(png, first);
            JSONObject parsedPng = parse(directory, "card.png", png);
            assertEquals("png", parsedPng.getJSONObject("metadata").getString("format"));
            assertEquals("chara", parsedPng.getJSONObject("metadata").getString("characterCardChunk"));
            JSONArray containerVariant = NativeCharacterCardProcessor.matchParsedResource(
                parsedPng, "card.png", new JSONArray().put(current), false);
            assertEquals("containerVariant", containerVariant.getJSONObject(0).getString("matchKind"));
        } finally {
            File[] children = directory.listFiles();
            if (children != null) for (File child : children) child.delete();
            directory.delete();
        }
    }

    @Test public void nativeParserRejectsNonCardJsonWithoutCreatingParsedSidecar() throws Exception {
        File directory = new File(context.getCacheDir(), "native-card-invalid-" + java.util.UUID.randomUUID());
        assertTrue(directory.mkdir());
        File input = new File(directory, "settings.json");
        File sidecar = new File(directory, "parsed.json");
        try (FileOutputStream output = new FileOutputStream(input)) {
            output.write("{\"theme\":\"light\"}".getBytes(StandardCharsets.UTF_8));
        }
        try {
            JSONObject result = NativeCharacterCardProcessor.parseOnly(input, "settings.json", sidecar);
            assertEquals("not_character_card", result.getString("state"));
            assertFalse(sidecar.exists());
        } finally {
            input.delete();
            sidecar.delete();
            directory.delete();
        }
    }

    private JSONObject card(String name, String greeting) throws Exception {
        JSONObject data = new JSONObject()
            .put("name", name)
            .put("description", "Stable description for native version comparison.")
            .put("personality", "Calm and curious.")
            .put("scenario", "A quiet library.")
            .put("first_mes", greeting)
            .put("mes_example", "{{char}}: hello");
        return new JSONObject().put("spec", "chara_card_v2").put("spec_version", "2.0").put("data", data);
    }

    private JSONObject parse(File directory, String fileName, JSONObject card) throws Exception {
        File input = new File(directory, fileName);
        try (FileOutputStream output = new FileOutputStream(input)) {
            output.write(card.toString().getBytes(StandardCharsets.UTF_8));
        }
        return parse(directory, fileName, input);
    }

    private JSONObject parse(File directory, String fileName, File input) throws Exception {
        File sidecar = new File(directory, fileName + ".parsed.json");
        JSONObject result = NativeCharacterCardProcessor.parseOnly(input, fileName, sidecar);
        assertEquals("parsed", result.getString("state"));
        try {
            return new JSONObject(new String(java.nio.file.Files.readAllBytes(sidecar.toPath()), StandardCharsets.UTF_8));
        } finally {
            sidecar.delete();
        }
    }

    private JSONObject row(String id, String fileName, JSONObject parsed, boolean historical) throws Exception {
        JSONObject metadata = parsed.getJSONObject("metadata");
        return new JSONObject()
            .put("id", id)
            .put("type", "characterCard")
            .put("name", parsed.getString("name"))
            .put("fileName", fileName)
            .put("historical", historical)
            .put("metadata", new JSONObject()
                .put("cardContentHash", metadata.getString("cardContentHash"))
                .put("cardCoreHash", metadata.getString("cardCoreHash"))
                .put("cardFingerprintVersion", 4));
    }

    private void writePngCard(File output, JSONObject card) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (DataOutputStream data = new DataOutputStream(bytes)) {
            data.write(new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10});
            byte[] text = ("chara\0" + Base64.encodeToString(card.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP))
                .getBytes(StandardCharsets.ISO_8859_1);
            chunk(data, "tEXt", text);
            chunk(data, "IEND", new byte[0]);
        }
        try (FileOutputStream file = new FileOutputStream(output)) { file.write(bytes.toByteArray()); }
    }

    private void chunk(DataOutputStream output, String name, byte[] data) throws Exception {
        output.writeInt(data.length);
        output.write(name.getBytes(StandardCharsets.US_ASCII));
        output.write(data);
        output.writeInt(0);
    }
}
