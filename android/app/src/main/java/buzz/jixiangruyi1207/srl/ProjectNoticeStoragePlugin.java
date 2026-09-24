package buzz.jixiangruyi1207.srl;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Persists only the local acknowledgement of the first-use notice. */
@CapacitorPlugin(name = "ProjectNoticeStorage")
public class ProjectNoticeStoragePlugin extends Plugin {
    private static final String PREFS = "srl-project-notice";
    private static final String VERSION = "acknowledged-version";

    @PluginMethod
    public void getAcknowledgedVersion(PluginCall call) {
        JSObject result = new JSObject();
        result.put("version", getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(VERSION, ""));
        call.resolve(result);
    }

    @PluginMethod
    public void setAcknowledgedVersion(PluginCall call) {
        String version = call.getString("version", "");
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(VERSION, version).commit();
        JSObject result = new JSObject();
        result.put("version", version);
        call.resolve(result);
    }
}
