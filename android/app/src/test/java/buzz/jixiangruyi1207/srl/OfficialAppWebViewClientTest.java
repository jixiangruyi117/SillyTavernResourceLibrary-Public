// SRL-PUBLIC-SYNC: BEGIN PUBLIC-ONLY id=public-hosted-package-validation-test
package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.IOException;
import java.net.URL;
import org.junit.Test;

public class OfficialAppWebViewClientTest {
    @Test
    public void hostedPackageUrlKeepsPathAndUsesConfiguredOrigin() throws Exception {
        URL localUrl = new URL("https://localhost/official-apps/srl-public-0.0.128-v4/chatReader-abcd.srlapp");

        URL hostedUrl = OfficialAppWebViewClient.buildHostedPackageUrl(
            localUrl,
            "https://downloads.example.workers.dev"
        );

        assertEquals(
            "https://downloads.example.workers.dev/official-apps/srl-public-0.0.128-v4/chatReader-abcd.srlapp",
            hostedUrl.toString()
        );
    }

    @Test
    public void hostedPackageUrlRejectsUnsafeOriginsAndPaths() throws Exception {
        URL localUrl = new URL("https://localhost/official-apps/srl-public-0.0.128-v4/chatReader-abcd.srlapp");
        URL traversalUrl = new URL("https://localhost/official-apps/../secret.srlapp");

        assertThrows(
            IOException.class,
            () -> OfficialAppWebViewClient.buildHostedPackageUrl(localUrl, "http://downloads.example.workers.dev")
        );
        assertThrows(
            IOException.class,
            () -> OfficialAppWebViewClient.buildHostedPackageUrl(localUrl, "https://downloads.example.workers.dev/path")
        );
        assertThrows(
            IOException.class,
            () -> OfficialAppWebViewClient.buildHostedPackageUrl(traversalUrl, "https://downloads.example.workers.dev")
        );
    }
}
// SRL-PUBLIC-SYNC: END PUBLIC-ONLY id=public-hosted-package-validation-test
