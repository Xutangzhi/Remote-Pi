package dev.remotepi.android.core;

import org.junit.Test;
import org.junit.Rule;
import org.junit.Assume;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.*;
import okio.BufferedSink;

public class SshChannelTransportTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private SshTunnel.Options options() {
        Assume.assumeTrue("Use npm run test:native to launch the SSH fixture", System.getenv("REMOTE_PI_TEST_SSH_PORT") != null);
        return new SshTunnel.Options("127.0.0.1", "test", Integer.parseInt(System.getenv("REMOTE_PI_TEST_SSH_PORT")), Integer.parseInt(System.getenv("REMOTE_PI_TEST_WEB_PORT")), "");
    }
    private void connect(SshTunnel tunnel, SshTunnel.Options options, AtomicBoolean active) throws Exception {
        tunnel.connect(options, null, (prompt, host) -> host ? "yes" : System.getenv("REMOTE_PI_TEST_PASSWORD"), message -> {}, active::get);
    }
    @Test public void httpAndBidirectionalWebSocketUseSshWithNoLocalSocket() throws Exception {
        SshTunnel.Options options = options(); SshTunnel tunnel = new SshTunnel(new File(temp.getRoot(), "known_hosts"));
        BlockingQueue<String> frames = new LinkedBlockingQueue<>(); CountDownLatch opened = new CountDownLatch(1);
        PiTransport transport = new PiTransport(tunnel, (id, type, data) -> { if (type.equals("open")) opened.countDown(); if (type.equals("message")) frames.add(data); });
        try {
            connect(tunnel, options, new AtomicBoolean(true));
            assertEquals(Proxy.NO_PROXY, tunnel.connection().client().proxy());
            try (Response response = transport.request("/api/machines/local/projects", "GET", null)) { assertEquals(200, response.code()); assertTrue(response.body().string().contains("Remote Pi")); }
            try (Socket socket = tunnel.connection().client().socketFactory().createSocket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", options.remotePort), 2000);
                assertFalse("the channel must never bind a local TCP socket", socket.isBound()); assertEquals(-1, socket.getLocalPort());
            }
            try (Response response = transport.request("/api/machines/local/projects", "GET", null)) { assertEquals(200, response.code()); response.body().string(); }
            transport.openSocket("terminal", "/api/paired-plugin-backends/terminal/terminal.attach");
            assertTrue(opened.await(5, TimeUnit.SECONDS));
            transport.sendSocket("terminal", "{\"kind\":\"open\"}");
            assertTrue(frames.poll(5, TimeUnit.SECONDS).contains("ready")); assertTrue(frames.poll(5, TimeUnit.SECONDS).contains("remote@test"));
            ExecutorService reader = Executors.newSingleThreadExecutor();
            try (Response response = transport.request("/api/machines/local/transport-test/large-body", "GET", null)) {
                Future<Long> bytes = reader.submit(() -> { long count = 0; byte[] buffer = new byte[8192]; int read; while ((read = response.body().byteStream().read(buffer)) != -1) count += read; return count; });
                transport.sendSocket("terminal", "{\"kind\":\"data\",\"data\":{\"type\":\"input\",\"data\":\"fixture-only echo\"}}");
                assertTrue(frames.poll(5, TimeUnit.SECONDS).contains("fixture-only echo")); assertEquals(20 * 1024 * 1024L, (long) bytes.get(10, TimeUnit.SECONDS));
            } finally { reader.shutdownNow(); }
            transport.disconnect(); tunnel.disconnect();
            assertThrows(IllegalStateException.class, () -> transport.sendSocket("terminal", "stale"));
            connect(tunnel, options, new AtomicBoolean(true));
            transport.openSocket("catalog", "/api/machines/local/events"); assertTrue(frames.poll(5, TimeUnit.SECONDS).contains("machine.status"));
        } finally { transport.disconnect(); tunnel.disconnect(); }
    }
    @Test public void socketReadTimeoutDoesNotCloseChannelAndCloseInterruptsBlockingRead() throws Exception {
        SshTunnel.Options options = options(); SshTunnel tunnel = new SshTunnel(new File(temp.getRoot(), "known_hosts")); ExecutorService worker = Executors.newSingleThreadExecutor();
        try {
            connect(tunnel, options, new AtomicBoolean(true));
            try (Socket socket = tunnel.connection().client().socketFactory().createSocket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", options.remotePort), 2000); socket.setSoTimeout(1);
                assertThrows(SocketTimeoutException.class, () -> socket.getInputStream().read()); assertFalse(socket.isClosed());
                socket.setSoTimeout(2000);
                socket.getOutputStream().write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n".getBytes(StandardCharsets.US_ASCII)); socket.getOutputStream().flush();
                assertEquals('H', socket.getInputStream().read());
            }
            try (Socket socket = tunnel.connection().client().socketFactory().createSocket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", options.remotePort), 2000); CountDownLatch reading = new CountDownLatch(1);
                Future<Integer> read = worker.submit(() -> { reading.countDown(); return socket.getInputStream().read(); });
                assertTrue(reading.await(1, TimeUnit.SECONDS)); socket.close();
                ExecutionException error = assertThrows(ExecutionException.class, () -> read.get(2, TimeUnit.SECONDS)); assertTrue(error.getCause() instanceof IOException);
            }
            assertTrue(tunnel.isConnected());
        } finally { worker.shutdownNow(); tunnel.disconnect(); }
    }
    @Test public void disconnectInvalidatesPoolsSocketsAndOldConnectionAfterReconnect() throws Exception {
        SshTunnel.Options options = options(); SshTunnel tunnel = new SshTunnel(new File(temp.getRoot(), "known_hosts")); ExecutorService worker = Executors.newSingleThreadExecutor();
        PiTransport transport = new PiTransport(tunnel, (id, type, data) -> {}); OkHttpClient old = null;
        try {
            connect(tunnel, options, new AtomicBoolean(true)); old = tunnel.connection().client();
            Request request = new Request.Builder().url(tunnel.connection().baseUrl + "/api/machines/local/projects").build();
            try (Response response = old.newCall(request).execute()) { assertEquals(200, response.code()); response.body().string(); }
            try (Socket socket = old.socketFactory().createSocket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", options.remotePort), 2000); CountDownLatch reading = new CountDownLatch(1);
                Future<Integer> read = worker.submit(() -> { reading.countDown(); return socket.getInputStream().read(); }); assertTrue(reading.await(1, TimeUnit.SECONDS));
                transport.disconnect(); tunnel.disconnect();
                try { assertEquals(-1, (int) read.get(2, TimeUnit.SECONDS)); } catch (ExecutionException error) { assertTrue(error.getCause() instanceof IOException); }
                connect(tunnel, options, new AtomicBoolean(true));
                OkHttpClient stale = old; assertThrows(IOException.class, () -> stale.newCall(request).execute());
                try (Socket staleSocket = old.socketFactory().createSocket()) { assertThrows(IOException.class, () -> staleSocket.connect(new InetSocketAddress("127.0.0.1", options.remotePort), 2000)); }
                try (Response response = transport.request("/api/machines/local/projects", "GET", null)) { assertEquals(200, response.code()); }
            }
        } finally { worker.shutdownNow(); transport.disconnect(); tunnel.disconnect(); if (old != null) old.connectionPool().evictAll(); }
    }
    @Test public void stalledResponseBodyAndUploadCanBeCancelledWithoutClosingSsh() throws Exception {
        SshTunnel.Options options = options(); SshTunnel tunnel = new SshTunnel(new File(temp.getRoot(), "known_hosts")); ExecutorService worker = Executors.newSingleThreadExecutor();
        PiTransport transport = new PiTransport(tunnel, (id, type, data) -> {}); OkHttpClient client = null;
        try {
            connect(tunnel, options, new AtomicBoolean(true));
            try (Response response = transport.request("/api/machines/local/transport-test/body-delay", "GET", null)) {
                Future<String> body = worker.submit(() -> response.body().string()); transport.disconnect();
                ExecutionException error = assertThrows(ExecutionException.class, () -> body.get(2, TimeUnit.SECONDS)); assertTrue(error.getCause() instanceof IOException);
            }
            client = tunnel.connection().client().newBuilder().writeTimeout(1, TimeUnit.SECONDS).callTimeout(1, TimeUnit.SECONDS).build();
            Request upload = new Request.Builder().url(tunnel.connection().baseUrl + "/api/machines/local/transport-test/upload-stall").post(new RequestBody() {
                @Override public MediaType contentType() { return MediaType.get("application/octet-stream"); }
                @Override public long contentLength() { return 16 * 1024 * 1024; }
                @Override public void writeTo(BufferedSink sink) throws IOException { byte[] block = new byte[8192]; for (int i = 0; i < 2048; i++) sink.write(block); }
            }).build();
            OkHttpClient uploading = client; Future<?> write = worker.submit(() -> { try (Response response = uploading.newCall(upload).execute()) { response.body().string(); } return null; });
            ExecutionException error = assertThrows(ExecutionException.class, () -> write.get(4, TimeUnit.SECONDS)); assertTrue(error.getCause() instanceof IOException);
            assertTrue(tunnel.isConnected());
            try (Response response = transport.request("/api/machines/local/projects", "GET", null)) { assertEquals(200, response.code()); }
        } finally { worker.shutdownNow(); transport.disconnect(); tunnel.disconnect(); if (client != null) client.connectionPool().evictAll(); }
    }
    @Test public void unreadResponseCannotBlockOtherSshChannelsIndefinitely() throws Exception {
        SshTunnel.Options options = options(); SshTunnel tunnel = new SshTunnel(new File(temp.getRoot(), "known_hosts"));
        PiTransport transport = new PiTransport(tunnel, (id, type, data) -> {});
        try {
            connect(tunnel, options, new AtomicBoolean(true));
            try (Socket socket = tunnel.connection().client().socketFactory().createSocket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", options.remotePort), 2000);
                socket.getOutputStream().write("GET /api/machines/local/transport-test/large-body HTTP/1.1\r\nHost: localhost\r\n\r\n".getBytes(StandardCharsets.US_ASCII)); socket.getOutputStream().flush();
                // Give the fixture time to fill this deliberately unconsumed channel.
                Thread.sleep(200);
                try (Response response = transport.request("/api/machines/local/projects", "GET", null, 8000)) { assertEquals(200, response.code()); }
                assertThrows(IOException.class, () -> socket.getInputStream().read());
            }
            assertTrue(tunnel.isConnected());
        } finally { transport.disconnect(); tunnel.disconnect(); }
    }
    @Test public void channelRejectsOtherDestinationsAndCancelledGeneration() throws Exception {
        SshTunnel.Options options = options(); SshTunnel tunnel = new SshTunnel(new File(temp.getRoot(), "known_hosts")); AtomicBoolean active = new AtomicBoolean(true);
        try {
            connect(tunnel, options, active); OkHttpClient client = tunnel.connection().client();
            try (Socket socket = client.socketFactory().createSocket()) { assertThrows(SocketException.class, () -> socket.connect(new InetSocketAddress("127.0.0.2", options.remotePort), 1000)); }
            try (Socket socket = client.socketFactory().createSocket()) { assertThrows(SocketException.class, () -> socket.connect(new InetSocketAddress("127.0.0.1", options.remotePort == 65535 ? 1 : options.remotePort + 1), 1000)); }
            active.set(false);
            try (Socket socket = client.socketFactory().createSocket()) { assertThrows(SocketException.class, () -> socket.connect(new InetSocketAddress("127.0.0.1", options.remotePort), 1000)); }
        } finally { tunnel.disconnect(); }
    }
}
