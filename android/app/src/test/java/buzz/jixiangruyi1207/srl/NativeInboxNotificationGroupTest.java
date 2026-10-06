package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.*;

import android.app.Notification;
import org.junit.Test;

public class NativeInboxNotificationGroupTest {
    @Test public void clearActionOnlyTargetsFinishedChildNotifications() {
        assertTrue(NativeInboxNotificationGroup.isClearable(0));
        assertFalse(NativeInboxNotificationGroup.isClearable(Notification.FLAG_GROUP_SUMMARY));
        assertFalse(NativeInboxNotificationGroup.isClearable(Notification.FLAG_ONGOING_EVENT));
        assertFalse(NativeInboxNotificationGroup.isClearable(Notification.FLAG_NO_CLEAR));
        assertFalse(NativeInboxNotificationGroup.isClearable(Notification.FLAG_ONGOING_EVENT | Notification.FLAG_NO_CLEAR));
    }

    @Test public void summarySeparatesActiveWorkFromFinishedResults() {
        assertEquals("2 项处理中 · 3 条结果", NativeInboxNotificationGroup.summaryText(2, 3));
        assertEquals("3 条结果，可清理", NativeInboxNotificationGroup.summaryText(0, 3));
        assertEquals("2 项处理中", NativeInboxNotificationGroup.summaryText(2, 0));
    }
}
