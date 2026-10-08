package buzz.jixiangruyi1207.srl;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONObject;

/** Streaming transport for the existing share staging owner; never imports resources itself. */
final class NativeDiscordAttachmentDownload {
    static final long MAX_BYTES = 4L * 1024L * 1024L * 1024L;
    private static final Pattern RANGE = Pattern.compile("bytes (\\d+)-(\\d+)/(\\d+)");
    interface Checkpoint { void save(JSONObject metadata) throws Exception; }
    interface Progress { void update(long done, long total) throws Exception; }
    static class TerminalFailure extends IOException {
        TerminalFailure(String message) { super(message); }
    }
    static final class HttpFailure extends IOException {
        final int status;
        HttpFailure(int status) {
            super(status == 403 || status == 404
                ? "Discord 附件链接已失效或不可访问（HTTP " + status + "），请从原应用重新分享"
                : "Discord 附件服务器返回 HTTP " + status);
            this.status = status;
        }
    }

    private NativeDiscordAttachmentDownload() {}

    static boolean retryable(Exception error) {
        if (error instanceof HttpFailure) {
            int status = ((HttpFailure) error).status;
            return status == 429 || status == 408 || status >= 500;
        }
        return error instanceof IOException && !(error instanceof TerminalFailure);
    }

    static boolean shouldRetry(Exception error, int failures) { return failures <= 3 && retryable(error); }

    static void download(OkHttpClient client, String url, File partial, JSONObject metadata,
        Checkpoint checkpoint, Progress progress, Consumer<Call> onCall) throws Exception {
        download(client, url, partial, metadata, checkpoint, progress, onCall, MAX_BYTES);
    }

    static void download(OkHttpClient client, String url, File partial, JSONObject metadata,
        Checkpoint checkpoint, Progress progress, Consumer<Call> onCall, long maximumBytes) throws Exception {
        if (maximumBytes <= 0 || maximumBytes > MAX_BYTES) throw new IllegalArgumentException("附件下载上限无效");
        DiscordAttachmentUrl.fromSharedText(url);
        long offset = partial.isFile() ? partial.length() : 0;
        long expected = metadata.optLong("downloadSize", -1);
        if (expected > 0 && expected <= maximumBytes && offset == expected) {
            // All declared bytes reached disk before a process stop at the final checkpoint.
            if (!metadata.optBoolean("downloadComplete")) {
                metadata.put("downloadComplete", true);
                checkpoint.save(metadata);
            }
            return;
        }
        String validator = metadata.optString("downloadValidator", "");
        boolean resume = offset > 0 && offset < expected && !validator.isBlank();
        if (!resume) offset = 0;
        String current = url;
        Response response = null;
        try {
            for (int redirects = 0; redirects <= 3; redirects++) {
                Request.Builder request = new Request.Builder().url(current).get()
                    .header("Accept", "*/*").header("Accept-Encoding", "identity")
                    .header("User-Agent", "SRL-Android");
                if (resume) request.header("Range", "bytes=" + offset + "-").header("If-Range", validator);
                Call call = client.newCall(request.build());
                onCall.accept(call);
                response = call.execute();
                if (response.code() < 300 || response.code() >= 400) break;
                String location = response.header("Location");
                response.close(); response = null;
                if (location == null || redirects == 3) throw new TerminalFailure("Discord 附件重定向无效");
                HttpUrl base = HttpUrl.parse(current);
                HttpUrl resolved = base == null ? null : base.resolve(location);
                if (resolved == null) throw new TerminalFailure("Discord 附件重定向地址无效");
                current = DiscordAttachmentUrl.fromSharedText(resolved.toString()).url;
            }
            if (response == null) throw new IOException("无法连接 Discord 附件地址");
            if (!response.isSuccessful()) {
                long wait = retryAfterMillis(response.header("Retry-After"));
                if (response.code() == 429 || response.code() == 503) {
                    metadata.put("downloadNotBefore", System.currentTimeMillis() + wait);
                    checkpoint.save(metadata);
                }
                throw new HttpFailure(response.code());
            }
            ResponseBody body = response.body();
            if (body == null) throw new TerminalFailure("Discord 附件没有返回文件内容");
            String encoding = response.header("Content-Encoding", "identity");
            if (!"identity".equalsIgnoreCase(encoding)) throw new TerminalFailure("Discord 附件返回了无法续传的编码");
            String type = body.contentType() == null ? "application/octet-stream" : body.contentType().toString();
            if (type.toLowerCase(java.util.Locale.ROOT).startsWith("text/html")) {
                throw new TerminalFailure("链接返回了网页而不是附件，请重新分享有效附件链接");
            }
            long total;
            if (response.code() == 206) {
                total = rangeTotal(response.header("Content-Range"), offset);
                if (!resume || total != expected || !validator.equals(responseValidator(response))) {
                    throw new TerminalFailure("Discord 附件续传范围或版本不一致；未拼接不同文件");
                }
                if (body.contentLength() >= 0 && body.contentLength() != total - offset) {
                    throw new TerminalFailure("Discord 附件续传长度不一致");
                }
            } else if (response.code() == 200) {
                offset = 0;
                total = body.contentLength();
            } else throw new TerminalFailure("Discord 附件下载响应无效");
            if (total > maximumBytes) throw new TerminalFailure("附件超过本次自动下载上限");
            long usable = partial.getParentFile().getUsableSpace();
            if (total > 0 && usable > 0 && total - offset > usable) throw new TerminalFailure("设备可用空间不足，无法暂存附件");
            // Truncate before committing a new validator: a crash must never associate an old prefix with a new file.
            if (offset == 0) try (FileOutputStream output = new FileOutputStream(partial)) { output.getFD().sync(); }
            metadata.put("downloadSize", total).put("downloadValidator", responseValidator(response))
                .put("downloadType", type).put("downloadComplete", false);
            String disposition = response.header("Content-Disposition", "");
            Matcher filename = Pattern.compile("filename\\*?=(?:UTF-8''|\\\")?([^;\\\"]+)", Pattern.CASE_INSENSITIVE).matcher(disposition);
            if (filename.find()) {
                String supplied = filename.group(1).trim();
                int slash = Math.max(supplied.lastIndexOf('/'), supplied.lastIndexOf('\\'));
                if (slash >= 0) supplied = supplied.substring(slash + 1);
                try { supplied = java.net.URLDecoder.decode(supplied.replace("+", "%2B"), "UTF-8"); }
                catch (IllegalArgumentException invalidName) { supplied = ""; }
                supplied = supplied.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
                if (!supplied.isBlank() && !supplied.equals(".") && !supplied.equals("..")) metadata.put("name", supplied);
            }
            metadata.remove("downloadNotBefore");
            checkpoint.save(metadata);
            long written = offset;
            try (InputStream input = body.byteStream(); FileOutputStream output = new FileOutputStream(partial, true)) {
                try {
                    byte[] buffer = new byte[128 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Discord 下载已暂停；已保留断点");
                        if (written > maximumBytes - count || (total >= 0 && written > total - count)) {
                            throw new TerminalFailure("Discord 附件超过声明大小");
                        }
                        try { output.write(buffer, 0, count); }
                        catch (IOException local) { throw new TerminalFailure("无法写入附件暂存文件，请检查设备空间"); }
                        written += count;
                        progress.update(written, total);
                    }
                } finally { output.getFD().sync(); }
            }
            if (written == 0) throw new TerminalFailure("Discord 附件内容为空");
            if (total >= 0 && written != total) throw new IOException("Discord 附件下载中断；已保留断点");
            metadata.put("downloadSize", written).put("downloadComplete", true);
            checkpoint.save(metadata);
        } finally { if (response != null) response.close(); }
    }

    static long rangeTotal(String value, long offset) throws TerminalFailure {
        Matcher match = RANGE.matcher(value == null ? "" : value);
        try {
            if (!match.matches()) throw new NumberFormatException();
            long start = Long.parseLong(match.group(1)), end = Long.parseLong(match.group(2)), total = Long.parseLong(match.group(3));
            if (start != offset || total <= offset || end != total - 1 || total > MAX_BYTES) throw new NumberFormatException();
            return total;
        } catch (NumberFormatException invalid) { throw new TerminalFailure("Discord 附件续传范围无效"); }
    }

    private static String responseValidator(Response response) {
        String etag = response.header("ETag", "");
        if (etag.startsWith("\"") && etag.endsWith("\"")) return etag;
        // A weak ETag or timestamp alone cannot prove that an old prefix belongs to this representation.
        return "";
    }

    static long retryAfterMillis(String value) {
        if (value == null) return 30_000L;
        try { return Math.max(30_000L, Math.min(86_400_000L, Math.multiplyExact(Long.parseLong(value.trim()), 1000L))); }
        catch (Exception invalid) {
            try {
                java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", java.util.Locale.US);
                format.setLenient(false);
                return Math.max(30_000L, Math.min(86_400_000L, format.parse(value).getTime() - System.currentTimeMillis()));
            }
            catch (Exception ignored) { return 30_000L; }
        }
    }
}
