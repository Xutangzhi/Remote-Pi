package dev.remotepi.android;

import android.app.Activity;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.appcompat.app.AppCompatDelegate;
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import dev.remotepi.android.core.PiTransport;
import dev.remotepi.android.core.SshTunnel;
import okhttp3.Response;
import org.json.JSONObject;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(name = "RemotePi")
public class RemotePiPlugin extends Plugin {
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicInteger attempt = new AtomicInteger();
    private final Map<String, CompletableFuture<String>> questions = new ConcurrentHashMap<>();
    private SecureStore store;
    private SshTunnel tunnel;
    private PiTransport transport;
    private volatile JSObject state = new JSObject().put("phase", "idle").put("message", "尚未连接服务器");
    private volatile JSObject desiredProfile;
    private volatile boolean connecting;
    private final Runnable monitor = new Runnable() { public void run() {
        if (tunnel != null && desiredProfile != null && !connecting && state.optString("phase").equals("connected") && !tunnel.isConnected()) { transport.disconnect(); updateState("error", "SSH 连接已中断，重新连接后可以继续远端任务。", desiredProfile.optString("id")); }
        main.postDelayed(this, 10000);
    } };
    @Override public void load() {
        main.postDelayed(monitor, 10000);
        store = new SecureStore(getContext());
        try { applyTheme(store.settings().optString("theme", "light")); } catch (Exception ignored) { }
        tunnel = new SshTunnel(new File(getContext().getFilesDir(), "known_hosts"));
        transport = new PiTransport(tunnel, (id, type, data) -> {
            JSObject event = new JSObject().put("id", id).put("type", type); if (data != null) event.put("data", data);
            main.post(() -> notifyListeners("transport", event));
        });
    }
    private void updateState(String phase, String message, String profileId) {
        JSObject value = new JSObject().put("phase", phase).put("message", message); if (profileId != null) value.put("profileId", profileId);
        state = value; main.post(() -> notifyListeners("connection", new JSObject().put("state", value), true));
    }
    private interface Work { JSObject run() throws Exception; }
    private void run(PluginCall call, Work work) { workers.execute(() -> { try { call.resolve(work.run()); } catch (Exception error) { call.reject(error.getMessage() == null ? "操作失败。" : error.getMessage()); } }); }
    @PluginMethod public void settings(PluginCall call) { run(call, () -> new JSObject().put("settings", store.settings())); }
    @PluginMethod public void saveProfile(PluginCall call) { run(call, () -> new JSObject().put("profile", store.saveProfile(requireProfile(call)))); }
    @PluginMethod public void deleteProfile(PluginCall call) { run(call, () -> { String id = call.getString("id", ""); if (desiredProfile != null && desiredProfile.optString("id").equals(id)) disconnectNow(); store.deleteProfile(id); return new JSObject(); }); }
    private void applyTheme(String theme) { main.post(() -> getActivity().getDelegate().setLocalNightMode(theme.equals("dark") ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO)); }
    @PluginMethod public void setTheme(PluginCall call) { run(call, () -> { String theme = call.getString("theme", "light"); store.setTheme(theme); applyTheme(theme); return new JSObject(); }); }
    @PluginMethod public void connection(PluginCall call) { call.resolve(new JSObject().put("state", state)); }
    private JSObject requireProfile(PluginCall call) { JSObject profile = call.getObject("profile"); if (profile == null) throw new IllegalArgumentException("缺少服务器配置。"); return profile; }
    @PluginMethod public void connect(PluginCall call) {
        JSObject profile;
        try { profile = requireProfile(call); SecureStore.options(profile); }
        catch (Exception error) { call.reject(error.getMessage()); return; }
        if (connecting) { call.reject("SSH 正在连接中。"); return; }
        beginConnect(profile, call);
    }
    private synchronized void beginConnect(JSObject profile, PluginCall call) {
        if (connecting) { if (call != null) call.reject("SSH 正在连接中。"); return; }
        connecting = true; final int ticket = attempt.incrementAndGet();
        String profileId = profile.optString("id");
        updateState("connecting", "正在连接 " + profile.optString("name") + "…", profileId);
        transport.disconnect();
        workers.execute(() -> {
            try {
                JSObject saved = store.saveProfile(profile); SshTunnel.Options options = SecureStore.options(saved);
                tunnel.connect(options, store.readKey(options.identity), (prompt, host) -> ask(prompt, host, ticket, profileId), (message) -> { if (attempt.get() == ticket) updateState("checking", message, profileId); }, () -> attempt.get() == ticket);
                if (attempt.get() != ticket) { if (call != null) call.resolve(new JSObject().put("connected", false)); return; }
                desiredProfile = saved; updateState("connected", "SSH 已连接", profileId);
                if (call != null) call.resolve(new JSObject().put("connected", true));
            } catch (Exception error) {
                if (attempt.get() == ticket) {
                    transport.disconnect(); tunnel.disconnect();
                    updateState("error", error.getMessage() == null ? "SSH 连接失败，请检查服务器和认证信息。" : error.getMessage(), profileId);
                    if (call != null) call.reject(state.optString("message"));
                } else if (call != null) call.resolve(new JSObject().put("connected", false));
            } finally {
                if (attempt.get() == ticket) connecting = false;
                main.post(() -> { if (attempt.get() == ticket) notifyListeners("challenge", new JSObject().put("challenge", JSONObject.NULL), true); });
            }
        });
    }
    private String ask(String prompt, boolean host, int ticket, String profileId) {
        if (attempt.get() != ticket) return null;
        String id = UUID.randomUUID().toString(); CompletableFuture<String> future = new CompletableFuture<>(); questions.put(id, future);
        updateState("authenticating", host ? "请确认主机指纹" : "请完成 SSH 身份验证", profileId);
        JSObject challenge = new JSObject().put("id", id).put("kind", host ? "host" : "secret").put("prompt", prompt);
        main.post(() -> notifyListeners("challenge", new JSObject().put("challenge", challenge), true));
        try { return future.get(180, TimeUnit.SECONDS); }
        catch (Exception ignored) { return null; }
        finally { questions.remove(id); main.post(() -> { if (attempt.get() == ticket) notifyListeners("challenge", new JSObject().put("challenge", JSONObject.NULL), true); }); }
    }
    @PluginMethod public void answer(PluginCall call) {
        String id = call.getString("id", ""); String answer = call.getString("answer");
        if (answer != null && (answer.length() > 8192 || answer.contains("\n") || answer.contains("\r"))) { call.reject("验证响应无效。"); return; }
        if (answer == null) disconnectNow();
        else { CompletableFuture<String> question = questions.get(id); if (question != null) question.complete(answer); }
        call.resolve();
    }
    private synchronized void disconnectNow() {
        attempt.incrementAndGet(); desiredProfile = null; connecting = false;
        for (CompletableFuture<String> question : questions.values()) question.complete(null); questions.clear();
        if (transport != null) transport.disconnect(); if (tunnel != null) tunnel.disconnect();
        main.post(() -> notifyListeners("challenge", new JSObject().put("challenge", JSONObject.NULL), true)); updateState("idle", "连接已关闭，远端任务继续运行", null);
    }
    @PluginMethod public void disconnect(PluginCall call) { disconnectNow(); call.resolve(); }
    @PluginMethod public void request(PluginCall call) {
        run(call, () -> {
            String method = call.getString("method", "GET"); Object body = call.getData().opt("body");
            try (Response response = transport.request(call.getString("path"), method, body == null ? null : body.toString(), call.getInt("timeoutMs", 35000))) {
                if (response.body() == null) return new JSObject().put("data", "");
                if (!response.isSuccessful()) {
                    String content = response.body().string(); String message = "Pi Web 请求失败（HTTP " + response.code() + "）。";
                    try { message = new JSONObject(content).optString("error", message); } catch (Exception ignored) { }
                    throw new IllegalStateException(message);
                }
                if (call.getBoolean("image", false)) {
                    String mime = response.header("Content-Type", "").split(";")[0];
                    if (!mime.matches("image/(png|jpeg|gif|webp)")) throw new IllegalStateException("图片类型不支持。");
                    try (InputStream input = response.body().byteStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        byte[] buffer = new byte[8192]; int read; while ((read = input.read(buffer)) != -1) { if (output.size() + read > 20 * 1024 * 1024) throw new IllegalStateException("图片不能超过 20 MB。"); output.write(buffer, 0, read); }
                        return new JSObject().put("data", "data:" + mime + ";base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                    }
                }
                return new JSObject().put("data", response.body().string());
            }
        });
    }
    @PluginMethod public void openSocket(PluginCall call) { run(call, () -> { transport.openSocket(call.getString("id"), call.getString("path")); return new JSObject(); }); }
    @PluginMethod public void sendSocket(PluginCall call) { try { transport.sendSocket(call.getString("id"), call.getString("data")); call.resolve(); } catch (Exception error) { call.reject(error.getMessage()); } }
    @PluginMethod public void closeSocket(PluginCall call) { String id = call.getString("id"); if (id != null) transport.closeSocket(id); call.resolve(); }
    @PluginMethod public void pickIdentity(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(call, intent, "identityPicked");
    }
    @ActivityCallback private void identityPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.resolve(new JSObject().put("identity", JSONObject.NULL)); return; }
        run(call, () -> new JSObject().put("identity", store.importKey(result.getData().getData())));
    }
    @PluginMethod public void openPage(PluginCall call) {
        try {
            String url = call.getString("url");
            if (!RemotePageActivity.allowed(url)) throw new IllegalArgumentException("仅支持 HTTPS 网页。");
            getActivity().startActivity(new Intent(getContext(), RemotePageActivity.class).putExtra("url", url)); call.resolve();
        } catch (Exception error) { call.reject(error.getMessage()); }
    }
    @Override protected void handleOnResume() {
        if (tunnel == null) return;
        JSObject profile = desiredProfile;
        if (profile != null && !connecting && !tunnel.isConnected()) beginConnect(profile, null);
        else if (tunnel.isConnected()) main.post(() -> notifyListeners("resume", new JSObject()));
    }
    @Override protected void handleOnDestroy() { main.removeCallbacks(monitor); disconnectNow(); workers.shutdownNow(); }
}
