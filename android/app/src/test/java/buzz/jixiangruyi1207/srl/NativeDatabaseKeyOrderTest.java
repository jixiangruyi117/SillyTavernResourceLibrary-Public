package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Random;
import org.json.JSONObject;
import org.junit.Test;

public class NativeDatabaseKeyOrderTest {
    @Test public void ordersAllSupportedKeyTypesAndUtf16Prefixes() {
        String[] ordered = {"-10", "0", "2", "10",
            "{\"__srlIdbDateKeyV1\":\"1969-12-31T23:59:59.999Z\"}",
            "{\"__srlIdbDateKeyV1\":\"+010000-01-01T00:00:00.000Z\"}",
            JSONObject.quote(""), JSONObject.quote("a"), JSONObject.quote("a\u0000"),
            JSONObject.quote("a\""), JSONObject.quote("a\\"), JSONObject.quote("中"),
            JSONObject.quote("🌧"), JSONObject.quote("\ue000"),
            "{\"__srlIdbBinaryKeyV1\":[]}", "{\"__srlIdbBinaryKeyV1\":[0]}",
            "{\"__srlIdbBinaryKeyV1\":[0,255]}", "{\"__srlIdbBinaryKeyV1\":[1]}",
            "[]", "[2]", "[2,0]", "[10]", "[\"a\"]", "[\"a\",2]", "[\"a\",10]", "[[]]", "[[2]]"};
        for (int i = 1; i < ordered.length; i++) assertTrue(ordered[i - 1] + " < " + ordered[i],
            NativeDatabaseKeyOrder.key(ordered[i - 1]).compareTo(NativeDatabaseKeyOrder.key(ordered[i])) < 0);
        assertEquals(NativeDatabaseKeyOrder.key("-0.0"), NativeDatabaseKeyOrder.key("0"));
        assertEquals(NativeDatabaseKeyOrder.key("2.0"), NativeDatabaseKeyOrder.key("2"));
    }

    @Test public void preservesDoubleOrderAcrossExponentsAndSubnormals() {
        Random random = new Random(12345);
        ArrayList<Double> values = new ArrayList<>();
        values.add(-Double.MAX_VALUE); values.add(-Double.MIN_VALUE); values.add(0d);
        values.add(Double.MIN_VALUE); values.add(Double.MAX_VALUE);
        for (int i = 0; i < 10000; i++) {
            double value = Double.longBitsToDouble(random.nextLong());
            if (Double.isFinite(value)) values.add(value);
        }
        values.sort(Comparator.naturalOrder());
        String previous = null;
        for (double value : values) {
            String current = NativeDatabaseKeyOrder.key(Double.toString(value));
            if (previous != null) assertTrue(previous.compareTo(current) <= 0);
            previous = current;
        }
    }

    @Test public void preservesOpaqueNativeApiKeysWithoutRejectingExistingRecords() {
        assertEquals(NativeDatabaseKeyOrder.key(JSONObject.quote("resource-id")), NativeDatabaseKeyOrder.key("resource-id"));
    }

    @Test public void encodesPreEpochYearZeroAndExtendedDatesAtTheirExactEpochMillis() throws Exception {
        for (String iso : new String[] {"0000-02-29T00:00:00.000Z", "-000001-01-01T00:00:00.000Z",
                "+010000-01-01T00:00:00.000Z", "1582-10-10T00:00:00.000Z", "1969-12-31T23:59:59.999Z"}) {
            // JVM Instant is the oracle, never used by the API-24 production implementation.
            long millis = java.time.Instant.parse(iso).toEpochMilli();
            assertEquals("2" + NativeDatabaseKeyOrder.key(Long.toString(millis)).substring(1),
                NativeDatabaseKeyOrder.key(new JSONObject().put("__srlIdbDateKeyV1", iso).toString()));
        }
    }
}
