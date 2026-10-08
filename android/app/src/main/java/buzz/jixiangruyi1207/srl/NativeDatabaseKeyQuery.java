package buzz.jixiangruyi1207.srl;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bounded key-only range/seek queries against the existing record and index tables. */
final class NativeDatabaseKeyQuery {
    private static volatile Boolean rowValuesAvailable;
    static final class Plan {
        final String sql;
        final String[] args;
        final boolean count;
        Plan(String sql, ArrayList<String> args, boolean count) {
            this.sql = sql; this.args = args.toArray(new String[0]); this.count = count;
        }
    }

    static JSONObject query(SQLiteDatabase database, String store, JSONObject request) throws Exception {
        Plan plan = build(store, request, supportsRowValues(database));
        JSONObject result = new JSONObject();
        try (Cursor cursor = database.rawQuery(plan.sql, plan.args)) {
            if (plan.count) return result.put("count", cursor.moveToFirst() ? cursor.getLong(0) : 0L);
            JSONArray rows = new JSONArray();
            while (cursor.moveToNext()) rows.put(new JSONObject().put("indexKey", cursor.getString(0)).put("primaryKey", cursor.getString(1)));
            return result.put("rows", rows);
        }
    }

    static Plan build(String store, JSONObject request) {
        return build(store, request, true);
    }

    static Plan build(String store, JSONObject request, boolean rowValues) {
        String index = text(request, "indexName");
        boolean primary = index == null;
        boolean reverse = request.optBoolean("reverse");
        boolean unique = !primary && request.optBoolean("unique");
        String key = primary ? "i.record_sort_key" : "i.index_sort_key";
        String table = primary ? "app_records" : "app_record_indexes";
        ArrayList<String> args = new ArrayList<>();
        StringBuilder where = new StringBuilder("i.store_name = ?"); args.add(store);
        if (!primary) { where.append(" AND i.index_name = ?"); args.add(index); }
        bound(where, args, key, text(request, "lower"), request.optBoolean("lowerOpen") ? ">" : ">=");
        bound(where, args, key, text(request, "upper"), request.optBoolean("upperOpen") ? "<" : "<=");
        String after = text(request, "afterKey");
        if (after != null) {
            String afterPrimary = text(request, "afterPrimaryKey");
            if (primary || unique) bound(where, args, key, after, reverse ? "<" : ">");
            else {
                if (afterPrimary == null) throw new IllegalArgumentException("分页主键缺失");
                tuple(where, args, key, after, afterPrimary, reverse, false, rowValues);
            }
        }
        String seek = text(request, "seekKey");
        String seekPrimary = text(request, "seekPrimaryKey");
        if (seek != null && seekPrimary != null && !primary && !unique) {
            tuple(where, args, key, seek, seekPrimary, reverse, true, rowValues);
        } else bound(where, args, key, seek, reverse ? "<=" : ">=");
        if (unique) {
            // Both nextunique and prevunique return the lowest primary key of each index key.
            where.append(" AND NOT EXISTS (SELECT 1 FROM app_record_indexes u WHERE ")
                .append("u.store_name = i.store_name AND u.index_name = i.index_name ")
                .append("AND u.index_sort_key = i.index_sort_key AND u.record_sort_key < i.record_sort_key)");
        }
        if (request.optBoolean("countOnly")) {
            return new Plan("SELECT COUNT(*) FROM " + table + " i WHERE " + where, args, true);
        }
        int limit = request.optInt("limit", 100);
        long offset = request.optLong("offset", 0L);
        if (limit < 1 || limit > 1000 || offset < 0 || offset > 9_007_199_254_740_991L)
            throw new IllegalArgumentException("原生范围分页大小无效");
        String columns = primary ? "i.record_key, i.record_key" : "i.index_key, i.record_key";
        String order = key + (reverse ? " DESC" : " ASC") + (primary ? "" : ", i.record_sort_key" + (reverse ? " DESC" : " ASC"));
        args.add(Integer.toString(limit)); args.add(Long.toString(offset));
        return new Plan("SELECT " + columns + " FROM " + table + " i WHERE " + where +
            " ORDER BY " + order + " LIMIT ? OFFSET ?", args, false);
    }

    private static String text(JSONObject request, String name) {
        if (!request.has(name) || request.isNull(name)) return null;
        String value = request.optString(name, "");
        if (value.isEmpty() || value.length() > 2048) throw new IllegalArgumentException("原生范围键无效");
        return value;
    }

    private static void bound(StringBuilder where, ArrayList<String> args, String key, String value, String operator) {
        if (value == null) return;
        where.append(" AND ").append(key).append(' ').append(operator).append(" ?");
        args.add(NativeDatabaseKeyOrder.key(value));
    }

    private static void tuple(StringBuilder where, ArrayList<String> args, String key, String value,
            String primary, boolean reverse, boolean inclusive, boolean rowValues) {
        String direction = reverse ? "<" : ">";
        String comparison = direction + (inclusive ? "=" : "");
        String ordered = NativeDatabaseKeyOrder.key(value);
        if (rowValues) {
            where.append(" AND (").append(key).append(", i.record_sort_key) ").append(comparison).append(" (?, ?)");
            args.add(ordered);
        } else {
            // API 24 SQLite predates 3.15 tuple comparison. Keep the same indexed key boundary.
            where.append(" AND ").append(key).append(' ').append(direction).append("= ? AND (")
                .append(key).append(' ').append(direction).append(" ? OR i.record_sort_key ").append(comparison).append(" ?)");
            args.add(ordered); args.add(ordered);
        }
        args.add(NativeDatabaseKeyOrder.key(primary));
    }

    private static boolean supportsRowValues(SQLiteDatabase database) {
        Boolean available = rowValuesAvailable;
        if (available != null) return available;
        try (Cursor cursor = database.rawQuery("SELECT sqlite_version()", null)) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("SQLite 版本无法读取");
            String[] parts = cursor.getString(0).split("\\.");
            int major = Integer.parseInt(parts[0]), minor = Integer.parseInt(parts[1]);
            available = major > 3 || (major == 3 && minor >= 15);
        }
        rowValuesAvailable = available;
        return available;
    }
}
