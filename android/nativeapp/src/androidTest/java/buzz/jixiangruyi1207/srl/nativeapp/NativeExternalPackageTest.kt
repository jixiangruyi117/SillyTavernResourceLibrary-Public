package buzz.jixiangruyi1207.srl.nativeapp

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import buzz.jixiangruyi1207.srl.nativeapp.extensions.NativeExternalPackageService
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(AndroidJUnit4::class)
class NativeExternalPackageTest {
    @Test
    fun auditsManifestAndPreservesWebExternalAppStateWithoutExecutingCode() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        val appId = "native.audit.$seed"
        val file = createPackage(context.cacheDir, "audit-$seed.srlapp", appId, false)
        NativeResourceStore(context).use { store ->
            store.writePortableSection("externalApps", JSONObject()
                .put("apps", JSONArray().put(JSONObject().put("id", "web-app").put("runtimeHtml", "<p>保留</p>")))
                .put("data", JSONArray().put(JSONObject().put("appId", "web-app").put("key", "x").put("value", 1)))
                .put("futureExternal", "保留"))
            store.importUris(listOf(Uri.fromFile(file)))
            val resource = store.loadResources().single { it.fileName == file.name }
            val service = NativeExternalPackageService(store)
            val inspected = service.inspectAndRegister(resource.id)
            assertEquals(appId, inspected.id)
            assertEquals("resourceAssistant", inspected.permissionLevel)
            assertEquals(listOf("resources.library.read"), inspected.permissions)
            val root = JSONObject(store.portableDataJson()).getJSONObject("externalApps")
            assertEquals("保留", root.getString("futureExternal"))
            assertEquals(1, root.getJSONArray("apps").length())
            assertEquals(1, root.getJSONArray("data").length())
            assertEquals(1, root.getJSONArray("nativePackages").length())
            service.unregister(appId)
            assertTrue(service.load().isEmpty())
            assertTrue(store.loadResources().any { it.id == resource.id })
            assertEquals(1, JSONObject(store.portableDataJson()).getJSONObject("externalApps").getJSONArray("apps").length())
        }
        file.delete()
    }

    @Test
    fun rejectsTraversalPackageBeforeRegistration() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        val file = createPackage(context.cacheDir, "traversal-$seed.srlapp", "native.bad.$seed", true)
        NativeResourceStore(context).use { store ->
            store.importUris(listOf(Uri.fromFile(file)))
            val resource = store.loadResources().single { it.fileName == file.name }
            val error = runCatching { NativeExternalPackageService(store).inspectAndRegister(resource.id) }.exceptionOrNull()
            assertTrue(
                error?.message ?: "扩展包未被拒绝",
                error?.message?.let { it.contains("不安全路径") || it.contains("Invalid zip entry path") } == true,
            )
            assertTrue(NativeExternalPackageService(store).load().none { it.resourceId == resource.id })
        }
        file.delete()
    }

    private fun createPackage(cache: File, name: String, id: String, traversal: Boolean): File {
        val file = File(cache, name)
        val manifest = JSONObject().put("schemaVersion", 2).put("apiVersion", "srl-app-api@1")
            .put("id", id).put("name", "审计扩展").put("version", "1.2.3").put("entry", "index.html")
            .put("permissions", JSONArray().put("resources.library.read")).put("permissionLevel", "resourceAssistant")
        ZipOutputStream(file.outputStream()).use { zip ->
            zip.putNextEntry(ZipEntry("manifest.json")); zip.write(manifest.toString().toByteArray()); zip.closeEntry()
            zip.putNextEntry(ZipEntry("index.html")); zip.write("<main>不会执行<script>window.bad=true</script></main>".toByteArray()); zip.closeEntry()
            if (traversal) { zip.putNextEntry(ZipEntry("../evil.js")); zip.write("x".toByteArray()); zip.closeEntry() }
        }
        return file
    }
}
