package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import java.util.ArrayList;

/** 动态桌面入口只反映备份状态；不显示角色名、缩略图或任何资源内容。 */
final class NativePrivacyShortcuts {
    private NativePrivacyShortcuts() {}
    static void updateBackupStatus(Context context, boolean completed) {
        if (Build.VERSION.SDK_INT < 25) return;
        String label = completed ? "最近备份已完成" : "最近备份需处理";
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("srl://backup"), context, MainActivity.class);
        ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(context, "backup-status")
            .setShortLabel("备份状态")
            .setLongLabel(label)
            .setIcon(IconCompat.createWithResource(context, R.drawable.ic_shortcut_backup))
            .setIntent(intent)
            .build();
        try {
            ArrayList<ShortcutInfoCompat> shortcuts = new ArrayList<>(ShortcutManagerCompat.getDynamicShortcuts(context));
            shortcuts.removeIf(item -> "backup-status".equals(item.getId()));
            shortcuts.add(shortcut);
            ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts);
        }
        catch (Exception ignored) {}
    }
}
