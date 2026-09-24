package buzz.jixiangruyi1207.srl;

import android.app.Activity;
import android.content.SharedPreferences;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeSystemUi")
public class NativeSystemUiPlugin extends Plugin {
    private static final String PREFS = "srl-native-system-ui";
    private static final String SHOW_STATUS_BAR = "show-status-bar";

    static boolean shouldShowStatusBar(Activity activity) {
        return activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)
            .getBoolean(SHOW_STATUS_BAR, false);
    }

    static void applyPersistedSystemBars(Activity activity) {
        applySystemBars(activity, shouldShowStatusBar(activity));
    }

    private static void applySystemBars(Activity activity, boolean showStatusBar) {
        WindowCompat.setDecorFitsSystemWindows(activity.getWindow(), showStatusBar);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            activity.getWindow(),
            activity.getWindow().getDecorView()
        );
        if (showStatusBar) controller.show(WindowInsetsCompat.Type.statusBars());
        else controller.hide(WindowInsetsCompat.Type.statusBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("showStatusBar", shouldShowStatusBar(getActivity()));
        call.resolve(result);
    }

    @PluginMethod
    public void setShowStatusBar(PluginCall call) {
        boolean show = call.getBoolean("show", false);
        SharedPreferences preferences = getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
        preferences.edit().putBoolean(SHOW_STATUS_BAR, show).apply();
        getActivity().runOnUiThread(() -> {
            applySystemBars(getActivity(), show);
            JSObject result = new JSObject();
            result.put("showStatusBar", show);
            call.resolve(result);
        });
    }
}
