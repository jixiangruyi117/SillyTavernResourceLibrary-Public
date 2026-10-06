package buzz.jixiangruyi1207.srl;

import java.io.File;
import java.io.FileOutputStream;
import java.security.MessageDigest;

@FunctionalInterface
interface NativeLibraryAction { void run() throws Exception; }
final class PendingWrite {
        final String token;
        final String scope;
        final String id;
        final String fileName;
        final String mimeType;
        final String resourceType;
        final boolean hiddenFromDocuments;
        final String contentHash;
        final long expectedSize;
        final long updatedAt;
        final File temporary;
        final FileOutputStream output;
        final MessageDigest digest;
        long written;

        PendingWrite(String token, String scope, String id, String fileName, String mimeType,
                     String resourceType, boolean hiddenFromDocuments, String contentHash,
                     long expectedSize, long updatedAt, File temporary,
                     FileOutputStream output, MessageDigest digest) {
            this.token = token;
            this.scope = scope;
            this.id = id;
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.resourceType = resourceType;
            this.hiddenFromDocuments = hiddenFromDocuments;
            this.contentHash = contentHash;
            this.expectedSize = expectedSize;
            this.updatedAt = updatedAt;
            this.temporary = temporary;
            this.output = output;
            this.digest = digest;
        }
    }
