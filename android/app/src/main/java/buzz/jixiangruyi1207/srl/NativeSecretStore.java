package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Android Keystore 加密的本机凭据仓库；明文不会写入 SharedPreferences 或任务文件。 */
final class NativeSecretStore {
    private static final String ALIAS = "srl-native-cloud-credentials-v1";
    private final android.content.SharedPreferences preferences;

    NativeSecretStore(Context context) {
        preferences = context.getSharedPreferences("srl-native-cloud-secrets", Context.MODE_PRIVATE);
    }

    synchronized void save(String key, String secret) throws Exception {
        String encrypted = encrypt(secret);
        if (!preferences.edit().putString(key, encrypted).commit()) {
            throw new IllegalStateException("无法持久化 Android 安全凭据");
        }
    }

    synchronized void saveCredential(String key, String invalidKey, String secret) throws Exception {
        String encrypted = encrypt(secret);
        if (!preferences.edit().putString(key, encrypted).remove(invalidKey).commit()) {
            throw new IllegalStateException("无法持久化 Android 云端凭据");
        }
    }

    synchronized void invalidateCredential(String key, String invalidKey) {
        if (!preferences.edit().remove(key).putBoolean(invalidKey, true).commit()) {
            throw new IllegalStateException("无法标记 Android 云端凭据失效");
        }
    }

    synchronized void clearCredential(String key, String invalidKey) {
        if (!preferences.edit().remove(key).remove(invalidKey).commit()) {
            throw new IllegalStateException("无法清除 Android 云端凭据");
        }
    }

    synchronized boolean isCredentialInvalid(String invalidKey) {
        return preferences.getBoolean(invalidKey, false);
    }

    private String encrypt(String secret) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(secret.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
            Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    synchronized String read(String key) throws Exception {
        String stored = preferences.getString(key, null);
        if (stored == null) return null;
        String[] parts = stored.split(":", 2);
        if (parts.length != 2) return null;
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    synchronized boolean has(String key) { return preferences.contains(key); }
    synchronized void clear(String key) {
        if (!preferences.edit().remove(key).commit()) {
            throw new IllegalStateException("无法清除 Android 安全凭据");
        }
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        java.security.Key present = store.getKey(ALIAS, null);
        if (present instanceof SecretKey) return (SecretKey) present;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }
}
