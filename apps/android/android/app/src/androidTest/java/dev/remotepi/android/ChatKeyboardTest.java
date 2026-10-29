package dev.remotepi.android;

import android.app.Instrumentation;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeNotNull;

/** Uses the real WebView, native bridge and SSH tunnel, connected only to the local test fixture. */
@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 30)
public class ChatKeyboardTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();

    @Test public void realChatRemainsUsableWithKeyboardAndAcrossRotation() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        assumeNotNull(args.getString("sshPort"), args.getString("webPort"), args.getString("password"));
        Context context = instrumentation.getTargetContext();
        File knownHosts = new File(context.getFilesDir(), "known_hosts");
        byte[] previousHosts = knownHosts.isFile() ? Files.readAllBytes(knownHosts.toPath()) : null;
        String profileId = "keyboard-test-" + UUID.randomUUID();
        JSONObject profile = new JSONObject().put("id", profileId).put("name", "Local keyboard fixture")
            .put("host", "127.0.0.1").put("username", "test").put("port", Integer.parseInt(args.getString("sshPort")))
            .put("remotePort", Integer.parseInt(args.getString("webPort"))).put("identityFile", "");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                scenario.onActivity(activity -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
                awaitJs(scenario, "Boolean(window.desktop) && innerHeight > innerWidth", "Android bridge and portrait viewport");
                evaluate(scenario, "window.__keyboardTest={}; void (async()=>{const bridge=window.desktop; "
                    + "const off=bridge.onChallenge(challenge=>{if(challenge) void bridge.answerChallenge(challenge.id, challenge.kind==='host'?'yes':"
                    + JSONObject.quote(args.getString("password")) + ");}); try {const profile=await bridge.saveProfile(" + profile + "); "
                    + "await bridge.connect(profile); window.__keyboardTest.connected=true;} catch(error) {window.__keyboardTest.error=String(error);} finally {off();}})()");
                awaitJs(scenario, "Boolean(window.__keyboardTest.connected || window.__keyboardTest.error)", "local fixture SSH connection");
                assertEquals("null", evaluate(scenario, "window.__keyboardTest.error || null"));
                awaitJs(scenario, "Boolean(document.querySelector('.pi-workspace'))", "real workspace");
                evaluate(scenario, "document.querySelector('[aria-label=\"展开侧栏\"]')?.click()");
                awaitJs(scenario, "Boolean(document.querySelector('[data-session-id=\"session-1\"] .conversation-row'))", "fixture session");
                evaluate(scenario, "if(document.documentElement.dataset.theme!=='dark') document.querySelector('.sidebar-utilities [aria-label=\"切换主题\"]').click()");
                awaitJs(scenario, "document.documentElement.dataset.theme==='dark'", "dark chat theme"); awaitSystemTheme(scenario, true);
                evaluate(scenario, "document.querySelector('.sidebar-utilities [aria-label=\"切换主题\"]').click()");
                awaitJs(scenario, "document.documentElement.dataset.theme==='light'", "restored light chat theme"); awaitSystemTheme(scenario, false);
                evaluate(scenario, "document.querySelector('[data-session-id=\"session-1\"] .conversation-row').click()");
                awaitJs(scenario, "Boolean(document.querySelector('.composer textarea')) && !document.querySelector('.stream-notice') && !document.querySelector('[role=\"dialog\"]')", "live chat composer");
                assertLayout(scenario);

                touchComposer(scenario);
                awaitIme(scenario, true);
                awaitJs(scenario, "document.activeElement === document.querySelector('.composer textarea') && document.querySelector('.composer').getBoundingClientRect().bottom <= innerHeight + 1", "focused composer above keyboard");
                scenario.onActivity(activity -> {
                    View decor = activity.getWindow().getDecorView();
                    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
                    assertNotNull(insets);
                    int keyboardHeight = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
                    assertTrue("A real IME must occupy screen space", keyboardHeight > 0);
                    assertEquals(keyboardHeight, decor.getPaddingBottom());
                    assertEquals("The content must not reserve the keyboard twice", 0, activity.findViewById(android.R.id.content).getPaddingBottom());
                    WebView web = activity.getBridge().getWebView(); int[] position = new int[2]; web.getLocationOnScreen(position);
                    int keyboardTop = activity.getWindowManager().getCurrentWindowMetrics().getBounds().bottom - keyboardHeight;
                    assertTrue("The WebView must end above the IME", position[1] + web.getHeight() <= keyboardTop + 2);
                    assertTrue("The viewport must not lose a second keyboard height", keyboardTop - position[1] - web.getHeight() <= 2);
                });
                assertLayout(scenario); screenshot("chat-portrait-keyboard.png");

                instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                awaitIme(scenario, false);
                awaitJs(scenario, "Boolean(document.querySelector('.composer textarea')) && document.visibilityState==='visible'", "chat retained after dismissing keyboard");
                scenario.onActivity(activity -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
                awaitJs(scenario, "innerWidth > innerHeight", "landscape viewport");
                assertLayout(scenario); screenshot("chat-landscape.png");
                scenario.onActivity(activity -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
                awaitJs(scenario, "innerHeight > innerWidth", "restored portrait viewport");
                assertLayout(scenario); screenshot("chat-portrait.png");
            } finally {
                try {
                    evaluate(scenario, "window.__keyboardCleanup=false; void (async()=>{try{await window.desktop?.setTheme('light'); await window.desktop?.disconnect(); await window.desktop?.deleteProfile("
                        + JSONObject.quote(profileId) + ");}finally{window.__keyboardCleanup=true;}})()");
                    awaitJs(scenario, "window.__keyboardCleanup===true", "fixture cleanup");
                } finally { scenario.onActivity(activity -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT)); }
            }
        } finally {
            if (previousHosts == null) Files.deleteIfExists(knownHosts.toPath()); else Files.write(knownHosts.toPath(), previousHosts);
        }
    }

    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue("WebView script must return", done.await(5, TimeUnit.SECONDS)); return result.get();
    }
    private void awaitJs(ActivityScenario<MainActivity> scenario, String condition, String description) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 25000;
        while (SystemClock.uptimeMillis() < deadline) { if ("true".equals(evaluate(scenario, condition))) return; SystemClock.sleep(100); }
        fail("Timed out waiting for " + description);
    }
    private void awaitIme(ActivityScenario<MainActivity> scenario, boolean visible) {
        long deadline = SystemClock.uptimeMillis() + 10000;
        while (SystemClock.uptimeMillis() < deadline) {
            AtomicBoolean matches = new AtomicBoolean();
            scenario.onActivity(activity -> { WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(activity.getWindow().getDecorView()); matches.set(insets != null && insets.isVisible(WindowInsetsCompat.Type.ime()) == visible); });
            if (matches.get()) { instrumentation.waitForIdleSync(); return; } SystemClock.sleep(100);
        }
        fail("The real IME did not become " + (visible ? "visible" : "hidden"));
    }
    private void touchComposer(ActivityScenario<MainActivity> scenario) throws Exception {
        String raw = evaluate(scenario, "JSON.stringify((()=>{const r=document.querySelector('.composer textarea').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth};})())");
        JSONObject point = new JSONObject((String) new JSONTokener(raw).nextValue());
        float[] location = new float[2];
        scenario.onActivity(activity -> {
            WebView web = activity.getBridge().getWebView(); int[] origin = new int[2]; web.getLocationOnScreen(origin);
            float scale = (float) (web.getWidth() / point.optDouble("width"));
            location[0] = origin[0] + (float) point.optDouble("x") * scale; location[1] = origin[1] + (float) point.optDouble("y") * scale;
        });
        long now = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, location[0], location[1], 0);
        MotionEvent up = MotionEvent.obtain(now, now + 50, MotionEvent.ACTION_UP, location[0], location[1], 0);
        down.setSource(InputDevice.SOURCE_TOUCHSCREEN); up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        try { instrumentation.sendPointerSync(down); instrumentation.sendPointerSync(up); } finally { down.recycle(); up.recycle(); }
    }
    private void awaitSystemTheme(ActivityScenario<MainActivity> scenario, boolean dark) {
        long deadline = SystemClock.uptimeMillis() + 10000;
        while (SystemClock.uptimeMillis() < deadline) {
            AtomicBoolean matches = new AtomicBoolean();
            scenario.onActivity(activity -> {
                WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView());
                int mode = dark ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO;
                matches.set(activity.getDelegate().getLocalNightMode() == mode && bars.isAppearanceLightStatusBars() == !dark && bars.isAppearanceLightNavigationBars() == !dark);
            });
            if (matches.get()) return; SystemClock.sleep(100);
        }
        fail("Native system bars did not match the " + (dark ? "dark" : "light") + " chat theme");
    }
    private void assertLayout(ActivityScenario<MainActivity> scenario) throws Exception {
        awaitJs(scenario, "(()=>{const composer=document.querySelector('.composer'); if(!composer)return false; const r=composer.getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth+1 && document.body.scrollWidth<=innerWidth+1 && r.left>=-1 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1;})()", "composer within viewport without horizontal overflow");
    }
    private void screenshot(String name) throws Exception {
        instrumentation.waitForIdleSync();
        // DOM layout settles before the system's rotation/IME surface animation finishes.
        SystemClock.sleep(750);
        File directory = new File(instrumentation.getTargetContext().getExternalFilesDir(null), "verification");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        Bitmap bitmap = instrumentation.getUiAutomation().takeScreenshot(); assertNotNull(bitmap);
        try (FileOutputStream output = new FileOutputStream(new File(directory, name))) { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)); }
        finally { bitmap.recycle(); }
    }
}
