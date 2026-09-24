package buzz.jixiangruyi1207.srl.nativeapp.model

data class NativeResource(
    val id: String,
    val type: String,
    val name: String,
    val description: String,
    val fileName: String,
    val mimeType: String,
    val fileSize: Long,
    val contentHash: String,
    val favorite: Boolean,
    val tags: List<String>,
    val categoryIds: List<String>,
    val versionGroupId: String?,
    val versionLabel: String,
    val versionNote: String,
    val versionImportedAt: Long,
    val metadataJson: String,
    val localPath: String,
    val createdAt: Long,
    val updatedAt: Long,
    val relatedResourceIds: List<String> = emptyList(),
)

data class NativeResourceBundle(
    val id: String,
    val name: String,
    val primaryResourceId: String,
    val resourceIds: List<String>,
    val createdAt: Long,
    val updatedAt: Long,
)

data class NativeTagMutation(
    val resourceId: String,
    val resourceName: String,
    val tags: List<String>,
)

data class NativeTagMutationResult(val resourceCount: Int, val tagCount: Int)

data class NativeCategory(
    val id: String,
    val name: String,
    val color: String,
    val sortOrder: Int,
    val hidden: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
)

data class ParsedNativeResource(
    val type: String,
    val name: String,
    val description: String,
    val tags: List<String>,
    val metadataJson: String,
)

data class ImportReport(
    val imported: Int,
    val skippedDuplicates: Int,
    val failed: Int,
    val messages: List<String>,
) {
    fun summary(): String = buildString {
        append("已导入 $imported 项")
        if (skippedDuplicates > 0) append("，跳过 $skippedDuplicates 项重复内容")
        if (failed > 0) append("，$failed 项失败")
        messages.firstOrNull()?.let { append("：$it") }
    }
}

data class ExportReport(val resourceCount: Int, val versionCount: Int)

data class NativeSnapshot(
    val id: String,
    val reason: String,
    val resourceCount: Int,
    val categoryCount: Int,
    val size: Long,
    val createdAt: Long,
    val filePath: String,
)

data class NativeCloudSource(
    val manifestJson: String,
    val filePath: String,
    val isVersion: Boolean,
    val contentHash: String,
    val fileSize: Long,
)

data class NativeBackupSelection(
    val resources: Boolean = true,
    val versions: Boolean = true,
    val categories: Boolean = true,
    val portableData: Boolean = true,
) {
    fun requireContent() {
        require(resources || versions || categories || portableData) { "至少选择一项备份内容" }
    }
}

val resourceTypeLabels = mapOf(
    "characterCard" to "角色卡",
    "userPersona" to "用户人设",
    "worldBook" to "世界书",
    "beautification" to "主题美化",
    "regex" to "正则",
    "preset" to "预设",
    "quickReply" to "快速回复",
    "script" to "脚本",
    "plugin" to "插件清单",
    "other" to "其他",
)
