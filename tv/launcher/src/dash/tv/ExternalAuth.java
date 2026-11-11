package dash.tv;

import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

/**
 * HA's external-auth protocol (what the HA Android app offers), as window.externalApp: getExternalAuth() is answered with
 * the token set by Provision, only while the page is on the configured HA origin (engine core/auth.js, step 2).
 * Used by the home screen's WebView and the overlay's (Overlay.java).
 */
final class ExternalAuth {
    private final WebView web;
    private final SharedPreferences cfg;
    private final Handler ui = new Handler(Looper.getMainLooper());

    ExternalAuth(WebView web, SharedPreferences cfg) { this.web = web; this.cfg = cfg; }

    /** scheme://host:port of a URL, or "" */
    static String origin(String url) {
        Uri u = Uri.parse(url);
        return u.getScheme() == null || u.getAuthority() == null ? "" : u.getScheme() + "://" + u.getAuthority();
    }

    @JavascriptInterface public void getExternalAuth(String msg) { answer(msg, true); }
    @JavascriptInterface public void revokeExternalAuth(String msg) { answer(msg, false); }

    private void answer(String msg, boolean give) {
        final String cb;
        try { cb = new JSONObject(msg).getString("callback").replaceAll("[^A-Za-z0-9_$]", ""); } catch (Exception e) { return; }
        ui.post(() -> {
            String here = web.getUrl(), o = origin(cfg.getString("url", "")), tok = cfg.getString("token", "");
            boolean ours = here != null && !o.isEmpty() && (here.equals(o) || here.startsWith(o + "/"));
            String js;
            if (!give) js = "window." + cb + " && window." + cb + "(true)";
            else if (ours && !tok.isEmpty())
                js = "window." + cb + " && window." + cb + "(true, {access_token: " + JSONObject.quote(tok) + ", expires_in: 86400})";
            else js = "window." + cb + " && window." + cb + "(false)";
            web.evaluateJavascript(js, null);
        });
    }
}
