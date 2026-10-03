package buzz.jixiangruyi1207.srl;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Per-object durable metadata for scalable native cloud upload jobs. */
final class NativeCloudJobStore {
    private static final String OBJECTS_DIRECTORY = "objects";
    private static final String NAMES_DIRECTORY = "object-names";
    private static final int READ_PAGE_SIZE = 64;
    private static final int MAX_OBJECTS = 50_000;

    private NativeCloudJobStore() {}

    static boolean usesPerObjectFiles(JSONObject job) {
        return job.optInt("version", 0) >= 3;
    }

    static int objectCount(JSONObject job) throws Exception {
        if (usesPerObjectFiles(job)) return job.optInt("objectCount", 0);
        JSONArray objects = job.optJSONArray("objects");
        return objects == null ? 0 : objects.length();
    }

    static List<JSONObject> readRange(File root, JSONObject job, int start, int limit) throws Exception {
        List<JSONObject> result = new ArrayList<>();
        if (start < 0 || limit < 0) throw new IllegalArgumentException("云对象读取范围无效");
        if (!usesPerObjectFiles(job)) {
            JSONArray objects = job.optJSONArray("objects");
            if (objects == null) return result;
            int end = Math.min(objects.length(), start + limit);
            for (int index = start; index < end; index++) result.add(objects.getJSONObject(index));
            return result;
        }
        int count = job.optInt("objectCount", 0);
        int end = Math.min(count, start + Math.min(limit, READ_PAGE_SIZE));
        for (int index = start; index < end; index++) {
            File file = objectFile(root, index);
            result.add(readJson(file));
        }
        return result;
    }

    static List<JSONObject> readAll(File root, JSONObject job) throws Exception {
        int count = objectCount(job);
        List<JSONObject> result = new ArrayList<>(count);
        for (int start = 0; start < count; start += READ_PAGE_SIZE) {
            result.addAll(readRange(root, job, start, READ_PAGE_SIZE));
        }
        return result;
    }

    /** Writes one immutable entry and O(1) duplicate-name marker. Caller persists the small job header. */
    static void append(File root, JSONObject job, JSONObject entry) throws Exception {
        if (!usesPerObjectFiles(job)) throw new IllegalStateException("旧版云任务不能追加分项元数据");
        int previousCount = job.optInt("objectCount", 0);
        recoverUncommittedTail(root, job);
        int count = job.optInt("objectCount", 0);
        if (count > previousCount) {
            JSONObject recovered = readJson(objectFile(root, count - 1));
            if (entry.optString("token").equals(recovered.optString("token"))
                && entry.optString("name").equals(recovered.optString("name"))) return;
        }
        int expected = job.optInt("expectedTotal", 0);
        if (count >= MAX_OBJECTS) throw new IllegalStateException("原生云任务对象数超过上限：" + MAX_OBJECTS);
        if (expected > 0 && count >= expected) throw new IllegalStateException("原生云任务暂存对象超过预期数量");
        String name = entry.getString("name");
        File names = new File(root, NAMES_DIRECTORY);
        if (!names.exists() && !names.mkdirs()) throw new IllegalStateException("无法创建云对象名称索引");
        File nameMarker = nameMarker(root, name);
        if (nameMarker.exists()) throw new IllegalStateException("原生云任务包含重复对象名称");
        boolean manifest = entry.optBoolean("manifest", false);
        if (manifest && job.optBoolean("manifestStaged", false)) {
            throw new IllegalStateException("原生云任务只能暂存一个最终清单");
        }

        entry.put("stagingIndex", count);
        File target = objectFile(root, count);
        writeJsonAtomic(target, entry);
        try {
            if (!nameMarker.createNewFile()) throw new IllegalStateException("原生云任务包含重复对象名称");
        } catch (Exception error) {
            target.delete();
            nameMarker.delete();
            throw error;
        }
        job.put("objectCount", count + 1);
        long size = entry.optLong("size", 0L);
        long totalBytes = job.optLong("totalBytes", 0L);
        if (size > 0L && totalBytes <= Long.MAX_VALUE - size) job.put("totalBytes", totalBytes + size);
        if (manifest) job.put("manifestStaged", true);
    }

    /** Recovers the narrow crash window after an entry was written but before its header was committed. */
    private static void recoverUncommittedTail(File root, JSONObject job) throws Exception {
        int count = job.optInt("objectCount", 0);
        while (count < MAX_OBJECTS) {
            File file = objectFile(root, count);
            if (!file.exists()) return;
            JSONObject orphan;
            try {
                orphan = readJson(file);
            } catch (Exception invalid) {
                file.delete();
                return;
            }
            String name = orphan.optString("name", "");
            if (orphan.optInt("stagingIndex", -1) != count || name.isEmpty()) {
                file.delete();
                return;
            }
            File marker = nameMarker(root, name);
            if (!marker.isFile()) {
                file.delete();
                return;
            }
            if (orphan.optBoolean("manifest") && job.optBoolean("manifestStaged", false)) {
                throw new IllegalStateException("原生云任务暂存状态与尾部清单冲突");
            }
            job.put("objectCount", ++count);
            long size = orphan.optLong("size", 0L);
            long totalBytes = job.optLong("totalBytes", 0L);
            if (size > 0L && totalBytes <= Long.MAX_VALUE - size) job.put("totalBytes", totalBytes + size);
            if (orphan.optBoolean("manifest")) job.put("manifestStaged", true);
        }
    }

    static void rollbackLastAppend(File root, JSONObject job, JSONObject entry) throws Exception {
        int index = entry.optInt("stagingIndex", -1);
        if (index >= 0) objectFile(root, index).delete();
        nameMarker(root, entry.optString("name", "")).delete();
        job.put("objectCount", Math.max(0, index));
        job.put("totalBytes", Math.max(0L, job.optLong("totalBytes", 0L) - entry.optLong("size", 0L)));
        if (entry.optBoolean("manifest")) job.put("manifestStaged", false);
    }

    /** Updates only the selected object file; returns true if this is its first successful upload. */
    static boolean markUploaded(File root, JSONObject job, JSONObject uploadedEntry, String resultId) throws Exception {
        if (!usesPerObjectFiles(job)) {
            JSONArray objects = job.getJSONArray("objects");
            String token = uploadedEntry.getString("token");
            for (int index = 0; index < objects.length(); index++) {
                JSONObject stored = objects.getJSONObject(index);
                if (!token.equals(stored.optString("token"))) continue;
                if (stored.optBoolean("uploaded", false)) return false;
                stored.put("uploaded", true);
                if (resultId != null) stored.put("resultId", resultId);
                job.put("completed", job.optInt("completed", 0) + 1);
                return true;
            }
            throw new IllegalStateException("原生云任务找不到已上传对象");
        }
        int index = uploadedEntry.getInt("stagingIndex");
        File file = objectFile(root, index);
        JSONObject stored = readJson(file);
        if (!uploadedEntry.getString("token").equals(stored.optString("token"))) {
            throw new IllegalStateException("原生云对象元数据标识不匹配");
        }
        if (stored.optBoolean("uploaded", false)) return false;
        stored.put("uploaded", true);
        if (resultId != null) stored.put("resultId", resultId);
        writeJsonAtomic(file, stored);
        job.put("completed", job.optInt("completed", 0) + 1);
        return true;
    }

    static void validate(File root, JSONObject job, int expectedTotal) throws Exception {
        if (usesPerObjectFiles(job)) recoverUncommittedTail(root, job);
        int count = objectCount(job);
        if (count != expectedTotal) {
            throw new IllegalStateException("原生云任务暂存数量不完整：" + count + " / " + expectedTotal);
        }
        int manifests = 0;
        java.util.HashSet<String> names = new java.util.HashSet<>();
        for (JSONObject entry : readAll(root, job)) {
            if (!names.add(entry.optString("name"))) throw new IllegalStateException("原生云任务包含重复对象名称");
            if (entry.optBoolean("manifest")) manifests++;
        }
        if (manifests != 1) throw new IllegalStateException("原生云任务必须且只能暂存一个最终清单");
    }

    static JSONObject readManifest(File root, JSONObject job) throws Exception {
        for (JSONObject entry : readAll(root, job)) {
            if (entry.optBoolean("manifest")) return entry;
        }
        return null;
    }

    /** Object markers are durable before the small header; reconcile once when a worker resumes. */
    static void reconcileCompleted(File root, JSONObject job) throws Exception {
        int completed = 0;
        int count = objectCount(job);
        for (int start = 0; start < count; start += READ_PAGE_SIZE) {
            for (JSONObject entry : readRange(root, job, start, READ_PAGE_SIZE)) {
                if (entry.optBoolean("uploaded", false)) completed++;
            }
        }
        job.put("completed", completed);
    }

    private static File objectFile(File root, int index) {
        return new File(new File(root, OBJECTS_DIRECTORY), String.format(Locale.ROOT, "%08d.json", index));
    }

    private static File nameMarker(File root, String name) throws Exception {
        return new File(new File(root, NAMES_DIRECTORY), sha256(name) + ".idx");
    }

    private static synchronized JSONObject readJson(File file) throws Exception {
        try {
            return readJsonFile(file);
        } catch (Exception primaryError) {
            // A process can stop after primary -> backup but before temporary -> primary.
            // Only committed metadata is eligible; an uncommitted .tmp is never promoted.
            File backup = new File(file.getParentFile(), file.getName() + ".bak");
            if (!backup.isFile()) throw primaryError;
            return readJsonFile(backup);
        }
    }

    private static JSONObject readJsonFile(File file) throws Exception {
        if (!file.isFile() || file.length() > 64 * 1024) throw new IllegalStateException("原生云对象元数据缺失或过大");
        byte[] bytes = new byte[(int) file.length()];
        try (FileInputStream input = new FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int read = input.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
        }
        return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
    }

    private static synchronized void writeJsonAtomic(File target, JSONObject value) throws Exception {
        File parent = target.getParentFile();
        if (!parent.exists() && !parent.mkdirs()) throw new IllegalStateException("无法创建云对象元数据目录");
        File temporary = new File(parent, target.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(value.toString().getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        File backup = new File(parent, target.getName() + ".bak");
        if (target.exists()) {
            if (backup.exists() && !backup.delete()) throw new IllegalStateException("无法清理云对象元数据备份");
            if (!target.renameTo(backup)) throw new IllegalStateException("无法备份云对象元数据");
        }
        if (!temporary.renameTo(target)) {
            if (backup.exists()) backup.renameTo(target);
            throw new IllegalStateException("无法提交云对象元数据");
        }
        backup.delete();
    }

    private static String sha256(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte item : digest) hex.append(String.format(Locale.ROOT, "%02x", item));
        return hex.toString();
    }
}
