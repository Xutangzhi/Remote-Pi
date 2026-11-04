package dev.remotepi.android;

import android.content.Context;
import android.os.Bundle;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeNotNull;

@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 30)
public class FilePreviewDeviceTest {
    @Test public void remoteFilesRenderAndPlayThroughNativeCacheAndRealWebView() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        assumeNotNull(args.getString("sshPort"), args.getString("webPort"), args.getString("password"));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File knownHosts = new File(context.getFilesDir(), "known_hosts");
        byte[] previous = knownHosts.isFile() ? Files.readAllBytes(knownHosts.toPath()) : null;
        String profileId = "preview-test-" + UUID.randomUUID();
        JSONObject profile = new JSONObject().put("id", profileId).put("name", "Local preview fixture").put("host", "127.0.0.1").put("username", "test")
            .put("port", Integer.parseInt(args.getString("sshPort"))).put("remotePort", Integer.parseInt(args.getString("webPort"))).put("identityFile", "");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                scenario.onActivity(activity -> activity.getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false));
                await(scenario, "Boolean(window.desktop)");
                eval(scenario, "window.__previewTest={}; void(async()=>{const off=window.desktop.onChallenge(c=>{if(c)void window.desktop.answerChallenge(c.id,c.kind==='host'?'yes':" + JSONObject.quote(args.getString("password")) + ");});try{await window.desktop.connect(await window.desktop.saveProfile(" + profile + "));window.__previewTest.ready=true;}catch(e){window.__previewTest.error=String(e);}finally{off();}})()");
                await(scenario, "Boolean(window.__previewTest.ready||window.__previewTest.error)");
                assertEquals("null", eval(scenario, "window.__previewTest.error||null"));
                await(scenario, "Boolean(document.querySelector('[aria-label=\"文件面板\"]'))");
                eval(scenario, "document.querySelector('[aria-label=\"文件面板\"]').click()");
                open(scenario, "preview.csv");
                await(scenario, "document.querySelector('.sheet-grid')?.textContent.includes('中文预览')");
                for (String[] media : new String[][] { { "preview.wav", "audio" }, { "preview.webm", "video" } }) {
                    eval(scenario, "document.querySelector('.file-back').click()"); open(scenario, media[0]);
                    String selector = ".rich-file-preview " + media[1];
                    await(scenario, "(document.querySelector('" + selector + "')?.readyState||0)>=1");
                    eval(scenario, "void(async()=>{try{const m=document.querySelector('" + selector + "');m.muted=true;await m.play();}catch(e){window.__previewTest.error=String(e);}})()");
                    await(scenario, "document.querySelector('" + selector + "').currentTime>0");
                    assertEquals("null", eval(scenario, "window.__previewTest.error||null"));
                }
                eval(scenario, "document.querySelector('.file-back').click()"); open(scenario, "preview.pdf");
                await(scenario, "document.querySelector('.pdf-preview canvas')?.dataset.rendered==='true'");
                await(scenario, "document.querySelector('.document-controls')?.textContent.includes('第 1 / 2 页')");
                eval(scenario, "document.querySelector('[aria-label=\"下一页\"]').click()");
                await(scenario, "document.querySelector('.pdf-preview canvas')?.getAttribute('aria-label')==='PDF 第 2 页' && document.querySelector('.pdf-preview canvas')?.dataset.rendered==='true'");
                eval(scenario, "document.querySelector('.file-back').click()"); open(scenario, "preview.docx");
                await(scenario, "document.querySelector('iframe')?.contentDocument?.body.textContent.includes('中文 Word 第一页')");
                await(scenario, "document.querySelector('iframe')?.contentDocument?.querySelector('img')?.naturalWidth===180");
                eval(scenario, "document.querySelector('[aria-label=\"下一页\"]').click()");
                await(scenario, "document.querySelector('.document-controls')?.textContent.includes('第 2 / 2 页')");
                eval(scenario, "document.querySelector('.file-back').click()"); open(scenario, "preview.pptx");
                await(scenario, "document.querySelector('.presentation-preview img')?.naturalWidth>0");
                eval(scenario, "document.querySelector('[aria-label=\"下一页\"]').click()");
                await(scenario, "document.querySelector('.presentation-preview img')?.alt==='PPT 第 2 页' && document.querySelector('.presentation-preview img')?.naturalWidth>0");
                eval(scenario, "document.querySelector('[aria-label=\"关闭面板\"]').click()");
                await(scenario, "!document.querySelector('.rich-file-preview')");
                File cache = new File(context.getCacheDir(), "file-previews");
                long deadline = SystemClock.uptimeMillis() + 5000;
                while (cache.list().length > 0 && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(50);
                assertEquals("Closing the preview deletes its cached bytes", 0, cache.list().length);
            } finally {
                eval(scenario, "window.__previewClean=false;void(async()=>{try{await window.desktop.disconnect();await window.desktop.deleteProfile(" + JSONObject.quote(profileId) + ");}finally{window.__previewClean=true;}})()");
                await(scenario, "window.__previewClean===true");
            }
        } finally { if (previous == null) Files.deleteIfExists(knownHosts.toPath()); else Files.write(knownHosts.toPath(), previous); }
    }
    private void open(ActivityScenario<MainActivity> scenario, String path) throws Exception {
        String button = "Array.from(document.querySelectorAll('.file-list button')).find(b=>b.textContent===" + JSONObject.quote(path) + ")";
        await(scenario, "Boolean(" + button + ")"); eval(scenario, button + ".click()");
    }
    private String eval(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue(done.await(5, TimeUnit.SECONDS)); return result.get();
    }
    private void await(ActivityScenario<MainActivity> scenario, String condition) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 30000;
        while (SystemClock.uptimeMillis() < deadline) { if ("true".equals(eval(scenario, condition))) return; SystemClock.sleep(100); }
        fail("WebView condition failed: " + condition + "; " + eval(scenario, "document.querySelector('.panel-error')?.textContent||window.__previewTest?.error||null"));
    }
}
