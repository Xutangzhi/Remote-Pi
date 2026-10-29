package dev.remotepi.android;

import android.os.Bundle;
import android.net.Uri;
import android.webkit.*;
import android.widget.*;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.EdgeToEdge;
import androidx.appcompat.app.AppCompatActivity;

/** Remote pages have their own WebView and never receive the Capacitor bridge. */
public class RemotePageActivity extends AppCompatActivity {
    private WebView web;
    static boolean allowed(String raw) {
        if (raw == null) return false;
        Uri url = Uri.parse(raw);
        return "https".equals(url.getScheme());
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String url = getIntent().getStringExtra("url"); if (!allowed(url)) { finish(); return; }
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        Button close = new Button(this); close.setText("关闭 · 返回 Remote Pi"); close.setOnClickListener((view) -> finish()); layout.addView(close, new LinearLayout.LayoutParams(-1, Math.round(48 * getResources().getDisplayMetrics().density)));
        web = new WebView(this); web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true); web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(false); web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient() { @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !allowed(request.getUrl().toString()); } });
        layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1)); setContentView(layout);
        EdgeToEdge.enable(this);
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(layout, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() | androidx.core.view.WindowInsetsCompat.Type.displayCutout());
            androidx.core.graphics.Insets keyboard = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            return androidx.core.view.WindowInsetsCompat.CONSUMED;
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) { public void handleOnBackPressed() { if (web.canGoBack()) web.goBack(); else finish(); } }); web.loadUrl(url);
    }
    @Override public void onDestroy() { if (web != null) { web.stopLoading(); web.destroy(); } super.onDestroy(); }
}
