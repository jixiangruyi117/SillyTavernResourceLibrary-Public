package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.graphics.Bitmap;
import android.net.Uri;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NativeFilePipelineTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test public void safCopyResumesIntoTheSameDocumentAndRecoversRenameBeforeReceipt() throws Exception {
        String taskId=java.util.UUID.randomUUID().toString();
        Uri treeUri=android.provider.DocumentsContract.buildTreeDocumentUri("srl.archive.checkpoint.tests","root");
        java.util.concurrent.CountDownLatch granted=new java.util.concurrent.CountDownLatch(1);
        android.content.Intent grant=new android.content.Intent().setClassName(context.getPackageName()+".test",ArchiveTestGrantReceiver.class.getName());
        context.sendOrderedBroadcast(grant,null,new android.content.BroadcastReceiver() {
            @Override public void onReceive(Context owner,android.content.Intent intent) { if(getResultCode()==android.app.Activity.RESULT_OK)granted.countDown(); }
        },null,0,null,null);
        assertTrue("test provider tree grant",granted.await(5,java.util.concurrent.TimeUnit.SECONDS));
        androidx.documentfile.provider.DocumentFile tree=androidx.documentfile.provider.DocumentFile.fromTreeUri(context,treeUri);
        JSObject state=NativeArchiveExport.begin(context,taskId,"测试备份.zip",treeUri.toString());
        String id=state.getString("id");
        File dir=new File(NativeArchiveExport.root(context),id);
        androidx.documentfile.provider.DocumentFile result=null;
        try {
            byte[] bytes="{\"test\":true}".getBytes(StandardCharsets.UTF_8);
            NativeArchiveExport.resetInput(context,id,"manifest.json");
            NativeArchiveExport.appendInput(context,id,"manifest.json",0,bytes);
            NativeArchiveExport.compress(context,id,"manifest.json",null,bytes.length,true,315532800000L,null);
            state=NativeArchiveExport.assemble(context,id,java.util.Arrays.asList("manifest.json"));
            androidx.documentfile.provider.DocumentFile partial=tree.createFile("application/octet-stream",state.getString("fileName")+".partial");
            assertNotNull(partial);
            String oldUri=partial.getUri().toString();
            try(OutputStream output=context.getContentResolver().openOutputStream(partial.getUri(),"wt")) { output.write("incomplete".getBytes(StandardCharsets.UTF_8)); }
            state.put("targetUri",oldUri);
            NativeArchiveTasks.writeJson(context,new android.util.AtomicFile(new File(dir,"state.json")),state);
            // A completed copy can survive without the rename or local receipt.
            try(InputStream input=new FileInputStream(new File(dir,"archive.zip")); OutputStream output=context.getContentResolver().openOutputStream(partial.getUri(),"wt")) {
                byte[] buffer=new byte[1024];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
            }
            JSObject published=NativeArchiveExport.publish(context,id);
            result=androidx.documentfile.provider.DocumentFile.fromSingleUri(context,Uri.parse(published.getString("targetUri")));
            assertNotNull(result);assertTrue(result.exists());assertTrue(published.getBoolean("saved"));
            assertEquals(state.getString("fileName"),result.getName());
            assertNotEquals(oldUri,published.getString("targetUri"));
            // Simulate death between the provider's rename and the local saved receipt.
            state.put("targetUri",oldUri);state.put("saved",false);
            NativeArchiveTasks.writeJson(context,new android.util.AtomicFile(new File(dir,"state.json")),state);
            assertEquals(result.getUri().toString(),NativeArchiveExport.publish(context,id).getString("targetUri"));
            assertEquals(1,tree.listFiles().length);
            NativeArchiveExport.removeTask(context,taskId);
            assertTrue(result.exists());
        } finally {
            NativeArchiveExport.removeTask(context,taskId);
            if(result!=null)result.delete();
        }
    }

    @Test public void compressedEntriesSurviveRestartAndAssembleWithoutRecompression() throws Exception {
        String taskId=java.util.UUID.randomUUID().toString();
        String id=taskId+"-0123456789abcdef";
        File dir=new File(NativeArchiveExport.root(context),id); assertTrue(dir.mkdir());
        JSObject state=new JSObject(); state.put("id",id);
        NativeArchiveTasks.writeJson(context,new android.util.AtomicFile(new File(dir,"state.json")),state);
        try {
            for(String path:new String[]{"files/中文.txt","files/image.png","manifest.json"}) {
                byte[] bytes=("payload:"+path).getBytes(StandardCharsets.UTF_8);
                NativeArchiveExport.resetInput(context,id,path);
                NativeArchiveExport.appendInput(context,id,path,0,bytes);
                JSObject meta=NativeArchiveExport.compress(context,id,path,null,bytes.length,!path.endsWith("png"),System.currentTimeMillis(),null);
                assertEquals(path,meta.getString("path"));
                assertNotNull(NativeArchiveExport.entry(context,id,path));
            }
            File[] cached=dir.listFiles((d,n)->n.endsWith(".zip"));
            long modified=cached[0].lastModified();
            JSObject ready=NativeArchiveExport.assemble(context,id,java.util.Arrays.asList("files/中文.txt","files/image.png","manifest.json"));
            assertEquals(modified,cached[0].lastModified());
            assertTrue(ready.getLong("bytes")>0);
            try(ZipFile zip=new ZipFile(new File(dir,"archive.zip"))) {
                assertEquals(3,zip.size());
                for(String path:new String[]{"files/中文.txt","files/image.png","manifest.json"}) {
                    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                    try(InputStream input=zip.getInputStream(zip.getEntry(path))) { byte[] buffer=new byte[1024]; int count; while((count=input.read(buffer))!=-1) bytes.write(buffer,0,count); }
                    assertEquals("payload:"+path,bytes.toString("UTF-8"));
                }
            }
            try(RandomAccessFile bad=new RandomAccessFile(cached[0],"rw")) { bad.seek(0); bad.writeByte(0); }
            // Same length corruption must not pass checkpoint validation.
            boolean rejected=false;
            for(String path:new String[]{"files/中文.txt","files/image.png","manifest.json"}) if(NativeArchiveExport.entry(context,id,path)==null) rejected=true;
            assertTrue(rejected);
        } finally { NativeArchiveExport.removeTask(context,taskId); }
    }

    @Test public void archiveTaskJournalIsEncryptedAndSurvivesNewOwner() throws Exception {
        String id=java.util.UUID.randomUUID().toString();
        JSObject task=new JSObject(); task.put("id",id); task.put("kind","export"); task.put("name","test"); task.put("phase","compress"); task.put("secret","sample-secret-only");
        try {
            NativeArchiveTasks.save(context,task);
            String disk=new String(new android.util.AtomicFile(new File(NativeArchiveTasks.root(context),id+".json")).readFully(),StandardCharsets.UTF_8);
            assertFalse(disk.contains("sample-secret-only"));
            assertEquals("sample-secret-only",NativeArchiveTasks.read(context,id).getString("secret"));
        } finally { NativeArchiveTasks.remove(context,id); }
    }

    private File archive(String name, String... paths) throws Exception {
        File root = new File(context.getFilesDir(), "srl-shared-intake");
        root.mkdirs();
        File source = new File(root, name);
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(source))) {
            for (String path : paths) {
                zip.putNextEntry(new ZipEntry(path));
                zip.write(("payload-" + path).getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
        }
        return source;
    }

    @Test public void interruptedExtractionReusesVerifiedCheckpointsAndRepairsCorruption() throws Exception {
        File source = archive("resume.zip", "manifest.json", "files/原件.txt", "empty.txt");
        String jobId = "native-zip-" + NativeFileAccess.hash(source);
        try {
            try {
                NativeArchiveStaging.stage(context, source, (completed, reused) -> {
                    if (completed == 1) throw new IOException("simulate interruption");
                });
                fail("expected interruption");
            } catch (IOException expected) { assertEquals("simulate interruption", expected.getMessage()); }
            JSObject continued = NativeArchiveStaging.stage(context, source);
            assertEquals(1, continued.getInt("reusedEntries"));
            assertEquals(3, continued.getInt("completedEntries"));
            JSObject entry = NativeArchiveStaging.read(context, jobId, "files/原件.txt").getJSObject("entry");
            File payload = new File(Uri.parse(entry.getString("uri")).getPath());
            try (RandomAccessFile output = new RandomAccessFile(payload, "rw")) { output.write(0); }
            assertEquals(2, NativeArchiveStaging.stage(context, source).getInt("reusedEntries"));
            assertEquals(entry.getString("sha256"), NativeFileAccess.hash(payload));
            assertEquals(3, NativeArchiveStaging.stage(context, source).getInt("reusedEntries"));
        } finally { NativeArchiveStaging.remove(context, jobId); source.delete(); }
    }

    @Test public void traversalIsRejectedAndPrivateSettingsCannotBeRead() throws Exception {
        File source = archive("unsafe.zip", "../escape");
        String jobId = "native-zip-" + NativeFileAccess.hash(source);
        try {
            try { NativeArchiveStaging.stage(context, source); fail("unsafe ZIP accepted"); }
            // Android 14 may reject traversal inside ZipFile before our own path check.
            catch (IOException expected) { assertNotNull(expected.getMessage()); }
            File privateFile = new File(context.getFilesDir(), "private-test-settings");
            try {
                try (FileOutputStream stream = new FileOutputStream(privateFile)) { stream.write(1); }
                try { NativeFileAccess.resolve(context, privateFile.getPath()); fail("private file exposed"); }
                catch (IOException expected) { assertTrue(expected.getMessage().contains("目录")); }
            } finally { privateFile.delete(); }
        } finally { NativeArchiveStaging.remove(context, jobId); source.delete(); }
    }

    @Test public void longImageThumbnailIsSampledToTheRequestedEdge() throws Exception {
        File source = new File(context.getCacheDir(), "long-image-test.png");
        Bitmap input = Bitmap.createBitmap(300, 12000, Bitmap.Config.ARGB_8888);
        try (FileOutputStream stream = new FileOutputStream(source)) { input.compress(Bitmap.CompressFormat.PNG, 100, stream); }
        finally { input.recycle(); }
        try {
            assertTrue(NativeImageDecoder.supportsRegion(source, NativeImageDecoder.bounds(source)));
            Bitmap result = NativeImageDecoder.thumbnail(source, 640);
            assertNotNull(result);
            assertTrue(result.getWidth() <= 640);
            assertTrue(result.getHeight() <= 640);
            assertTrue(result.getAllocationByteCount() <= 640 * 640 * 4);
            result.recycle();
            Bitmap tile = NativeImageDecoder.region(source, new android.graphics.Rect(0, 5000, 300, 6000), 512);
            assertNotNull(tile);
            assertTrue(tile.getWidth() <= 512);
            assertTrue(tile.getHeight() <= 512);
            assertTrue(tile.getAllocationByteCount() <= 512 * 512 * 4);
            tile.recycle();
        } finally { source.delete(); }
    }

    @Test public void jpegThumbnailPreservesExifOrientation() throws Exception {
        File source = new File(context.getCacheDir(), "orientation-test.jpg");
        Bitmap input = Bitmap.createBitmap(100, 200, Bitmap.Config.ARGB_8888);
        try (FileOutputStream stream = new FileOutputStream(source)) { input.compress(Bitmap.CompressFormat.JPEG, 90, stream); }
        finally { input.recycle(); }
        try {
            android.media.ExifInterface exif = new android.media.ExifInterface(source.getPath());
            exif.setAttribute(android.media.ExifInterface.TAG_ORIENTATION, "6"); exif.saveAttributes();
            Bitmap result = NativeImageDecoder.thumbnail(source, 640);
            assertNotNull(result);
            assertEquals(200, result.getWidth());
            assertEquals(100, result.getHeight());
            result.recycle();
        } finally { source.delete(); }
    }
}
