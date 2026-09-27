package buzz.jixiangruyi1207.srl;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.util.UUID;

@CapacitorPlugin(name = "NativeArchive")
public class NativeArchivePlugin extends Plugin {
    @PluginMethod public void beginArchiveSource(PluginCall call) {
        runIo(call, () -> { NativeArchiveTasks.beginSource(getContext(),call.getString("id")); call.resolve(); });
    }
    @PluginMethod public void appendArchiveSource(PluginCall call) {
        runIo(call, () -> {
            String data=call.getString("data", "");
            if(data.length()>1400000) throw new IllegalArgumentException("恢复分块过大");
            NativeArchiveTasks.appendSource(getContext(),call.getString("id"),call.getLong("offset",-1L),android.util.Base64.decode(data,android.util.Base64.NO_WRAP));
            call.resolve();
        });
    }
    @PluginMethod public void finishArchiveSource(PluginCall call) {
        runIo(call, () -> { JSObject result=new JSObject(); result.put("uri",NativeArchiveTasks.finishSource(getContext(),call.getString("id"),call.getLong("size",-1L),call.getString("hash"))); call.resolve(result); });
    }
    @PluginMethod
    public void saveArchiveTask(PluginCall call) {
        runIo(call, () -> { NativeArchiveTasks.save(getContext(), call.getObject("task")); call.resolve(); });
    }

    @PluginMethod
    public void readArchiveTask(PluginCall call) {
        runIo(call, () -> {
            JSObject result = new JSObject();
            result.put("task", NativeArchiveTasks.read(getContext(), call.getString("id")));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void listArchiveTasks(PluginCall call) {
        runIo(call, () -> { JSObject result = new JSObject(); result.put("tasks", NativeArchiveTasks.list(getContext())); call.resolve(result); });
    }

    @PluginMethod
    public void deleteArchiveTask(PluginCall call) {
        runIo(call, () -> { NativeArchiveTasks.remove(getContext(), call.getString("id")); call.resolve(); });
    }

    @PluginMethod
    public void stageArchive(PluginCall call) {
        runIo(call, () -> {
            File file = NativeFileAccess.resolve(getContext(), call.getString("uri"));
            long expectedSize = NativeBridgeNumber.bounded(call.getData().opt("size"), 0L, NativeBridgeNumber.MAX_SAFE_INTEGER, "备份文件大小无效");
            if (file.length() != expectedSize) throw new IllegalStateException("备份文件大小已变化");
            call.resolve(NativeArchiveStaging.stage(getContext(), file));
        });
    }

    @PluginMethod
    public void readArchiveEntry(PluginCall call) {
        runIo(call, () -> call.resolve(NativeArchiveStaging.read(getContext(), call.getString("jobId"), call.getString("path"))));
    }

    @PluginMethod
    public void deleteArchiveJob(PluginCall call) {
        runIo(call, () -> { NativeArchiveStaging.remove(getContext(), call.getString("jobId")); call.resolve(); });
    }


    private interface CheckedAction { void run() throws Exception; }
    private void runIo(PluginCall call, CheckedAction action) {
        NativeExecutors.ioSerial().execute(() -> { try { action.run(); } catch (Exception error) { call.reject(error.getMessage(), error); } });
    }

}
