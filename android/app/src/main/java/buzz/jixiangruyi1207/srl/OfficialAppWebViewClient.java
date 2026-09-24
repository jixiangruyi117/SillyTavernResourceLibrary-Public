package buzz.jixiangruyi1207.srl;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.Collections;

/** Installed official modules share the packaged shell's origin and Vue runtime. */
final class OfficialAppWebViewClient extends BridgeWebViewClient {
    private final File root;
    private final Uri origin;

    OfficialAppWebViewClient(Bridge bridge) {
        super(bridge);
        root = new File(bridge.getContext().getFilesDir(), "official-apps/assets");
        origin = Uri.parse(bridge.getLocalUrl());
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if ("GET".equals(request.getMethod()) && origin.getScheme().equals(url.getScheme())
                && origin.getAuthority().equals(url.getAuthority())) {
            String path = url.getPath();
            // Packages come from the official host, not Capacitor's bundled-file fallback.
            if (path != null && path.startsWith("/official-apps/")) return null;
            if (path != null && path.matches("/assets/[A-Za-z0-9_.-]+") && !path.contains("..")) {
                File file = new File(root, path.substring("/assets/".length()));
                try {
                    if (file.isFile() && file.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())) {
                        String mime = path.endsWith(".js") ? "text/javascript"
                            : path.endsWith(".css") ? "text/css"
                            : path.endsWith(".wasm") ? "application/wasm"
                            : path.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
                        return new WebResourceResponse(mime, null, 200, "OK",
                            Collections.singletonMap("Cache-Control", "no-store"), new FileInputStream(file));
                    }
                } catch (IOException ignored) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), null);
                }
            }
        }
        return super.shouldInterceptRequest(view, request);
    }
}
