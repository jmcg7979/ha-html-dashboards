package dash.tv;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

import org.json.JSONObject;

/**
 * Take-overs (camera alert, timer) over whatever app is playing. A see-through window (an accessibility overlay:
 * HomeGuard's own, no extra permission) with the dashboard at &overlay=1, which draws only the take-overs (engine app.js
 * overlayOnly) and follows HA itself. It is loaded ahead of time, as soon as another app is in front (HomeActivity.onPause,
 * screen on), because a page loaded only when the alert starts took longer than a timer someone stops from another room.
 * While nothing is up it takes no keys or touches. 'shown': the window takes the remote (Back goes to the page as tv:back:
 * stop the timer, dismiss the alert); 'done': back to see-through. It goes when our home screen is back in front (it shows
 * take-overs itself) or the screen goes off. Watcher.java is the backup: a watched state starting with no window up opens
 * one (slow), and a window that doesn't show it within 5 s is reloaded. The app behind keeps playing.
 */
final class Overlay {
    private static Overlay cur;
    private static final Handler ui = new Handler(Looper.getMainLooper());
    private static final int PASS = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
    private final WindowManager wm;
    private final WindowManager.LayoutParams lp;
    private final FrameLayout box;
    private final WebView web;
    private boolean up;   // a take-over is on screen

    /** another app is in front with the screen on: have the window loaded and waiting (main thread) */
    static void preload(AccessibilityService s) {
        if (s == null || cur != null || !allowed(s)) return;
        try { cur = new Overlay(s, s.getSharedPreferences("cfg", Context.MODE_PRIVATE)); } catch (Exception e) { cur = null; }
    }

    /** Watcher: a watched state started a take-over (main thread). The loaded page shows it itself; this is the backup. */
    static void show(AccessibilityService s) {
        if (cur == null) { preload(s); return; }
        final Overlay o = cur;
        ui.postDelayed(() -> { if (cur == o && !o.up) o.web.reload(); }, 5000);   // the page didn't show it (lost its connection?): load it again
    }

    private static boolean allowed(Context s) {
        SharedPreferences cfg = s.getSharedPreferences("cfg", Context.MODE_PRIVATE);
        if (HomeActivity.resumed || !cfg.getBoolean("overlay", true) || cfg.getString("url", "").isEmpty()) return false;
        PowerManager pm = (PowerManager) s.getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isInteractive();   // the TV is off: no take-over
    }

    static void close() {
        ui.post(() -> {
            Overlay o = cur; if (o == null) return;
            cur = null;
            try { o.wm.removeView(o.box); } catch (Exception e) { /* gone */ }
            o.web.destroy();
        });
    }

    private Overlay(AccessibilityService s, SharedPreferences cfg) {
        wm = (WindowManager) s.getSystemService(Context.WINDOW_SERVICE);
        web = new WebView(s);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        ws.setUserAgentString(ws.getUserAgentString() + " DashTV-overlay");
        web.addJavascriptInterface(new Bridge(cfg), "tvhost");
        web.addJavascriptInterface(new ExternalAuth(web, cfg), "externalApp");
        web.setWebChromeClient(new WebChromeClient());
        box = new FrameLayout(s) {
            @Override public boolean dispatchKeyEvent(KeyEvent e) {
                int k = e.getKeyCode();
                if (k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_ESCAPE) {
                    if (e.getAction() == KeyEvent.ACTION_UP) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('tv:back'))", null);
                    return true;
                }
                return super.dispatchKeyEvent(e);
            }
        };
        box.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        lp = new WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            PASS | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT);
        wm.addView(box, lp);
        String url = cfg.getString("url", "");
        web.loadUrl(url + (url.contains("?") ? "&" : "?") + "overlay=1");
    }

    /** a take-over on screen: the window takes the remote; none: see-through again, the app behind has the remote */
    private void up(boolean on) {
        if (cur != this || up == on) return;
        up = on;
        if (on) lp.flags &= ~PASS; else lp.flags |= PASS;
        try { wm.updateViewLayout(box, lp); } catch (Exception e) { return; }
        if (on) web.requestFocus();
    }

    /** the overlay page's window.tvhost (engine core/tvhost.js: overlay, info) */
    class Bridge {
        private final SharedPreferences cfg;
        Bridge(SharedPreferences cfg) { this.cfg = cfg; }
        @JavascriptInterface public void overlay(String state) {
            if ("shown".equals(state)) ui.post(() -> up(true));
            else if ("done".equals(state)) ui.post(() -> up(false));
        }
        @JavascriptInterface public String info() {
            try { return new JSONObject().put("id", cfg.getString("id", "")).put("name", cfg.getString("name", "")).put("overlay", true).toString(); }
            catch (Exception e) { return "{}"; }
        }
    }
}
