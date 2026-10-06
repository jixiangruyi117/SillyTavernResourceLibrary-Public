package buzz.jixiangruyi1207.srl;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Notification commands reuse the per-share WorkManager owner and retain resumable staging. */
public final class NativeDiscordDownloadNotificationReceiver extends BroadcastReceiver {
    static final String ACTION_CANCEL = "buzz.jixiangruyi1207.srl.CANCEL_DISCORD_DOWNLOAD";
    static final String ACTION_RETRY = "buzz.jixiangruyi1207.srl.RETRY_DISCORD_DOWNLOAD";
    static final String ACTION_CLEAR_COMPLETED = "buzz.jixiangruyi1207.srl.CLEAR_COMPLETED_INBOX_NOTIFICATIONS";

    @Override public void onReceive(Context context, Intent intent) {
        if (intent != null && ACTION_CLEAR_COMPLETED.equals(intent.getAction())) {
            NativeInboxNotificationGroup.clearCompleted(context.getApplicationContext());
            return;
        }
        if (intent == null || (!ACTION_CANCEL.equals(intent.getAction()) && !ACTION_RETRY.equals(intent.getAction()))) return;
        String token = intent.getStringExtra("token"), workId = intent.getStringExtra("workId");
        if (!NativeDiscordDownloadWorker.validToken(token) || workId == null || !workId.matches("[a-f0-9-]{36}")) return;
        Context application = context.getApplicationContext();
        String action = intent.getAction();
        PendingResult pending = goAsync();
        NativeExecutors.ioLimited().execute(() -> {
            try {
                if (ACTION_CANCEL.equals(action)) NativeDiscordDownloadWorker.cancel(application, token, workId);
                else NativeDiscordDownloadWorker.enqueue(application, token, workId);
            } catch (Exception error) {
                NativeDiscordDownloadWorker.notifyActionFailed(application, token, workId);
            } finally { pending.finish(); }
        });
    }
}
