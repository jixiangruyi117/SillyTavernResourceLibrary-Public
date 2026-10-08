package buzz.jixiangruyi1207.srl;

import java.io.File;
import java.io.IOException;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.JSONObject;

/** File inventory for ShareReceiver; callers hold its existing download/state boundary. */
final class ShareReceiverIntakeFiles {
    private static final class Fact {
        final boolean regular, safe;
        final long size, modifiedAt;
        final String canonical;
        Fact(File file, String root) throws IOException {
            canonical = file.getCanonicalPath();
            regular = file.isFile(); size = regular ? file.length() : 0; modifiedAt = file.lastModified();
            safe = regular && canonical.equals(root + File.separator + file.getName());
        }
    }
    static final class Entry {
        final String token;
        final List<File> files = new ArrayList<>();
        String name, state, protectedReason = "", snapshot;
        long bytes, modifiedAt;
        boolean receiptOnly;
        Entry(String token) { this.token = token; this.name = token; }
        JSONObject json() throws Exception {
            return new JSONObject().put("token", token).put("name", name).put("state", state)
                .put("bytes", bytes).put("modifiedAt", modifiedAt).put("fileCount", files.size())
                .put("protectedReason", protectedReason).put("snapshot", snapshot).put("receiptOnly", receiptOnly);
        }
    }

    static String group(String fileName) {
        String token = fileName;
        for (String suffix : new String[]{".character-card.json", ".json.bak", ".json.new", ".json", ".part", ".done"}) {
            if (token.endsWith(suffix)) { token = token.substring(0, token.length() - suffix.length()); break; }
        }
        if (token.matches("discord-url-[a-f0-9-]{36}-0")) token = token.substring(0, token.length() - 2);
        return token;
    }

    static List<Entry> list(File folder, Set<String> active, Set<String> retained, boolean receiving) throws Exception {
        Map<String, Entry> groups = new TreeMap<>();
        File[] children = folder.listFiles();
        if (children == null) {
            if (folder.exists()) throw new IOException("无法读取接收暂存目录");
            return new ArrayList<>();
        }
        String root = folder.getCanonicalPath();
        Map<File, Fact> facts = new HashMap<>();
        for (File file : children) {
            Fact fact = new Fact(file, root); facts.put(file, fact);
            Entry entry = groups.computeIfAbsent(group(file.getName()), Entry::new);
            entry.files.add(file);
            entry.bytes += fact.size;
            entry.modifiedAt = Math.max(entry.modifiedAt, fact.modifiedAt);
            if (!fact.safe) entry.protectedReason = "文件位置无法确认，保留";
            if (retained.contains(fact.canonical)) entry.protectedReason = "恢复任务正在保留此文件";
        }
        for (Entry entry : groups.values()) {
            entry.files.sort(Comparator.comparing(File::getName));
            if (!entry.token.matches("[A-Za-z0-9_-]{1,180}")) entry.protectedReason = "暂存标识无法确认，保留";
            if (active.contains(entry.token) || active.contains(entry.token + "-0")) entry.protectedReason = "正在下载或导入";
            if (receiving) entry.protectedReason = "系统分享正在接收，完成后可刷新";
            JSONObject metadata = metadata(new File(folder, entry.token + ".json"), facts);
            JSONObject staged = metadata(new File(folder, entry.token + "-0.json"), facts);
            if (staged.length() > 0) metadata = staged;
            if (metadata.optBoolean("cloudAutoBindingPending")) entry.protectedReason = "收件关联尚未完成，请先处理收件任务";
            entry.name = metadata.optString("name", entry.token);
            JSONObject outcome = metadata.optJSONObject("nativeImportOutcome");
            String state = outcome == null ? "" : outcome.optString("state");
            if (Arrays.asList("imported", "duplicate_file", "duplicate_card").contains(state)) entry.state = metadata.optBoolean("nativeAckPending") ? "已入库，等待收件确认" : "已入库的接收副本";
            else if (metadata.has("error") || metadata.optBoolean("downloadCancelled")) entry.state = "失败或已取消的暂存";
            else if (facts.containsKey(new File(folder, entry.token + ".done")) && staged.length() == 0) entry.state = "已处理的残留";
            else if (metadata.length() > 0) entry.state = "待导入或待确认";
            else entry.state = "未完成或缺少记录的暂存";
            entry.snapshot = fingerprint(entry.files, facts);
            entry.receiptOnly = entry.files.size() == 1 && entry.files.get(0).getName().equals(entry.token + ".done") && facts.get(entry.files.get(0)).safe;
            if (entry.receiptOnly) entry.state = "已处理回执（防止重复接收）";
        }
        List<Entry> result = new ArrayList<>(groups.values());
        result.sort(Comparator.comparingLong((Entry entry) -> entry.bytes).reversed().thenComparing(entry -> entry.token));
        return result;
    }

    private static JSONObject metadata(File file, Map<File, Fact> facts) {
        try {
            Fact fact = facts.get(file);
            if (fact == null || !fact.safe || fact.size > 64 * 1024) return new JSONObject();
            // Unlike AtomicFile.openRead, inventory must not restore/delete sidecars.
            return new JSONObject(new String(metadataBytes(file), StandardCharsets.UTF_8));
        } catch (Exception ignored) { return new JSONObject(); }
    }

    private static byte[] metadataBytes(File file) throws IOException {
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 64 * 1024) throw new IOException("接收记录已变化，请刷新列表");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private static String fingerprint(List<File> files, Map<File, Fact> facts) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (File file : files) {
            Fact fact = facts.get(file);
            digest.update((file.getName() + "\0" + fact.size + "\0" + fact.modifiedAt + "\n").getBytes(StandardCharsets.UTF_8));
            if (fact.safe && file.getName().endsWith(".json") && fact.size <= 64 * 1024)
                digest.update(metadataBytes(file));
        }
        StringBuilder result = new StringBuilder();
        String hex = "0123456789abcdef";
        for (byte value : digest.digest()) result.append(hex.charAt((value & 255) >>> 4)).append(hex.charAt(value & 15));
        return result.toString();
    }

    static long remove(File folder, String token, String snapshot, Set<String> active, Set<String> retained, boolean receiving) throws Exception {
        Entry selected = list(folder, active, retained, receiving).stream().filter(entry -> entry.token.equals(token)).findFirst()
            .orElseThrow(() -> new IOException("暂存文件已变化，请刷新列表"));
        if (!selected.protectedReason.isEmpty()) throw new IOException(selected.protectedReason);
        if (!selected.snapshot.equals(snapshot)) throw new IOException("暂存文件已变化，请刷新后重新确认");
        // Payloads precede their metadata, so a failed deletion never leaves a live payload without its record.
        selected.files.sort(Comparator.comparing(file -> file.getName().endsWith(".json") || file.getName().endsWith(".done")));
        for (File file : selected.files) if (file.exists() && !file.delete()) throw new IOException("部分暂存文件仍被占用，请刷新查看剩余项");
        return selected.bytes;
    }

    /** Inspect only the selected receipt and known companions, never rescan N files for each item. */
    static long removeReceipt(File folder, String token, String snapshot, Set<String> active, Set<String> retained, boolean receiving) throws Exception {
        if (!token.matches("[A-Za-z0-9_-]{1,180}")) throw new IOException("回执标识无效，保留");
        if (receiving || active.contains(token) || active.contains(token + "-0")) throw new IOException("任务正在使用，保留");
        String root = folder.getCanonicalPath();
        File receipt = new File(folder, token + ".done");
        Fact fact = new Fact(receipt, root);
        if (!fact.safe || retained.contains(fact.canonical)) throw new IOException("回执不存在或被恢复任务保留");
        List<String> names = new ArrayList<>(Arrays.asList(token));
        if (token.matches("discord-url-[a-f0-9-]{36}")) names.add(token + "-0");
        for (String name : names) for (String suffix : new String[]{"", ".json", ".json.bak", ".json.new", ".part", ".character-card.json", ".done"}) {
            File companion = new File(folder, name + suffix);
            if (!companion.equals(receipt) && companion.exists()) throw new IOException("仍有附件或接收记录，保留");
        }
        if (!fingerprint(Collections.singletonList(receipt), Collections.singletonMap(receipt, fact)).equals(snapshot))
            throw new IOException("回执已变化，请刷新后重试");
        if (!receipt.delete()) throw new IOException("回执仍被占用，保留");
        return fact.size;
    }
}
