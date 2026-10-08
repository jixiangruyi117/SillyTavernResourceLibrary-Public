package buzz.jixiangruyi1207.srl;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.Iterator;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** Ephemeral complete-text AI requests. Credentials stay in request memory only. */
@CapacitorPlugin(name = "NativeMainApi")
public class NativeMainApiPlugin extends Plugin {
    private final NativeMainApiRequests requests = new NativeMainApiRequests();

    @PluginMethod
    public void request(PluginCall call) {
        String id = call.getString("requestId", "");
        try {
            if (!id.matches("[a-fA-F0-9-]{36}")) throw new IllegalArgumentException("AI 请求标识无效");
            String url = call.getString("url", "");
            if (!url.startsWith("https://") && !url.startsWith("http://"))
                throw new IllegalArgumentException("AI 地址必须使用 HTTP 或 HTTPS");
            String body = call.getString("body");
            if (body == null) throw new IllegalArgumentException("AI 请求缺少正文");
            Request.Builder builder = new Request.Builder().url(url)
                .post(RequestBody.create(body, MediaType.get("application/json; charset=utf-8")));
            JSObject headers = call.getObject("headers", new JSObject());
            Iterator<String> names = headers.keys();
            while (names.hasNext()) {
                String name = names.next();
                builder.header(name, headers.optString(name));
            }
            Call operation = requests.begin(id, builder.build());
            operation.enqueue(new Callback() {
                @Override public void onFailure(Call failed, IOException error) {
                    requests.finish(id, failed);
                    call.reject(failed.isCanceled() ? "AI 请求已取消" : "无法连接 AI 接口");
                }
                @Override public void onResponse(Call completed, Response response) {
                    try (Response owned = response) {
                        ResponseBody responseBody = owned.body();
                        String text = responseBody == null ? "" : responseBody.string();
                        if (completed.isCanceled()) { call.reject("AI 请求已取消"); return; }
                        JSObject result = new JSObject();
                        JSObject responseHeaders = new JSObject();
                        for (String name : owned.headers().names()) responseHeaders.put(name, owned.header(name));
                        result.put("status", owned.code());
                        result.put("headers", responseHeaders);
                        result.put("body", text);
                        call.resolve(result);
                    } catch (IOException error) {
                        call.reject(completed.isCanceled() ? "AI 请求已取消" : "读取 AI 响应失败");
                    } finally { requests.finish(id, completed); }
                }
            });
        } catch (Exception error) { call.reject("AI 请求配置无效"); }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        requests.cancel(call.getString("requestId", ""));
        call.resolve();
    }

    @Override protected void handleOnDestroy() { requests.close(); }
}
