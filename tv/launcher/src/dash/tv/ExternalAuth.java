package dash.tv;

import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

/**
 * HA's external-auth protocol (what the HA Android app offers), as window.externalApp: getExternalAuth() is answered with
 * the token Provision stored for the configured dashboard's server, and only while the page in the WebView is on that
 * server (engine core/auth.js, step 2). A page anywhere else, and a server no token was sent for, get "no".
 * Used by the home screen's WebView and the overlay's (Overlay.java).
 */
final class ExternalAuth {
    private final WebView web;
    private final SharedPreferences cfg;
    private final Web.Client page;
    private final Handler ui = new Handler(Looper.getMainLooper());

    ExternalAuth(WebView web, SharedPreferences cfg, Web.Client page) { this.web = web; this.cfg = cfg; this.page = page; }

    @JavascriptInterface public void getExternalAuth(String msg) { answer(msg, true); }
    @JavascriptInterface public void revokeExternalAuth(String msg) { answer(msg, false); }

    private void answer(String msg, boolean give) {
        final String cb;
        try { cb = new JSONObject(msg).getString("callback").replaceAll("[^A-Za-z0-9_$]", ""); } catch (Exception e) { return; }
        if (cb.isEmpty()) return;
        ui.post(() -> {
            if (!page.ours()) return;   // a page on another server: no answer at all, and no script run in it
            try {
                String tok = Cfg.token(cfg);
                boolean here = Origin.same(web.getUrl(), Cfg.url(cfg));
                String js;
                if (!give) js = "window." + cb + " && window." + cb + "(true)";
                else if (here && !tok.isEmpty())
                    js = "window." + cb + " && window." + cb + "(true, {access_token: " + JSONObject.quote(tok) + ", expires_in: 86400})";
                else js = "window." + cb + " && window." + cb + "(false)";
                web.evaluateJavascript(js, null);
            } catch (RuntimeException e) { /* the WebView is gone */ }
        });
    }
}
