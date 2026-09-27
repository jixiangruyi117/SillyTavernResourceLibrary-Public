package buzz.jixiangruyi1207.srl;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.DocumentsContract;

/** Test fixture grants its own SAF tree, just as a document picker would. */
public class ArchiveTestGrantReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String target=context.getPackageName().replaceFirst("\\.test$", "");
        context.grantUriPermission(target,DocumentsContract.buildTreeDocumentUri("srl.archive.checkpoint.tests","root"),
            Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        setResultCode(android.app.Activity.RESULT_OK);
    }
}
