package buzz.jixiangruyi1207.srl.nativeapp

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.espresso.action.ViewActions.click
import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import buzz.jixiangruyi1207.srl.nativeapp.cloud.NativeCloudSnapshotCodec
import buzz.jixiangruyi1207.srl.nativeapp.cloud.NativeStructuredSnapshotBuilder
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeCloudSource
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(AndroidJUnit4::class)
class NativeAppSmokeTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun launchesNativeLibraryAndExposesApkUpdateAction() {
        composeRule.onNodeWithText("酒馆资源库").assertIsDisplayed()
        composeRule.onNodeWithText("设置").performClick()
        val updateAction = hasText("检查 APK 版本更新") and hasClickAction()
        composeRule.onNode(hasScrollAction()).performScrollToNode(updateAction)
        composeRule.onNode(updateAction).assertIsDisplayed()
    }

    @Test
    fun opensNativeTavernBridgeFromFeatureDesktop() {
        composeRule.onNodeWithText("功能").performClick()
        composeRule.onNodeWithText("酒馆互传").performClick()
        composeRule.onNodeWithText("8 位设备码").assertIsDisplayed()
        composeRule.onNodeWithText("连接酒馆").assertIsDisplayed()
    }

    @Test
    fun opensNativeUserPersonaEditorFromFeatureDesktop() {
        composeRule.onNodeWithText("功能").performClick()
        composeRule.onNode(hasScrollAction()).performScrollToNode(hasText("user才是老大"))
        composeRule.onNodeWithText("user才是老大").performClick()
        composeRule.onNodeWithText("酒馆格式").assertIsDisplayed()
        composeRule.onNodeWithText("新建备份").assertIsDisplayed()
        composeRule.onNodeWithText("导入 JSON").assertIsDisplayed()
    }

    @Test
    fun opensNativePresetStitcherAndResourceBundleFromFeatureDesktop() {
        composeRule.onNodeWithText("功能").performClick()
        composeRule.onNode(hasScrollAction()).performScrollToNode(hasText("缝了么"))
        composeRule.onNodeWithText("缝了么").performClick()
        composeRule.onNodeWithText("往返保真").assertIsDisplayed()
        composeRule.onNodeWithText("返回").performClick()
        composeRule.onNode(hasScrollAction()).performScrollToNode(hasText("配了么"))
        composeRule.onNodeWithText("配了么").performClick()
        composeRule.onNodeWithText("资源装配").assertIsDisplayed()
    }

    @Test
    fun opensNativeFrontendWorkshopFromFeatureDesktop() {
        composeRule.onNodeWithText("功能").performClick()
        composeRule.onNode(hasScrollAction()).performScrollToNode(hasText("前端了么"))
        composeRule.onNodeWithText("前端了么").performClick()
        composeRule.onNodeWithText("与网页版一致的输出边界").assertIsDisplayed()
        composeRule.onNodeWithText("作品名称").assertIsDisplayed()
    }

    @Test
    fun opensNativeCharacterDrawFromFeatureDesktop() {
        composeRule.onNodeWithText("功能").performClick()
        composeRule.onNodeWithText("抽了么").performClick()
        composeRule.onNodeWithText("累计抽取").assertIsDisplayed()
        composeRule.onNodeWithText("抽取范围").assertIsDisplayed()
    }

    @Test
    fun opensNativeAppearanceStudioFromFeatureDesktop() {
        composeRule.onNodeWithText("功能").performClick()
        composeRule.onNodeWithText("外观").performClick()
        composeRule.onNodeWithText("原生外观").assertIsDisplayed()
        composeRule.onNodeWithText("资源库排版").assertIsDisplayed()
    }

    @Test
    fun opensNativeCabinetFromFeatureDesktop() {
        composeRule.onNodeWithText("功能").performClick()
        composeRule.onNodeWithText("收藏柜").performClick()
        composeRule.onNodeWithText("收藏柜桌面").assertIsDisplayed()
        composeRule.onNodeWithText("整理收藏柜").assertIsDisplayed()
    }

    @Test
    fun opensNativeExtensionAuditFromFeatureDesktop() {
        composeRule.onNodeWithText("功能").performClick()
        composeRule.onNode(hasScrollAction()).performScrollToNode(hasText("扩展"))
        composeRule.onNodeWithText("扩展").performClick()
        composeRule.onNodeWithText("原生安全边界").assertIsDisplayed()
        composeRule.onNodeWithText("选择 .srlapp 安装包").assertIsDisplayed()
    }

    @Test
    fun opensNativeAiTaggingReviewFromLibraryBatchBar() {
        composeRule.onNodeWithText("批量管理").performClick()
        composeRule.onNodeWithText("AI 识别标签").performClick()
        composeRule.onNodeWithText("先审核，后写入").assertIsDisplayed()
        composeRule.onNodeWithText("保存接口配置").assertIsDisplayed()
    }

    @Test
    fun createsLocalResourceDirectoryOnDevice() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        NativeResourceStore(context).use { store ->
            assertTrue("未创建原生资源目录", store.storageDirectory().isDirectory)
        }
    }

    @Test
    fun restoresConflictingCategoryIdsWithoutMisassigningResources() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val categoryId = UUID.randomUUID().toString()
        val firstName = "原生分类甲-${categoryId.take(6)}"
        val secondName = "原生分类乙-${categoryId.take(6)}"
        NativeResourceStore(context).use { store ->
            store.importUris(listOf(createArchive(context.cacheDir, categoryId, firstName, "#112233")))
            store.importUris(listOf(createArchive(context.cacheDir, categoryId, secondName, "#445566")))
            val categories = store.loadCategories()
            val first = categories.single { it.name == firstName }
            val second = categories.single { it.name == secondName }
            assertTrue("冲突分类必须获得新 ID", first.id != second.id)
            val restored = store.loadResources().single { it.name == secondName }
            assertTrue("资源必须指向重映射后的分类", restored.categoryIds == listOf(second.id))
        }
    }

    @Test
    fun activatingVersionKeepsPreviousCarrierInHistory() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val fixture = createVersionArchive(context.cacheDir)
        NativeResourceStore(context).use { store ->
            store.importUris(listOf(fixture.uri))
            store.activateVersion(fixture.resourceId, fixture.versionId)
            val active = store.loadResources().single { it.id == fixture.resourceId }
            assertTrue("所选历史版本必须成为当前版本", active.name == fixture.selectedName)
            val versions = store.loadVersions(fixture.resourceId)
            assertTrue("切换前的当前载体必须进入历史", versions.any { it.name == fixture.currentName })
            assertTrue("被激活的旧载体必须从历史索引移除", versions.none { it.id == fixture.versionId })
        }
    }

    @Test
    fun deletingCategoryAndResourcePreservesOldHistoryWithoutCreatingArchives() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "无快照删除-${UUID.randomUUID()}"
        val root = File(context.getExternalFilesDir(android.os.Environment.DIRECTORY_DOCUMENTS) ?: context.filesDir, "SRL")
        val history = File(root, "history")
        history.mkdirs()
        val oldArchive = File(history, "legacy-fixture-${UUID.randomUUID()}.zip")
        ZipOutputStream(oldArchive.outputStream()).use { zip ->
            zip.putNextEntry(ZipEntry("legacy-fixture.txt"))
            zip.write("旧整库快照保留验收".toByteArray())
            zip.closeEntry()
        }
        fun historyFiles() = history.listFiles().orEmpty().associate { it.name to it.length() }
        fun fixtureDigest() = MessageDigest.getInstance("SHA-256").digest(oldArchive.readBytes()).toList()
        try {
            NativeResourceStore(context).use { store ->
                store.importUris(listOf(createArchive(context.cacheDir, UUID.randomUUID().toString(), name, "#235766")))
                val resource = store.loadResources().single { it.name == name }
                val before = historyFiles()
                val originalDigest = fixtureDigest()
                assertTrue("必须有旧快照文件才能证明保留行为", oldArchive.name in before)
                store.deleteCategory(resource.categoryIds.single())
                assertTrue("删除文件夹必须保留资源并移除分类", store.loadResources().single { it.id == resource.id }.categoryIds.isEmpty())
                store.deleteResource(resource.id)
                assertTrue("所选资源必须删除", store.loadResources().none { it.id == resource.id })
                assertTrue("不应创建或裁剪旧快照文件", historyFiles() == before)
                assertTrue("旧快照文件内容必须保持不变", fixtureDigest() == originalDigest)
            }
        } finally {
            oldArchive.delete()
        }
    }

    @Test
    fun legacyHistoryCleanupConfirmsAndPreservesResourcesVersionsAndUnknownFiles() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val fixture = createVersionArchive(context.cacheDir)
        NativeResourceStore(context).use { store ->
            store.importUris(listOf(fixture.uri))
            val id = UUID.randomUUID().toString()
            val history = File(store.storageDirectory(), "history").apply { mkdirs() }
            val archive = File(history, "$id.zip").apply { writeText("old whole-library archive") }
            val unknown = File(history, "unknown-${UUID.randomUUID()}.zip").apply { writeText("keep unknown") }
            val outside = File(context.cacheDir, "outside-${UUID.randomUUID()}.zip").apply { writeText("keep outside") }
            val records = JSONArray().put(JSONObject().put("id", id).put("filePath", archive.absolutePath))
                .put(JSONObject().put("id", UUID.randomUUID().toString()).put("filePath", outside.absolutePath))
            store.writableDatabase.execSQL("INSERT OR REPLACE INTO app_state (state_key, state_value) VALUES (?, ?)", arrayOf("historySnapshots", records.toString()))
            val resources = store.loadResources()
            val versions = store.loadAllVersions()
            try {
                val preview = store.legacyLibraryHistoryCleanup()
                assertTrue(preview.files.size == 1 && preview.bytes == archive.length())
                archive.appendText("changed")
                assertTrue(runCatching { store.clearLegacyLibraryHistory(preview) }.isFailure)
                assertTrue(archive.exists())
                composeRule.activityRule.scenario.recreate()
                composeRule.onNodeWithText("设置").performClick()
                val action = hasText("清理旧整库快照") and hasClickAction()
                composeRule.onNode(hasScrollAction()).performScrollToNode(action)
                composeRule.onNode(action).performClick()
                onView(withText("取消")).perform(click())
                assertTrue(archive.exists())
                composeRule.onNode(action).performClick()
                onView(withText("永久清理")).perform(click())
                composeRule.waitUntil { !archive.exists() }
                composeRule.waitForIdle()
                assertTrue(store.legacyLibraryHistoryCleanup().files.isEmpty())
                assertTrue(unknown.readText() == "keep unknown" && outside.readText() == "keep outside")
                assertTrue(store.loadResources() == resources && store.loadAllVersions() == versions)
                store.readableDatabase.rawQuery("SELECT state_value FROM app_state WHERE state_key = ?", arrayOf("historySnapshots")).use { cursor ->
                    assertTrue(cursor.moveToFirst() && JSONArray(cursor.getString(0)).length() == 1)
                }
            } finally {
                archive.delete(); unknown.delete(); outside.delete()
                store.writableDatabase.delete("app_state", "state_key = ?", arrayOf("historySnapshots"))
            }
        }
    }

    @Test
    fun concurrentLegacyHistoryCleanupAcrossStoresDoesNotRestoreDeletedIndex() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        NativeResourceStore(context).use { first -> NativeResourceStore(context).use { second ->
            val id = UUID.randomUUID().toString()
            val history = File(first.storageDirectory(), "history").apply { mkdirs() }
            val archive = File(history, "$id.zip").apply { writeText("concurrent cleanup fixture") }
            val records = JSONArray().put(JSONObject().put("id", id).put("filePath", archive.absolutePath))
            first.writableDatabase.execSQL("INSERT OR REPLACE INTO app_state (state_key, state_value) VALUES (?, ?)", arrayOf("historySnapshots", records.toString()))
            val plan = first.legacyLibraryHistoryCleanup()
            val start = java.util.concurrent.CountDownLatch(1)
            val worker = java.util.concurrent.Executors.newFixedThreadPool(2)
            try {
                val jobs = listOf(first, second).map { store -> worker.submit<Boolean> {
                    start.await()
                    runCatching { store.clearLegacyLibraryHistory(plan) }.isSuccess
                } }
                start.countDown()
                assertTrue(jobs.count { it.get() } == 1)
                assertTrue(!archive.exists() && first.legacyLibraryHistoryCleanup().files.isEmpty())
                first.readableDatabase.rawQuery("SELECT state_value FROM app_state WHERE state_key = ?", arrayOf("historySnapshots")).use { cursor ->
                    assertTrue(cursor.moveToFirst() && JSONArray(cursor.getString(0)).length() == 0)
                }
            } finally {
                worker.shutdownNow()
                archive.delete()
                first.writableDatabase.delete("app_state", "state_key = ?", arrayOf("historySnapshots"))
            }
        } }
    }

    @Test
    fun structuredSnapshotAggregatesEqualSmallFilesAndRemainsWebCompatible() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.cacheDir, "structured-${UUID.randomUUID()}").apply { mkdirs() }
        try {
            val bytes = "small-object-${UUID.randomUUID()}".toByteArray()
            val file = File(directory, "card.json").apply { writeBytes(bytes) }
            val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            fun source(id: String, version: Boolean) = NativeCloudSource(
                JSONObject().put("id", id).put("type", "other").put("fileName", "card.json").put("mimeType", "application/json")
                    .put("fileSize", bytes.size).put("contentHash", hash).put("metadata", JSONObject()).toString(),
                file.absolutePath, version, hash, bytes.size.toLong(),
            )
            val built = NativeStructuredSnapshotBuilder(context).build(
                listOf(source(UUID.randomUUID().toString(), false), source(UUID.randomUUID().toString(), true)),
                "[]", JSONObject().put("version", 1).toString(),
            )
            try {
                assertTrue("相同小文件必须复用同一个聚合内容块", built.chunks.size == 1)
                val snapshot = NativeCloudSnapshotCodec.decode(built.snapshotFile)
                assertTrue(snapshot.getString("format") == "srl-structured-cloud-snapshot")
                assertTrue(snapshot.getJSONArray("resources").length() == 1 && snapshot.getJSONArray("versions").length() == 1)
                val references = NativeCloudSnapshotCodec.referencedParts(snapshot)
                assertTrue(references.size == 1 && references.values.single() == built.chunks.values.single().length())
            } finally {
                built.buildDirectory.deleteRecursively()
            }
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun importsCssAndPersonaBackupWithWebCompatibleTypesAndPersistsEdits() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seed = UUID.randomUUID().toString().take(8)
        val css = File(context.cacheDir, "theme-$seed.css").apply { writeText("/* @name: 移动主题-$seed */\n:root { --accent: #123456; color: #fff; }") }
        val persona = File(context.cacheDir, "persona-$seed.json").apply {
            writeText(JSONObject().put("personas", JSONObject().put("avatar-$seed.png", "人设-$seed"))
                .put("persona_descriptions", JSONObject().put("avatar-$seed.png", JSONObject().put("description", "测试")))
                .put("default_persona", "avatar-$seed.png").toString())
        }
        var editedId = ""
        NativeResourceStore(context).use { store ->
            val report = store.importUris(listOf(android.net.Uri.fromFile(css), android.net.Uri.fromFile(persona)))
            assertTrue("导入结果异常：${report.summary()} / ${report.messages}", report.imported == 2)
            val resources = store.loadResources()
            assertTrue(resources.any { it.fileName == css.name && it.type == "beautification" })
            val personaResource = resources.single { it.fileName == persona.name }
            assertTrue(personaResource.type == "userPersona")
            editedId = personaResource.id
            store.updateResourceDetails(editedId, "已编辑人设-$seed", "本机说明", listOf("人设", "测试"))
        }
        NativeResourceStore(context).use { reopened ->
            val edited = reopened.loadResources().single { it.id == editedId }
            assertTrue(edited.name == "已编辑人设-$seed" && edited.description == "本机说明" && edited.tags == listOf("人设", "测试"))
        }
        css.delete(); persona.delete()
    }

    private data class VersionFixture(val uri: android.net.Uri, val resourceId: String, val versionId: String, val currentName: String, val selectedName: String)

    private fun createVersionArchive(cache: File): VersionFixture {
        val resourceId = UUID.randomUUID().toString()
        val versionId = UUID.randomUUID().toString()
        val currentName = "当前-${resourceId.take(6)}"
        val selectedName = "历史-${resourceId.take(6)}"
        val currentBytes = "{\"name\":\"$currentName\"}".toByteArray()
        val selectedBytes = "{\"name\":\"$selectedName\"}".toByteArray()
        fun item(id: String, name: String, bytes: ByteArray, path: String, groupId: String? = null): JSONObject {
            val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            return JSONObject().put("id", id).put("type", "other").put("name", name).put("description", "")
                .put("fileName", "$id.json").put("mimeType", "application/json").put("fileSize", bytes.size)
                .put("contentHash", hash).put("favorite", false).put("categoryId", JSONObject.NULL)
                .put("categoryIds", JSONArray()).put("tags", JSONArray()).put("metadata", JSONObject())
                .put("createdAt", System.currentTimeMillis()).put("updatedAt", System.currentTimeMillis())
                .put("archivePath", path).also { if (groupId != null) it.put("versionGroupId", groupId) }
        }
        val currentPath = "files/other/$resourceId.json"
        val versionPath = "versions/other/$versionId.json"
        val manifest = JSONObject().put("format", "srl-archive").put("version", 4).put("mode", "full")
            .put("createdAt", java.time.Instant.now().toString()).put("resourceCount", 1).put("categoryCount", 0)
            .put("categories", JSONArray()).put("resources", JSONArray().put(item(resourceId, currentName, currentBytes, currentPath)))
            .put("versionCount", 1).put("versions", JSONArray().put(item(versionId, selectedName, selectedBytes, versionPath, resourceId)))
        val file = File(cache, "versions-${UUID.randomUUID()}.zip")
        ZipOutputStream(file.outputStream()).use { zip ->
            zip.putNextEntry(ZipEntry(currentPath)); zip.write(currentBytes); zip.closeEntry()
            zip.putNextEntry(ZipEntry(versionPath)); zip.write(selectedBytes); zip.closeEntry()
            zip.putNextEntry(ZipEntry("manifest.json")); zip.write(manifest.toString().toByteArray()); zip.closeEntry()
        }
        return VersionFixture(android.net.Uri.fromFile(file), resourceId, versionId, currentName, selectedName)
    }

    private fun createArchive(cache: File, categoryId: String, name: String, color: String): android.net.Uri {
        val resourceId = UUID.randomUUID().toString()
        val bytes = "{\"name\":\"$name\"}".toByteArray()
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val archivePath = "files/other/$resourceId.json"
        val item = JSONObject()
            .put("id", resourceId).put("type", "other").put("name", name)
            .put("description", "").put("fileName", "$resourceId.json")
            .put("mimeType", "application/json").put("fileSize", bytes.size)
            .put("contentHash", hash).put("favorite", false)
            .put("categoryId", categoryId).put("categoryIds", JSONArray().put(categoryId))
            .put("tags", JSONArray()).put("metadata", JSONObject())
            .put("createdAt", System.currentTimeMillis()).put("updatedAt", System.currentTimeMillis())
            .put("archivePath", archivePath)
        val category = JSONObject().put("id", categoryId).put("name", name).put("color", color)
            .put("createdAt", System.currentTimeMillis()).put("updatedAt", System.currentTimeMillis())
        val manifest = JSONObject().put("format", "srl-archive").put("version", 4).put("mode", "full")
            .put("createdAt", java.time.Instant.now().toString()).put("resourceCount", 1)
            .put("categoryCount", 1).put("categories", JSONArray().put(category))
            .put("resources", JSONArray().put(item)).put("versionCount", 0).put("versions", JSONArray())
        val file = File(cache, "category-${UUID.randomUUID()}.zip")
        ZipOutputStream(file.outputStream()).use { zip ->
            zip.putNextEntry(ZipEntry(archivePath)); zip.write(bytes); zip.closeEntry()
            zip.putNextEntry(ZipEntry("manifest.json")); zip.write(manifest.toString().toByteArray()); zip.closeEntry()
        }
        return android.net.Uri.fromFile(file)
    }
}
