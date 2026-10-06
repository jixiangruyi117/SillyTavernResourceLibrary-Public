package buzz.jixiangruyi1207.srl.nativeapp.cloud

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class NativeSecretStore(context: Context) {
    private val preferences = context.getSharedPreferences("srl-native-cloud-secrets", Context.MODE_PRIVATE)
    private val alias = "srl-native-cloud-credentials-v1"

    fun save(provider: String, secret: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(secret.toByteArray(Charsets.UTF_8))
        val stored = "${Base64.encodeToString(cipher.iv, Base64.NO_WRAP)}:${Base64.encodeToString(encrypted, Base64.NO_WRAP)}"
        check(preferences.edit().putString(provider, stored).remove(invalidKey(provider)).commit()) {
            "Android 安全凭据保存失败"
        }
    }

    fun read(provider: String): String? {
        if (preferences.getBoolean(invalidKey(provider), false)) return null
        val stored = preferences.getString(provider, null) ?: return null
        return runCatching {
            val parts = stored.split(':', limit = 2); require(parts.size == 2)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
            cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)).toString(Charsets.UTF_8)
        }.getOrNull()
    }

    fun state(provider: String): NativeCredentialState = when {
        preferences.getBoolean(invalidKey(provider), false) -> NativeCredentialState.INVALID
        read(provider).isNullOrBlank() -> NativeCredentialState.MISSING
        else -> NativeCredentialState.VALID
    }

    fun invalidate(provider: String) {
        check(preferences.edit().putBoolean(invalidKey(provider), true).commit()) {
            "Android 安全凭据失效状态保存失败"
        }
    }

    fun clear(provider: String) {
        check(preferences.edit().remove(provider).remove(invalidKey(provider)).commit()) {
            "Android 安全凭据清除失败"
        }
    }

    private fun invalidKey(provider: String) = "$provider-invalid"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }
}
