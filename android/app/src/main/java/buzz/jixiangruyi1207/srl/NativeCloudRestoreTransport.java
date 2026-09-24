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
    interface ObjectLocator { File locate(String hash) throws Exception; }
    interface ObjectDownloader { void download(RestoreObject object, File temporary) throws Exception; }

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
        File taskRoot = new File(pendingRoot, UUID.randomUUID().toString());
        if (!taskRoot.mkdirs()) throw new IOException("无法创建原生恢复任务暂存目录");
        List<File> ownedFiles = new ArrayList<>();
        Map<String, File> verified = new HashMap<>();
        RestoreCounts counts = new RestoreCounts();
        try {
            for (RestoreResource resource : resources) {
                File destination = locator.locate(resource.hash);
                // The path is content-addressed, but a same-size local corruption must not be
                // accepted as a recovered original. Verification is the restore trust boundary.
                if (verifyFile(destination, resource.hash, resource.size)) {
                    counts.reused++;
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
                                downloader.download(object, source);
                                // Preserve the existing SHA/size trust boundary even for alternate transports.
                                if (!verifyFile(source, object.hash, object.size)) {
                                    throw new IOException("原生恢复对象大小或 SHA-256 校验失败");
                                }
                                counts.downloaded++;
                            }
                            verified.put(segment.hash, source);
                        }
                        written += copyRange(source, segment.offset, segment.size, output, digest, buffer);
                    }
                    output.getFD().sync();
                }
                if (written != resource.size || !resource.hash.equals(hex(digest.digest()))) {
                    throw new IOException("原生恢复资源大小或 SHA-256 校验失败");
                }
                installRestoredObject(temporary, destination, resource.size);
                counts.assembled++;
            }
            return counts;
        } finally {
            // Only files created by this call are eligible. Legacy CAS chunks, other jobs,
            // originals and unknown pre-existing pending files are deliberately untouched.
            for (File file : ownedFiles) {
                if (file.isFile()) file.delete();
            }
            deleteEmptyDirectory(taskRoot);
            deleteEmptyDirectory(pendingRoot);
        }
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
        Request.Builder request = new Request.Builder().url(url).get();
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
        try (Response response = NativeHttpClients.CLOUD.newCall(request.build()).execute()) {
            if (!response.isSuccessful()) {
                throw new CloudHttpStatusException(response.code(), "原生恢复对象下载失败（" + response.code() + "）");
            }
            ResponseBody body = response.body();
            if (body == null) throw new IOException("原生恢复对象响应为空");
            long declaredSize = body.contentLength();
            if (declaredSize >= 0 && declaredSize != expectedSize) {
                throw new IOException("原生恢复对象远端大小不一致");
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long written = 0L;
            try (InputStream input = body.byteStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[RESTORE_BUFFER_BYTES];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (written > expectedSize - count) {
                        throw new IOException("原生恢复对象超过声明大小");
                    }
                    output.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                    written += count;
                }
                output.getFD().sync();
            } catch (Exception error) {
                temporary.delete();
                throw error;
            }
            if (written != expectedSize || !expectedHash.equals(hex(digest.digest()))) {
                temporary.delete();
                throw new IOException("原生恢复对象大小或 SHA-256 校验失败");
            }
        }
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
            while ((count = input.read(buffer)) >= 0) digest.update(buffer, 0, count);
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
