package dev.remotepi.android.core;

import org.junit.Test;
import org.junit.Rule;
import org.junit.Assume;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;
import java.io.*;
import okhttp3.Response;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Base64;
import java.util.concurrent.CancellationException;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.KeyPair;

public class SshTunnelTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private SshTunnel.Options options() {
        Assume.assumeTrue("Use npm run test:native to launch the SSH fixture", System.getenv("REMOTE_PI_TEST_SSH_PORT") != null);
        return new SshTunnel.Options("127.0.0.1", "test", Integer.parseInt(System.getenv("REMOTE_PI_TEST_SSH_PORT")), Integer.parseInt(System.getenv("REMOTE_PI_TEST_WEB_PORT")), "");
    }
    @Test public void rejectsInvalidConnectionArguments() {
        assertThrows(IllegalArgumentException.class, () -> new SshTunnel.Options("host;whoami", "test", 22, 8504, ""));
        assertThrows(IllegalArgumentException.class, () -> new SshTunnel.Options("host", "", 22, 8504, ""));
        assertThrows(IllegalArgumentException.class, () -> new SshTunnel.Options("host", "test", 0, 8504, ""));
    }
    @Test public void passwordLoginVerifiesHostCarriesHttpAndRemembersTrust() throws Exception {
        SshTunnel.Options options = options(); File knownHosts = new File(temp.getRoot(), "known_hosts"); SshTunnel tunnel = new SshTunnel(knownHosts);
        ArrayList<Boolean> prompts = new ArrayList<>();
        SshTunnel.Auth auth = (prompt, host) -> { prompts.add(host); return host ? "yes" : System.getenv("REMOTE_PI_TEST_PASSWORD"); };
        try {
            tunnel.connect(options, null, auth, (message) -> {}, () -> true);
            assertTrue(tunnel.isConnected()); assertEquals(Boolean.TRUE, prompts.get(0)); assertTrue(prompts.contains(false));
            PiTransport transport = new PiTransport(tunnel, (id, type, data) -> {});
            try (Response response = transport.request("/api/machines/local/projects", "GET", null)) { assertTrue(response.body().string().contains("Remote Pi")); }
            finally { transport.disconnect(); }
            assertTrue(knownHosts.length() > 0); assertFalse(new String(Files.readAllBytes(knownHosts.toPath()), StandardCharsets.UTF_8).contains(System.getenv("REMOTE_PI_TEST_PASSWORD")));
            tunnel.disconnect(); prompts.clear();
            tunnel.connect(options, null, auth, (message) -> {}, () -> true);
            assertFalse("a trusted host must not prompt again", prompts.contains(true));
        } finally { tunnel.disconnect(); }
    }
    @Test public void changedHostKeyIsRejectedBeforeAnyUserApproval() throws Exception {
        SshTunnel.Options options = options(); File knownHosts = new File(temp.getRoot(), "known_hosts");
        KeyPair otherKey = KeyPair.genKeyPair(new JSch(), KeyPair.RSA, 2048);
        Files.write(knownHosts.toPath(), ("[127.0.0.1]:" + options.port + " ssh-rsa " + Base64.getEncoder().encodeToString(otherKey.getPublicKeyBlob()) + "\n").getBytes(StandardCharsets.UTF_8));
        otherKey.dispose(); SshTunnel tunnel = new SshTunnel(knownHosts); ArrayList<String> prompts = new ArrayList<>();
        try {
            Exception error = assertThrows(Exception.class, () -> tunnel.connect(options, null, (prompt, host) -> { prompts.add(prompt); return "yes"; }, (message) -> {}, () -> true));
            assertTrue(error.toString(), error.toString().contains("主机密钥已变化")); assertTrue(prompts.isEmpty()); assertFalse(tunnel.isConnected());
        } finally { tunnel.disconnect(); }
    }
    @Test public void encryptedOpenSshEd25519KeyAuthenticatesWithoutPassword() throws Exception {
        SshTunnel.Options options = options();
        byte[] key = Files.readAllBytes(new File(System.getenv("REMOTE_PI_TEST_KEY")).toPath());
        SshTunnel tunnel = new SshTunnel(new File(temp.getRoot(), "known_hosts")); ArrayList<String> secrets = new ArrayList<>();
        try {
            tunnel.connect(options, key, (prompt, host) -> { if (host) return "yes"; secrets.add(prompt); return System.getenv("REMOTE_PI_TEST_PASSPHRASE"); }, (message) -> {}, () -> true);
            assertTrue(tunnel.isConnected()); assertEquals("only the encrypted key passphrase should be requested", 1, secrets.size());
            assertArrayEquals("the decrypted import buffer must be wiped", new byte[key.length], key);
        } finally { tunnel.disconnect(); }
    }
    @Test public void cancellingHostVerificationLeavesNoConnection() throws Exception {
        SshTunnel.Options options = options(); SshTunnel tunnel = new SshTunnel(new File(temp.getRoot(), "known_hosts"));
        try { assertThrows(Exception.class, () -> tunnel.connect(options, null, (prompt, host) -> null, (message) -> {}, () -> true)); assertFalse(tunnel.isConnected()); }
        finally { tunnel.disconnect(); }
    }
    @Test public void cancelledAttemptCannotOpenAnSshTunnel() throws Exception {
        SshTunnel tunnel = new SshTunnel(new File(temp.getRoot(), "known_hosts"));
        assertThrows(CancellationException.class, () -> tunnel.connect(new SshTunnel.Options("127.0.0.1", "test", 22, 8504, ""), null, (prompt, host) -> "yes", (message) -> {}, () -> false));
        assertFalse(tunnel.isConnected());
    }
}
