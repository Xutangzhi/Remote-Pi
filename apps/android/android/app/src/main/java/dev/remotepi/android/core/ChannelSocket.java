package dev.remotepi.android.core;

import com.jcraft.jsch.ChannelDirectTCPIP;
import com.jcraft.jsch.Session;
import java.io.*;
import java.net.*;
import java.util.function.BooleanSupplier;
import java.util.concurrent.*;

/** A process-local socket backed by one SSH channel; it never opens a listening TCP port. */
final class ChannelSocket extends Socket {
    private static final ThreadFactory DAEMON = work -> { Thread thread = new Thread(work, "ssh-channel-close"); thread.setDaemon(true); return thread; };
    private static final ExecutorService CLOSER = new ThreadPoolExecutor(1, 4, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(128), DAEMON);
    private static final ScheduledExecutorService WATCHDOG = Executors.newSingleThreadScheduledExecutor(DAEMON);
    private final Session session;
    private final int remotePort;
    private final BooleanSupplier active;
    private final Runnable abortTransport;
    private final ChannelInput input = new ChannelInput();
    private volatile ChannelDirectTCPIP channel;
    private volatile OutputStream output;
    private volatile boolean connected, closed;
    private boolean opening;
    private volatile int timeout;

    ChannelSocket(Session session, int remotePort, BooleanSupplier active, Runnable abortTransport) {
        this.session = session; this.remotePort = remotePort; this.active = active; this.abortTransport = abortTransport;
    }
    @Override public void connect(SocketAddress address, int connectTimeout) throws IOException {
        if (connectTimeout < 0) throw new IllegalArgumentException("timeout < 0");
        if (!(address instanceof InetSocketAddress)) throw new SocketException("不支持的 SSH 通道地址。");
        InetSocketAddress target = (InetSocketAddress) address;
        if (target.getAddress() == null || !"127.0.0.1".equals(target.getAddress().getHostAddress()) || target.getPort() != remotePort) throw new SocketException("SSH 通道仅允许访问配置的 Pi Web 服务。");
        synchronized (this) {
            if (closed || connected || channel != null || !active.getAsBoolean()) throw new SocketException("SSH 连接已失效。");
            try { channel = (ChannelDirectTCPIP) session.openChannel("direct-tcpip"); opening = true; }
            catch (Exception error) { throw new IOException("无法创建 SSH 通道。", error); }
        }
        try {
            ChannelDirectTCPIP next = channel;
            next.setHost("127.0.0.1"); next.setPort(remotePort); next.setOrgIPAddress("127.0.0.1"); next.setOrgPort(0);
            next.setOutputStream(input.receiver);
            OutputStream channelOutput = next.getOutputStream();
            output = new FilterOutputStream(channelOutput) {
                // Socket writes are unbuffered. OkHttp WebSocket frames use emit(),
                // which writes bytes without calling flush() on the underlying sink.
                @Override public void write(int value) throws IOException { out.write(value); out.flush(); }
                @Override public void write(byte[] data, int offset, int length) throws IOException { out.write(data, offset, length); out.flush(); }
                @Override public void close() { ChannelSocket.this.close(); }
            };
            next.connect(connectTimeout == 0 ? 15000 : connectTimeout);
            synchronized (this) {
                if (closed || !active.getAsBoolean()) throw new SocketException("SSH 连接已失效。");
                connected = true;
            }
        } catch (Exception error) {
            close();
            if (error instanceof IOException) throw (IOException) error;
            throw new IOException("无法连接远端 Pi Web 通道。", error);
        } finally {
            synchronized (this) { opening = false; notifyAll(); }
        }
    }
    @Override public void connect(SocketAddress address) throws IOException { connect(address, 0); }
    @Override public InputStream getInputStream() throws IOException { if (!connected || closed) throw new SocketException("SSH 通道已关闭。"); return input; }
    @Override public OutputStream getOutputStream() throws IOException { if (!connected || closed) throw new SocketException("SSH 通道已关闭。"); return output; }
    @Override public void close() {
        synchronized (this) { if (closed) return; closed = true; }
        input.stop();
        if (channel == null) return;
        // JSch may hold its channel lock while writing the shared SSH TCP socket.
        // Never block Okio's watchdog or the UI on that lock. A stuck cleanup aborts
        // only this socket's original SSH transport, never a replacement connection.
        ScheduledFuture<?> deadline = WATCHDOG.schedule(abortTransport, 500, TimeUnit.MILLISECONDS);
        try {
            CLOSER.execute(() -> {
                try {
                    // Keep opening channels registered until their confirmation arrives.
                    synchronized (this) { while (opening) wait(); }
                    channel.disconnect();
                } catch (InterruptedException error) { Thread.currentThread().interrupt(); abortTransport.run(); }
                finally { deadline.cancel(false); }
            });
        } catch (RejectedExecutionException error) { deadline.cancel(false); abortTransport.run(); }
    }
    @Override public boolean isConnected() { return connected; }
    @Override public boolean isClosed() { return closed; }
    @Override public boolean isInputShutdown() { return closed; }
    @Override public boolean isOutputShutdown() { return closed; }
    @Override public void shutdownInput() { close(); }
    @Override public void shutdownOutput() { close(); }
    @Override public void setSoTimeout(int value) { if (value < 0) throw new IllegalArgumentException("timeout < 0"); timeout = value; }
    @Override public int getSoTimeout() { return timeout; }
    @Override public void setTcpNoDelay(boolean value) { }
    @Override public boolean getTcpNoDelay() { return true; }
    @Override public InetAddress getInetAddress() { return InetAddress.getLoopbackAddress(); }
    @Override public int getPort() { return remotePort; }

    /** Bounded channel receive buffer, including the 1 ms probe OkHttp uses before pool reuse. */
    private final class ChannelInput extends InputStream {
        private final byte[] bytes = new byte[64 * 1024];
        private int head, size;
        private boolean eof, stopped;
        private IOException failure;
        final OutputStream receiver = new OutputStream() {
            @Override public void write(int value) throws IOException { write(new byte[] { (byte) value }, 0, 1); }
            @Override public void write(byte[] data, int offset, int length) throws IOException {
                synchronized (ChannelInput.this) {
                    while (length > 0) {
                        long deadline = System.nanoTime() + 5_000_000_000L;
                        while (size == bytes.length && !stopped) {
                            long remaining = deadline - System.nanoTime();
                            if (remaining <= 0) {
                                // JSch writes here on its shared reader. Fail only this stalled
                                // channel instead of indefinitely blocking every SSH channel.
                                failure = new IOException("SSH 通道接收缓冲已满。"); ChannelInput.this.notifyAll(); throw failure;
                            }
                            await(Math.max(1, (remaining + 999_999) / 1_000_000));
                        }
                        if (stopped) throw new IOException("SSH 通道已关闭。");
                        int tail = (head + size) % bytes.length;
                        int count = Math.min(length, Math.min(bytes.length - size, bytes.length - tail));
                        System.arraycopy(data, offset, bytes, tail, count); size += count; offset += count; length -= count;
                        ChannelInput.this.notifyAll();
                    }
                }
            }
            @Override public void close() { synchronized (ChannelInput.this) { eof = true; ChannelInput.this.notifyAll(); } }
        };
        private void await(long millis) throws InterruptedIOException {
            try { wait(millis); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new InterruptedIOException("SSH 通道读取已取消。"); }
        }
        @Override public int read() throws IOException { byte[] one = new byte[1]; return read(one, 0, 1) == -1 ? -1 : one[0] & 255; }
        @Override public synchronized int read(byte[] target, int offset, int length) throws IOException {
            if (offset < 0 || length < 0 || length > target.length - offset) throw new IndexOutOfBoundsException();
            if (length == 0) return 0;
            long deadline = timeout == 0 ? 0 : System.nanoTime() + timeout * 1_000_000L;
            while (size == 0 && !eof && !stopped && failure == null) {
                if (deadline == 0) await(0);
                else {
                    long remaining = deadline - System.nanoTime();
                    if (remaining <= 0) throw new SocketTimeoutException("SSH 通道读取超时。");
                    await(Math.max(1, (remaining + 999_999) / 1_000_000));
                }
            }
            if (stopped) throw new SocketException("SSH 通道已关闭。");
            if (failure != null) throw failure;
            if (size == 0) return -1;
            int count = Math.min(length, Math.min(size, bytes.length - head));
            System.arraycopy(bytes, head, target, offset, count); head = (head + count) % bytes.length; size -= count; notifyAll(); return count;
        }
        @Override public synchronized int available() { return size; }
        private synchronized void stop() { stopped = true; notifyAll(); }
        @Override public void close() { ChannelSocket.this.close(); }
    }
}
