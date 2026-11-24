package dash.tv;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The TV's home screen. A full-screen WebView on the site's `tv` dashboard (HA /local/dash/start.html?d=tv&tv=<id>).
 * The page gets two bridges, which answer only a page on the dashboard's own server or a built-in one (Web.Client):
 *   window.tvhost      caps(), info(), apps(), watchNext(), launch(pkg), open(uri), settings(), watch(json), keepAwake(on),
 *                      show(view), cover(view), home()  (class Host below; engine core/tvhost.js)
 *   window.externalApp getExternalAuth(): the HA app's auth protocol (ExternalAuth.java)
 * watch(json): the entity states that start a take-over, or (with a view) bring this screen up; Watcher.java follows them
 * while another app or the screensaver is in front; Overlay.java shows a take-over over it.
 * App banners are served to the page at <origin>/__tv/banner/<package> (intercepted, never reaches HA).
 * When HA can't be reached, or its page doesn't come to run (window.DASH_UP), the built-in page (assets/fallback.html)
 * shows the installed apps and retries.
 * Keys: Back and Home go to the page as `tv:back` / `tv:home` events; it never leaves itself. On a page of the server
 * that isn't the dashboard (HA's sign-in page) Back goes back and Home loads the dashboard.
 * OK held goes as `tv:hold` too (the key itself still reaches the page).
 * The WebView can be absent: when its renderer is gone (Android takes it for memory behind another app, or it crashes)
 * the WebView is dropped, and a new one is made when this screen is next in front.
 */
public class HomeActivity extends Activity {
    /** What this build offers the page beyond the method names (tvhost.caps().api); a build without caps() counts as 0. */
    static final int API = 2;   // 2: the take-over window knows 'aside' (Overlay.java)
    private static final String COVER = "dash.tv.COVER";
    private static final long RETRY_MS = 20000;         // on the built-in page: look for HA this often
    private static final long HOLD_MS = 5 * 60000;      // after a page that keeps failing: this long on the built-in page
    static final long PRELOAD_MS = 15000;               // another app in front this long: the take-over page is loaded
    private static final long PARK_MS = 3000;           // out of sight this long: the WebView leaves the window
    private static final long WATCH_ASK_MS = 60000;     // a page that hasn't named its watch list by then has none
    private static final int VIEW_TRIES = 60;           // a view to show is offered this often, 0.5 s apart
    private static final long START_MS = 45000;         // a dashboard page that doesn't say it runs by then didn't start
    private static final long SAME_VIEW_MS = 3000;      // the same view asked for again this soon, in front: once is enough

    static HomeActivity live;
    static volatile long resumedAt;    // when this screen last came to the front (SystemClock.elapsedRealtime; HomeGuard's Presses)
    static volatile boolean resumed;   // in front: the page shows take-overs itself, no overlay (Overlay.java)
    private WebView web;               // null from a renderer's end until this screen is needed again
    private Client client;
    private FrameLayout box;
    private SharedPreferences cfg;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<String, Banner> banners = new HashMap<>();
    private final Burst ends = new Burst(), strays = new Burst();
    private boolean onFallback;
    private boolean ended;       // onDestroy has run
    private volatile boolean watchAsked;   // the page that is loaded has called watch()
    private Ear ear;             // the page's voice (tvhost.listen): Ear.java

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        live = this;
        cfg = Cfg.of(this);
        ear = new Ear(this, (d) -> { if (web != null && !ended) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('tv:hear',{detail:" + d + "}))", null); });
        IntentFilter pk = new IntentFilter(Intent.ACTION_PACKAGE_ADDED);
        pk.addAction(Intent.ACTION_PACKAGE_REMOVED); pk.addAction(Intent.ACTION_PACKAGE_REPLACED); pk.addAction(Intent.ACTION_PACKAGE_CHANGED);
        pk.addDataScheme("package");
        registerReceiver(packages, pk);
        WebView.setWebContentsDebuggingEnabled(cfg.getBoolean("debug", false));   // Provision --ez debug true
        box = new FrameLayout(this);
        box.setBackgroundColor(Color.BLACK);
        setContentView(box);
        build();
        immersive();
        loadHome();
        show(getIntent());
    }

    /** A new WebView with its bridges, in the window. */
    private void build() {
        WebView w = Web.create(this, " DashTV/" + version());
        w.setBackgroundColor(Color.BLACK);
        w.setFocusable(true);
        w.setFocusableInTouchMode(true);
        Client c = new Client();
        w.addJavascriptInterface(new Host(c), "tvhost");
        w.addJavascriptInterface(new ExternalAuth(w, cfg, c), "externalApp");
        w.setWebChromeClient(new WebChromeClient() {   // the page's errors in the TV's log: adb logcat -s DashTV
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                String t = m.message();
                if (t != null && m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.i(Web.TAG, t.length() > 400 ? t.substring(0, 400) : t);
                return false;
            }
        });
        w.setWebViewClient(c);
        box.addView(w, new FrameLayout.LayoutParams(-1, -1));
        web = w; client = c;
    }

    /** This screen is wanted and has no WebView (its renderer is gone): a new one, on the dashboard. */
    private void rebuild(boolean builtIn) {
        if (web != null || ended) return;
        try { build(); } catch (RuntimeException e) { Log.i(Web.TAG, "no WebView: " + e); return; }   // tried again the next time this screen is wanted
        if (started) web.requestFocus();
        if (builtIn) fallback("The dashboard keeps stopping", HOLD_MS); else loadHome();
    }

    /**
     * The page's renderer is gone. The WebView goes with it. In front, a new one is loaded at once; behind another app or
     * the screensaver, when this screen is next shown (until then the launcher holds no page at all). A page that dies
     * three times within a minute is not loaded a fourth time: the built-in page shows, and the dashboard is tried again
     * after five minutes (or with its Try again button). If the built-in page goes too, nothing is loaded until Home is pressed.
     */
    private void gone(WebView dead) {
        if (dead != web) { Web.end(dead); return; }
        boolean wasBuiltIn = onFallback, loop = ends.third(SystemClock.uptimeMillis());
        ui.removeCallbacks(retry); ui.removeCallbacks(watchCheck); ui.removeCallbacks(startCheck);
        web = null; client = null; onFallback = false;
        Web.end(dead);
        if (!started || (loop && wasBuiltIn)) return;
        ui.post(() -> rebuild(loop));
    }

    private String version() { return Web.version(this); }

    // The list of apps is read once and kept until an app is installed, updated, switched off or removed: the page asks
    // for it every time this screen comes back, and reading every app's name takes a while on a TV.
    private volatile String appsJson;
    private final BroadcastReceiver packages = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            appsJson = null;
            Uri u = i.getData();
            if (u != null) synchronized (banners) { banners.remove(u.getSchemeSpecificPart()); }
        }
    };

    /** Android is short of memory: what can be made again is let go (HomeGuard.onTrimMemory). */
    static void trim() {
        HomeActivity a = live;
        if (a != null) synchronized (a.banners) { a.banners.clear(); }
    }

    // Deprecated since Android 11, whose replacement (WindowInsetsController) doesn't exist on Android 9 and 10: kept.
    @SuppressWarnings("deprecation")
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    String url() { return Cfg.url(cfg); }

    String origin() { return Origin.of(url()); }

    /** The configured dashboard, or the built-in page when none is set yet. */
    void loadHome() {
        if (web == null) return;
        ui.removeCallbacks(retry);
        onFallback = false;
        if (url().isEmpty()) { fallback("Not set up yet", RETRY_MS); return; }
        client.loading();
        web.loadUrl(url());
    }

    /** The built-in page, with why; HA is looked for again after `first` ms, then every 20 s. */
    void fallback(String why, long first) {
        if (web == null) return;
        onFallback = true;
        client.loading();
        web.loadUrl(Origin.BUILT_IN + "fallback.html#" + Uri.encode(why));
        ui.removeCallbacks(retry);
        if (!url().isEmpty()) ui.postDelayed(retry, first);
    }

    /** While on the built-in page: back to the dashboard once HA answers. */
    private final Runnable retry = new Runnable() {
        @Override public void run() {
            if (!onFallback || url().isEmpty()) return;
            final String o = origin();
            new Thread(() -> {
                boolean up = false;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(o + "/manifest.json").openConnection();
                    c.setConnectTimeout(5000); c.setReadTimeout(5000);
                    up = c.getResponseCode() < 500;
                    c.disconnect();
                } catch (Exception e) { /* still down */ }
                final boolean ok = up;
                ui.post(() -> { if (!onFallback || ended) return; if (ok) loadHome(); else ui.postDelayed(retry, RETRY_MS); });
            }).start();
        }
    };

    /** Provision's --ez yield changed: the page that is loaded follows it (the take-over page is made anew anyway). */
    static void yielding(boolean on) {
        HomeActivity a = live;
        if (a != null) a.ui.post(() -> { if (a.web != null) Web.giveWay(a.web, on); });
    }

    /** Provision changed the address or the token: start again from the dashboard. */
    static void reconfigured() {
        HomeActivity a = live;
        if (a != null) a.ui.post(a::loadHome);
    }

    private void emit(String name) {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('" + name + "'))", null);
    }

    // ---- a view to show (the page's Now playing over a cast screen, or when music starts): `tv:view` to the page ----
    // The page may not be there to hear it: this screen was just created, or the page is still loading. So the view is
    // kept and offered until the page says it runs (window.DASH_UP, set by the engine once it listens), for 30 s.
    private String wanted = "", shown = "";
    private long shownAt;
    private int tries;
    private void show(Intent i) {
        String v = i != null && COVER.equals(i.getAction()) ? i.getStringExtra("view") : null;
        if (v == null || v.isEmpty()) return;
        // music starting asks twice (the page's tvhost.show, then the Watcher): the second must not pull back someone
        // who has moved on in between
        long now = SystemClock.uptimeMillis();
        boolean again = resumed && v.equals(shown) && now - shownAt < SAME_VIEW_MS;
        shown = v; shownAt = now;
        if (again) return;
        wanted = v; tries = VIEW_TRIES;
        ui.removeCallbacks(offer); offer.run();
    }
    private final Runnable offer = new Runnable() {
        @Override public void run() {
            final String v = wanted;
            if (v.isEmpty() || ended) return;
            if (tries-- <= 0) { wanted = ""; return; }
            if (web == null) { ui.postDelayed(this, 500); return; }
            web.evaluateJavascript("(function(v){if(!window.DASH_UP)return false;window.dispatchEvent(new CustomEvent('tv:view',{detail:v}));return true})("
                + JSONObject.quote(v) + ")", r -> {
                    if (!v.equals(wanted) || ended) return;   // another view was asked for meanwhile
                    if ("true".equals(r)) wanted = ""; else { ui.removeCallbacks(this); ui.postDelayed(this, 500); }
                });
        }
    };

    // ---- over a cast screen (MA's Cast receiver): the page says which of its views covers it (tvhost.cover) ----
    static volatile String coverView = "";   // "" = leave cast screens alone
    static volatile long castAt;             // when a cast screen came to the front (HomeGuard); 0 once this screen has been in front since
    /** A cast screen came to the front (or the page just asked to cover one that did): bring this screen up on that view. */
    static void coverCast(Context c) {
        String v = coverView;
        if (v.isEmpty() || resumed) return;
        c.startActivity(new Intent(c, HomeActivity.class).setAction(COVER).putExtra("view", v)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NO_ANIMATION));
    }

    /** This screen comes to the front on that view and the TV leaves its screensaver: music started on this TV through a
     *  player app that shows nothing itself (Sendspin; a cast screen did this just by coming up). From the page (tvhost.show)
     *  while it runs, and from Watcher while it doesn't (behind the screensaver or another app the page is stopped). */
    // The wake lock's two flags are deprecated with no replacement a service can use (the others need a window): they are
    // what ends a screensaver from here, with the TURN_SCREEN_ON app-op.
    @SuppressWarnings("deprecation")
    static void bringUp(Context c, String view) {
        try {
            PowerManager pm = (PowerManager) c.getSystemService(POWER_SERVICE);
            pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "dash.tv:show").acquire(3000);
        } catch (Exception e) { /* no wake lock: the activity start still ends most screensavers */ }
        c.startActivity(new Intent(c, HomeActivity.class).setAction(COVER).putExtra("view", view == null ? "" : view)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NO_ANIMATION));
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        rebuild(false);
        if (Intent.ACTION_MAIN.equals(i.getAction())) {   // Home pressed, or HomeGuard brought this screen up: the page goes to its start
            emit("tv:home");
            ifAway(this::loadHome);
        } else show(i);
    }

    /**
     * Runs `then` when the page in front is on the dashboard's server but is not the dashboard (HA's sign-in page, HA's
     * own pages): such a page doesn't hear tv:back / tv:home, and without this the remote had no way out of it.
     * Both must hold: the address is outside the dashboard's folder, and the page doesn't say it is the running dashboard.
     */
    private void ifAway(Runnable then) {
        if (web == null || onFallback) return;
        String here = web.getUrl();
        if (here == null || Origin.builtIn(here) || !Origin.same(here, url()) || Origin.inFolder(here, url())) return;
        web.evaluateJavascript("!!window.DASH_UP", r -> { if (!"true".equals(r) && !ended) then.run(); });
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true; resumedAt = SystemClock.elapsedRealtime(); castAt = 0;   // this screen is in front: no cast screen is
        Overlay.close();   // Home pressed during a take-over: this page shows it now (also drops a preload still waiting)
        rebuild(false);
        if (web != null) web.onResume();   // the page is visible again: cameras and timers resume (they stop while an app is in front)
        immersive();
        emit("tv:resume");
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        // An app in front: take-overs over it ready, once it has stayed in front for 15 s. Not at once: the overlay is a second
        // dashboard (~100 MB), and when a Music Assistant cast starts our Now playing covers it ~5 s later; a 2 GB TV that
        // loads the overlay in those seconds runs out of memory and Android kills the hidden Cast app. One wait at a time:
        // a new one replaces the one before, and coming back in front drops it (Overlay.close in onResume).
        // A take-over before then loads the page on demand (Watcher -> Overlay.show).
        Overlay.preloadIn(PRELOAD_MS);
        ear.stop(); ear.cool();   // no listening behind another app or the screensaver, and no recognizer kept
        if (web != null) web.onPause();
    }

    // Behind another app (or the screensaver) the WebView leaves the window. Only then does it give its graphics memory
    // back: attached, it keeps ~55 MB of GPU memory for as long as the app lives (measured on a 2 GB TV: 137 MB -> 59 MB
    // for this process behind an app). The page stays loaded; it is back in the window before this screen shows.
    private boolean started;
    private final Runnable park = () -> { if (!started && web != null && web.getParent() != null) box.removeView(web); };
    @Override protected void onStop() { super.onStop(); started = false; ui.postDelayed(park, PARK_MS); }
    @Override protected void onStart() {
        super.onStart(); started = true; ui.removeCallbacks(park);
        rebuild(false);
        if (web == null) return;
        if (web.getParent() == null) box.addView(web, new FrameLayout.LayoutParams(-1, -1));
        web.requestFocus();   // also a WebView made while this screen was out of sight (rebuild)
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_ESCAPE) {
            if (e.getAction() == KeyEvent.ACTION_UP) {
                emit("tv:back");
                ifAway(() -> { if (web != null && web.canGoBack()) web.goBack(); else loadHome(); });
            }
            return true;   // the home screen never closes itself
        }
        if ((k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER) && e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 1)
            emit("tv:hold");   // OK held (the WebView doesn't pass the repeat on): a dimmer goes into adjust (engine core/remote.js)
        return super.dispatchKeyEvent(e);
    }

    @Override
    protected void onDestroy() {
        ended = true;
        if (live == this) live = null;
        ear.stop(); ear.cool();
        ui.removeCallbacksAndMessages(null);   // the retry, the park, a view still offered: nothing may reach the WebView after this
        try { unregisterReceiver(packages); } catch (Exception e) { /* not registered */ }
        WebView w = web; web = null; client = null;
        Web.end(w);
        super.onDestroy();
    }

    // ---- native helpers ----

    private List<ResolveInfo> leanbackApps() {
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
        return getPackageManager().queryIntentActivities(i, 0);
    }

    boolean launch(String pkg) {
        if (!Links.isPackage(pkg)) return false;
        PackageManager pm = getPackageManager();
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        return i != null && start(i);
    }

    private boolean start(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); return true; } catch (ActivityNotFoundException | SecurityException e) { return false; }
    }

    /** Starts what a link from the page names, if it is one of the kinds a page may start (Links.java); false otherwise. */
    boolean open(String uri) {
        Links l = Links.of(uri);
        switch (l.kind) {
            case Links.APP: return launch(l.pkg);
            case Links.STORE: return start(new Intent(Intent.ACTION_VIEW, Uri.parse(l.data)));
            case Links.SETTINGS: return start(new Intent(Settings.ACTION_SETTINGS));
            case Links.WEB_IN_APP: return start(new Intent(Intent.ACTION_VIEW, Uri.parse(l.data)).setPackage(l.pkg));
            default:
                Intent i = watchNextIntent(uri);
                if (i != null) return start(i);
                Log.i(Web.TAG, "open: not a link a page may start");
                return false;
        }
    }

    private static final Uri WATCH_NEXT = Uri.parse("content://android.media.tv/watch_next_program");

    /**
     * The intent of a Continue watching item: `uri` must be, word for word, a link an app has published to Android TV's
     * Watch Next list (the page got it from watchNext() and hands it back). Such a link may name an activity (Netflix's
     * does), which is why it is taken from the list and from nowhere else. null: not on the list.
     */
    private Intent watchNextIntent(String uri) {
        if (uri == null || uri.isEmpty()) return null;
        boolean listed = false;
        try (Cursor cur = getContentResolver().query(WATCH_NEXT, new String[] { "intent_uri" }, null, null, null)) {
            while (cur != null && !listed && cur.moveToNext()) listed = uri.equals(cur.getString(0));
        } catch (Exception e) { return null; }
        if (!listed) return null;
        try {
            // intent:... and any URI with an #Intent;...;end part (e.g. https://...#Intent;component=...;end); else a plain deep link
            Intent i = uri.startsWith("intent:") || uri.contains("#Intent;") ? Intent.parseUri(uri, Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            i.setFlags(i.getFlags() & ~(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION));
            return i;
        } catch (Exception e) { return null; }
    }

    /** Android TV's Watch Next list (what apps publish for "Continue watching"), newest first; JSON array. */
    static String watchNext(Context c, int max) {
        JSONArray a = new JSONArray();
        String[] cols = { "package_name", "title", "episode_title", "season_display_number", "episode_display_number", "poster_art_uri",
            "thumbnail_uri", "intent_uri", "watch_next_type", "last_engagement_time_utc_millis", "last_playback_position_millis", "duration_millis", "type" };
        try (Cursor cur = c.getContentResolver().query(WATCH_NEXT, cols, null, null, "last_engagement_time_utc_millis DESC")) {
            if (cur == null) return "[]";
            while (cur.moveToNext() && a.length() < max) {
                JSONObject o = new JSONObject();
                for (int i = 0; i < cols.length; i++) if (!cur.isNull(i)) o.put(cols[i], cur.getString(i));
                a.put(o);
            }
        } catch (Exception e) {
            try { return new JSONArray().put(new JSONObject().put("error", String.valueOf(e))).toString(); } catch (Exception x) { return "[]"; }
        }
        return a.toString();
    }

    /** A drawn banner and the app version it was drawn from (the time the package was last installed or updated). */
    private static final class Banner {
        final long stamp; final byte[] png;
        Banner(long stamp, byte[] png) { this.stamp = stamp; this.png = png; }
    }

    /** PNG of the app's TV banner (320x180 dp), else its icon. Kept per app until that app is updated or removed; null: no such app. */
    byte[] banner(String pkg) {
        PackageManager pm = getPackageManager();
        long stamp;
        try { stamp = pm.getPackageInfo(pkg, 0).lastUpdateTime; }
        catch (Exception e) { synchronized (banners) { banners.remove(pkg); } return null; }   // not installed (it may be later: nothing is remembered)
        synchronized (banners) {
            Banner b = banners.get(pkg);
            if (b != null && b.stamp == stamp) return b.png;
        }
        try {
            Drawable d = null;
            Intent li = pm.getLeanbackLaunchIntentForPackage(pkg);
            if (li != null && li.getComponent() != null) d = pm.getActivityBanner(li.getComponent());
            if (d == null) { ApplicationInfo ai = pm.getApplicationInfo(pkg, 0); d = ai.loadBanner(pm); }
            boolean isBanner = d != null;
            if (d == null) d = pm.getApplicationIcon(pkg);
            int w = isBanner ? 320 : 192, h = isBanner ? 180 : 192;
            Bitmap bm = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bm);
            d.setBounds(0, 0, w, h);
            d.draw(c);
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            bm.compress(Bitmap.CompressFormat.PNG, 100, bo);
            byte[] out = bo.toByteArray();
            synchronized (banners) { banners.put(pkg, new Banner(stamp, out)); }
            return out;
        } catch (Exception e) { return null; }
    }

    /**
     * The dashboard's page answered but never came to run (a deploy that left it broken, a script that failed, a page
     * that hangs): it says so itself by not setting window.DASH_UP (engine app.js). Then the built-in page shows, with
     * the apps and Try again, and the dashboard is tried again in five minutes. Without this such a page was the TV's
     * home screen: black, with no way to an app.
     */
    private final Runnable startCheck = () -> {
        if (web == null || onFallback || ended) return;
        String here = web.getUrl();
        if (here == null || !Origin.inFolder(here, url())) return;
        web.evaluateJavascript("!!window.DASH_UP", r -> {
            if ("true".equals(r) || ended || onFallback || web == null) return;
            Log.i(Web.TAG, "the dashboard's page didn't start in " + START_MS / 1000 + " s");
            fallback("The dashboard didn't start", HOLD_MS);
        });
    };

    /** A page that hasn't called watch() a minute after it started watches nothing: the list a page before it left goes. */
    private final Runnable watchCheck = () -> {
        if (watchAsked || onFallback || cfg.getString("watch", "").isEmpty()) return;
        cfg.edit().remove("watch").apply();
        Watcher.restart();
    };

    // ---- the page's bridge: window.tvhost. Every method first asks whether the page may call it (Web.Client.ours). ----
    class Host {
        private final Web.Client page;
        Host(Web.Client page) { this.page = page; }

        /** What this launcher offers: { api, version, overlay: false, can: [every method here] }. A build without caps() is api 0. */
        @JavascriptInterface public String caps() {
            if (!page.ours()) return "{}";
            return HomeActivity.caps(this, version(), false);
        }
        @JavascriptInterface public String info() {
            if (!page.ours()) return "{}";
            try {
                return new JSONObject().put("id", cfg.getString("id", "")).put("name", cfg.getString("name", ""))
                    .put("version", version()).put("api", API).put("url", url()).put("fallback", onFallback).toString();
            } catch (Exception e) { return "{}"; }
        }
        @JavascriptInterface public String apps() {
            JSONArray a = new JSONArray();
            if (!page.ours()) return a.toString();
            String kept = appsJson;
            if (kept != null) return kept;
            PackageManager pm = getPackageManager();
            for (ResolveInfo r : leanbackApps()) {
                String pkg = r.activityInfo.packageName;
                if (pkg.equals(getPackageName())) continue;
                try { a.put(new JSONObject().put("pkg", pkg).put("label", String.valueOf(r.loadLabel(pm)))); } catch (Exception e) { /* skip */ }
            }
            appsJson = a.toString();
            return appsJson;
        }
        @JavascriptInterface public String watchNext() { return page.ours() ? HomeActivity.watchNext(HomeActivity.this, 30) : "[]"; }
        @JavascriptInterface public boolean launch(String pkg) { return page.ours() && HomeActivity.this.launch(pkg); }
        @JavascriptInterface public boolean open(String uri) { return page.ours() && HomeActivity.this.open(uri); }
        @JavascriptInterface public void settings() { if (page.ours()) start(new Intent(Settings.ACTION_SETTINGS)); }
        @JavascriptInterface public void watch(String json) {
            if (!page.ours() || json == null) return;
            watchAsked = true;
            if (json.equals(cfg.getString("watch", ""))) return;
            cfg.edit().putString("watch", json).apply();
            Watcher.restart();
        }
        /** saver(json): the weather entity the screensaver reads ({weather, conditions}: Saver.java, Lines.java). */
        @JavascriptInterface public void saver(String json) {
            if (!page.ours() || json == null || json.length() > 20000 || json.equals(cfg.getString("saver", ""))) return;
            cfg.edit().putString("saver", json).apply();
        }
        @JavascriptInterface public void home() { if (page.ours()) ui.post(HomeActivity.this::loadHome); }
        /** keepAwake(on): no screensaver while this screen is in front (the page: music playing on this TV). */
        @JavascriptInterface public void keepAwake(boolean on) {
            if (!page.ours()) return;
            ui.post(() -> { if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); });
        }
        /** show(view): this screen comes to the front on that view and the TV leaves its screensaver (bringUp). */
        @JavascriptInterface public void show(String view) { if (page.ours()) ui.post(() -> bringUp(HomeGuard.it != null ? HomeGuard.it : HomeActivity.this, view)); }
        /** canListen(): this TV can hear the page (a recognizer, and the microphone allowed: Ear.java). */
        @JavascriptInterface public boolean canListen() { return page.ours() && Ear.can(HomeActivity.this); }
        /** listen(): Android's speech recognizer starts; what it hears comes as `tv:hear` events (Ear.java). False: no voice here. */
        @JavascriptInterface public boolean listen() {
            if (!page.ours() || !Ear.can(HomeActivity.this)) return false;
            ui.post(() -> { if (!ended) ear.start(); });
            return true;
        }
        /** warmListen(on): keep the recognizer ready while the page's search is open (Ear.java), or let it go. */
        @JavascriptInterface public void warmListen(boolean on) { if (page.ours()) ui.post(() -> { if (ended) return; if (on) ear.warm(); else ear.cool(); }); }
        /** stopListening(): a listen still going ends, with no `done`. */
        @JavascriptInterface public void stopListening() { if (page.ours()) ui.post(ear::stop); }
        /** cover(view): while set, a cast screen coming to the front brings this screen up on that view; "" stops it. */
        @JavascriptInterface public void cover(String view) {
            if (!page.ours()) return;
            coverView = view == null ? "" : view;
            // A cast screen that came up first is covered now, however long ago it came: the page can be late (a TV woken for
            // the music reloads the page first, while the Cast app is already starting).
            if (!coverView.isEmpty() && castAt != 0) ui.post(() -> coverCast(HomeGuard.it != null ? HomeGuard.it : HomeActivity.this));
        }
    }

    /** The answer to tvhost.caps() for a bridge object: its @JavascriptInterface method names are read off the class itself. */
    static String caps(Object bridge, String version, boolean overlay) {
        try {
            JSONArray can = new JSONArray();
            for (Method m : bridge.getClass().getDeclaredMethods()) if (m.isAnnotationPresent(JavascriptInterface.class)) can.put(m.getName());
            return new JSONObject().put("api", API).put("version", version).put("overlay", overlay).put("can", can).toString();
        } catch (Exception e) { return "{}"; }
    }

    // ---- page loading ----
    class Client extends Web.Client {
        Client() { super(cfg); }

        /** A new page (a reload, a deploy, the fallback) starts clean: what the old page asked for no longer holds. */
        @Override void started(String url, boolean ours) {
            coverView = "";
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            watchAsked = false;
            ui.removeCallbacks(watchCheck);
            if (ours && !Origin.builtIn(url)) ui.postDelayed(watchCheck, WATCH_ASK_MS);
            ui.removeCallbacks(startCheck);
            if (ours && Origin.inFolder(url, url())) ui.postDelayed(startCheck, START_MS);
            if (!ours) ui.post(() -> elsewhere("The dashboard left its address"));   // a page of another server got in (not by a link: those aren't followed)
        }

        @Override void link(String uri) { open(uri); }   // intent:, market:, dashtv: (Links.java)

        @Override void refused(String url, boolean redirect) {
            // the configured address itself sends the TV elsewhere: nothing would load, and loading it again gives the same
            if (redirect) ui.post(() -> { if (!onFallback) fallback("The dashboard's address leads to another server", HOLD_MS); });
        }

        @Override void gone(WebView w, boolean crashed) { HomeActivity.this.gone(w); }

        @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String p = u.getPath();
            if (p == null || !p.startsWith("/__tv/banner/")) return null;
            // only at the dashboard's own address (and the one the built-in page uses before any is set)
            String o = Origin.of(u.toString());
            if (!o.equals(origin()) && !o.equals("http://tv.invalid")) return null;
            byte[] png = banner(p.substring("/__tv/banner/".length()));
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "max-age=86400");
            if (png == null) return new WebResourceResponse("image/png", null, 404, "Not found", h, new ByteArrayInputStream(new byte[0]));
            return new WebResourceResponse("image/png", null, 200, "OK", h, new ByteArrayInputStream(png));
        }

        @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r.isForMainFrame() && !onFallback) fallback("Home Assistant isn't answering", RETRY_MS);
        }

        @Override public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse e) {
            if (r.isForMainFrame() && !onFallback && e.getStatusCode() >= 500) fallback("Home Assistant isn't answering", RETRY_MS);
        }
    }

    /** The top page ended up off the dashboard's server: back to the dashboard; the third time in a minute, the built-in page. */
    private void elsewhere(String why) {
        if (web == null || ended) return;
        if (onFallback) return;
        if (strays.third(SystemClock.uptimeMillis())) fallback(why, HOLD_MS); else loadHome();
    }
}
