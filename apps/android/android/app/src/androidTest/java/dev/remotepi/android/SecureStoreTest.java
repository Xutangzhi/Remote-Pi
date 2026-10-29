package dev.remotepi.android;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.filters.SdkSuppress;
import com.getcapacitor.JSObject;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import java.util.Comparator;
import static org.junit.Assert.*;

/** Exercises the Android Keystore and actual private-file storage on a device. */
@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 26)
public class SecureStoreTest {
    private SecureStore store;
    private File directory;
    private Context context;
    @Before public void setup() {
        Context base = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String namespace = "secure-store-test-" + UUID.randomUUID();
        directory = new File(base.getCacheDir(), namespace); directory.mkdirs();
        context = new ContextWrapper(base) {
            @Override public File getFilesDir() { return directory; }
            @Override public SharedPreferences getSharedPreferences(String name, int mode) { return super.getSharedPreferences(namespace + name, mode); }
        };
        store = new SecureStore(context);
    }
    @After public void cleanup() throws Exception {
        context.getSharedPreferences("settings", Context.MODE_PRIVATE).edit().clear().commit();
        try (java.util.stream.Stream<java.nio.file.Path> files = Files.walk(directory.toPath())) { files.sorted(Comparator.reverseOrder()).forEach(path -> path.toFile().delete()); }
    }
    @Test public void importedKeyRoundTripsThroughAndroidKeystoreEncryption() throws Exception {
        byte[] key = "-----BEGIN OPENSSH PRIVATE KEY-----\nlocal-storage-test-only\n-----END OPENSSH PRIVATE KEY-----".getBytes(StandardCharsets.US_ASCII);
        File source = new File(directory, "import.key"); Files.write(source.toPath(), key);
        String identity = store.importKey(Uri.fromFile(source));
        File encrypted = new File(directory, "keys/" + identity.substring(4));
        assertTrue(encrypted.isFile());
        assertFalse(new String(Files.readAllBytes(encrypted.toPath()), StandardCharsets.ISO_8859_1).contains("local-storage-test-only"));
        assertArrayEquals(key, store.readKey(identity));
    }
    @Test public void savedProfilesExcludeAuthenticationSecretsAndSurviveReload() throws Exception {
        JSObject profile = new JSObject().put("id", "test").put("name", "test").put("host", "127.0.0.1").put("username", "test").put("port", 22).put("remotePort", 8504).put("identityFile", "").put("password", "must-not-be-saved");
        store.saveProfile(profile);
        String settings = new SecureStore(context).settings().toString();
        assertTrue(settings.contains("127.0.0.1")); assertFalse(settings.contains("must-not-be-saved")); assertFalse(settings.contains("password"));
    }
}
