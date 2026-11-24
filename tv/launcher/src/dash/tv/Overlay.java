package dash.tv;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.FrameLayout;

/**
 * Take-overs (camera alert, timer) over whatever app is playing. A see-through window (an accessibility overlay:
 * HomeGuard's own, no extra permission) with the dashboard at &overlay=1, which draws only the take-overs (engine app.js
 * overlayOnly) and follows HA itself. The page is loaded ahead of time, 15 s after another app comes in front
 * (HomeActivity.onPause) or 2 s after the screen comes on over one (HomeGuard), because a page loaded only when the alert
 * starts takes longer than a timer someone stops from another room. While nothing is up the page has no window at all: a
 * window, even a see-through one, keeps ~55 MB of graphics memory in use for as long as any app is in front.
 * 'shown': the window is added and takes the remote (Back goes to the page as tv:back: stop the timer, dismiss the
 * alert); 'aside' (a camera alert in its corner): the window is added but takes neither the remote nor touches, so the
 * app behind is used as before; only Back comes here, once, to dismiss the alert (HomeGuard.onKeyEvent, which hears the
 * remote only while such a window is up); 'done': the window is removed; a page that starts over (a reload) has nothing
 * up either. The page goes when our
 * home screen is back in front (it shows take-overs itself) or the screen goes off. Watcher.java is the backup: a watched
 * state starting with no page loaded loads one (slow), and a page that hasn't shown anything 5 s later is loaded again.
 * The app behind keeps playing. If the page's renderer is gone the page is dropped; the next take-over or the next wait
 * loads a new one, unless it went three times within a minute: then none is loaded for five minutes.
 */
final class Overlay {
    private static final long SHOW_WAIT_MS = 5000;     // a watched state started: the page has this long to show it
    private static final long HOLD_MS = 5 * 60000;     // after a page that keeps dying: no new one for this long
    private static final String BACK = "window.dispatchEvent(new CustomEvent('tv:back'))";
    private static final int IN_SCREEN = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN;
    private static final int LEAVE_REMOTE = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
    private static Overlay cur;
    private static final Handler ui = new Handler(Looper.getMainLooper());
    private static final Burst ends = new Burst();
    private static long holdUntil;
    private final WindowManager wm;
    private final WindowManager.LayoutParams lp;
    private final FrameLayout box;
    private final WebView web;
    private final Web.Client client;
    private final SharedPreferences cfg;
    private boolean giveWay;  // Provision's --ez yield, as it was when this page was made
    private boolean up;       // a take-over is on screen
    private boolean aside;    // ... and it is one in its corner: the app behind has the remote, except Back
    private long shownAt;     // when one last came on screen (uptime ms); 0: never

    /** another app is in front with the screen on: have the page loaded and waiting (main thread) */
    static void preload(AccessibilityService s) {
        if (s == null || cur != null || !allowed(s) || SystemClock.uptimeMillis() < holdUntil) return;
        try { cur = new Overlay(s, Cfg.of(s)); } catch (Exception e) { cur = null; Log.i(Web.TAG, "no take-over page: " + e); }
    }

    /** preload() in `ms`, if it still applies then. One wait at a time: a new one replaces the one before; close() drops it. */
    static void preloadIn(long ms) { ui.removeCallbacks(later); ui.postDelayed(later, ms); }
    private static final Runnable later = () -> preload(HomeGuard.it);

    /** Watcher: a watched state started a take-over (main thread). The loaded page shows it itself; this is the backup. */
    static void show(AccessibilityService s) {
        if (cur == null) { preload(s); return; }
        firedAt = SystemClock.uptimeMillis();
        ui.removeCallbacks(check); ui.postDelayed(check, SHOW_WAIT_MS);
    }
    private static long firedAt;
    // The page showed nothing around that start (it may have shown and finished already: that counts): it has lost its
    // connection, or it rightly ignores this one, which can't be told apart from here. Load it again, from its address
    // (not a reload: whatever the WebView holds by now, an error page included, the take-over page is what is wanted).
    private static final Runnable check = () -> {
        Overlay o = cur;
        if (o != null && !o.up && o.shownAt < firedAt - SHOW_WAIT_MS) o.load();
    };

    private static boolean allowed(Context s) {
        SharedPreferences cfg = Cfg.of(s);
        if (HomeActivity.resumed || !cfg.getBoolean("overlay", true) || Cfg.url(cfg).isEmpty()) return false;
        PowerManager pm = (PowerManager) s.getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isInteractive();   // the TV is off: no take-over
    }

    /** Android is short of memory (HomeGuard.onTrimMemory): a page with nothing on screen goes; Watcher loads one when needed. */
    static void trim() {
        Overlay o = cur;
        if (o == null || o.up) return;
        cur = null;
        o.end();
        Log.i(Web.TAG, "short of memory: the waiting take-over page is dropped");
    }

    static void close() {
        ui.removeCallbacks(later); ui.removeCallbacks(check);   // here, not in the post below: a wait started right after this call stays
        ui.post(() -> {
            Overlay o = cur; if (o == null) return;
            cur = null;
            o.end();
        });
    }

    private void end() {
        if (up) try { wm.removeView(box); } catch (Exception e) { /* gone */ }
        if (aside) HomeGuard.hearKeys(false);
        up = aside = false;
        Web.end(web);
    }

    private Overlay(AccessibilityService s, SharedPreferences cfg) {
        wm = (WindowManager) s.getSystemService(Context.WINDOW_SERVICE);
        web = Web.create(s, " DashTV-overlay");
        web.setBackgroundColor(Color.TRANSPARENT);
        client = new Web.Client(cfg) {
            @Override void started(String url, boolean ours) { up(false, false); }   // a page starting over has nothing on screen yet; it says 'shown' again if it has
            @Override void gone(WebView w, boolean crashed) {
                if (cur == Overlay.this) cur = null;
                end();
                if (ends.third(SystemClock.uptimeMillis())) holdUntil = SystemClock.uptimeMillis() + HOLD_MS;
            }
        };
        web.addJavascriptInterface(new Bridge(), "tvhost");
        web.addJavascriptInterface(new ExternalAuth(web, cfg, client), "externalApp");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(client);
        box = new FrameLayout(s) {
            @Override public boolean dispatchKeyEvent(KeyEvent e) {
                int k = e.getKeyCode();
                if (k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_ESCAPE) {
                    if (e.getAction() == KeyEvent.ACTION_UP) web.evaluateJavascript(BACK, null);
                    return true;
                }
                return super.dispatchKeyEvent(e);
            }
        };
        box.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        lp = new WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY, IN_SCREEN, PixelFormat.TRANSLUCENT);
        // no window yet: the page gets the screen's size to lay itself out in
        DisplayMetrics dm = s.getResources().getDisplayMetrics();
        box.measure(View.MeasureSpec.makeMeasureSpec(dm.widthPixels, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(dm.heightPixels, View.MeasureSpec.EXACTLY));
        box.layout(0, 0, dm.widthPixels, dm.heightPixels);
        this.cfg = cfg;
        load();
        // Giving way (Web.giveWay) only counts for a page Android takes to be out of sight, and a WebView that sits in
        // no window counts as in sight until it is paused. Paused, the page still hears Home Assistant and says
        // 'shown'; its drawing waits for the window.
        giveWay = cfg.getBoolean("yield", false);
        if (giveWay) web.onPause();
    }

    /** The dashboard's take-over page. */
    private void load() {
        String url = Cfg.url(cfg);
        if (url.isEmpty()) return;
        client.loading();
        web.loadUrl(url + (url.contains("?") ? "&" : "?") + "overlay=1");
    }

    /**
     * a take-over on screen: the window goes up and takes the remote, or (`side`: one in its corner) leaves the remote
     * with the app behind, all but Back; none: no window, the app behind has the remote
     */
    private void up(boolean on, boolean side) {
        side = on && side;
        if (cur != this || up == on && aside == side) return;
        lp.flags = side ? IN_SCREEN | LEAVE_REMOTE : IN_SCREEN;
        try {
            if (!on) wm.removeView(box); else if (!up) wm.addView(box, lp); else wm.updateViewLayout(box, lp);
        } catch (Exception e) { return; }
        boolean was = up;
        up = on;
        if (aside != side) { aside = side; HomeGuard.hearKeys(side); }
        if (giveWay && was != on) { if (on) web.onResume(); else web.onPause(); }
        if (on && !was) shownAt = SystemClock.uptimeMillis();
        if (on && !side) web.requestFocus();
    }

    /** HomeGuard, a key of the remote while a take-over sits in its corner: Back dismisses it; any other key is the app's (false) */
    static boolean key(KeyEvent e) {
        Overlay o = cur;
        int k = e.getKeyCode();
        if (o == null || !o.aside || k != KeyEvent.KEYCODE_BACK && k != KeyEvent.KEYCODE_ESCAPE) return false;
        if (e.getAction() == KeyEvent.ACTION_UP) o.web.evaluateJavascript(BACK, null);
        return true;
    }

    /** the overlay page's window.tvhost (engine core/tvhost.js: caps, overlay); answers only the dashboard's own page */
    class Bridge {
        @JavascriptInterface public String caps() { return client.ours() ? HomeActivity.caps(this, Web.version(web.getContext()), true) : "{}"; }
        @JavascriptInterface public void overlay(String state) {
            if (!client.ours()) return;
            if ("shown".equals(state)) ui.post(() -> up(true, false));
            else if ("aside".equals(state)) ui.post(() -> up(true, true));
            else if ("done".equals(state)) ui.post(() -> up(false, false));
        }
    }
}
