package buzz.jixiangruyi1207.srl;

/** Canonical validation for native cloud object keys. */
final class NativeCloudObjectKey {
    private NativeCloudObjectKey() {}

    static String validate(String provider, String name, boolean manifest) {
        if (name == null || name.isBlank() || name.length() > 240 || name.indexOf('\\') >= 0) {
            throw new IllegalArgumentException("对象名称包含非法路径");
        }
        String[] segments = name.split("/", -1);
        if ("github".equals(provider)) {
            if (segments.length != 1 || !validSegment(segments[0])) {
                throw new IllegalArgumentException("对象名称包含非法路径");
            }
            return name;
        }
        if (!"webdav".equals(provider)) throw new IllegalArgumentException("云端类型无效");
        if (segments.length == 1) {
            if (!validSegment(segments[0])) throw new IllegalArgumentException("对象名称包含非法路径");
            return name;
        }
        String expectedDirectory = manifest ? "snapshots" : "objects";
        if (segments.length != 2 || !expectedDirectory.equals(segments[0]) || !validSegment(segments[1])) {
            throw new IllegalArgumentException("对象名称包含非法路径");
        }
        return name;
    }

    static String baseName(String name) {
        int slash = name.lastIndexOf('/');
        return slash < 0 ? name : name.substring(slash + 1);
    }

    private static boolean validSegment(String value) {
        if (value == null || value.isBlank() || ".".equals(value) || "..".equals(value)) return false;
        for (int index = 0; index < value.length(); index++) {
            char item = value.charAt(index);
            if (item == '/' || item == '\\' || Character.isISOControl(item)) return false;
        }
        return true;
    }
}
