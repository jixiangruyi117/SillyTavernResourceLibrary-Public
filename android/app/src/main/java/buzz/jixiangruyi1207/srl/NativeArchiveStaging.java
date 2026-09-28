package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.net.Uri;
import android.util.AtomicFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** File-backed implementation of RestoreStagingStore, with verified entry checkpoints. */
final class NativeArchiveStaging {
    private static final long MAX_ENTRY = 2L * 1024 * 1024 * 1024;
    private static final long MAX_TOTAL = 4L * 1024 * 1024 * 1024;
    interface Checkpoint {
        void progress(String phase, long readBytes, long sourceSize, int completed, int entryCount, int reused,
                      long stagedBytes, long totalStagedBytes) throws Exception;
    }

    static synchronized JSObject stage(Context context, File source) throws Exception {
        return stage(context, source, null, (phase, readBytes, sourceSize, completed, entryCount, reused, stagedBytes, totalStagedBytes) -> {});
    }

    static synchronized JSObject stage(Context context, File source, Checkpoint checkpoint) throws Exception {
        return stage(context, source, null, checkpoint);
    }

    static synchronized JSObject list(Context context, File source) throws Exception {
        cleanExpiredSessions(context);
        JSObject result = new JSObject();
        JSArray paths = new JSArray();
        Set<String> seen = new HashSet<>();
        long total = 0L;
        long nameBytes = 0L;
        try (ZipFile zip = new ZipFile(source)) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String path = entry.getName();
                if (!safePath(path) || !seen.add(path)) throw new IOException("备份包含不安全或重复路径");
                if (seen.size() > 100_000) throw new IOException("备份文件数量超过限制");
                nameBytes += path.getBytes(StandardCharsets.UTF_8).length;
                if (nameBytes > 8L * 1024 * 1024) throw new IOException("备份路径清单超过支持范围");
                if (!entry.isDirectory()) {
                    if (entry.getSize() < 0 || entry.getSize() > MAX_ENTRY || total > MAX_TOTAL - entry.getSize())
                        throw new IOException("备份解压后超过支持的大小限制");
                    total += entry.getSize();
                }
                paths.put(path);
            }
        }
        result.put("paths", paths);
        return result;
    }

    static synchronized JSObject stage(Context context, File source, Set<String> selectedPaths, Checkpoint checkpoint) throws Exception {
        long sourceSize = source.length();
        String id = selectedPaths == null
            ? NativeFileAccess.hash(source, (readBytes, totalBytes) ->
                checkpoint.progress("hashing", readBytes, totalBytes, 0, 0, 0, 0L, 0L))
            : UUID.randomUUID().toString().replace("-", "");
        boolean session = selectedPaths != null;
        File job = directory(context, session ? "session-" + id : id);
        if (!job.isDirectory() && !job.mkdirs()) throw new IOException("无法创建解压检查点目录");
        job.setLastModified(System.currentTimeMillis());
        long total = 0L;
        long selectedTotal = 0L;
        long stagedArchiveBytes = 0L;
        int completed = 0, reused = 0;
        Set<String> paths = new HashSet<>();
        List<ZipEntry> files = new ArrayList<>();
        try (ZipFile zip = new ZipFile(source)) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String path = entry.getName();
                if (!safePath(path) || !paths.add(path)) throw new IOException("备份包含不安全或重复路径");
                if (paths.size() > 100_000) throw new IOException("备份文件数量超过限制");
                if (entry.isDirectory()) continue;
                if (entry.getSize() < 0 || entry.getSize() > MAX_ENTRY || total > MAX_TOTAL - entry.getSize()) throw new IOException("备份解压后超过支持的大小限制");
                total += entry.getSize();
                if (selectedPaths == null || selectedPaths.contains(path)) {
                    files.add(entry);
                    selectedTotal += entry.getSize();
                }
            }
            stagedArchiveBytes = selectedTotal;
            final long archiveTotalBytes = stagedArchiveBytes;
            final int totalEntries = files.size();
            long stagedBytes = 0L;
            long lastProgressAt = 0L;
            for (ZipEntry entry : files) {
                String path = entry.getName();
                File output = payload(job, path);
                JSObject previous = metadata(job, path);
                final int completedBefore = completed;
                final int reusedBefore = reused;
                final long stagedBefore = stagedBytes;
                if (previous != null && output.isFile() && output.length() == entry.getSize()
                    && previous.optLong("size", -1) == entry.getSize()
                    && NativeFileAccess.hash(output, (readBytes, totalBytes) ->
                        checkpoint.progress("staging", readBytes, totalBytes, completedBefore, totalEntries, reusedBefore,
                            stagedBefore + readBytes, archiveTotalBytes))
                        .equals(previous.optString("sha256"))) {
                    completed++;
                    reused++;
                    stagedBytes += entry.getSize();
                            checkpoint.progress("staging", session ? stagedBytes : sourceSize,
                                session ? archiveTotalBytes : sourceSize, completed, totalEntries, reused, stagedBytes, archiveTotalBytes);
                    continue;
                }
                File partial = new File(output.getPath() + ".partial");
                CRC32 crc = new CRC32();
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long size = 0;
                try (InputStream input = zip.getInputStream(entry); FileOutputStream stream = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[256 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (size > entry.getSize() - count || size > MAX_ENTRY - count) throw new IOException("ZIP 条目大小与目录不一致");
                        stream.write(buffer, 0, count);
                        crc.update(buffer, 0, count);
                        digest.update(buffer, 0, count);
                        size += count;
                        long now = System.currentTimeMillis();
                        if (now - lastProgressAt >= 350 || size == entry.getSize()) {
                            checkpoint.progress("staging", session ? stagedBytes + size : sourceSize,
                                session ? archiveTotalBytes : sourceSize, completed, totalEntries, reused, stagedBytes + size, archiveTotalBytes);
                            lastProgressAt = now;
                        }
                    }
                    stream.getFD().sync();
                }
                if (size != entry.getSize() || crc.getValue() != entry.getCrc()) throw new IOException("ZIP 条目大小或 CRC 校验失败");
                if (output.exists() && !output.delete()) throw new IOException("无法替换损坏的解压检查点");
                if (!partial.renameTo(output)) throw new IOException("无法提交解压条目");
                JSObject meta = new JSObject();
                meta.put("path", path);
                meta.put("size", size);
                meta.put("sha256", hex(digest.digest()));
                meta.put("updatedAt", System.currentTimeMillis());
                write(new File(output.getPath() + ".json"), meta);
                completed++;
                stagedBytes += size;
                job.setLastModified(System.currentTimeMillis());
                checkpoint.progress("staging", session ? stagedBytes : sourceSize,
                    session ? archiveTotalBytes : sourceSize, completed, totalEntries, reused, stagedBytes, archiveTotalBytes);
            }
        } catch (Exception error) {
            if (session) {
                try { remove(context, "native-zip-session-" + id); } catch (Exception ignored) {}
            }
            throw error;
        }
        JSObject result = new JSObject();
        result.put("jobId", (session ? "native-zip-session-" : "native-zip-") + id);
        result.put("stagedBytes", stagedArchiveBytes);
        result.put("completedEntries", completed);
        result.put("reusedEntries", reused);
        return result;
    }

    static JSObject read(Context context, String jobId, String path) throws Exception {
        File job = directory(context, id(jobId));
        JSObject meta = metadata(job, path);
        JSObject result = new JSObject();
        if (meta == null) return result;
        File file = payload(job, path);
        if (!file.isFile() || file.length() != meta.optLong("size", -1)) throw new IOException("解压检查点文件已丢失");
        meta.put("jobId", jobId);
        meta.put("uri", Uri.fromFile(file).toString());
        result.put("entry", meta);
        return result;
    }

    static synchronized void remove(Context context, String jobId) throws Exception {
        File job = directory(context, id(jobId));
        File[] files = job.listFiles();
        if (files != null) for (File file : files) {
            if (!file.isFile() || !file.delete()) throw new IOException("无法清理解压检查点");
        }
        if (job.exists() && !job.delete()) throw new IOException("无法清理解压任务");
    }

    private static void cleanExpiredSessions(Context context) {
        File root = new File(context.getFilesDir(), "srl-archive-jobs");
        File[] sessions = root.listFiles(File::isDirectory);
        if (sessions == null) return;
        long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
        for (File session : sessions) {
            String name = session.getName();
            if (name.startsWith("session-") && name.matches("session-[a-f0-9]{32}") && session.lastModified() < cutoff) {
                try { remove(context, "native-zip-" + name); } catch (Exception ignored) {}
            }
        }
    }

    private static String id(String value) throws IOException {
        if (value == null || !value.matches("native-zip-(?:session-)?[a-f0-9]{32,64}")) throw new IOException("无效的解压任务");
        int separator = value.indexOf("-", "native-zip-".length());
        return separator < 0
            ? value.substring("native-zip-".length())
            : "session-" + value.substring(separator + 1);
    }
    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) value.append(String.format(Locale.ROOT, "%02x", item));
        return value.toString();
    }
    private static File directory(Context context, String id) { return new File(new File(context.getFilesDir(), "srl-archive-jobs"), id); }
    private static boolean safePath(String value) {
        return !value.isEmpty() && !value.startsWith("/") && !value.startsWith("\\")
            && !value.matches("(?i)^[a-z]:.*") && !Arrays.asList(value.split("[/\\\\]", -1)).contains("..");
    }
    private static File payload(File job, String path) throws Exception {
        if (!safePath(path)) throw new IOException("无效的解压条目路径");
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(path.getBytes(StandardCharsets.UTF_8));
        StringBuilder name = new StringBuilder();
        for (byte value : digest) name.append(String.format(Locale.ROOT, "%02x", value));
        return new File(job, name + ".bin");
    }
    private static JSObject metadata(File job, String path) throws Exception {
        AtomicFile file = new AtomicFile(new File(payload(job, path).getPath() + ".json"));
        if (!file.getBaseFile().exists()) return null;
        try (FileInputStream stream = file.openRead()) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = stream.read(buffer)) != -1) {
                if (bytes.size() + count > 1024 * 1024) throw new IOException("解压检查点元数据超过限制");
                bytes.write(buffer, 0, count);
            }
            JSObject value = new JSObject(bytes.toString("UTF-8"));
            return path.equals(value.optString("path")) ? value : null;
        }
    }
    private static void write(File target, JSObject value) throws Exception {
        AtomicFile file = new AtomicFile(target);
        FileOutputStream stream = file.startWrite();
        try {
            stream.write(value.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(stream);
        } catch (Exception error) { file.failWrite(stream); throw error; }
    }
}
