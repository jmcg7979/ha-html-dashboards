package dash.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * What the launcher's two WebViews share (the home screen's in HomeActivity, the take-over window's in Overlay): how
 * one is made, and the rules every page in one lives by (Client).
 */
final class Web {
    private Web() { }
    static final String TAG = "DashTV";   // adb logcat -s DashTV

    /** A WebView set up for a dashboard page; `ua` is added to its user agent. */
    static WebView create(Context c, String ua) {
        WebView w = new WebView(c);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + ua);
        giveWay(w, Cfg.of(c).getBoolean("yield", false));
        return w;
    }

    /**
     * Who goes first when the TV runs out of memory. Android ranks the process that runs a WebView's page as high as
     * the app itself, and this app ranks high (the TV keeps its accessibility service running), so with two pages out
     * of sight behind a film Android takes other things first, the Cast receiver among them. With `on` a page that is
     * not on screen gives that rank up: Android may take it first, and it is loaded again when it is next needed
     * (Client.gone). Off unless Provision's --ez yield true says so.
     */
    static void giveWay(WebView w, boolean on) {
        w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, on);
    }

    /** This build's name (build.sh: date, commit), as in the user agent and tvhost.caps(). */
    static String version(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    /** Takes a WebView out of whatever holds it and ends it. A WebView whose renderer is gone must not be used again. */
    static void end(WebView w) {
        if (w == null) return;
        try {
            if (w.getParent() instanceof ViewGroup) ((ViewGroup) w.getParent()).removeView(w);
            w.destroy();
        } catch (RuntimeException e) { Log.i(TAG, "ending a page: " + e); }
    }

    /**
     * The rules of a page:
     * - Its bridges (window.tvhost, window.externalApp) answer only while the page in the WebView is `ours`: on the
     *   configured dashboard's server, or built in. addJavascriptInterface hands the objects to every page and every
     *   frame, with no word on who is calling, so each bridge method asks ours() first. It is true from the start and
     *   through every load the launcher starts itself; a page that turns out to be on another server switches it off
     *   as it starts. What that leaves open: a frame inside the dashboard (it calls as the dashboard), and the moment
     *   between the launcher starting a load and that page arriving (the page still there counts as the new one).
     * - The top page stays on the dashboard's server: a link or a redirect to another one is not followed
     *   (refused()); a link that isn't a web address goes to link(). Frames load what they like but start nothing.
     * - A renderer that is gone (Android took it for its memory, or it crashed) does not take the app with it: gone().
     */
    abstract static class Client extends WebViewClient {
        private final SharedPreferences cfg;
        private volatile boolean ours = true;

        Client(SharedPreferences cfg) { this.cfg = cfg; }

        final boolean ours() { return ours; }
        /** The launcher itself is about to load its dashboard or a built-in page. */
        final void loading() { ours = true; }

        /** A new page has started; `ours` as above. */
        abstract void started(String url, boolean ours);
        /** A tap on a link that isn't a web address (intent:, market:, an app's own scheme). */
        void link(String uri) { }
        /** The top page was sent to another server and did not go; `redirect`: by the server, not by a tap. */
        void refused(String url, boolean redirect) { }
        /** The renderer is gone and `w` with it: forget `w` (Web.end), make a new one when the page is next needed. */
        abstract void gone(WebView w, boolean crashed);

        @Override public final void onPageStarted(WebView v, String url, Bitmap icon) {
            if (Origin.builtIn(url)) ours = true;
            else if (!Origin.of(url).isEmpty()) ours = Origin.same(url, Cfg.url(cfg));
            // anything else (the WebView's own error page, about:blank) is no page of anyone's: as it was
            started(url, ours);
        }

        @Override public final boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String url = u.toString(), s = u.getScheme() == null ? "" : u.getScheme();
            if (!r.isForMainFrame()) return !s.equals("http") && !s.equals("https");
            if (s.equals("http") || s.equals("https")) {
                if (Origin.same(url, Cfg.url(cfg))) return false;
                Log.i(TAG, "not followed, another server: " + Origin.of(url));
                refused(url, r.isRedirect());
                return true;
            }
            if (!Origin.builtIn(url)) link(url);
            return !Origin.builtIn(url);
        }

        @Override public final boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
            boolean crashed = d != null && d.didCrash();
            Log.i(TAG, "a page's renderer " + (crashed ? "crashed" : "was taken by Android"));
            gone(v, crashed);
            return true;   // handled: without this the whole app goes down with the renderer
        }
    }
}
