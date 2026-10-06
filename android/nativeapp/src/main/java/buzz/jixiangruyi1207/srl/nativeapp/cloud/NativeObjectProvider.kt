package buzz.jixiangruyi1207.srl.nativeapp.cloud

import java.io.File

interface NativeObjectProvider {
    val providerName: String
    fun test(): String
    fun listObjects(): List<NativeCloudObject>
    fun upload(name: String, file: File, contentType: String): NativeCloudObject
    fun download(name: String, destination: File): File
    fun delete(name: String)
}
