package buzz.jixiangruyi1207.srl;

import android.util.Base64;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;


final class NativeCloudRestoreTransport {
    static final int RESTORE_BUFFER_BYTES = 256 * 1024;
    static final class IntegrityException extends IOException {
        IntegrityException(String message) { super(message); }
    }
    interface ObjectLocator { File locate(String hash) throws Exception; }
    interface ObjectDownloader { void download(RestoreObject object, File temporary) throws Exception; }
    interface RestoreProgress { void update(int completed, int total) throws Exception; }

    static final class RestoreObject {
        final String hash;
        final long size;
        final String url;
        RestoreObject(String hash, long size, String url) {
            this.hash = hash; this.size = size; this.url = url;
        }
    }

    static final class RestoreSegment {
        final String hash;
        final long offset;
        final long size;
        RestoreSegment(String hash, long offset, long size) {
            this.hash = hash; this.offset = offset; this.size = size;
        }
    }

    static final class RestoreResource {
        final String hash;
        final long size;
        final List<RestoreSegment> segments;
        RestoreResource(String hash, long size, List<RestoreSegment> segments) {
            this.hash = hash; this.size = size; this.segments = segments;
        }
    }

    static final class RestoreCounts {
        int downloaded;
        int reused;
        int assembled;
    }

    /** Transport chunks belong to this invocation, never to the formal resource object store.
     * The caller supplies the existing NativeLibrary content-addressed locator (no second index).
     * Existing originals and legacy chunks are verified only when needed, not by a full-disk scan.
     */
    static RestoreCounts restoreFiles(
        File pendingRoot, List<RestoreObject> objects, List<RestoreResource> resources,
        ObjectLocator locator, ObjectDownloader downloader
    ) throws Exception {
        return restoreFiles(pendingRoot, objects, resources, locator, downloader, false, (completed, total) -> {});
    }

    static RestoreCounts restoreFiles(
        File pendingRoot, List<RestoreObject> objects, List<RestoreResource> resources,
        ObjectLocator locator, ObjectDownloader downloader, boolean resumable, RestoreProgress progress
    ) throws Exception {
        Map<String, RestoreObject> byHash = validatePlan(objects, resources);
        File taskRoot = resumable ? pendingRoot : new File(pendingRoot, UUID.randomUUID().toString());
        if (!taskRoot.isDirectory() && !taskRoot.mkdirs()) throw new IOException("无法创建原生恢复任务暂存目录");
        if (resumable) {
            File[] abandoned = taskRoot.listFiles(file -> file.isFile() && file.getName().matches("[a-f0-9-]{36}\\.resource\\.part"));
            if (abandoned != null) for (File file : abandoned) {
                if (!file.delete()) throw new IllegalStateException("无法清理已中断的原件拼装文件");
            }
        }
        List<File> ownedFiles = new ArrayList<>();
        if (resumable) for (RestoreObject object : objects) ownedFiles.add(new File(taskRoot, object.hash + ".chunk.part"));
        Map<String, File> verified = new HashMap<>();
        RestoreCounts counts = new RestoreCounts();
        boolean successful = false;
        int completed = 0;
        try {
            for (RestoreResource resource : resources) {
                progress.update(completed, resources.size());
                File destination = locator.locate(resource.hash);
                if (verifyFile(destination, resource.hash, resource.size)) {
                    counts.reused++;
                    progress.update(++completed, resources.size());
                    continue;
                }
                File temporary = new File(taskRoot, UUID.randomUUID() + ".resource.part");
                ownedFiles.add(temporary);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long written = 0;
                try (FileOutputStream output = new FileOutputStream(temporary)) {
                    byte[] buffer = new byte[RESTORE_BUFFER_BYTES];
                    for (RestoreSegment segment : resource.segments) {
                        File source = verified.get(segment.hash);
                        if (source == null) {
                            RestoreObject object = byHash.get(segment.hash);
                            File legacy = locator.locate(segment.hash);
                            if (verifyFile(legacy, object.hash, object.size)) {
                                source = legacy;
                                counts.reused++;
                            } else {
                                source = new File(taskRoot, object.hash + ".chunk.part");
                                ownedFiles.add(source);
                                if (!verifyFile(source, object.hash, object.size)) {
                                    downloader.download(object, source);
                                    counts.downloaded++;
                                } else counts.reused++;
                                if (!verifyFile(source, object.hash, object.size)) {
                                    source.delete();
                                    throw new IntegrityException("原生恢复对象大小或 SHA-256 校验失败");
                                }
                            }
                            verified.put(segment.hash, source);
                        }
                        written += copyRange(source, segment.offset, segment.size, output, digest, buffer);
                    }
                    output.getFD().sync();
                }
                if (written != resource.size || !resource.hash.equals(hex(digest.digest()))) {
                    throw new IntegrityException("原生恢复资源大小或 SHA-256 校验失败");
                }
                installRestoredObject(temporary, destination, resource.size);
                counts.assembled++;
                progress.update(++completed, resources.size());
            }
            successful = true;
            return counts;
        } finally {
            for (File file : ownedFiles) {
                if (file.isFile() && (!resumable || successful || !file.getName().endsWith(".chunk.part"))) file.delete();
            }
            deleteEmptyDirectory(taskRoot);
            deleteEmptyDirectory(pendingRoot);
        }
    }

    static Map<String, RestoreObject> validatePlan(List<RestoreObject> objects, List<RestoreResource> resources) {
        Map<String, RestoreObject> byHash = new HashMap<>();
        for (RestoreObject object : objects) {
            RestoreObject previous = byHash.put(object.hash, object);
            if (previous != null && previous.size != object.size) {
                throw new IllegalArgumentException("原生恢复对象的重复声明不一致");
            }
        }
        // Validate all ranges before any download or installation, including already-local resources.
        for (RestoreResource resource : resources) {
            long total = 0;
            for (RestoreSegment segment : resource.segments) {
                RestoreObject object = byHash.get(segment.hash);
                if (object == null || segment.offset < 0 || segment.size < 0
                    || segment.offset > object.size || segment.size > object.size - segment.offset
                    || segment.size > resource.size - total) {
                    throw new IllegalArgumentException("原生恢复资源分段范围无效");
                }
                total += segment.size;
            }
            if (total != resource.size) throw new IllegalArgumentException("原生恢复资源分段总量不一致");
        }
        return byHash;
    }

    static void validateRestoreUri(String provider, URI uri, String webDavHost) {
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
            throw new IllegalArgumentException("原生恢复对象只允许 HTTPS 地址");
        }
        if ("github".equals(provider) && !"api.github.com".equalsIgnoreCase(uri.getHost())) {
            throw new IllegalArgumentException("GitHub 原生恢复对象地址无效");
        }
        if ("webdav".equals(provider) && !webDavHost.equalsIgnoreCase(uri.getHost())) {
            throw new IllegalArgumentException("WebDAV 原生恢复对象地址与配置不一致");
        }
    }

    static void downloadRestoreObject(
        String provider,
        String url,
        String secret,
        String webDavUsername,
        String expectedHash,
        long expectedSize,
        File temporary
    ) throws Exception {
        downloadRestoreObject(provider, url, secret, webDavUsername, expectedHash, expectedSize, temporary, call -> {});
    }

    static void downloadRestoreObject(
        String provider, String url, String secret, String webDavUsername, String expectedHash,
        long expectedSize, File temporary, java.util.function.Consumer<okhttp3.Call> onCall
    ) throws Exception {
        if (temporary.isFile() && temporary.length() >= expectedSize) {
            if (verifyFile(temporary, expectedHash, expectedSize)) return;
            if (!temporary.delete()) throw new IllegalStateException("无法清理损坏的恢复断点");
        }
        long offset = temporary.isFile() ? temporary.length() : 0;
        Request.Builder request = new Request.Builder().url(url).get();
        request.header("Accept-Encoding", "identity");
        if (offset > 0) request.header("Range", "bytes=" + offset + "-");
        if ("github".equals(provider)) {
            request.header("Accept", "application/octet-stream");
            request.header("Authorization", "Bearer " + secret);
            request.header("X-GitHub-Api-Version", "2022-11-28");
        } else {
            String credentials = webDavUsername + ":" + secret;
            request.header(
                "Authorization",
                "Basic " + Base64.encodeToString(credentials.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP)
            );
        }
        okhttp3.Call call = NativeHttpClients.CLOUD.newCall(request.build());
        onCall.accept(call);
        try (Response response = call.execute()) {
            if (!response.isSuccessful()) {
                throw new CloudHttpStatusException(response.code(), "原生恢复对象下载失败（" + response.code() + "）");
            }
            ResponseBody body = response.body();
            if (body == null) throw new IOException("原生恢复对象响应为空");
            offset = restoreResponseOffset(response.code(), response.header("Content-Range"), offset, expectedSize);
            long declaredSize = body.contentLength();
            if (declaredSize >= 0 && declaredSize != expectedSize - offset) {
                throw new IllegalStateException("原生恢复对象远端大小不一致");
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            if (offset > 0) try (FileInputStream prefix = new FileInputStream(temporary)) {
                byte[] buffer = new byte[RESTORE_BUFFER_BYTES];
                int count;
                while ((count = prefix.read(buffer)) >= 0) digest.update(buffer, 0, count);
            }
            long written = offset;
            try (InputStream input = body.byteStream(); FileOutputStream output = new FileOutputStream(temporary, offset > 0)) {
              try {
                byte[] buffer = new byte[RESTORE_BUFFER_BYTES];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException("云恢复已暂停");
                    if (written > expectedSize - count) {
                        temporary.delete();
                        throw new IllegalStateException("原生恢复对象超过声明大小");
                    }
                    output.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                    written += count;
                }
              } finally { output.getFD().sync(); }
            }
            if (written != expectedSize) throw new IOException("原生恢复对象下载中断；已保留断点");
            if (!expectedHash.equals(hex(digest.digest()))) {
                temporary.delete();
                throw new IllegalStateException("原生恢复对象大小或 SHA-256 校验失败");
            }
        }
    }

    /** A server may ignore Range with 200; only an exact suffix 206 can append bytes. */
    static long restoreResponseOffset(int status, String range, long offset, long size) {
        if (status == 200) return 0;
        if (status != 206 || range == null || offset < 0 || offset >= size) throw new IllegalStateException("原生恢复断点响应无效");
        java.util.regex.Matcher match = java.util.regex.Pattern.compile("bytes (\\d+)-(\\d+)/(\\d+)").matcher(range);
        try {
            if (!match.matches() || Long.parseLong(match.group(1)) != offset
                || Long.parseLong(match.group(2)) != size - 1 || Long.parseLong(match.group(3)) != size) {
                throw new IllegalStateException("原生恢复断点范围不一致");
            }
        } catch (NumberFormatException invalid) { throw new IllegalStateException("原生恢复断点范围无效", invalid); }
        return offset;
    }

    static boolean isReusableCasObject(File file, long expectedSize) {
        return file.isFile() && file.length() == expectedSize;
    }

    static boolean verifyFile(File file, String expectedHash, long expectedSize) throws Exception {
        if (!isReusableCasObject(file, expectedSize)) return false;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[RESTORE_BUFFER_BYTES];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException("云恢复已暂停");
                digest.update(buffer, 0, count);
            }
        }
        return expectedHash.equals(hex(digest.digest()));
    }

    static long copyRange(
        File source,
        long offset,
        long size,
        FileOutputStream output,
        MessageDigest digest,
        byte[] buffer
    ) throws Exception {
        try (RandomAccessFile input = new RandomAccessFile(source, "r")) {
            input.seek(offset);
            long remaining = size;
            while (remaining > 0) {
                if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException("云恢复已暂停");
                int count = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (count < 0) throw new IOException("原生恢复资源分段被截断");
                output.write(buffer, 0, count);
                digest.update(buffer, 0, count);
                remaining -= count;
            }
        }
        return size;
    }

    static void installRestoredObject(File source, File destination, long expectedSize) throws Exception {
        File parent = destination.getParentFile();
        if (!parent.exists() && !parent.mkdirs()) throw new IOException("无法创建原生对象目录");
        if (destination.exists() && !destination.delete()) throw new IOException("无法替换异常原生对象");
        if (!source.renameTo(destination)) {
            try (FileInputStream input = new FileInputStream(source);
                 FileOutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[RESTORE_BUFFER_BYTES];
                int count;
                while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
                output.getFD().sync();
            } catch (Exception error) {
                destination.delete();
                throw error;
            }
            source.delete();
        }
        if (!destination.isFile() || destination.length() != expectedSize) {
            destination.delete();
            throw new IOException("无法提交原生恢复对象");
        }
    }

    static void deleteEmptyDirectory(File directory) {
        File[] children = directory.listFiles();
        if (children != null && children.length == 0) directory.delete();
    }

    static String hex(byte[] bytes) { StringBuilder value = new StringBuilder(); for (byte item : bytes) value.append(String.format(Locale.ROOT, "%02x", item)); return value.toString(); }
    static final class CloudHttpStatusException extends IOException {
        final int status;
        CloudHttpStatusException(int status, String message) { super(message); this.status = status; }
    }
}
