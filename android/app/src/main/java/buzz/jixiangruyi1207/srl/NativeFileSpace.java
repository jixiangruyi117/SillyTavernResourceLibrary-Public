package buzz.jixiangruyi1207.srl;

import android.os.StatFs;
import java.io.File;

final class NativeFileSpace {
    private NativeFileSpace() {}
    static long directoryBytes(File directory) {
        if (directory == null || !directory.exists()) return 0L;
        File[] files = directory.listFiles();
        if (files == null) return directory.isFile() ? directory.length() : 0L;
        long bytes = 0L;
        for (File file : files) bytes += file.isDirectory() ? directoryBytes(file) : file.length();
        return bytes;
    }

    static long availableBytes(File primary, File secondary) {
        long primaryAvailable = availableBytes(primary);
        long secondaryAvailable = availableBytes(secondary);
        if (primaryAvailable <= 0L) return secondaryAvailable;
        if (secondaryAvailable <= 0L) return primaryAvailable;
        return Math.min(primaryAvailable, secondaryAvailable);
    }

    static long availableBytes(File directory) {
        if (directory == null || !directory.exists()) return 0L;
        try {
            return new StatFs(directory.getAbsolutePath()).getAvailableBytes();
        } catch (IllegalArgumentException ignored) {
            return 0L;
        }
    }

}
