package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import java.util.Arrays;
import org.json.JSONObject;
import org.junit.Test;

public class NativeDatabaseKeyQueryTest {
    @Test public void buildsBoundedCoveringRangeAndTupleSeekPlansWithoutPayloads() throws Exception {
        NativeDatabaseKeyQuery.Plan plan = NativeDatabaseKeyQuery.build("resourceListSummaries", new JSONObject()
            .put("indexName", "updatedAt").put("lower", "2").put("lowerOpen", true)
            .put("upper", "1000").put("afterKey", "10").put("afterPrimaryKey", "\"id\"")
            .put("seekKey", "100").put("seekPrimaryKey", "\"next\"").put("reverse", true).put("limit", 8));
        assertFalse(plan.sql.contains("payload_json"));
        assertTrue(plan.sql.contains("i.index_sort_key > ?"));
        assertTrue(plan.sql.contains("(i.index_sort_key, i.record_sort_key) < (?, ?)"));
        assertTrue(plan.sql.contains("(i.index_sort_key, i.record_sort_key) <= (?, ?)"));
        assertTrue(plan.sql.endsWith("ORDER BY i.index_sort_key DESC, i.record_sort_key DESC LIMIT ? OFFSET ?"));
        assertEquals("8", plan.args[plan.args.length - 2]);
        assertEquals("0", plan.args[plan.args.length - 1]);
        assertTrue(Arrays.asList(plan.args).contains(NativeDatabaseKeyOrder.key("10")));
    }

    @Test public void countsOnlyAndUniqueDirectionsSelectLowestPrimaryKeys() throws Exception {
        NativeDatabaseKeyQuery.Plan count = NativeDatabaseKeyQuery.build("settings", new JSONObject().put("lower", "2").put("countOnly", true));
        assertTrue(count.count); assertTrue(count.sql.startsWith("SELECT COUNT(*)"));
        assertFalse(count.sql.contains("ORDER BY")); assertFalse(count.sql.contains("LIMIT"));
        NativeDatabaseKeyQuery.Plan unique = NativeDatabaseKeyQuery.build("resourceListSummaries", new JSONObject()
            .put("indexName", "updatedAt").put("reverse", true).put("unique", true).put("afterKey", "10"));
        assertTrue(unique.sql.contains("i.index_sort_key < ?"));
        assertTrue(unique.sql.contains("u.record_sort_key < i.record_sort_key"));
    }

    @Test public void rejectsOversizedPagesAndMissingTuplePrimaryKeys() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> NativeDatabaseKeyQuery.build("settings", new JSONObject().put("limit", 1001)));
        assertThrows(IllegalArgumentException.class, () -> NativeDatabaseKeyQuery.build("settings", new JSONObject().put("offset", -1)));
        assertThrows(IllegalArgumentException.class, () -> NativeDatabaseKeyQuery.build("resourceListSummaries", new JSONObject()
            .put("indexName", "updatedAt").put("afterKey", "10")));
    }

    @Test public void supportsOlderSqliteWithEquivalentScalarSeekPredicates() throws Exception {
        NativeDatabaseKeyQuery.Plan plan = NativeDatabaseKeyQuery.build("resourceListSummaries", new JSONObject()
            .put("indexName", "updatedAt").put("afterKey", "2").put("afterPrimaryKey", "\"id\"")
            .put("seekKey", "10").put("seekPrimaryKey", "\"next\"").put("reverse", true), false);
        assertFalse(plan.sql.contains("(i.index_sort_key, i.record_sort_key)"));
        assertTrue(plan.sql.contains("i.index_sort_key <= ? AND (i.index_sort_key < ? OR i.record_sort_key < ?)"));
        assertTrue(plan.sql.contains("i.index_sort_key <= ? AND (i.index_sort_key < ? OR i.record_sort_key <= ?)"));
        assertEquals(10, plan.args.length);
    }
}
