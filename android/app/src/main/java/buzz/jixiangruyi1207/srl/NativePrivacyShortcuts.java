package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import java.util.Collections;

/** 动态桌面入口只反映备份状态；不显示角色名、缩略图或任何资源内容。 */
final class NativePrivacyShortcuts {
    private NativePrivacyShortcuts() {}
    static void updateBackupStatus(Context context, boolean completed) {
        if (Build.VERSION.SDK_INT < 25) return;
        String label = completed ? "最近备份已完成" : "最近备份需处理";
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("srl://backup"), context, MainActivity.class);
        ShortcutInfo shortcut = new ShortcutInfo.Builder(context, "backup-status")
            .setShortLabel("备份状态")
            .setLongLabel(label)
            .setIcon(Icon.createWithResource(context, R.drawable.ic_shortcut_backup))
            .setIntent(intent)
            .build();
        try { context.getSystemService(ShortcutManager.class).setDynamicShortcuts(Collections.singletonList(shortcut)); }
        catch (Exception ignored) {}
    }
}
