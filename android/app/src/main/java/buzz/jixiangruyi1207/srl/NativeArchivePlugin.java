package buzz.jixiangruyi1207.srl;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
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
            long offset = NativeBridgeNumber.bounded(call.getData().opt("offset"), 0L, NativeBridgeNumber.MAX_SAFE_INTEGER, "恢复分块位置无效");
            NativeArchiveTasks.appendSource(getContext(),call.getString("id"),offset,android.util.Base64.decode(data,android.util.Base64.NO_WRAP));
            call.resolve();
        });
    }
    @PluginMethod public void finishArchiveSource(PluginCall call) {
        runIo(call, () -> {
            long size = NativeBridgeNumber.bounded(call.getData().opt("size"), 0L, NativeBridgeNumber.MAX_SAFE_INTEGER, "恢复源文件大小无效");
            JSObject result=new JSObject();
            result.put("uri",NativeArchiveTasks.finishSource(getContext(),call.getString("id"),size,call.getString("hash")));
            call.resolve(result);
        });
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
    public void listArchiveEntries(PluginCall call) {
        runIo(call, () -> {
            File file = NativeFileAccess.resolve(getContext(), call.getString("uri"));
            NativeBridgeNumber.matchingFileSize(
                call.getData().opt("size"), file.length(), NativeBridgeNumber.MAX_SAFE_INTEGER,
                "备份文件大小无效", "备份文件大小已变化"
            );
            call.resolve(NativeArchiveStaging.list(getContext(), file));
        });
    }

    @PluginMethod
    public void stageArchive(PluginCall call) {
        runIo(call, () -> {
            File file = NativeFileAccess.resolve(getContext(), call.getString("uri"));
            NativeBridgeNumber.matchingFileSize(
                call.getData().opt("size"), file.length(), NativeBridgeNumber.MAX_SAFE_INTEGER,
                "备份文件大小无效", "备份文件大小已变化"
            );
            String requestId = call.getString("requestId", "");
            JSArray selectedArray = call.getArray("selectedPaths");
            java.util.Set<String> selectedPaths = null;
            if (selectedArray != null) {
                selectedPaths = new java.util.HashSet<>();
                for (int index = 0; index < selectedArray.length(); index++) {
                    String path = selectedArray.getString(index);
                    if (path == null || path.length() > 4096 || !selectedPaths.add(path)) throw new IllegalArgumentException("ZIP 选择路径无效或重复");
                }
            }
            call.resolve(NativeArchiveStaging.stage(getContext(), file, selectedPaths, requestId, (phase, readBytes, totalBytes, completed, entryCount, reused, stagedBytes, totalStagedBytes) -> {
                JSObject progress = new JSObject();
                progress.put("requestId", requestId);
                progress.put("phase", phase);
                progress.put("readBytes", readBytes);
                progress.put("totalBytes", totalBytes);
                progress.put("completedEntries", completed);
                progress.put("entryCount", entryCount);
                progress.put("reusedEntries", reused);
                progress.put("stagedBytes", stagedBytes);
                progress.put("totalStagedBytes", totalStagedBytes);
                notifyListeners("archiveProgress", progress);
            }));
        });
    }

    @PluginMethod
    public void cancelArchiveStage(PluginCall call) {
        NativeArchiveStaging.cancel(call.getString("requestId", ""));
        call.resolve();
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
