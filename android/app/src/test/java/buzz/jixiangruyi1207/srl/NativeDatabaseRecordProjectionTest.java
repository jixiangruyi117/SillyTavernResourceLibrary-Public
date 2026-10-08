package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class NativeDatabaseRecordProjectionTest {
    @Test public void optionalProjectionPreservesReferenceIdentityAndDropsBodyWithoutMutatingRecord() throws Exception {
        JSONObject source = new JSONObject().put("id", "resource-a").put("name", "角色")
            .put("originalBlob", new JSONObject().put("size", 1024).put("sha256", "a"))
            .put("metadata", new JSONObject().put("card", new JSONObject().put("body", "正文".repeat(10000)))
                .put("recoveredFromNativeObject", true));
        assertSame(source, NativeAppDatabase.projectRecord(source, null));
        JSONObject projected = NativeAppDatabase.projectRecord(source,
            new JSONArray().put("id").put("originalBlob").put("metadata.recoveredFromNativeObject").put("missing"));
        assertEquals("resource-a", projected.getString("id"));
        assertEquals(1024, projected.getJSONObject("originalBlob").getInt("size"));
        assertTrue(projected.getJSONObject("metadata").getBoolean("recoveredFromNativeObject"));
        assertFalse(projected.getJSONObject("metadata").has("card"));
        assertFalse(projected.has("name"));
        assertFalse(projected.has("missing"));
        assertTrue(source.getJSONObject("metadata").has("card"));
    }

    @Test public void rejectsMalformedOrUnboundedProjectionWhilePreservingNulls() throws Exception {
        JSONObject source = new JSONObject().put("nullable", JSONObject.NULL);
        assertTrue(NativeAppDatabase.projectRecord(source, new JSONArray().put("nullable")).isNull("nullable"));
        for (String path : new String[]{"../id", "metadata..card", "id;DROP TABLE records", "id."})
            assertThrows(IllegalArgumentException.class,
                () -> NativeAppDatabase.projectRecord(source, new JSONArray().put(path)));
        JSONArray fields = new JSONArray();
        for (int index = 0; index < 33; index++) fields.put("id");
        assertThrows(IllegalArgumentException.class, () -> NativeAppDatabase.projectRecord(source, fields));
    }
}
