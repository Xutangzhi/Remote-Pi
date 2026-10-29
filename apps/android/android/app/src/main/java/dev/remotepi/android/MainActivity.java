package dev.remotepi.android;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(RemotePiPlugin.class); super.onCreate(state);
        // Capacitor SystemBars applies system bar, cutout and IME insets once at the decor view.
        EdgeToEdge.enable(this);
    }
}
