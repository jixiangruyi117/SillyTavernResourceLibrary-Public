package buzz.jixiangruyi1207.srl;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeImportKeepAlive")
public class NativeImportKeepAlivePlugin extends Plugin {
    @Override
    protected void handleOnDestroy() {
        getContext().stopService(new Intent(getContext(), NativeImportKeepAliveService.class));
    }
    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), NativeImportKeepAliveService.class);
        intent.putExtra(NativeImportKeepAliveService.EXTRA_TITLE, call.getString("title", "SRL 正在导入资源"));
        intent.putExtra(NativeImportKeepAliveService.EXTRA_PHASE, call.getString("phase", "正在处理所选资源"));
        intent.putExtra(NativeImportKeepAliveService.EXTRA_PROGRESS, call.getInt("progress", -1));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve(new JSObject());
        } catch (Exception error) {
            call.reject("Android 导入后台保活无法启动", error);
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        NativeImportKeepAliveService.updateNotification(
            getContext(),
            call.getString("title", "SRL 正在导入资源"),
            call.getString("phase", "正在处理所选资源"),
            call.getInt("progress", -1)
        );
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (call.getBoolean("notify", true)) {
            NativeImportKeepAliveService.notifyFinished(
                getContext(),
                call.getString("title", "导入已结束"),
                call.getString("message", "导入任务已结束"),
                call.getBoolean("successful", false)
            );
        }
        getContext().stopService(new Intent(getContext(), NativeImportKeepAliveService.class));
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void notifyAwaitingChoice(PluginCall call) {
        NativeImportKeepAliveService.notifyAwaitingChoice(
            getContext(),
            call.getString("title", "备份预检已完成"),
            call.getString("message", "请返回应用选择恢复方式")
        );
        call.resolve(new JSObject());
    }
}
