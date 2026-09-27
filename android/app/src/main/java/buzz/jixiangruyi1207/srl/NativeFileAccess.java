package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.net.Uri;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.Locale;

/** Only files owned by resource/import pipelines may be exposed to bridge operations. */
final class NativeFileAccess {
    static File resolve(Context context, String value) throws Exception {
        if (value == null) throw new IOException("缺少原生文件位置");
        Uri uri = Uri.parse(value);
        if (uri.getScheme() != null && !"file".equals(uri.getScheme())) throw new IOException("不支持的原生文件位置");
        File file = new File(uri.getScheme() == null ? value : uri.getPath()).getCanonicalFile();
        File taskRoot = new File(context.getFilesDir(), "srl-archive-tasks").getCanonicalFile();
        if(taskRoot.equals(file.getParentFile()) && file.isFile() && file.getName().matches("[0-9a-f]{8}-[0-9a-f-]{27}\\.source")) return file;
        File[] roots = {
            new File(NativeLibraryPlugin.libraryRoot(context), "objects"),
            new File(context.getFilesDir(), "srl-shared-intake"),
            new File(context.getFilesDir(), "srl-archive-jobs"),
            new File(context.getCacheDir(), "picked-images")
        };
        for (File root : roots) {
            if (file.getPath().startsWith(root.getCanonicalPath() + File.separator) && file.isFile()) return file;
        }
        throw new IOException("文件不属于资源库原件或导入暂存目录");
    }

    static String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[256 * 1024];
        try (FileInputStream input = new FileInputStream(file)) {
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        StringBuilder hex = new StringBuilder(64);
        for (byte value : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", value));
        return hex.toString();
    }
}
