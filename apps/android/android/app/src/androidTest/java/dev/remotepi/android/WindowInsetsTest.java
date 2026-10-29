package dev.remotepi.android;

import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 30)
public class WindowInsetsTest {
    @Test public void keyboardAndCutoutInsetsAreAppliedOnceAndRestoreAfterDismissal() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(activity -> {
                View decor = activity.getWindow().getDecorView();
                View content = activity.findViewById(android.R.id.content);
                WindowInsetsCompat keyboard = new WindowInsetsCompat.Builder()
                    .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.of(0, 24, 0, 48))
                    .setInsets(WindowInsetsCompat.Type.displayCutout(), Insets.of(32, 0, 0, 0))
                    .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, 300))
                    .setVisible(WindowInsetsCompat.Type.ime(), true).build();
                try {
                    ViewCompat.dispatchApplyWindowInsets(decor, keyboard);
                    assertEquals(32, decor.getPaddingLeft()); assertEquals(24, decor.getPaddingTop());
                    assertEquals(300, decor.getPaddingBottom());
                    assertEquals("The content must not reserve the keyboard height a second time", 0, content.getPaddingBottom());
                    ViewCompat.dispatchApplyWindowInsets(decor, new WindowInsetsCompat.Builder(keyboard)
                        .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                        .setVisible(WindowInsetsCompat.Type.ime(), false).build());
                    assertEquals(48, decor.getPaddingBottom()); assertEquals(0, content.getPaddingBottom());
                } finally { ViewCompat.requestApplyInsets(decor); }
            });
        }
    }
}
