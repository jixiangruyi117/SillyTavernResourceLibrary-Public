package buzz.jixiangruyi1207.srl;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileNotFoundException;

/** Test APK only: a SAF provider whose document URI changes on rename. */
public class ArchiveTestDocumentsProvider extends DocumentsProvider {
    private File root;
    private static final String[] COLUMNS={"document_id","_display_name","mime_type","flags","_size","last_modified"};
    @Override public boolean onCreate() { root=new File(getContext().getFilesDir(),"archive-saf-tests"); return root.isDirectory()||root.mkdirs(); }
    private File file(String id) throws FileNotFoundException {
        try {
            File file="root".equals(id)?root:new File(root,id.substring(5));
            if(!"root".equals(id) && (!id.startsWith("root/")||!file.getCanonicalFile().getParentFile().equals(root.getCanonicalFile()))) throw new Exception();
            return file;
        } catch(Exception error) { throw new FileNotFoundException("test document path"); }
    }
    private String id(File file) { return file.equals(root)?"root":"root/"+file.getName(); }
    private void add(MatrixCursor cursor,File file) {
        Object[] values={id(file),file.getName(),file.isDirectory()?DocumentsContract.Document.MIME_TYPE_DIR:"application/zip",
            file.isDirectory()?DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE:DocumentsContract.Document.FLAG_SUPPORTS_WRITE|DocumentsContract.Document.FLAG_SUPPORTS_RENAME|DocumentsContract.Document.FLAG_SUPPORTS_DELETE,file.length(),file.lastModified()};
        MatrixCursor.RowBuilder row=cursor.newRow();
        for(String column:cursor.getColumnNames()) { int index=java.util.Arrays.asList(COLUMNS).indexOf(column);row.add(index<0?null:values[index]); }
    }
    @Override public Cursor queryRoots(String[] projection) {
        MatrixCursor cursor=new MatrixCursor(new String[]{"root_id","document_id","title","flags"});
        cursor.addRow(new Object[]{"root","root","Archive test",DocumentsContract.Root.FLAG_SUPPORTS_CREATE});return cursor;
    }
    @Override public Cursor queryDocument(String documentId,String[] projection) throws FileNotFoundException {
        MatrixCursor cursor=new MatrixCursor(projection==null?COLUMNS:projection);File file=file(documentId);if(file.exists())add(cursor,file);return cursor;
    }
    @Override public Cursor queryChildDocuments(String parentId,String[] projection,String sortOrder) throws FileNotFoundException {
        MatrixCursor cursor=new MatrixCursor(projection==null?COLUMNS:projection);File[] files=file(parentId).listFiles();if(files!=null)for(File file:files)add(cursor,file);return cursor;
    }
    @Override public ParcelFileDescriptor openDocument(String documentId,String mode,CancellationSignal signal) throws FileNotFoundException { return ParcelFileDescriptor.open(file(documentId),ParcelFileDescriptor.parseMode(mode)); }
    @Override public String createDocument(String parentId,String mime,String name) throws FileNotFoundException {
        File file=new File(file(parentId),name);file("root/"+name);
        try { if(!file.createNewFile())throw new Exception();return id(file); }catch(Exception error){throw new FileNotFoundException("test create");}
    }
    @Override public String renameDocument(String documentId,String name) throws FileNotFoundException {
        File old=file(documentId),next=file("root/"+name);if(!old.renameTo(next))throw new FileNotFoundException("test rename");return id(next);
    }
    @Override public void deleteDocument(String documentId) throws FileNotFoundException { if(!file(documentId).delete())throw new FileNotFoundException("test delete"); }
    @Override public boolean isChildDocument(String parent,String document){return "root".equals(parent)&&document.startsWith("root/");}
}
