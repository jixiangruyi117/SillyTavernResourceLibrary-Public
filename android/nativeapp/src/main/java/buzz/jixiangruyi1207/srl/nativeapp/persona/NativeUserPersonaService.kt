package buzz.jixiangruyi1207.srl.nativeapp.persona

import buzz.jixiangruyi1207.srl.nativeapp.data.NativeResourceStore
import buzz.jixiangruyi1207.srl.nativeapp.model.NativeResource
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.time.LocalDate

data class NativePersonaConnection(val type: String, val id: String)

data class NativePersonaEntry(
    val avatarId: String,
    val name: String,
    val title: String,
    val description: String,
    val position: Int,
    val depth: Int,
    val role: Int,
    val lorebook: String,
    val connections: List<NativePersonaConnection>,
    val invalidConnectionCount: Int,
)

data class NativePersonaBackup(
    val resourceId: String,
    val fileName: String,
    val entries: List<NativePersonaEntry>,
    val defaultPersona: String,
    val warnings: List<String>,
)

class NativeUserPersonaService(private val store: NativeResourceStore) {
    fun listResources(): List<NativeResource> = store.loadResources().filter { it.type == "userPersona" }

    fun load(resourceId: String): NativePersonaBackup {
        val resource = listResources().firstOrNull { it.id == resourceId }
            ?: throw IllegalArgumentException("用户人设资源不存在")
        val root = parseRoot(store.readResourceText(resourceId))
        val personas = root.getJSONObject("personas")
        val descriptions = root.getJSONObject("persona_descriptions")
        val warnings = mutableListOf<String>()
        val entries = personas.keys().asSequence().map { avatarId ->
            val rawName = personas.opt(avatarId)
            val name = rawName as? String ?: ""
            if (name.isBlank()) warnings += "人设 $avatarId 的名称不是有效字符串"
            val descriptor = descriptions.optJSONObject(avatarId)
            if (descriptor == null) warnings += "人设 $avatarId 缺少有效描述对象"
            val connections = mutableListOf<NativePersonaConnection>()
            var invalidConnections = 0
            val rawConnections = descriptor?.optJSONArray("connections")
            if (rawConnections != null) {
                for (index in 0 until rawConnections.length()) {
                    val connection = rawConnections.optJSONObject(index)
                    val type = connection?.optString("type").orEmpty()
                    val id = connection?.optString("id").orEmpty().trim()
                    if (type in setOf("character", "group") && id.isNotBlank()) connections += NativePersonaConnection(type, id)
                    else invalidConnections += 1
                }
            } else if (descriptor?.has("connections") == true) invalidConnections += 1
            if (invalidConnections > 0) warnings += "人设 $avatarId 有 $invalidConnections 条无法识别的连接"
            NativePersonaEntry(
                avatarId = avatarId,
                name = name,
                title = descriptor?.optString("title").orEmpty(),
                description = descriptor?.optString("description").orEmpty(),
                position = descriptor?.optInt("position", 0) ?: 0,
                depth = descriptor?.optInt("depth", 2) ?: 2,
                role = descriptor?.optInt("role", 0) ?: 0,
                lorebook = descriptor?.optString("lorebook").orEmpty(),
                connections = connections,
                invalidConnectionCount = invalidConnections,
            )
        }.toList()
        val defaultPersona = root.optString("default_persona")
        if (defaultPersona.isNotBlank() && !personas.has(defaultPersona)) warnings += "默认人设 $defaultPersona 不存在"
        return NativePersonaBackup(resource.id, resource.fileName, entries, defaultPersona, warnings)
    }

    fun create(entry: NativePersonaEntry): NativeResource {
        validate(entry)
        val root = JSONObject()
            .put("personas", JSONObject().put(entry.avatarId.trim(), entry.name.trim()))
            .put("persona_descriptions", JSONObject().put(entry.avatarId.trim(), descriptor(entry)))
            .put("default_persona", entry.avatarId.trim())
        return store.importGeneratedJson("personas_${LocalDate.now().toString().replace("-", "")}.json", serialize(root))
    }

    fun save(resourceId: String, originalAvatarId: String?, entry: NativePersonaEntry) {
        validate(entry)
        val root = parseRoot(store.readResourceText(resourceId))
        val personas = root.getJSONObject("personas")
        val descriptions = root.getJSONObject("persona_descriptions")
        val avatarId = entry.avatarId.trim()
        val previousId = originalAvatarId?.trim().orEmpty()
        if (previousId.isNotBlank() && previousId != avatarId && personas.has(avatarId)) {
            throw IllegalArgumentException("头像文件名 $avatarId 已被另一个人设使用")
        }
        val previousDescriptor = descriptions.optJSONObject(previousId)?.let { JSONObject(it.toString()) } ?: JSONObject()
        if (previousId.isNotBlank()) {
            personas.remove(previousId)
            descriptions.remove(previousId)
        }
        personas.put(avatarId, entry.name.trim())
        val nextDescriptor = previousDescriptor
        val normalized = descriptor(entry)
        normalized.keys().forEach { key -> nextDescriptor.put(key, normalized.get(key)) }
        descriptions.put(avatarId, nextDescriptor)
        if (root.optString("default_persona") == previousId || root.optString("default_persona").isBlank()) root.put("default_persona", avatarId)
        store.replaceJsonResource(resourceId, serialize(root), if (previousId.isBlank()) "新增用户人设" else "编辑用户人设")
    }

    fun duplicate(resourceId: String, avatarId: String, nextAvatarId: String) {
        val root = parseRoot(store.readResourceText(resourceId))
        val personas = root.getJSONObject("personas")
        val descriptions = root.getJSONObject("persona_descriptions")
        require(personas.has(avatarId)) { "要复制的人设不存在" }
        val normalizedNext = nextAvatarId.trim()
        require(normalizedNext.isNotBlank()) { "新头像文件名不能为空" }
        require(!personas.has(normalizedNext)) { "头像文件名 $normalizedNext 已存在" }
        personas.put(normalizedNext, "${personas.optString(avatarId)} 副本")
        descriptions.put(normalizedNext, descriptions.optJSONObject(avatarId)?.let { JSONObject(it.toString()) } ?: JSONObject())
        store.replaceJsonResource(resourceId, serialize(root), "复制用户人设")
    }

    fun remove(resourceId: String, avatarId: String) {
        val root = parseRoot(store.readResourceText(resourceId))
        val personas = root.getJSONObject("personas")
        val descriptions = root.getJSONObject("persona_descriptions")
        require(personas.has(avatarId)) { "要删除的人设不存在" }
        personas.remove(avatarId)
        descriptions.remove(avatarId)
        if (root.optString("default_persona") == avatarId) {
            root.put("default_persona", personas.keys().asSequence().firstOrNull() ?: JSONObject.NULL)
        }
        store.replaceJsonResource(resourceId, serialize(root), "删除用户人设")
    }

    fun setDefault(resourceId: String, avatarId: String) {
        val root = parseRoot(store.readResourceText(resourceId))
        require(root.getJSONObject("personas").has(avatarId)) { "要设为默认的人设不存在" }
        root.put("default_persona", avatarId)
        store.replaceJsonResource(resourceId, serialize(root), "设置默认用户人设")
    }

    private fun parseRoot(text: String): JSONObject {
        val root = runCatching { JSONTokener(text).nextValue() as? JSONObject }.getOrNull()
            ?: throw IllegalArgumentException("用户人设 JSON 已损坏")
        require(root.opt("personas") is JSONObject && root.opt("persona_descriptions") is JSONObject) {
            "不是 SillyTavern 用户人设备份：缺少 personas 或 persona_descriptions"
        }
        return root
    }

    private fun validate(entry: NativePersonaEntry) {
        require(entry.avatarId.trim().isNotBlank()) { "头像文件名不能为空" }
        require(entry.name.trim().isNotBlank()) { "人设名称不能为空" }
        require(entry.position in setOf(0, 1, 2, 3, 4, 9)) { "人设注入位置无效" }
        require(entry.depth in 0..999) { "注入深度无效" }
        require(entry.role in 0..2) { "消息角色无效" }
        require(entry.connections.all { it.type in setOf("character", "group") && it.id.isNotBlank() }) { "人设连接无效" }
    }

    private fun descriptor(entry: NativePersonaEntry): JSONObject = JSONObject()
        .put("description", entry.description)
        .put("position", entry.position)
        .put("depth", entry.depth)
        .put("role", entry.role)
        .put("lorebook", entry.lorebook)
        .put("connections", JSONArray(entry.connections.map { JSONObject().put("type", it.type).put("id", it.id.trim()) }))
        .put("title", entry.title.trim())

    private fun serialize(root: JSONObject): String = "${root.toString(2)}\n"
}
