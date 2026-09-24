package buzz.jixiangruyi1207.srl;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class NativeCloudObjectNameContractTest {
    @Test
    public void koofrAcceptsCanonicalContentAndManifestKeys() {
        String hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        String objectKey = "objects/srl-chunk--sha256-" + hash;
        assertEquals(
            objectKey,
            NativeCloudObjectKey.validate("webdav", objectKey, false)
        );
        assertEquals("srl-chunk--sha256-" + hash, NativeCloudObjectKey.baseName(objectKey));
        assertEquals(
            "snapshots/srl-snapshot-test.srlmanifest.v3.json.gz",
            NativeCloudObjectKey.validate(
                "webdav", "snapshots/srl-snapshot-test.srlmanifest.v3.json.gz", true
            )
        );
    }

    @Test
    public void githubStillRejectsPathLikeAssetNames() {
        assertThrows(
            IllegalArgumentException.class,
            () -> NativeCloudObjectKey.validate("github", "objects/file", false)
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> NativeCloudObjectKey.validate("github", "snapshots/manifest", true)
        );
    }

    @Test
    public void koofrRejectsTraversalWrongDirectoriesAndBackslashes() {
        assertThrows(
            IllegalArgumentException.class,
            () -> NativeCloudObjectKey.validate("webdav", "../file", false)
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> NativeCloudObjectKey.validate("webdav", "snapshots/file", false)
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> NativeCloudObjectKey.validate("webdav", "objects\\file", false)
        );
    }
}
