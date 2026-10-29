package dev.remotepi.android.core;

import org.junit.Test;
import static org.junit.Assert.*;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okio.ByteString;
import java.io.InterruptedIOException;
import java.io.IOException;
import java.util.concurrent.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class PiTransportTest {
    @Test public void refusesArbitraryOriginsAndNonApiPaths() {
        assertThrows(IllegalArgumentException.class, () -> PiTransport.validatePath("https://example.com"));
        assertThrows(IllegalArgumentException.class, () -> PiTransport.validatePath("//example.com/api"));
        assertThrows(IllegalArgumentException.class, () -> PiTransport.validatePath("/private-file"));
        assertEquals("/api/machines/local/projects", PiTransport.validatePath("/api/machines/local/projects"));
    }
    @Test public void requestsStayOnTheTunnelAndNeverFollowRedirects() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setBody("[]").addHeader("Content-Type", "application/json"));
            server.enqueue(new MockResponse().setResponseCode(302).addHeader("Location", "https://example.com")); server.start();
            PiTransport transport = new PiTransport(() -> server.url("/").toString().replaceAll("/$", ""), (id, type, data) -> {});
            try {
                try (Response response = transport.request("/api/machines/local/projects", "GET", null)) { assertEquals("[]", response.body().string()); }
                assertEquals("/api/machines/local/projects", server.takeRequest().getPath());
                try (Response response = transport.request("/api/machines/local/status", "GET", null)) { assertEquals(302, response.code()); }
            } finally { transport.disconnect(); }
        }
    }
    @Test public void websocketCarriesRealtimeEventsInBothDirections() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            CountDownLatch opened = new CountDownLatch(1); CountDownLatch received = new CountDownLatch(1); AtomicReference<String> message = new AtomicReference<>();
            server.enqueue(new MockResponse().withWebSocketUpgrade(new WebSocketListener() {
                @Override public void onOpen(WebSocket socket, Response response) { socket.send("hello from server"); }
                @Override public void onMessage(WebSocket socket, String text) { message.set(text); received.countDown(); socket.close(1000, "done"); }
            })); server.start();
            AtomicReference<String> incoming = new AtomicReference<>(); CountDownLatch delivered = new CountDownLatch(1);
            PiTransport transport = new PiTransport(() -> server.url("/").toString().replaceAll("/$", ""), (id, type, data) -> { if (type.equals("open")) opened.countDown(); if (type.equals("message")) { incoming.set(data); delivered.countDown(); } });
            try {
                transport.openSocket("test", "/api/machines/local/events"); assertTrue(opened.await(5, TimeUnit.SECONDS)); assertTrue(delivered.await(5, TimeUnit.SECONDS));
                assertEquals("hello from server", incoming.get()); transport.sendSocket("test", "hello from phone"); assertTrue(received.await(5, TimeUnit.SECONDS)); assertEquals("hello from phone", message.get());
            } finally { transport.disconnect(); }
        }
    }
    @Test public void websocketDeliversBinaryJsonFramesAsText() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            String event = "{\"type\":\"session.event\",\"text\":\"你好，手机终端\"}";
            server.enqueue(new MockResponse().withWebSocketUpgrade(new WebSocketListener() {
                @Override public void onOpen(WebSocket socket, Response response) { socket.send(ByteString.encodeUtf8(event)); }
            })); server.start();
            AtomicReference<String> incoming = new AtomicReference<>(); CountDownLatch delivered = new CountDownLatch(1);
            PiTransport transport = new PiTransport(() -> server.url("/").toString().replaceAll("/$", ""), (id, type, data) -> { if (type.equals("message")) { incoming.set(data); delivered.countDown(); } });
            try {
                transport.openSocket("binary-test", "/api/machines/local/events");
                assertTrue(delivered.await(5, TimeUnit.SECONDS)); assertEquals(event, incoming.get());
            } finally { transport.disconnect(); }
        }
    }
    @Test public void requestTimeoutCanBeSelectedWithoutChangingOtherRequests() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setHeadersDelay(1500, TimeUnit.MILLISECONDS).setBody("late"));
            server.enqueue(new MockResponse().setHeadersDelay(1500, TimeUnit.MILLISECONDS).setBody("completed"));
            server.start();
            PiTransport transport = new PiTransport(() -> server.url("/").toString().replaceAll("/$", ""), (id, type, data) -> {});
            try {
                assertThrows(InterruptedIOException.class, () -> { try (Response response = transport.request("/api/machines/local/sessions/test/command", "POST", "{}", 1000)) { response.body().string(); } });
                try (Response response = transport.request("/api/machines/local/sessions/test/command", "POST", "{}", 300000)) { assertEquals("completed", response.body().string()); }
                server.enqueue(new MockResponse().setHeadersDelay(1500, TimeUnit.MILLISECONDS).setBody("late"));
                assertThrows(InterruptedIOException.class, () -> { try (Response response = transport.request("/api/machines/local/status", "GET", null, 1000)) { response.body().string(); } });
            } finally { transport.disconnect(); }
        }
    }
    @Test public void disconnectCancelsAResponseBodyAfterHeadersHaveReturned() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setBody("delayed body").setBodyDelay(3, TimeUnit.SECONDS)); server.start();
            PiTransport transport = new PiTransport(() -> server.url("/").toString().replaceAll("/$", ""), (id, type, data) -> {});
            ExecutorService worker = Executors.newSingleThreadExecutor();
            try (Response response = transport.request("/api/machines/local/projects", "GET", null)) {
                Future<String> body = worker.submit(() -> response.body().string()); transport.disconnect();
                ExecutionException error = assertThrows(ExecutionException.class, () -> body.get(2, TimeUnit.SECONDS)); assertTrue(error.getCause() instanceof IOException);
            } finally { transport.disconnect(); worker.shutdownNow(); }
        }
    }
    @Test public void requestTimeoutCannotBeUnbounded() {
        PiTransport transport = new PiTransport(() -> "http://127.0.0.1:1", (id, type, data) -> {});
        assertThrows(IllegalArgumentException.class, () -> transport.request("/api/machines/local/status", "GET", null, 0));
        assertThrows(IllegalArgumentException.class, () -> transport.request("/api/machines/local/status", "GET", null, 300001));
    }
}
