package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.content.Intent;
import androidx.core.content.pm.ShortcutManagerCompat;
import java.util.Arrays;

/** Maps explicit system share entries; old pinned sharing shortcuts remain readable. */
final class NativeShareRouteShortcuts {
    static final String EXTRA_ROUTE = "buzz.jixiangruyi1207.srl.SHARE_ROUTE";
    static final String ROUTE_LIBRARY_BACKUP = "libraryBackup";
    static final String ROUTE_TAVERN_BACKUP = "tavernBackup";
    static final String ROUTE_RESOURCE = "resource";
    static final String ROUTE_THIRD_PARTY_APP = "thirdPartyApp";

    private NativeShareRouteShortcuts() {}

    static void retireLegacyShortcuts(Context context) {
        // Four share routes now use manifest aliases, independent of launcher shortcut quotas.
        ShortcutManagerCompat.removeDynamicShortcuts(context, Arrays.asList(
            "share-library-backup", "share-tavern-backup", "share-resource", "share-third-party-app"));
    }

    static String routeFrom(Intent intent) {
        if (intent == null) return null;
        String route = intent.getStringExtra(EXTRA_ROUTE);
        if (ROUTE_LIBRARY_BACKUP.equals(route) || ROUTE_TAVERN_BACKUP.equals(route) ||
            ROUTE_RESOURCE.equals(route) || ROUTE_THIRD_PARTY_APP.equals(route)) return route;
        String shortcutId = intent.getStringExtra(Intent.EXTRA_SHORTCUT_ID);
        if ("share-library-backup".equals(shortcutId)) return ROUTE_LIBRARY_BACKUP;
        if ("share-tavern-backup".equals(shortcutId)) return ROUTE_TAVERN_BACKUP;
        if ("share-resource".equals(shortcutId)) return ROUTE_RESOURCE;
        if ("share-third-party-app".equals(shortcutId)) return ROUTE_THIRD_PARTY_APP;
        String component = intent.getComponent() == null ? "" : intent.getComponent().getClassName();
        if (component.endsWith(".ShareLibraryBackup")) return ROUTE_LIBRARY_BACKUP;
        if (component.endsWith(".ShareTavernBackup")) return ROUTE_TAVERN_BACKUP;
        if (component.endsWith(".ShareResource")) return ROUTE_RESOURCE;
        if (component.endsWith(".ShareThirdPartyApp")) return ROUTE_THIRD_PARTY_APP;
        return null;
    }

}
