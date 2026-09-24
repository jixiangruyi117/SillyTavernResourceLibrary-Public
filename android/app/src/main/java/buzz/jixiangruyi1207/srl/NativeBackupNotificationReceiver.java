package buzz.jixiangruyi1207.srl;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.work.WorkManager;
import java.io.File;

/** 通知上的取消动作只取消指定云任务，不影响其他备份或本地资源。 */
public class NativeBackupNotificationReceiver extends BroadcastReceiver {
    static final String ACTION_CANCEL = "buzz.jixiangruyi1207.srl.CANCEL_CLOUD_BACKUP";
    @Override public void onReceive(Context context, Intent intent) {
        if (!ACTION_CANCEL.equals(intent.getAction())) return;
        String jobId = intent.getStringExtra("jobId");
        if (jobId == null || !jobId.matches("[a-f0-9-]{36}")) return;
        PendingResult result = goAsync();
        NativeExecutors.ioLimited().execute(() -> {
            try {
                WorkManager.getInstance(context).cancelUniqueWork(NativeCloudTransferPlugin.JOB_WORK_PREFIX + jobId);
                File root = new File(NativeCloudTransferPlugin.jobsRoot(context), jobId);
                org.json.JSONObject job = NativeCloudTransferPlugin.readJob(root);
                job.put("status", "cancelled");
                job.put("updatedAt", System.currentTimeMillis());
                NativeCloudTransferPlugin.writeJob(root, job);
                new NativeSecretStore(context).clear("cloud-job-" + jobId);
            } catch (Exception ignored) {
                // 任务已结束或已清理时无需重试取消。
            } finally { result.finish(); }
        });
    }
}
