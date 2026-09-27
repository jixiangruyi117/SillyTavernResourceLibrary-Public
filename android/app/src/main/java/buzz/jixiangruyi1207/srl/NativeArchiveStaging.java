package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.net.Uri;
import android.util.AtomicFile;
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
    interface Checkpoint { void saved(int completed, int reused) throws Exception; }

    static synchronized JSObject stage(Context context, File source) throws Exception {
        return stage(context, source, (completed, reused) -> {});
    }

    static synchronized JSObject stage(Context context, File source, Checkpoint checkpoint) throws Exception {
        String id = NativeFileAccess.hash(source);
        File job = directory(context, id);
        if (!job.isDirectory() && !job.mkdirs()) throw new IOException("无法创建解压检查点目录");
        long total = 0;
        int completed = 0, reused = 0;
        Set<String> paths = new HashSet<>();
        try (ZipFile zip = new ZipFile(source)) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String path = entry.getName();
                if (!safePath(path) || !paths.add(path)) throw new IOException("备份包含不安全或重复路径");
                if (paths.size() > 100_000) throw new IOException("备份文件数量超过限制");
                if (entry.isDirectory()) continue;
                if (entry.getSize() < 0 || entry.getSize() > MAX_ENTRY || (total += entry.getSize()) > MAX_TOTAL) throw new IOException("备份解压后超过支持的大小限制");
                File output = payload(job, path);
                JSObject previous = metadata(job, path);
                if (previous != null && output.isFile() && output.length() == entry.getSize()
                    && previous.optLong("size", -1) == entry.getSize()
                    && NativeFileAccess.hash(output).equals(previous.optString("sha256"))) {
                    completed++;
                    reused++;
                    checkpoint.saved(completed, reused);
                    continue;
                }
                File partial = new File(output.getPath() + ".partial");
                CRC32 crc = new CRC32();
                long size = 0;
                try (InputStream input = zip.getInputStream(entry); FileOutputStream stream = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[256 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        size += count;
                        if (size > entry.getSize() || size > MAX_ENTRY) throw new IOException("ZIP 条目大小与目录不一致");
                        stream.write(buffer, 0, count);
                        crc.update(buffer, 0, count);
                    }
                    stream.getFD().sync();
                }
                if (size != entry.getSize() || crc.getValue() != entry.getCrc()) throw new IOException("ZIP 条目大小或 CRC 校验失败");
                if (output.exists() && !output.delete()) throw new IOException("无法替换损坏的解压检查点");
                if (!partial.renameTo(output)) throw new IOException("无法提交解压条目");
                JSObject meta = new JSObject();
                meta.put("path", path);
                meta.put("size", size);
                meta.put("sha256", NativeFileAccess.hash(output));
                meta.put("updatedAt", System.currentTimeMillis());
                write(new File(output.getPath() + ".json"), meta);
                completed++;
                checkpoint.saved(completed, reused);
            }
        }
        JSObject result = new JSObject();
        result.put("jobId", "native-zip-" + id);
        result.put("stagedBytes", total);
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

    private static String id(String value) throws IOException {
        if (value == null || !value.matches("native-zip-[a-f0-9]{64}")) throw new IOException("无效的解压任务");
        return value.substring("native-zip-".length());
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
