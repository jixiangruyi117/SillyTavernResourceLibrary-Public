package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.util.AtomicFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Durable archive plans share the existing Keystore owner; no plaintext credentials in journals. */
final class NativeArchiveTasks {
    static File root(Context context) throws Exception {
        File root = new File(context.getFilesDir(), "srl-archive-tasks");
        if (!root.isDirectory() && !root.mkdirs()) throw new IllegalStateException("无法创建任务目录");
        return root;
    }

    private static AtomicFile file(Context context, String id) throws Exception {
        if (id == null || !id.matches("[0-9a-f]{8}-[0-9a-f-]{27}")) throw new IllegalArgumentException("任务标识无效");
        return new AtomicFile(new File(root(context), id + ".json"));
    }

    static synchronized void save(Context context, JSObject task) throws Exception {
        String id = task.getString("id");
        AtomicFile file = file(context, id);
        writeJson(context, file, task);
    }

    static void writeJson(Context context, AtomicFile file, JSObject value) throws Exception {
        byte[] bytes = new NativeSecretStore(context).encrypt(value.toString()).getBytes(StandardCharsets.UTF_8);
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(bytes);
            file.finishWrite(output);
        } catch (Exception error) {
            if (output != null) file.failWrite(output);
            throw error;
        }
    }

    static JSObject readJson(Context context, AtomicFile file) throws Exception {
        return new JSObject(new NativeSecretStore(context).decrypt(new String(file.readFully(), StandardCharsets.UTF_8)));
    }

    static synchronized JSObject read(Context context, String id) throws Exception {
        AtomicFile file = file(context, id);
        if (!file.getBaseFile().exists() && !new File(file.getBaseFile() + ".bak").exists()) return null;
        String encrypted = new String(file.readFully(), StandardCharsets.UTF_8);
        JSObject task = new JSObject(new NativeSecretStore(context).decrypt(encrypted));
        if (!id.equals(task.getString("id"))) throw new IllegalStateException("任务标识校验失败");
        return task;
    }

    static synchronized JSArray list(Context context) throws Exception {
        JSArray result = new JSArray();
        File[] files = root(context).listFiles();
        if (files == null) return result;
        java.util.Set<String> ids = new java.util.HashSet<>();
        for (File file : files) {
            String name = file.getName();
            if (name.matches("[0-9a-f]{8}-[0-9a-f-]{27}\\.json(?:\\.bak)?")) ids.add(name.substring(0, 36));
        }
        for (String id : ids) {
            JSObject task = read(context, id);
            if (task == null) continue;
            JSObject summary = new JSObject();
            for (String key : new String[]{"id", "kind", "name", "phase", "updatedAt"}) summary.put(key, task.opt(key));
            result.put(summary);
        }
        return result;
    }

    static synchronized void remove(Context context, String id) throws Exception {
        AtomicFile journal = file(context, id);
        File source = new File(root(context), id+".source");
        if(source.exists() && !source.delete()) throw new IOException("无法清理恢复源文件副本");
        journal.delete();
    }

    static synchronized void beginSource(Context context, String id) throws Exception {
        file(context,id); // Validate the opaque task identifier.
        try (FileOutputStream output=new FileOutputStream(new File(root(context),id+".source"))) { output.getFD().sync(); }
    }

    static synchronized void appendSource(Context context, String id, long offset, byte[] bytes) throws Exception {
        file(context,id);
        File source=new File(root(context),id+".source");
        if(!source.isFile() || source.length()!=offset || bytes.length>1024*1024) throw new IOException("恢复源文件分块位置无效");
        try(FileOutputStream output=new FileOutputStream(source,true)) { output.write(bytes); }
    }

    static synchronized String finishSource(Context context, String id, long size, String hash) throws Exception {
        file(context,id);
        File source=new File(root(context),id+".source");
        if(!source.isFile() || source.length()!=size || !NativeFileAccess.hash(source).equals(hash)) throw new IOException("恢复源文件副本校验失败");
        try(java.io.RandomAccessFile file=new java.io.RandomAccessFile(source,"rw")) { file.getFD().sync(); }
        return android.net.Uri.fromFile(source).toString();
    }

    static synchronized java.util.Set<String> retainedSourcePaths(Context context) throws Exception {
        java.util.Set<String> result = new java.util.HashSet<>();
        JSArray tasks = list(context);
        for (int index = 0; index < tasks.length(); index++) {
            JSObject task = read(context, tasks.getJSONObject(index).getString("id"));
            org.json.JSONObject payload = task.optJSONObject("payload");
            org.json.JSONObject source = payload == null ? null : payload.optJSONObject("source");
            if (source == null || !source.has("uri")) continue;
            android.net.Uri uri = android.net.Uri.parse(source.getString("uri"));
            if (uri.getPath() != null) result.add(new File(uri.getPath()).getCanonicalPath());
        }
        return result;
    }
}
