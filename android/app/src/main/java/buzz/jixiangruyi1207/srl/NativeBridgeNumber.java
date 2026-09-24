package buzz.jixiangruyi1207.srl;

/** Capacitor JSON 数字可能是 Integer、Long 或 Double；统一按 JS 安全整数读取。 */
final class NativeBridgeNumber {
    static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

    private NativeBridgeNumber() {}

    static long bounded(Object rawValue, long minimum, long maximum, String errorMessage) {
        if (!(rawValue instanceof Number) || minimum > maximum) {
            throw new IllegalArgumentException(errorMessage);
        }
        double numericValue = ((Number) rawValue).doubleValue();
        if (!Double.isFinite(numericValue)
            || numericValue < minimum
            || numericValue > maximum
            || numericValue != Math.rint(numericValue)) {
            throw new IllegalArgumentException(errorMessage);
        }
        long value = ((Number) rawValue).longValue();
        if ((double) value != numericValue) throw new IllegalArgumentException(errorMessage);
        return value;
    }

    static long boundedOrDefault(
        Object rawValue,
        long defaultValue,
        long minimum,
        long maximum,
        String errorMessage
    ) {
        return rawValue == null ? defaultValue : bounded(rawValue, minimum, maximum, errorMessage);
    }
}
