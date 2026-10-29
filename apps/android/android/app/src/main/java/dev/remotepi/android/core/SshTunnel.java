package dev.remotepi.android.core;

import com.jcraft.jsch.*;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Proxy;
import java.net.*;
import javax.net.SocketFactory;
import okhttp3.*;
import java.util.concurrent.TimeUnit;
import java.util.Arrays;
import java.util.concurrent.CancellationException;
import java.util.function.Consumer;
import java.util.function.BooleanSupplier;

/** Android-independent SSH engine, also exercised against a real SSH test server on the JVM. */
public final class SshTunnel {
    public interface Auth { String ask(String prompt, boolean host); }
    public static final class Options {
        public final String host, username, identity;
        public final int port, remotePort;
        public Options(String host, String username, int port, int remotePort, String identity) {
            if (host == null || !host.matches("[a-zA-Z0-9_.:\\[\\]-]+") || host.startsWith("-") || host.length() > 255) throw new IllegalArgumentException("服务器地址无效。");
            if (username == null || !username.matches("[a-zA-Z0-9_.-]+") || username.startsWith("-") || username.length() > 80) throw new IllegalArgumentException("请填写有效的 SSH 用户名。");
            if (port < 1 || port > 65535 || remotePort < 1 || remotePort > 65535) throw new IllegalArgumentException("端口必须在 1–65535 之间。");
            this.host = host; this.username = username; this.port = port; this.remotePort = remotePort; this.identity = identity;
        }
    }
    private final File knownHosts;
    private Session session;
    private SshSocketFactory socketTransport;
    private int generation;
    private Connection connection;
    public SshTunnel(File knownHosts) { this.knownHosts = knownHosts; }

    public void connect(Options options, byte[] privateKey, Auth auth, Consumer<String> progress, BooleanSupplier active) throws Exception {
        final int ticket;
        synchronized (this) { if (!active.getAsBoolean()) throw new CancellationException("连接已取消。"); disconnect(); ticket = generation; }
        JSch jsch = new JSch();
        knownHosts.getParentFile().mkdirs();
        if (!knownHosts.exists()) knownHosts.createNewFile();
        jsch.setKnownHosts(knownHosts.getAbsolutePath());
        HostKeyRepository delegate = jsch.getHostKeyRepository();
        jsch.setHostKeyRepository(new HostKeyRepository() {
            public int check(String host, byte[] key) {
                int result = delegate.check(host, key);
                if (result == CHANGED) throw new SecurityException("服务器主机密钥已变化，连接已拒绝。请先向管理员核对主机指纹。");
                return result;
            }
            public void add(HostKey key, UserInfo info) { delegate.add(key, info); }
            public void remove(String host, String type) { delegate.remove(host, type); }
            public void remove(String host, String type, byte[] key) { delegate.remove(host, type, key); }
            public String getKnownHostsRepositoryID() { return delegate.getKnownHostsRepositoryID(); }
            public HostKey[] getHostKey() { return delegate.getHostKey(); }
            public HostKey[] getHostKey(String host, String type) { return delegate.getHostKey(host, type); }
        });
        if (privateKey != null) {
            try { jsch.addIdentity("remote-pi", privateKey, null, null); }
            finally { Arrays.fill(privateKey, (byte) 0); }
        }
        Session next = jsch.getSession(options.username, options.host, options.port);
        SshSocketFactory wire = new SshSocketFactory(); next.setSocketFactory(wire);
        InteractiveAuth userInfo = new InteractiveAuth(auth);
        next.setUserInfo(userInfo);
        next.setConfig("StrictHostKeyChecking", "ask");
        next.setConfig("PreferredAuthentications", "publickey,keyboard-interactive,password");
        // Android lacks the desktop JDK's EdEC/XDH providers. JSch's BC
        // implementations use lightweight crypto and need no provider replacement.
        next.setConfig("ssh-ed25519", "com.jcraft.jsch.bc.SignatureEd25519");
        next.setConfig("ssh-ed448", "com.jcraft.jsch.bc.SignatureEd448");
        next.setConfig("xdh", "com.jcraft.jsch.bc.XDH");
        next.setServerAliveInterval(15000); next.setServerAliveCountMax(3);
        synchronized (this) { if (generation != ticket || !active.getAsBoolean()) throw new CancellationException("连接已取消。"); session = next; socketTransport = wire; }
        try {
            progress.accept("正在建立 SSH 连接…"); next.connect(20000);
            synchronized (this) { if (generation != ticket || !active.getAsBoolean()) throw new CancellationException("连接已取消。"); }
            Connection ready = new Connection(next, options.remotePort, wire::close, () -> {
                synchronized (SshTunnel.this) { return generation == ticket && session == next && next.isConnected() && !wire.isClosed() && active.getAsBoolean(); }
            });
            progress.accept("SSH 已连接，正在检查 Pi Web…");
            OkHttpClient probe = ready.client().newBuilder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).callTimeout(8, TimeUnit.SECONDS).build();
            try (Response response = probe.newCall(new Request.Builder().url(ready.baseUrl + "/").build()).execute()) {
                if (response.code() < 200 || response.code() >= 400) throw new IllegalStateException("SSH 已连接，但 Pi Web 返回 HTTP " + response.code() + "。");
            } finally { probe.connectionPool().evictAll(); }
            synchronized (this) { if (generation != ticket || !active.getAsBoolean()) throw new CancellationException("连接已取消。"); connection = ready; }
        } catch (Exception error) {
            wire.close(); next.disconnect(); synchronized (this) { if (session == next) { session = null; connection = null; socketTransport = null; } }
            throw error;
        } finally { userInfo.clear(); }
    }
    public synchronized boolean isConnected() { return session != null && session.isConnected() && socketTransport != null && !socketTransport.isClosed() && connection != null; }
    synchronized Connection connection() { if (!isConnected()) throw new IllegalStateException("请先连接 SSH 服务器。"); return connection; }
    public void disconnect() {
        Session previous; SshSocketFactory wire;
        synchronized (this) { generation++; previous = session; wire = socketTransport; session = null; connection = null; socketTransport = null; }
        // Closing TCP first breaks a blocked SSH packet write before JSch takes channel locks.
        if (wire != null) wire.close(); if (previous != null) previous.disconnect();
    }

    private static final class SshSocketFactory implements com.jcraft.jsch.SocketFactory {
        private Socket socket;
        private boolean closed;
        @Override public Socket createSocket(String host, int port) throws IOException {
            Socket next = new Socket();
            synchronized (this) { if (closed) { next.close(); throw new SocketException("SSH 连接已取消。"); } socket = next; }
            try { next.connect(new InetSocketAddress(host, port), 20000); next.setTcpNoDelay(true); return next; }
            catch (IOException error) { next.close(); throw error; }
        }
        @Override public InputStream getInputStream(Socket socket) throws IOException { return socket.getInputStream(); }
        @Override public OutputStream getOutputStream(Socket socket) throws IOException { return socket.getOutputStream(); }
        synchronized boolean isClosed() { return closed; }
        void close() { Socket previous; synchronized (this) { closed = true; previous = socket; } if (previous != null) try { previous.close(); } catch (IOException ignored) { } }
    }

    static final class Connection {
        final String baseUrl;
        private final SocketFactory sockets;
        Connection(Session session, int remotePort, Runnable abortTransport, BooleanSupplier active) {
            // This URL is an HTTP origin only: all traffic goes through the in-process factory.
            baseUrl = "http://127.0.0.1:" + remotePort;
            sockets = new SocketFactory() {
                @Override public Socket createSocket() throws IOException { return new ChannelSocket(session, remotePort, active, abortTransport); }
                @Override public Socket createSocket(String host, int port) throws IOException { Socket socket = createSocket(); socket.connect(new InetSocketAddress(host, port)); return socket; }
                @Override public Socket createSocket(InetAddress host, int port) throws IOException { Socket socket = createSocket(); socket.connect(new InetSocketAddress(host, port)); return socket; }
                @Override public Socket createSocket(String host, int port, InetAddress local, int localPort) throws IOException { throw new SocketException("SSH 通道不支持本机绑定。"); }
                @Override public Socket createSocket(InetAddress host, int port, InetAddress local, int localPort) throws IOException { throw new SocketException("SSH 通道不支持本机绑定。"); }
            };
        }
        OkHttpClient client() {
            return new OkHttpClient.Builder().socketFactory(sockets).proxy(Proxy.NO_PROXY).connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(35, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build();
        }
    }

    private static final class InteractiveAuth implements UserInfo, UIKeyboardInteractive {
        private final Auth auth; private String password, passphrase;
        InteractiveAuth(Auth auth) { this.auth = auth; }
        public String getPassword() { return password; }
        public String getPassphrase() { return passphrase; }
        public boolean promptPassword(String prompt) { password = auth.ask(prompt, false); return password != null; }
        public boolean promptPassphrase(String prompt) { passphrase = auth.ask(prompt, false); return passphrase != null; }
        public boolean promptYesNo(String prompt) { return "yes".equals(auth.ask(prompt, true)); }
        public void showMessage(String message) { }
        public String[] promptKeyboardInteractive(String destination, String name, String instruction, String[] prompts, boolean[] echo) {
            String[] answers = new String[prompts.length];
            for (int i = 0; i < prompts.length; i++) { answers[i] = auth.ask(name + "\n" + instruction + "\n" + prompts[i], false); if (answers[i] == null) return null; }
            return answers;
        }
        void clear() { password = null; passphrase = null; }
    }
}
