package dev.remotepi.android;

import android.app.Instrumentation;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Base64;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

/** Opt-in only: the operator supplies one private input file; no real credentials live in this APK. */
@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 36)
public class RealServerTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private ActivityScenario<MainActivity> scenario;
    private JSONObject input;
    private String stateKey;
    private File stateFile;

    @Test public void realServerChatFilesGitAndTerminal() throws Exception {
        Context context = instrumentation.getTargetContext();
        File inputFile = new File(context.getFilesDir(), "real-test-input.json");
        assumeTrue("Real-server test requires explicit private input", inputFile.isFile());
        byte[] bytes = Files.readAllBytes(inputFile.toPath());
        Files.delete(inputFile.toPath());
        try { input = new JSONObject(new String(bytes, StandardCharsets.UTF_8)); }
        finally { Arrays.fill(bytes, (byte) 0); }
        JSObject profile = prepareProfile(context);
        String mode = input.optString("mode", "all");
        assertTrue("Unknown test mode", Arrays.asList("all", "chat", "inspect", "files", "git", "terminal").contains(mode));
        stateKey = profile.getString("id") + ":" + input.getString("workspaceId");
        stateFile = new File(context.getFilesDir(), "real-test-state.json");
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            scenario = activity;
            activity.onActivity(a -> a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
            await("Boolean(window.desktop) && innerHeight > innerWidth", "Android bridge", 30000);
            js("window.__real={request:async(path,method='GET',body)=>JSON.parse((await Capacitor.nativePromise('RemotePi','request',{path,method,...(body===undefined?{}:{body})})).data)};");
            async("const off=window.desktop.onChallenge(c=>{if(c){window.__real.challenge=true;void window.desktop.answerChallenge(c.id,null);}});try{await window.desktop.connect(" + profile + ");if(window.__real.challenge)throw Error('Unexpected SSH authentication or host challenge');}finally{off();}", "trusted SSH connection", 45000);
            await("Boolean(document.querySelector('.pi-workspace'))", "real workspace", 30000);
            pass("connection");
            selectTestSession();
            if (mode.equals("all") || mode.equals("chat")) chat();
            if (mode.equals("all") || mode.equals("inspect") || mode.equals("files")) files();
            if (mode.equals("all") || mode.equals("inspect") || mode.equals("git")) git();
            if (mode.equals("all") || mode.equals("terminal")) terminal();
        }
    }

    private JSObject prepareProfile(Context context) throws Exception {
        SecureStore store = new SecureStore(context);
        JSObject profile = new JSObject(input.getJSONObject("profile").toString());
        String identity = "";
        JSONArray profiles = store.settings().getJSONArray("profiles");
        for (int i = 0; i < profiles.length(); i++) {
            JSONObject saved = profiles.getJSONObject(i);
            if (saved.optString("id").equals(profile.getString("id"))) identity = saved.optString("identityFile");
        }
        if (identity.isEmpty()) {
            byte[] key = Base64.decode(input.getString("privateKey"), Base64.DEFAULT);
            File temporary = new File(context.getCacheDir(), "real-test-key");
            try { Files.write(temporary.toPath(), key); identity = store.importKey(Uri.fromFile(temporary)); }
            finally { Arrays.fill(key, (byte) 0); Files.deleteIfExists(temporary.toPath()); }
        }
        input.remove("privateKey");
        String trusted = input.getString("knownHosts");
        assertFalse("Previously verified host key is required", trusted.trim().isEmpty());
        File hosts = new File(context.getFilesDir(), "known_hosts");
        String previous = hosts.isFile() ? new String(Files.readAllBytes(hosts.toPath()), StandardCharsets.UTF_8) : "";
        if (!previous.contains(trusted.trim())) Files.write(hosts.toPath(), (previous + "\n" + trusted.trim() + "\n").getBytes(StandardCharsets.UTF_8));
        input.remove("knownHosts");
        profile.put("identityFile", identity);
        return store.saveProfile(profile);
    }

    private void selectTestSession() throws Exception {
        JSONObject saved = stateFile.isFile() ? new JSONObject(new String(Files.readAllBytes(stateFile.toPath()), StandardCharsets.UTF_8)) : new JSONObject();
        String sessionId = input.optString("sessionId", saved.optString(stateKey));
        click("[aria-label=\"展开侧栏\"]");
        await("Boolean(document.querySelector('.project-tree .project-new'))", "project catalog", 30000);
        if (sessionId.isEmpty()) {
            String label = "在 " + input.getString("projectName") + " 新建对话";
            js("Array.from(document.querySelectorAll('.project-new')).find(b=>b.getAttribute('aria-label')===" + q(label) + ").click()");
            await("Boolean(document.querySelector('[aria-label=\"选择工作区\"]'))", "new session dialog", 10000);
            set("[aria-label=\"选择项目\"]", input.getString("projectId"));
            set("[aria-label=\"选择工作区\"]", input.getString("workspaceId"));
            click(".workspace-dialog .button.primary");
            await("Boolean(document.querySelector('.composer textarea')) && !document.querySelector('.stream-notice') && !document.querySelector('.workspace-dialog')", "created session", 60000);
            click("[aria-label=\"展开侧栏\"]");
            await("Boolean(document.querySelector('.conversation-row.selected'))", "selected test session", 10000);
            sessionId = string("document.querySelector('.conversation-row.selected').closest('[data-session-id]').dataset.sessionId");
            saved.put(stateKey, sessionId); Files.write(stateFile.toPath(), saved.toString().getBytes(StandardCharsets.UTF_8));
            click(".conversation-row.selected");
            click("[aria-label=\"对话菜单\"]");
            js("Array.from(document.querySelectorAll('.popover-menu button')).find(b=>b.textContent==='重命名对话').click()");
            await("Boolean(document.querySelector('[aria-label=\"对话名称\"]'))", "rename dialog", 10000);
            set("[aria-label=\"对话名称\"]", "Android 16 联调");
            click(".workspace-dialog .button.primary");
            await("!document.querySelector('.workspace-dialog')", "saved test name", 30000);
        } else {
            set("[aria-label=\"搜索项目和对话\"]", "Android 16 联调");
            String selector = "[data-session-id=" + q(sessionId) + "] .conversation-row";
            await("Boolean(document.querySelector(" + q(selector) + "))", "existing independent test session", 20000);
            click(selector);
        }
        js("window.__real.session={id:" + q(sessionId) + ",cwd:" + q(input.getString("cwd")) + "}");
        await("Boolean(document.querySelector('.composer textarea')) && !document.querySelector('.stream-notice') && !document.querySelector('[aria-label=\"停止任务\"]')", "idle live test chat", 30000);
    }

    private void chat() throws Exception {
        js("window.__real.beforeReplies=document.querySelectorAll('.message-assistant').length");
        set(".composer textarea", "这是安卓客户端连通性测试，请不要调用任何工具、不要修改文件，只回复 ANDROID16_CHAT_OK。");
        click(".send-button");
        await("Array.from(document.querySelectorAll('.message-assistant')).slice(window.__real.beforeReplies).some(e=>e.textContent.includes('ANDROID16_CHAT_OK')) && !document.querySelector('[aria-label=\"停止任务\"]') && !document.querySelector('.send-button .spinner')", "assistant response and completed work", 240000);
        screenshot("chat.png"); pass("chat");
    }
    private void panel(String name) throws Exception {
        if ("false".equals(js("Boolean(document.querySelector('.inspector:not(.inspector-closing)'))"))) click("[aria-label=\"文件面板\"]");
        click("[aria-label=" + q("切换到" + name) + "]");
        await("!document.querySelector('.panel-loading')", name + " loaded", 30000);
        assertEquals("Panel request failed", "false", js("Boolean(document.querySelector('.panel-error'))"));
    }
    private void files() throws Exception {
        panel("文件");
        String[] parts = input.getString("readPath").split("/");
        for (String part : parts) {
            if (part.isEmpty()) continue;
            String button = "Array.from(document.querySelectorAll('.file-list button')).find(b=>b.querySelector('span')?.textContent===" + q(part) + ")";
            await("Boolean(" + button + ") && !document.querySelector('.panel-loading')", "requested file entry", 30000);
            js(button + ".click()");
        }
        await("Boolean(document.querySelector('.file-preview')) && !document.querySelector('.panel-loading')", "file preview", 30000);
        async("window.__real.file=await window.desktop.piRequest('files.read',{..." + scope() + ",path:" + q(input.getString("readPath")) + "});", "reference file content", 30000);
        assertEquals("Displayed file content must exactly match the server, including an empty file", "true", js("document.querySelector('.file-preview').textContent===window.__real.file.content"));
        assertEquals(input.getString("readPath"), string("document.querySelector('.file-back').textContent"));
        horizontalScroll(".file-preview"); screenshot("files.png"); pass("files");
    }
    private void git() throws Exception {
        panel("变更");
        async("window.__real.git=await window.desktop.piRequest('git.status'," + scope() + ");", "Git status", 30000);
        assertEquals("Git repository required", "true", js("window.__real.git.isGitRepo===true"));
        await("document.querySelector('.diff-controls span')?.textContent===window.__real.git.branch", "Git branch in UI", 30000);
        String path = input.optString("diffPath");
        if (!path.isEmpty()) {
            set(".diff-file-select", path);
            await("!document.querySelector('.panel-loading') && Boolean(document.querySelector('.diff-content pre')?.textContent.trim())", "selected file diff", 30000);
            assertEquals(path, string("document.querySelector('.diff-file-select').value"));
        } else await("!document.querySelector('.panel-loading') && Boolean(document.querySelector('.diff-content pre,.diff-content .panel-empty'))", "Git changes or empty result", 30000);
        horizontalScroll(".diff-content"); screenshot("git.png"); pass("git");
    }
    private void terminal() throws Exception {
        async("const m=await window.__real.request('/pi-web-plugins/manifest.json');const p=m.plugins.find(p=>p.id==='terminal'||p.id==='pi-web.terminal');if(!p)throw Error('Terminal plugin unavailable');window.__real.terminalBranch=(await window.desktop.piRequest('git.status'," + scope() + ")).branch;window.__real.terminalPlugin=p;window.__real.terminalPath='/api/paired-plugin-backends/'+encodeURIComponent(p.id)+'/projects/'+encodeURIComponent(" + q(input.getString("projectId")) + ")+'/workspaces/'+encodeURIComponent(" + q(input.getString("workspaceId")) + ");window.__real.listTerminals=()=>window.__real.request(window.__real.terminalPath+'/terminal.list','POST',{revision:p.backendRevision,input:null});const list=await window.__real.listTerminals();if(list.some(t=>!t.exited))throw Error('Existing active terminal: test refused to attach');window.__real.beforeTerminals=list.map(t=>t.id);window.__real.output='';window.__real.exit=false;window.__real.offTerminal=window.desktop.onTerminal(p=>{if(p.type==='output')window.__real.output+=p.data||'';if(p.type==='exit')window.__real.exit=true;});", "exclusive terminal preflight", 30000);
        try {
            panel("终端");
            await("Boolean(document.querySelector('.xterm-helper-textarea')) && !document.querySelector('.terminal-note')", "terminal ready", 30000);
            async("const list=await window.__real.listTerminals();const own=list.filter(t=>!t.exited&&!window.__real.beforeTerminals.includes(t.id));if(own.length!==1)throw Error('Cannot identify own test terminal');window.__real.ownTerminal=own[0].id;", "own terminal identity", 30000);
            touch(".xterm-screen", false);
            awaitIme(true);
            await("(()=>{const r=document.querySelector('.terminal-pane').getBoundingClientRect();return r.height>60&&r.top>=0&&r.bottom<=innerHeight+1&&document.querySelector('.xterm-screen').clientHeight>60;})()", "terminal fits above real keyboard", 10000);
            screenshot("terminal-keyboard.png");
            instrumentation.sendStringSync("printf 'ANDROID16_TERMINAL_OK\\n'; pwd; git branch --show-current; exit\n");
            await("window.__real.exit && /(?:^|[\\r\\n])ANDROID16_TERMINAL_OK[\\r\\n]/.test(window.__real.output) && window.__real.output.includes(" + q(input.getString("cwd")) + ") && window.__real.output.includes(window.__real.terminalBranch)", "xterm command output and exit", 30000);
            assertEquals("Terminal screen must render", "true", js("Boolean(document.querySelector('.xterm-screen canvas,.xterm-rows'))"));
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK); awaitIme(false);
            screenshot("terminal.png"); pass("terminal");
        } finally {
            async("window.__real.offTerminal?.();if(window.__real.ownTerminal){const list=await window.__real.listTerminals();if(list.some(t=>t.id===window.__real.ownTerminal&&!t.exited))await window.__real.request(window.__real.terminalPath+'/terminal.close','POST',{revision:window.__real.terminalPlugin.backendRevision,input:{terminalId:window.__real.ownTerminal}});}", "own terminal cleanup", 30000);
        }
    }

    private void horizontalScroll(String selector) throws Exception {
        assertEquals("Page must not overflow horizontally", "true", js("document.documentElement.scrollWidth<=innerWidth+1&&document.body.scrollWidth<=innerWidth+1"));
        if ("true".equals(js("(()=>{const e=document.querySelector(" + q(selector) + ");return e.scrollWidth>e.clientWidth+2;})()"))) {
            touch(selector, true);
            await("document.querySelector(" + q(selector) + ").scrollLeft>0", "horizontal content swipe", 10000);
            js("document.querySelector(" + q(selector) + ").scrollLeft=0");
            await("document.querySelector(" + q(selector) + ").scrollLeft===0", "restored content position", 10000);
        }
    }
    private void touch(String selector, boolean swipe) throws Exception {
        JSONObject point = new JSONObject(string("JSON.stringify((()=>{const r=document.querySelector(" + q(selector) + ").getBoundingClientRect();const left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);return {x:left+(right-left)*.8,end:left+(right-left)*.2,y:top+(bottom-top)/2,width:innerWidth};})())"));
        float[] p = new float[3];
        scenario.onActivity(a -> { WebView web = a.getBridge().getWebView(); int[] origin = new int[2]; web.getLocationOnScreen(origin); float scale = (float) (web.getWidth() / point.optDouble("width")); p[0] = origin[0] + (float) point.optDouble("x") * scale; p[1] = origin[1] + (float) point.optDouble("y") * scale; p[2] = origin[0] + (float) point.optDouble("end") * scale; });
        long start = SystemClock.uptimeMillis();
        pointer(start, MotionEvent.ACTION_DOWN, p[0], p[1]);
        if (swipe) for (int step = 1; step <= 12; step++) { SystemClock.sleep(30); pointer(start, MotionEvent.ACTION_MOVE, p[0] + (p[2] - p[0]) * step / 12, p[1]); }
        else SystemClock.sleep(50);
        pointer(start, MotionEvent.ACTION_UP, swipe ? p[2] : p[0], p[1]);
    }
    private void pointer(long start, int action, float x, float y) {
        MotionEvent event = MotionEvent.obtain(start, SystemClock.uptimeMillis(), action, x, y, 0); event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        try { instrumentation.sendPointerSync(event); } finally { event.recycle(); }
    }
    private void awaitIme(boolean visible) {
        long deadline = SystemClock.uptimeMillis() + 10000;
        while (SystemClock.uptimeMillis() < deadline) {
            AtomicBoolean matches = new AtomicBoolean();
            scenario.onActivity(a -> { WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(a.getWindow().getDecorView()); matches.set(insets != null && insets.isVisible(WindowInsetsCompat.Type.ime()) == visible); });
            if (matches.get()) { instrumentation.waitForIdleSync(); return; } SystemClock.sleep(100);
        }
        fail("The real IME did not become " + (visible ? "visible" : "hidden"));
    }

    private String scope() throws Exception { return new JSONObject().put("projectId", input.getString("projectId")).put("workspaceId", input.getString("workspaceId")).toString(); }
    private String q(String text) { return JSONObject.quote(text); }
    private String js(String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(a -> a.getBridge().getWebView().evaluateJavascript(script, v -> { result.set(v); done.countDown(); }));
        assertTrue("WebView script must return", done.await(5, TimeUnit.SECONDS)); return result.get();
    }
    private String string(String script) throws Exception { return (String) new JSONTokener(js(script)).nextValue(); }
    private void click(String selector) throws Exception {
        await("Boolean(document.querySelector(" + q(selector) + "))", "UI control", 10000);
        js("document.querySelector(" + q(selector) + ").click()"); SystemClock.sleep(150);
    }
    private void set(String selector, String value) throws Exception {
        js("(()=>{const e=document.querySelector(" + q(selector) + ");Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e," + q(value) + ");e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()");
        SystemClock.sleep(150);
    }
    private void async(String script, String description, long timeout) throws Exception {
        js("window.__real.done=false;window.__real.error=null;void(async()=>{try{" + script + "}catch(e){window.__real.error=String(e);}finally{window.__real.done=true;}})()");
        await("window.__real.done===true", description, timeout);
        assertEquals(description + " failed", "null", js("window.__real.error"));
    }
    private void await(String condition, String description, long timeout) throws Exception {
        long deadline = SystemClock.uptimeMillis() + timeout;
        while (SystemClock.uptimeMillis() < deadline) { if ("true".equals(js(condition))) return; SystemClock.sleep(150); }
        screenshot("failure.png"); fail("Timed out waiting for " + description);
    }
    private void screenshot(String name) throws Exception {
        instrumentation.waitForIdleSync(); SystemClock.sleep(750);
        File directory = new File(instrumentation.getTargetContext().getExternalFilesDir(null), "real-verification");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        Bitmap bitmap = instrumentation.getUiAutomation().takeScreenshot(); assertNotNull(bitmap);
        try (FileOutputStream output = new FileOutputStream(new File(directory, name))) { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)); }
        finally { bitmap.recycle(); }
    }
    private void pass(String stage) { Bundle status = new Bundle(); status.putString("stream", "\nREAL PASS " + stage + "\n"); instrumentation.sendStatus(0, status); }
}
