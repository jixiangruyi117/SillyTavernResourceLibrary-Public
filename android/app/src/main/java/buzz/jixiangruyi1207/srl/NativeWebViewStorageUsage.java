package buzz.jixiangruyi1207.srl;

import java.io.File;
import java.io.IOException;
import java.util.Locale;

/** Read-only directory accounting. No filenames, origins or file contents leave this helper. */
final class NativeWebViewStorageUsage {
    long siteDataBytes;
    long cacheBytes;
    long temporaryBlobBytes;
    long otherBytes;

    static NativeWebViewStorageUsage measure(File root) throws IOException {
        NativeWebViewStorageUsage usage = new NativeWebViewStorageUsage();
        usage.visit(root.getCanonicalFile(), "other");
        return usage;
    }

    long totalBytes() {
        return siteDataBytes + cacheBytes + temporaryBlobBytes + otherBytes;
    }

    private void visit(File file, String category) throws IOException {
        // Never follow links outside this tree or into a loop.
        if (!file.getCanonicalFile().equals(file.getAbsoluteFile())) return;
        String next = category;
        if ("other".equals(category)) {
            String name = file.getName().toLowerCase(Locale.ROOT);
            switch (name) {
                case "indexeddb":
                case "local storage":
                case "session storage":
                case "databases":
                case "webstorage":
                case "file system":
                    next = "site";
                    break;
                case "cache":
                case "code cache":
                case "cachestorage":
                case "scriptcache":
                case "gpucache":
                    next = "cache";
                    break;
                case "blob_storage":
                    next = "blob";
                    break;
                default:
                    break;
            }
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) throw new IOException("无法读取网页容器占用目录");
            for (File child : children) visit(child, next);
        } else if (file.isFile()) {
            long bytes = file.length();
            switch (next) {
                case "site": siteDataBytes += bytes; break;
                case "cache": cacheBytes += bytes; break;
                case "blob": temporaryBlobBytes += bytes; break;
                default: otherBytes += bytes;
            }
        }
    }
}
