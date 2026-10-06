package buzz.jixiangruyi1207.srl;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;

/** Keeps per-file receive notifications collapsed under one expandable summary. */
final class NativeInboxNotificationGroup {
    static final String KEY = "srl-cloud-inbox";
    private static final String CHANNEL = "srl_cloud_inbox";
    private static final String SUMMARY_TAG = "srl-inbox-summary";
    private static final int SUMMARY_ID = 2132;

    private NativeInboxNotificationGroup() {}

    static NotificationCompat.Builder apply(NotificationCompat.Builder builder) {
        return builder.setGroup(KEY).setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_SUMMARY);
    }

    static boolean isClearable(int flags) {
        return (flags & (Notification.FLAG_GROUP_SUMMARY | Notification.FLAG_ONGOING_EVENT | Notification.FLAG_NO_CLEAR)) == 0;
    }

    static void clearCompleted(Context context) {
        if (Build.VERSION.SDK_INT < 23) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        for (StatusBarNotification active : manager.getActiveNotifications()) {
            Notification notification = active.getNotification();
            if (KEY.equals(notification.getGroup()) && isClearable(notification.flags)) {
                manager.cancel(active.getTag(), active.getId());
            }
        }
        refresh(context);
    }

    static void refresh(Context context) {
        if (Build.VERSION.SDK_INT < 23) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        int count = 0, clearableCount = 0;
        for (StatusBarNotification active : manager.getActiveNotifications()) {
            Notification notification = active.getNotification();
            if (KEY.equals(notification.getGroup()) && (notification.flags & Notification.FLAG_GROUP_SUMMARY) == 0) {
                count++;
                if (isClearable(notification.flags)) clearableCount++;
            }
        }
        if (count == 0) {
            manager.cancel(SUMMARY_TAG, SUMMARY_ID);
            return;
        }
        if (Build.VERSION.SDK_INT >= 26)
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "云端收件", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(context, SUMMARY_ID,
            new Intent(Intent.ACTION_VIEW, Uri.parse("srl://inbox"), context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder summary = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("SRL 云端收件")
            .setContentText(summaryText(count - clearableCount, clearableCount))
            .setContentIntent(open)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setGroup(KEY)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_SUMMARY);
        if (clearableCount > 0) {
            PendingIntent clear = PendingIntent.getBroadcast(context, SUMMARY_ID,
                new Intent(context, NativeDiscordDownloadNotificationReceiver.class)
                    .setAction(NativeDiscordDownloadNotificationReceiver.ACTION_CLEAR_COMPLETED)
                    .setData(Uri.parse("srl://inbox/clear-completed")),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            summary.addAction(android.R.drawable.ic_menu_delete, "清理通知", clear);
        }
        manager.notify(SUMMARY_TAG, SUMMARY_ID, summary.build());
    }

    static String summaryText(int activeCount, int resultCount) {
        if (activeCount > 0 && resultCount > 0) return activeCount + " 项处理中 · " + resultCount + " 条结果";
        if (resultCount > 0) return resultCount + " 条结果，可清理";
        return activeCount + " 项处理中";
    }
}
