package dash.tv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The TV's home screen. A full-screen WebView on the site's `tv` dashboard (HA /local/dash/start.html?d=tv&tv=<id>).
 * The page gets two bridges:
 *   window.tvhost      apps(), launch(pkg), open(uri), settings(), info(), watchNext(), watch(json)  (engine core/tvhost.js)
 *   window.externalApp getExternalAuth(): the HA app's auth protocol (ExternalAuth.java)
 * watch(json): the entity states that start a take-over; Watcher.java follows them while another app is in front and
 * Overlay.java shows the take-over over it.
 * App banners are served to the page at <origin>/__tv/banner/<package> (intercepted, never reaches HA).
 * When HA can't be reached the built-in page (assets/fallback.html) shows the installed apps and retries.
 * Keys: Back and Home (while already home) go to the page as `tv:back` / `tv:home` events; it never leaves itself.
 * OK held goes as `tv:hold` too (the key itself still reaches the page).
 */
public class HomeActivity extends Activity {
    static HomeActivity live;
    static volatile boolean resumed;   // in front: the page shows take-overs itself, no overlay (Overlay.java)
    private WebView web;
    private SharedPreferences cfg;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<String, byte[]> banners = new HashMap<>();
    private boolean onFallback;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        live = this;
        cfg = getSharedPreferences("cfg", MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + " DashTV/" + version());
        web.addJavascriptInterface(new Host(), "tvhost");
        web.addJavascriptInterface(new ExternalAuth(web, cfg), "externalApp");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new Client());
        setContentView(web);
        immersive();
        loadHome();
    }

    private String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    String url() { return cfg.getString("url", ""); }

    String origin() { return ExternalAuth.origin(url()); }

    /** The configured dashboard, or the built-in page when none is set yet. */
    void loadHome() {
        onFallback = false;
        if (url().isEmpty()) fallback("Not set up yet");
        else web.loadUrl(url());
    }

    void fallback(String why) {
        onFallback = true;
        web.loadUrl("file:///android_asset/fallback.html#" + Uri.encode(why));
        ui.removeCallbacks(retry);
        if (!url().isEmpty()) ui.postDelayed(retry, 20000);
    }

    /** While on the built-in page: every 20 s, back to the dashboard once HA answers. */
    private final Runnable retry = new Runnable() {
        @Override public void run() {
            if (!onFallback || url().isEmpty()) return;
            final String o = origin();
            new Thread(() -> {
                boolean up = false;
                try {
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(o + "/manifest.json").openConnection();
                    c.setConnectTimeout(5000); c.setReadTimeout(5000);
                    up = c.getResponseCode() < 500;
                    c.disconnect();
                } catch (Exception e) { /* still down */ }
                final boolean ok = up;
                ui.post(() -> { if (!onFallback) return; if (ok) loadHome(); else ui.postDelayed(retry, 20000); });
            }).start();
        }
    };

    /** Provision changed the settings: start again from the dashboard. */
    static void reconfigured() {
        HomeActivity a = live;
        if (a != null) a.ui.post(a::loadHome);
    }

    private void emit(String name) {
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('" + name + "'))", null);
    }
    private void emit(String name, String detail) {
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('" + name + "', {detail: " + JSONObject.quote(detail) + "}))", null);
    }

    // ---- over a cast screen (MA's Cast receiver): the page says which of its views covers it (tvhost.cover) ----
    static volatile String coverView = "";   // "" = leave cast screens alone
    static volatile long castAt;             // when a cast screen last came to the front (HomeGuard)
    /** A cast screen came to the front (or the page just asked to cover one that did): bring this screen up on that view. */
    static void coverCast(android.content.Context c) {
        String v = coverView;
        if (v.isEmpty() || resumed) return;
        c.startActivity(new Intent(c, HomeActivity.class).setAction("dash.tv.COVER").putExtra("view", v)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NO_ANIMATION));
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (Intent.ACTION_MAIN.equals(i.getAction())) emit("tv:home");   // Home pressed while home: the page goes to its start
        else if ("dash.tv.COVER".equals(i.getAction()) && i.getStringExtra("view") != null) emit("tv:view", i.getStringExtra("view"));
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        Overlay.close();   // Home pressed during a take-over: this page shows it now
        web.onResume();   // the page is visible again: cameras and timers resume (they stop while an app is in front)
        immersive();
        emit("tv:resume");
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        ui.postDelayed(() -> { if (!resumed) Overlay.preload(HomeGuard.it); }, 1500);   // an app in front: take-overs over it ready
        emit("tv:pause");
        web.onPause();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_ESCAPE) {
            if (e.getAction() == KeyEvent.ACTION_UP) emit("tv:back");
            return true;   // the home screen never closes itself
        }
        if ((k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER) && e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 1)
            emit("tv:hold");   // OK held (the WebView doesn't pass the repeat on): a dimmer goes into adjust (engine core/remote.js)
        return super.dispatchKeyEvent(e);
    }

    @Override
    protected void onDestroy() {
        if (live == this) live = null;
        web.destroy();
        super.onDestroy();
    }

    // ---- native helpers ----

    private List<ResolveInfo> leanbackApps() {
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
        return getPackageManager().queryIntentActivities(i, 0);
    }

    boolean launch(String pkg) {
        PackageManager pm = getPackageManager();
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        if (i == null) return false;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); return true; } catch (ActivityNotFoundException e) { return false; }
    }

    boolean open(String uri) {
        // intent:... and any URI with an #Intent;...;end fragment (Watch Next deep links, e.g. Netflix's https://...#Intent;component=...;end)
        Intent i = uri.startsWith("intent:") || uri.contains("#Intent;") ? parseIntent(uri) : new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
        if (i == null) return false;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); return true; } catch (ActivityNotFoundException e) { return false; }
    }

    private static Intent parseIntent(String uri) {
        try { return Intent.parseUri(uri, Intent.URI_INTENT_SCHEME); } catch (Exception e) { return null; }
    }

    /** Android TV's Watch Next list (what apps publish for "Continue watching"), newest first; JSON array. */
    static String watchNext(android.content.Context c, int max) {
        JSONArray a = new JSONArray();
        String[] cols = { "package_name", "title", "episode_title", "season_display_number", "episode_display_number", "poster_art_uri",
            "thumbnail_uri", "intent_uri", "watch_next_type", "last_engagement_time_utc_millis", "last_playback_position_millis", "duration_millis", "type" };
        try (android.database.Cursor cur = c.getContentResolver().query(Uri.parse("content://android.media.tv/watch_next_program"), cols, null, null,
                "last_engagement_time_utc_millis DESC")) {
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

    /** PNG of the app's TV banner (320x180 dp), else its icon, cached. */
    byte[] banner(String pkg) {
        synchronized (banners) {
            if (banners.containsKey(pkg)) return banners.get(pkg);
        }
        byte[] out = null;
        try {
            PackageManager pm = getPackageManager();
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
            out = bo.toByteArray();
        } catch (Exception e) { /* no such app: 404 */ }
        synchronized (banners) { banners.put(pkg, out); }
        return out;
    }

    // ---- the page's bridge: window.tvhost ----
    class Host {
        @JavascriptInterface public String info() {
            try {
                return new JSONObject().put("id", cfg.getString("id", "")).put("name", cfg.getString("name", ""))
                    .put("version", version()).put("url", url()).put("fallback", onFallback).toString();
            } catch (Exception e) { return "{}"; }
        }
        @JavascriptInterface public String apps() {
            JSONArray a = new JSONArray();
            PackageManager pm = getPackageManager();
            for (ResolveInfo r : leanbackApps()) {
                String pkg = r.activityInfo.packageName;
                if (pkg.equals(getPackageName())) continue;
                try { a.put(new JSONObject().put("pkg", pkg).put("label", String.valueOf(r.loadLabel(pm)))); } catch (Exception e) { /* skip */ }
            }
            return a.toString();
        }
        @JavascriptInterface public String watchNext() { return HomeActivity.watchNext(HomeActivity.this, 30); }
        @JavascriptInterface public boolean launch(String pkg) { return HomeActivity.this.launch(pkg); }
        @JavascriptInterface public boolean open(String uri) { return HomeActivity.this.open(uri); }
        @JavascriptInterface public void settings() { open("intent:#Intent;action=android.settings.SETTINGS;end"); }
        @JavascriptInterface public void watch(String json) {
            if (json == null || json.equals(cfg.getString("watch", ""))) return;
            cfg.edit().putString("watch", json).apply();
            Watcher.restart();
        }
        @JavascriptInterface public void home() { ui.post(HomeActivity.this::loadHome); }
        /** keepAwake(on): no screensaver while this screen is in front (the page: music playing on this TV). */
        @JavascriptInterface public void keepAwake(boolean on) {
            ui.post(() -> { if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); });
        }
        /** cover(view): while set, a cast screen coming to the front brings this screen up on that view; "" stops it. */
        @JavascriptInterface public void cover(String view) {
            coverView = view == null ? "" : view;
            if (!coverView.isEmpty() && System.currentTimeMillis() - castAt < 15000) ui.post(() -> coverCast(HomeActivity.this));   // it came up first
        }
        /** maToken(callback): the Music Assistant token (Provision ma_token) to window[callback], only on the configured HA origin. */
        @JavascriptInterface public void maToken(String callback) {
            final String cb = callback == null ? "" : callback.replaceAll("[^A-Za-z0-9_$]", "");
            if (cb.isEmpty()) return;
            ui.post(() -> {
                String here = web.getUrl(), o = origin(), tok = cfg.getString("ma_token", "");
                boolean ours = here != null && !o.isEmpty() && (here.equals(o) || here.startsWith(o + "/"));
                web.evaluateJavascript("window." + cb + " && window." + cb + "(" + (ours && !tok.isEmpty() ? JSONObject.quote(tok) : "null") + ")", null);
            });
        }
        @JavascriptInterface public void reload() { ui.post(() -> web.reload()); }
    }

    // ---- page loading ----
    class Client extends WebViewClient {
        /** A new page (a reload, a deploy, the fallback) starts clean: what the old page asked for no longer holds. */
        @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
            coverView = "";
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String s = u.getScheme() == null ? "" : u.getScheme();
            if (s.equals("http") || s.equals("https") || s.equals("file")) return false;
            open(u.toString());   // intent:, market:, app deep links
            return true;
        }

        @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            String p = r.getUrl().getPath();
            if (p == null || !p.startsWith("/__tv/banner/")) return null;
            byte[] png = banner(p.substring("/__tv/banner/".length()));
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "max-age=86400");
            h.put("Access-Control-Allow-Origin", "*");
            if (png == null) return new WebResourceResponse("image/png", null, 404, "Not found", h, new ByteArrayInputStream(new byte[0]));
            return new WebResourceResponse("image/png", null, 200, "OK", h, new ByteArrayInputStream(png));
        }

        @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r.isForMainFrame() && !onFallback) fallback("Home Assistant isn't answering");
        }

        @Override public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse e) {
            if (r.isForMainFrame() && !onFallback && e.getStatusCode() >= 500) fallback("Home Assistant isn't answering");
        }
    }
}
