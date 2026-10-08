package buzz.jixiangruyi1207.srl;

import java.util.Calendar;
import java.util.Date;
import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** SQLite BINARY order matching IndexedDB's number/date/string/binary/array key order. */
final class NativeDatabaseKeyOrder {
    private static final char[] HEX = "0123456789abcdef".toCharArray();
    private static final Pattern ISO_DATE = Pattern.compile("([+-]?\\d{4,6})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})\\.(\\d{3})Z");

    static String key(String encoded) {
        try { return value(new JSONTokener(encoded).nextValue()); }
        catch (Exception legacyOpaqueKey) {
            // The native record API predates the Dexie key codec and permits opaque strings.
            // Preserve those records; Dexie still validates its own encoded keys on decoding.
            return string(encoded);
        }
    }

    private static String number(char rank, double number) {
        if (!Double.isFinite(number)) throw new IllegalArgumentException("索引数字键无效");
        long bits = Double.doubleToLongBits(number == 0 ? 0 : number);
        bits = bits < 0 ? ~bits : bits ^ Long.MIN_VALUE;
        StringBuilder result = new StringBuilder().append(rank);
        hex(result, bits, 16);
        return result.toString();
    }

    private static void hex(StringBuilder result, long value, int digits) {
        for (int shift = (digits - 1) * 4; shift >= 0; shift -= 4)
            result.append(HEX[(int) ((value >>> shift) & 15)]);
    }

    private static String string(String text) {
        StringBuilder result = new StringBuilder("3");
        // Java char and JavaScript string comparison both use UTF-16 code units.
        for (int index = 0; index < text.length(); index++) hex(result, text.charAt(index), 4);
        return result.append('!').toString();
    }

    private static String value(Object key) throws Exception {
        if (key instanceof Number) return number('1', ((Number) key).doubleValue());
        if (key instanceof String) return string((String) key);
        if (key instanceof JSONArray) {
            StringBuilder result = new StringBuilder("5");
            JSONArray array = (JSONArray) key;
            for (int index = 0; index < array.length(); index++) result.append(value(array.get(index)));
            return result.append('!').toString();
        }
        if (key instanceof JSONObject) {
            JSONObject object = (JSONObject) key;
            if (object.has("__srlIdbDateKeyV1"))
                return number('2', dateMillis(object.getString("__srlIdbDateKeyV1")));
            JSONArray bytes = object.optJSONArray("__srlIdbBinaryKeyV1");
            if (bytes != null) {
                StringBuilder result = new StringBuilder("4");
                for (int index = 0; index < bytes.length(); index++) {
                    int item = bytes.getInt(index);
                    if (item < 0 || item > 255) throw new IllegalArgumentException("索引二进制键无效");
                    hex(result, item, 2);
                }
                return result.append('!').toString();
            }
        }
        throw new IllegalArgumentException("索引键类型无效");
    }

    private static long dateMillis(String iso) {
        Matcher match = ISO_DATE.matcher(iso);
        if (!match.matches()) throw new IllegalArgumentException("索引日期键无效");
        int year = Integer.parseInt(match.group(1));
        // java.time needs API 26. The app supports API 24; use proleptic Gregorian UTC instead.
        GregorianCalendar calendar = new GregorianCalendar(TimeZone.getTimeZone("UTC"), Locale.ROOT);
        calendar.setGregorianChange(new Date(Long.MIN_VALUE)); calendar.setLenient(false); calendar.clear();
        calendar.set(Calendar.ERA, year <= 0 ? GregorianCalendar.BC : GregorianCalendar.AD);
        calendar.set(Calendar.YEAR, year <= 0 ? 1 - year : year);
        calendar.set(Calendar.MONTH, Integer.parseInt(match.group(2)) - 1);
        calendar.set(Calendar.DAY_OF_MONTH, Integer.parseInt(match.group(3)));
        calendar.set(Calendar.HOUR_OF_DAY, Integer.parseInt(match.group(4)));
        calendar.set(Calendar.MINUTE, Integer.parseInt(match.group(5)));
        calendar.set(Calendar.SECOND, Integer.parseInt(match.group(6)));
        calendar.set(Calendar.MILLISECOND, Integer.parseInt(match.group(7)));
        return calendar.getTimeInMillis();
    }
}
