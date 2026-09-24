package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** NativeSecurity's recovery storage. Every key use requires a CryptoObject biometric prompt. */
final class NativeSecretRecovery {
    private static final String PREFIX = "srl.secret.recovery.";
    private static final byte[] AAD = "srl-secret-password-recovery-v1".getBytes(StandardCharsets.UTF_8);
    private final AtomicBoolean busy = new AtomicBoolean(false);

    private SharedPreferences prefs(Context context) {
        // App manifest disables Android backup; this device-bound material is never exported by JS.
        return context.getSharedPreferences("srl-secret-recovery", Context.MODE_PRIVATE);
    }

    private boolean available(Context context) {
        return BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private static final class Record {
        final String alias, iv, payload;
        Record(SharedPreferences prefs) {
            alias = prefs.getString("alias", null);
            iv = prefs.getString("iv", null);
            payload = prefs.getString("payload", null);
        }
        boolean absent() { return alias == null && iv == null && payload == null; }
        boolean wellFormed() {
            if (alias == null || !alias.startsWith(PREFIX) || iv == null || payload == null
                || iv.length() > 32 || payload.length() > 5500) return false;
            try {
                int size = Base64.decode(payload, Base64.NO_WRAP).length;
                return Base64.decode(iv, Base64.NO_WRAP).length == 12 && size >= 24 && size <= 4112;
            } catch (IllegalArgumentException error) { return false; }
        }
        boolean restore(SharedPreferences prefs) {
            // commit() can fail AFTER updating the in-memory map. Restore all fields together.
            return prefs.edit().putString("alias", alias).putString("iv", iv)
                .putString("payload", payload).commit();
        }
    }

    void state(Context context, PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", available(context));
        try {
            Record record = new Record(prefs(context));
            boolean enabled = record.wellFormed() && store().containsAlias(record.alias);
            result.put("enabled", enabled);
            // Configured is not a claim that an authenticated decryption has succeeded.
            result.put("status", record.absent() ? "unconfigured" : enabled ? "configured" : "invalid");
        } catch (Exception error) {
            log("state", error);
            result.put("enabled", false);
            result.put("status", "invalid");
        }
        call.resolve(result);
    }

    private KeyStore store() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return store;
    }

    private void deleteKey(String alias) throws Exception {
        if (alias != null && alias.startsWith(PREFIX)) store().deleteEntry(alias);
    }

    private void retireKey(String alias) {
        try { deleteKey(alias); } catch (Exception error) { log("retire-key", error); }
    }

    private void rollback(SharedPreferences prefs, Record previous) {
        try {
            if (!previous.restore(prefs)) log("rollback-persistence", new IllegalStateException());
        } catch (Exception error) { log("rollback-persistence", error); }
        // Keep BOTH keys if a write was attempted: after an interrupted/failed disk write,
        // either record could be durable. An orphan key is safer than unreadable recovery data.
    }

    private static void log(String stage, Exception error) {
        Throwable cause = error.getCause();
        Log.w("SRLSecretRecovery", stage + ": " + error.getClass().getSimpleName()
            + (cause == null ? "" : "; cause=" + cause.getClass().getSimpleName()));
    }

    private static void reject(PluginCall call, String stage, Exception error, boolean saving) {
        log(stage, error);
        String code = "SECRET_RECOVERY_" + stage;
        String message;
        if ("PERSISTENCE".equals(stage)) message = "指纹恢复设置保存失败，未完成变更；请保留原密码后重试";
        else if ("PASSWORD_LENGTH".equals(stage)) message = "密码的 UTF-8 长度须为 8 至 4096 字节，未修改原密码";
        else if ("FORMAT".equals(stage)) message = "本机指纹恢复记录不完整，请使用原密码重新绑定";
        else if ("CRYPTO_OBJECT".equals(stage)) message = "本次指纹授权未绑定到加密操作，请重试";
        else if ("PROMPT".equals(stage)) message = "无法启动本次指纹验证，请重试";
        else message = saving ? "指纹恢复绑定加密失败，原密码和资料未修改" : "指纹恢复解密失败，请使用原密码；原资料未修改";
        for (Throwable current = error; current != null; current = current.getCause()) {
            if (current instanceof android.security.keystore.KeyPermanentlyInvalidatedException) {
                code = "SECRET_RECOVERY_KEY_INVALIDATED";
                message = "本机恢复密钥已失效，请使用原密码重新绑定；原资料未修改";
                break;
            }
            if (current instanceof android.security.keystore.UserNotAuthenticatedException) {
                code = "SECRET_RECOVERY_AUTH_REQUIRED";
                message = "本次指纹未能授权加密操作，请重试；原资料未修改";
                break;
            }
        }
        call.reject(message, code);
    }

    void clear(Context context, PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("请先完成当前指纹验证", "SECRET_RECOVERY_BUSY"); return; }
        SharedPreferences preferences = null;
        Record previous = null;
        boolean cleared = false;
        try {
            preferences = prefs(context);
            previous = new Record(preferences);
            if (!preferences.edit().remove("alias").remove("iv").remove("payload").commit())
                throw new IllegalStateException();
            // Never destroy the old key while its recovery record may still be persisted.
            cleared = true;
            retireKey(previous.alias);
            call.resolve();
        } catch (Exception error) {
            if (!cleared && preferences != null && previous != null) rollback(preferences, previous);
            reject(call, "PERSISTENCE", error, false);
        } finally { busy.set(false); }
    }

    void authenticate(FragmentActivity activity, PluginCall call, boolean saving) {
        if (!busy.compareAndSet(false, true)) { call.reject("请先完成当前指纹验证", "SECRET_RECOVERY_BUSY"); return; }
        byte[] pendingPlaintext = new byte[0];
        String pendingAlias = null;
        String stage = "INITIALIZATION";
        try {
            if (!available(activity)) {
                busy.set(false);
                call.reject("请先在安卓系统中录入可用的强生物识别（如指纹）", "SECRET_RECOVERY_UNAVAILABLE");
                return;
            }
            SharedPreferences preferences = prefs(activity);
            Record previous = new Record(preferences);
            String alias = saving ? PREFIX + UUID.randomUUID() : previous.alias;
            pendingAlias = alias;
            final byte[] plaintext = saving ? call.getString("password", "").getBytes(StandardCharsets.UTF_8) : new byte[0];
            pendingPlaintext = plaintext;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            if (saving) {
                stage = "PASSWORD_LENGTH";
                if (plaintext.length < 8 || plaintext.length > 4096) throw new IllegalArgumentException();
                stage = "KEY_CREATION";
                KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(alias,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true);
                if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
                else spec.setUserAuthenticationValidityDurationSeconds(-1);
                generator.init(spec.build());
                cipher.init(Cipher.ENCRYPT_MODE, generator.generateKey());
            } else {
                stage = "FORMAT";
                if (!previous.wellFormed()) throw new IllegalStateException();
                stage = "KEY_ACCESS";
                SecretKey key = (SecretKey) store().getKey(alias, null);
                if (key == null) throw new IllegalStateException();
                cipher.init(Cipher.DECRYPT_MODE, key,
                    new GCMParameterSpec(128, Base64.decode(previous.iv, Base64.NO_WRAP)));
            }
            stage = "PROMPT";
            BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
                new BiometricPrompt.AuthenticationCallback() {
                    private boolean finished;
                    private void finish() {
                        Arrays.fill(plaintext, (byte) 0);
                        finished = true;
                        busy.set(false);
                    }
                    @Override public void onAuthenticationError(int code, CharSequence message) {
                        if (finished) return;
                        if (saving) retireKey(alias);
                        finish();
                        boolean cancelled = code == BiometricPrompt.ERROR_CANCELED
                            || code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON;
                        boolean locked = code == BiometricPrompt.ERROR_LOCKOUT || code == BiometricPrompt.ERROR_LOCKOUT_PERMANENT;
                        call.reject(cancelled ? "已取消指纹验证，未修改恢复设置" : locked ? "系统生物识别已锁定，请稍后重试" : "指纹验证未完成，未修改恢复设置",
                            cancelled ? "SECRET_RECOVERY_CANCELLED" : locked ? "SECRET_RECOVERY_LOCKED" : "SECRET_RECOVERY_AUTH_FAILED");
                    }
                    @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        if (finished) return;
                        boolean writeAttempted = false;
                        boolean committed = false;
                        String operation = "CRYPTO_OBJECT";
                        byte[] recovered = null;
                        try {
                            BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                            if (crypto == null || crypto.getCipher() != cipher) throw new IllegalStateException();
                            operation = saving ? "ENCRYPTION" : "DECRYPTION";
                            // Per-use Keystore authorization applies to updateAAD too. Nothing may
                            // update/finalize this operation before the matching prompt succeeds.
                            cipher.updateAAD(AAD);
                            if (saving) {
                                byte[] encrypted = cipher.doFinal(plaintext);
                                operation = "PERSISTENCE";
                                writeAttempted = true;
                                if (!preferences.edit().putString("alias", alias)
                                    .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                                    .putString("payload", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
                                    throw new IllegalStateException();
                                committed = true;
                                retireKey(previous.alias);
                                call.resolve();
                            } else {
                                recovered = cipher.doFinal(Base64.decode(previous.payload, Base64.NO_WRAP));
                                JSObject value = new JSObject();
                                value.put("password", new String(recovered, StandardCharsets.UTF_8));
                                call.resolve(value);
                            }
                        } catch (Exception error) {
                            if (writeAttempted && !committed) rollback(preferences, previous);
                            else if (!writeAttempted && saving) retireKey(alias);
                            reject(call, operation, error, saving);
                        } finally {
                            if (recovered != null) Arrays.fill(recovered, (byte) 0);
                            finish();
                        }
                    }
                });
            prompt.authenticate(new BiometricPrompt.PromptInfo.Builder()
                .setTitle(saving ? "开启密钥密码指纹找回" : "找回密钥统一密码")
                .setSubtitle("仅在本机使用，不上传恢复材料")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setNegativeButtonText("取消").build(), new BiometricPrompt.CryptoObject(cipher));
        } catch (Exception error) {
            Arrays.fill(pendingPlaintext, (byte) 0);
            if (saving) retireKey(pendingAlias);
            busy.set(false);
            reject(call, stage, error, saving);
        }
    }
}
