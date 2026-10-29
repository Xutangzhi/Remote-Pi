package dev.remotepi.android.core;

import okhttp3.*;
import okio.ByteString;
import java.io.IOException;
import java.net.Proxy;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

public final class PiTransport {
    public interface Events { void emit(String id, String type, String data); }
    private final SshTunnel tunnel;
    private final Supplier<String> testBase;
    private final Events events;
    private SshTunnel.Connection connection;
    private Route route;
    private final Map<String, WebSocket> sockets = new ConcurrentHashMap<>();
    public PiTransport(SshTunnel tunnel, Events events) { this.tunnel = tunnel; this.testBase = null; this.events = events; }
    // Unit tests exercise HTTP semantics with a local fixture rather than an SSH server.
    PiTransport(Supplier<String> base, Events events) { this.tunnel = null; this.testBase = base; this.events = events; }
    private static final class Route {
        final String base;
        final OkHttpClient client, streaming;
        final Set<Call> calls = ConcurrentHashMap.newKeySet();
        volatile boolean active = true;
        Route(String base, OkHttpClient client) {
            this.base = base;
            this.client = client.newBuilder().eventListener(new EventListener() {
                @Override public void callStart(Call call) { calls.add(call); if (!active) call.cancel(); }
                @Override public void callEnd(Call call) { calls.remove(call); }
                @Override public void callFailed(Call call, IOException error) { calls.remove(call); }
            }).build();
            streaming = this.client.newBuilder().callTimeout(0, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS).pingInterval(20, TimeUnit.SECONDS).build();
        }
    }
    private synchronized Route route() {
        SshTunnel.Connection next = tunnel == null ? null : tunnel.connection();
        if (route == null || connection != next) {
            disconnect(); connection = next;
            route = next == null
                ? new Route(testBase.get(), new OkHttpClient.Builder().proxy(Proxy.NO_PROXY).connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(35, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build())
                : new Route(next.baseUrl, next.client());
        }
        return route;
    }
    public static String validatePath(String path) {
        if (path == null || path.length() > 32768 || path.contains("\n") || path.contains("\r") || path.contains("#") || path.contains("\\") || !(path.startsWith("/api/machines/local/") || path.startsWith("/api/paired-plugin-backends/") || path.equals("/pi-web-plugins/manifest.json"))) throw new IllegalArgumentException("不允许的 Pi Web 接口路径。");
        return path;
    }
    public Response request(String path, String method, String body) throws IOException {
        return request(path, method, body, 35000);
    }
    public Response request(String path, String method, String body, int timeoutMs) throws IOException {
        if (timeoutMs < 1000 || timeoutMs > 300000) throw new IllegalArgumentException("请求超时必须介于 1 秒和 5 分钟之间。");
        if (!method.equals("GET") && !method.equals("POST") && !method.equals("PUT")) throw new IllegalArgumentException("不支持的请求方法。");
        RequestBody data = method.equals("GET") ? null : RequestBody.create(body == null ? "{}" : body, MediaType.get("application/json; charset=utf-8"));
        String target = validatePath(path); Route current = route();
        Request request = new Request.Builder().url(current.base + target).method(method, data).build();
        return current.client.newBuilder().readTimeout(timeoutMs, TimeUnit.MILLISECONDS).callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build().newCall(request).execute();
    }
    public synchronized void openSocket(String id, String path) {
        if (id == null || id.length() > 80 || sockets.containsKey(id)) throw new IllegalArgumentException("连接 ID 无效。");
        String target = validatePath(path); Route current = route();
        String url = current.base.replace("http:", "ws:") + target;
        synchronized (sockets) {
            WebSocket socket = current.streaming.newWebSocket(new Request.Builder().url(url).build(), new WebSocketListener() {
                public void onOpen(WebSocket socket, Response response) { synchronized (sockets) { if (sockets.get(id) == socket) events.emit(id, "open", null); else socket.cancel(); } }
                public void onMessage(WebSocket socket, String text) { if (sockets.get(id) == socket) events.emit(id, "message", text); }
                public void onMessage(WebSocket socket, ByteString bytes) { onMessage(socket, bytes.utf8()); }
                public void onClosing(WebSocket socket, int code, String reason) { socket.close(code, reason); }
                public void onClosed(WebSocket socket, int code, String reason) { synchronized (sockets) { if (sockets.remove(id, socket)) events.emit(id, "close", null); } }
                public void onFailure(WebSocket socket, Throwable error, Response response) { synchronized (sockets) { if (sockets.remove(id, socket)) events.emit(id, "error", null); } }
            });
            sockets.put(id, socket);
        }
    }
    public void sendSocket(String id, String data) { WebSocket socket = sockets.get(id); if (socket == null || data == null || data.length() > 1024 * 1024 || !socket.send(data)) throw new IllegalStateException("连接不可用。"); }
    public void closeSocket(String id) { WebSocket socket = sockets.remove(id); if (socket != null) socket.cancel(); }
    public synchronized void disconnect() {
        for (String id : sockets.keySet()) closeSocket(id);
        if (route != null) { route.active = false; for (Call call : route.calls) call.cancel(); route.client.dispatcher().cancelAll(); route.client.connectionPool().evictAll(); }
        route = null; connection = null;
    }
}
