package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

@RunWith(Parameterized.class)
public class NativeTavernResourceParserTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private final JSONObject fixture;
    public NativeTavernResourceParserTest(String name, JSONObject fixture) { this.fixture = fixture; }

    @Parameterized.Parameters(name = "{0}") public static java.util.Collection<Object[]> fixtures() throws Exception {
        try (InputStream input = NativeTavernResourceParserTest.class.getResourceAsStream("/tavern-resource-parity.json")) {
            JSONArray values = new JSONArray(new String(input.readAllBytes(), StandardCharsets.UTF_8));
            java.util.List<Object[]> result = new java.util.ArrayList<>();
            for (int i = 0; i < values.length(); i++) result.add(new Object[]{values.getJSONObject(i).getString("name"), values.getJSONObject(i)});
            return result;
        }
    }

    @Test public void nativeRecognitionMatchesTheSameForegroundContractFixture() throws Exception {
        File file = temporary.newFile(fixture.getString("name"));
        String content = fixture.has("content") ? fixture.getString("content") : fixture.get("value").toString();
        try (FileOutputStream output = new FileOutputStream(file)) { output.write(content.getBytes(StandardCharsets.UTF_8)); }
        JSONObject actual = NativeTavernResourceParser.parse(file, file.getName());
        assertSubset(fixture.getJSONObject("expected"), actual);
        assertTrue(NativeTavernResourceParser.supportedType(actual.getString("type")));
        String notification = NativeDiscordDownloadWorker.completionText(new JSONObject().put("state", "parsed").put("resourceType", actual.getString("type")),
            new JSONObject().put("state", "imported").put("resourceType", actual.getString("type")));
        assertTrue(notification.startsWith(NativeTavernResourceParser.label(actual.getString("type"))));
        assertFalse(notification.contains("需要在前台"));
        java.lang.reflect.Method create = NativeBackgroundResourceImporter.class.getDeclaredMethod(
            "newResource", JSONObject.class, String.class, String.class, String.class,
            long.class, String.class, long.class);
        create.setAccessible(true);
        JSONObject resource = (JSONObject) create.invoke(null, actual, file.getName(), "application/json",
            "a".repeat(64), file.length(), "background-resource", 1L);
        assertEquals("Stored resources and their summaries must always expose a tag array",
            0, resource.getJSONArray("tags").length());
        actual.put("tags", new JSONArray().put("保留标签"));
        JSONObject tagged = (JSONObject) create.invoke(null, actual, file.getName(), "application/json",
            "a".repeat(64), file.length(), "background-tagged-resource", 1L);
        assertEquals("保留标签", tagged.getJSONArray("tags").getString(0));
    }

    private static void assertSubset(JSONObject expected, JSONObject actual) throws Exception {
        assertNotNull(actual);
        Iterator<String> keys = expected.keys();
        while (keys.hasNext()) {
            String key = keys.next(); Object value = expected.get(key);
            if (value instanceof JSONObject) assertSubset((JSONObject) value, actual.getJSONObject(key));
            else if (value instanceof JSONArray) assertEquals(key, value.toString(), actual.getJSONArray(key).toString());
            else assertEquals(key, value, actual.get(key));
        }
    }
}
