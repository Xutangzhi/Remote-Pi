package dev.remotepi.android.core;

import com.jcraft.jsch.*;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.lang.reflect.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public class ChannelSocketCancellationTest {
    private static void field(Object target, Class<?> type, String name, Object value) throws Exception {
        Field field = type.getDeclaredField(name); field.setAccessible(true); field.set(target, value);
    }
    @Test public void closeDoesNotBlockWatchdogWhenJschHoldsItsLockDuringTcpWrite() throws Exception {
        // Use the real JSch packet writer with a stalled underlying TCP output. This
        // reproduces a lock path that a cooperative loopback SSH fixture cannot.
        Session session = new JSch().getSession("fixture", "unused.invalid", 22);
        field(session, Session.class, "isConnected", true);
        Class<?> ioClass = Class.forName("com.jcraft.jsch.IO"); Constructor<?> constructor = ioClass.getDeclaredConstructor(); constructor.setAccessible(true); Object io = constructor.newInstance();
        CountDownLatch writing = new CountDownLatch(1), released = new CountDownLatch(1), aborted = new CountDownLatch(1); AtomicInteger aborts = new AtomicInteger();
        OutputStream stalled = new OutputStream() {
            @Override public void write(int value) throws IOException { writing.countDown(); try { released.await(); } catch (InterruptedException error) { throw new IOException(error); } }
            @Override public void write(byte[] bytes, int offset, int length) throws IOException { write(0); }
        };
        field(io, ioClass, "out", stalled); field(session, Session.class, "io", io);
        field(null, Class.forName("com.jcraft.jsch.Packet"), "random", new com.jcraft.jsch.jce.Random());
        ChannelDirectTCPIP channel = (ChannelDirectTCPIP) session.openChannel("direct-tcpip");
        field(channel, Channel.class, "rmpsize", 32768); field(channel, Channel.class, "rwsize", 1048576L); field(channel, Channel.class, "connected", true); field(channel, Channel.class, "recipient", 1);
        ChannelSocket socket = new ChannelSocket(session, 8504, () -> true, () -> { aborts.incrementAndGet(); released.countDown(); aborted.countDown(); });
        field(socket, ChannelSocket.class, "channel", channel);
        ExecutorService workers = Executors.newFixedThreadPool(2);
        try {
            Future<?> write = workers.submit(() -> { OutputStream output = channel.getOutputStream(); output.write(1); output.flush(); return null; });
            assertTrue(writing.await(2, TimeUnit.SECONDS));
            Future<?> close = workers.submit(socket::close); close.get(250, TimeUnit.MILLISECONDS); socket.close();
            assertTrue("stuck JSch cleanup must abort its own raw SSH transport", aborted.await(2, TimeUnit.SECONDS)); write.get(2, TimeUnit.SECONDS);
            assertEquals("repeated closes must not schedule duplicate cleanup", 1, aborts.get());
        } finally { released.countDown(); socket.close(); workers.shutdownNow(); session.disconnect(); }
    }
}
