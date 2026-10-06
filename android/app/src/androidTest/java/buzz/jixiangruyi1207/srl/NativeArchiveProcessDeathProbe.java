package buzz.jixiangruyi1207.srl;

import android.content.Context;
import android.util.AtomicFile;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.*;
import org.junit.Test;
import org.junit.Assume;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Opt-in two-process probe. The harness force-stops ONLY its isolated test application. */
@RunWith(AndroidJUnit4.class)
public class NativeArchiveProcessDeathProbe {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private String taskId() { return InstrumentationRegistry.getArguments().getString("archiveTaskId"); }
    private String exportId() { return taskId()+"-0123456789abcdef"; }
    private File source() { return new File(new File(context.getFilesDir(),"srl-shared-intake"),"process-"+taskId()+".zip"); }

    @Test public void writeAndWaitForProcessDeath() throws Exception {
        Assume.assumeTrue("write".equals(InstrumentationRegistry.getArguments().getString("archiveProbe")));
        source().getParentFile().mkdirs();
        try(ZipOutputStream zip=new ZipOutputStream(new FileOutputStream(source()))) {
            for(String path:Arrays.asList("manifest.json","files/second.txt")) {
                zip.putNextEntry(new ZipEntry(path)); zip.write(path.getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
            }
        }
        try { NativeArchiveStaging.stage(context,source(),(phase,readBytes,totalBytes,completed,entries,reused,stagedBytes,totalStagedBytes)-> { if(completed==1) throw new IOException("checkpoint reached"); }); }
        catch(IOException expected) { assertEquals("checkpoint reached",expected.getMessage()); }
        File dir=new File(NativeArchiveExport.root(context),exportId()); assertTrue(dir.mkdir());
        JSObject state=new JSObject(); state.put("id",exportId());
        NativeArchiveTasks.writeJson(context,new AtomicFile(new File(dir,"state.json")),state);
        byte[] bytes="persisted-before-kill".getBytes(StandardCharsets.UTF_8);
        NativeArchiveExport.resetInput(context,exportId(),"files/first.txt");
        NativeArchiveExport.appendInput(context,exportId(),"files/first.txt",0,bytes);
        NativeArchiveExport.compress(context,exportId(),"files/first.txt",null,bytes.length,true,315532800000L,null);
        JSObject task=new JSObject(); task.put("id",taskId()); task.put("kind","export"); task.put("name","process death probe"); task.put("phase","checkpoint");
        NativeArchiveTasks.save(context,task);
        try(FileOutputStream marker=new FileOutputStream(new File(context.getFilesDir(),"archive-kill-ready"))) { marker.write(taskId().getBytes(StandardCharsets.UTF_8)); marker.getFD().sync(); }
        Thread.sleep(120000); // Harness must kill the process here, before this test returns.
        fail("process-death harness did not stop the test application");
    }

    @Test public void resumeInNewProcess() throws Exception {
        Assume.assumeTrue("read".equals(InstrumentationRegistry.getArguments().getString("archiveProbe")));
        assertEquals("checkpoint",NativeArchiveTasks.read(context,taskId()).getString("phase"));
        assertEquals(1,NativeArchiveStaging.stage(context,source()).getInt("reusedEntries"));
        assertNotNull(NativeArchiveExport.entry(context,exportId(),"files/first.txt"));
        byte[] bytes="{}".getBytes(StandardCharsets.UTF_8);
        NativeArchiveExport.resetInput(context,exportId(),"manifest.json");
        NativeArchiveExport.appendInput(context,exportId(),"manifest.json",0,bytes);
        NativeArchiveExport.compress(context,exportId(),"manifest.json",null,bytes.length,true,315532800000L,null);
        NativeArchiveExport.assemble(context,exportId(),Arrays.asList("files/first.txt","manifest.json"));
        try(ZipFile zip=new ZipFile(new File(new File(NativeArchiveExport.root(context),exportId()),"archive.zip"))) { assertEquals(2,zip.size()); }
        NativeArchiveExport.removeTask(context,taskId());
        NativeArchiveTasks.remove(context,taskId());
        NativeArchiveStaging.remove(context,"native-zip-"+NativeFileAccess.hash(source()));
        assertTrue(source().delete());
        assertTrue(new File(context.getFilesDir(),"archive-kill-ready").delete());
    }
}
