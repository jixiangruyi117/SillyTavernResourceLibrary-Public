package buzz.jixiangruyi1207.srl;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/** Keeps the WebView import pipeline at foreground process priority while an Android import is active. */
public class NativeImportKeepAliveService extends Service {
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_PHASE = "phase";
    static final String EXTRA_PROGRESS = "progress";
    private static final String CHANNEL = "srl_import_task";
    private static final int NOTIFICATION_ID = 2112;
    private PowerManager.WakeLock processingWakeLock;
    private static volatile boolean running;

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent == null ? "SRL 正在导入资源" : intent.getStringExtra(EXTRA_TITLE);
        String phase = intent == null ? "正在处理所选资源" : intent.getStringExtra(EXTRA_PHASE);
        int progress = intent == null ? -1 : intent.getIntExtra(EXTRA_PROGRESS, -1);
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(this, title, phase, progress),
            Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);
        running = true;
        if (processingWakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
            processingWakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SRL:ArchiveProcessing");
            processingWakeLock.setReferenceCounted(false);
            processingWakeLock.acquire();
        }
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        running = false;
        if (processingWakeLock != null && processingWakeLock.isHeld()) processingWakeLock.release();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override public void onTimeout(int startId, int fgsType) {
        notifyFinished(this, "后台任务已达到系统时限", "请返回 SRL 查看任务状态后继续。", false);
        stopSelf();
    }

    static void updateNotification(Context context, String title, String phase, int progress) {
        if (!running) return;
        ensureChannel(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(NOTIFICATION_ID, notification(context, title, phase, progress));
    }

    static void notifyFinished(Context context, String title, String message, boolean successful) {
        ensureChannel(context);
        Intent launch = new Intent(Intent.ACTION_VIEW, Uri.parse("srl://shortcut/import"), context, MainActivity.class);
        android.app.PendingIntent pending = android.app.PendingIntent.getActivity(context, NOTIFICATION_ID + 1, launch,
            android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(successful ? android.R.drawable.stat_sys_upload_done : android.R.drawable.stat_notify_error)
            .setContentTitle(title)
            .setContentText(message)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(NOTIFICATION_ID + 1, builder.build());
    }

    static void notifyAwaitingChoice(Context context, String title, String message) {
        ensureChannel(context);
        Intent launch = new Intent(Intent.ACTION_VIEW, Uri.parse("srl://shortcut/import"), context, MainActivity.class);
        android.app.PendingIntent pending = android.app.PendingIntent.getActivity(context, NOTIFICATION_ID + 2, launch,
            android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(message)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(NOTIFICATION_ID + 2, builder.build());
    }

    private static android.app.Notification notification(Context context, String title, String phase, int progress) {
        ensureChannel(context);
        Intent launch = new Intent(Intent.ACTION_VIEW, Uri.parse("srl://shortcut/import"), context, MainActivity.class);
        android.app.PendingIntent pending = android.app.PendingIntent.getActivity(context, NOTIFICATION_ID, launch,
            android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title == null || title.isBlank() ? "SRL 正在导入资源" : title)
            .setContentText(phase == null || phase.isBlank() ? "正在处理所选资源" : phase)
            .setContentIntent(pending)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS);
        if (progress >= 0) builder.setProgress(100, Math.min(100, progress), false);
        else builder.setProgress(0, 0, true);
        return builder.build();
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "资源导入与导出", NotificationManager.IMPORTANCE_LOW));
        }
    }
}
