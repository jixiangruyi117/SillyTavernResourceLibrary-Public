package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class NativeBridgeNumberTest {

    private static final long MAX_FILE_BYTES = 8L * 1024L * 1024L * 1024L * 1024L;

    @Test
    public void bounded_acceptsIntegerLongAndIntegralDoubleBridgeValues() {
        assertEquals(25L, NativeBridgeNumber.bounded(25, 0L, MAX_FILE_BYTES, "invalid"));
        assertEquals(
            3L * 1024L * 1024L * 1024L,
            NativeBridgeNumber.bounded(3L * 1024L * 1024L * 1024L, 0L, MAX_FILE_BYTES, "invalid")
        );
        assertEquals(25L, NativeBridgeNumber.bounded(25.0d, 0L, MAX_FILE_BYTES, "invalid"));
        assertEquals(MAX_FILE_BYTES, NativeBridgeNumber.bounded(MAX_FILE_BYTES, 0L, MAX_FILE_BYTES, "invalid"));
    }

    @Test
    public void boundedOrDefault_onlyDefaultsWhenFieldIsMissing() {
        assertEquals(12L, NativeBridgeNumber.boundedOrDefault(null, 12L, 0L, 100L, "invalid"));
        assertEquals(25L, NativeBridgeNumber.boundedOrDefault(25, -1L, 1L, 100L, "invalid"));
        assertThrows(
            IllegalArgumentException.class,
            () -> NativeBridgeNumber.boundedOrDefault("", 12L, 0L, 100L, "invalid")
        );
    }

    @Test
    public void bounded_rejectsFractionalNegativeNonFiniteAndOversizedValues() {
        assertThrows(IllegalArgumentException.class, () -> NativeBridgeNumber.bounded(null, 0L, MAX_FILE_BYTES, "invalid"));
        assertThrows(IllegalArgumentException.class, () -> NativeBridgeNumber.bounded("25", 0L, MAX_FILE_BYTES, "invalid"));
        assertThrows(IllegalArgumentException.class, () -> NativeBridgeNumber.bounded(-1, 0L, MAX_FILE_BYTES, "invalid"));
        assertThrows(IllegalArgumentException.class, () -> NativeBridgeNumber.bounded(1.5d, 0L, MAX_FILE_BYTES, "invalid"));
        assertThrows(IllegalArgumentException.class, () -> NativeBridgeNumber.bounded(Double.NaN, 0L, MAX_FILE_BYTES, "invalid"));
        assertThrows(
            IllegalArgumentException.class,
            () -> NativeBridgeNumber.bounded(MAX_FILE_BYTES + 1L, 0L, MAX_FILE_BYTES, "invalid")
        );
    }
}
