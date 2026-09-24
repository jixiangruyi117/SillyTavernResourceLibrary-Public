package buzz.jixiangruyi1207.srl;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;

@CapacitorPlugin(name = "NativeShortcut")
public class NativeShortcutPlugin extends Plugin {
    private static final Object LOCK = new Object();
    private static String pendingAction;
    private static WeakReference<NativeShortcutPlugin> activePlugin = new WeakReference<>(null);

    @Override
    public void load() {
        synchronized (LOCK) {
            activePlugin = new WeakReference<>(this);
        }
    }

    static void captureIntent(Intent intent) {
        String action = shortcutAction(intent);
        if (action == null) return;
        NativeShortcutPlugin plugin;
        synchronized (LOCK) {
            pendingAction = action;
            plugin = activePlugin.get();
        }
        if (plugin != null) {
            JSObject payload = new JSObject();
            payload.put("action", action);
            plugin.notifyListeners("shortcut", payload);
        }
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (LOCK) {
            if (pendingAction != null) result.put("action", pendingAction);
            pendingAction = null;
        }
        call.resolve(result);
    }

    private static String shortcutAction(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"srl".equals(data.getScheme()) || !"shortcut".equals(data.getHost())) return null;
        String path = data.getPath();
        String action = path == null ? "" : path.replaceFirst("^/+", "");
        return "import".equals(action) || "cloud".equals(action) || "favorites".equals(action) ? action : null;
    }
}
