package dev.remotepi.android;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import dev.remotepi.android.core.SshTunnel;
import dev.remotepi.android.core.PiTransport;
import okhttp3.Response;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import android.util.Base64;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeNotNull;

/** Pass the local SSH fixture ports through instrumentation arguments. */
@RunWith(AndroidJUnit4.class)
public class SshDeviceTest {
    @Test public void androidCanLoginWithEncryptedOpenSshEd25519Key() throws Exception {
        android.os.Bundle args = InstrumentationRegistry.getArguments();
        assumeNotNull(args.getString("sshPort"), args.getString("webPort"), args.getString("privateKey"), args.getString("passphrase"));
        File knownHosts = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(), "ssh-test-" + UUID.randomUUID());
        SshTunnel tunnel = new SshTunnel(knownHosts); byte[] key = Base64.decode(args.getString("privateKey"), Base64.DEFAULT);
        try {
            tunnel.connect(new SshTunnel.Options("127.0.0.1", "test", Integer.parseInt(args.getString("sshPort")), Integer.parseInt(args.getString("webPort")), ""), key, (prompt, host) -> host ? "yes" : args.getString("passphrase"), (message) -> {}, () -> true);
            assertTrue(tunnel.isConnected()); assertArrayEquals(new byte[key.length], key);
        } finally { tunnel.disconnect(); knownHosts.delete(); }
    }
    @Test public void androidCanTunnelPiWebHttpAndWebSocket() throws Exception {
        android.os.Bundle args = InstrumentationRegistry.getArguments();
        assumeNotNull(args.getString("sshPort"), args.getString("webPort"), args.getString("password"));
        File knownHosts = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(), "ssh-test-" + UUID.randomUUID());
        SshTunnel tunnel = new SshTunnel(knownHosts);
        CountDownLatch statusReceived = new CountDownLatch(1);
        PiTransport transport = new PiTransport(tunnel, (id, type, data) -> { if ("message".equals(type) && data != null && data.contains("machine.status")) statusReceived.countDown(); });
        try {
            tunnel.connect(new SshTunnel.Options("127.0.0.1", "test", Integer.parseInt(args.getString("sshPort")), Integer.parseInt(args.getString("webPort")), ""), null, (prompt, host) -> host ? "yes" : args.getString("password"), (message) -> {}, () -> true);
            assertTrue(tunnel.isConnected());
            try (Response response = transport.request("/api/machines/local/projects", "GET", null)) { assertEquals(200, response.code()); assertTrue(response.body().string().contains("/srv/projects")); }
            transport.openSocket("android-test", "/api/machines/local/events");
            assertTrue("machine status must arrive through the real SSH tunnel", statusReceived.await(15, TimeUnit.SECONDS));
        } finally { transport.disconnect(); tunnel.disconnect(); knownHosts.delete(); }
    }
}
