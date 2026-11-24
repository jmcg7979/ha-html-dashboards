package dash.tv;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The launcher's settings (Provision writes them): the dashboard's address and the Home Assistant token.
 * A token belongs to the server it was sent for: it is stored under that server's origin, and only a page on that
 * origin (ExternalAuth) and the launcher's own connection to it (Watcher) ever get it. Pointing the launcher at another
 * server (`--es url` alone, e.g. a test server) gives that server no token; the first one's is still there on the way back.
 */
final class Cfg {
    private Cfg() { }

    static SharedPreferences of(Context c) { return c.getSharedPreferences("cfg", Context.MODE_PRIVATE); }

    static String url(SharedPreferences cfg) { return cfg.getString("url", ""); }

    private static String key(String origin) { return "token@" + origin; }

    /** The token for the configured dashboard's server; "" when none was sent for it. */
    static synchronized String token(SharedPreferences cfg) {
        adopt(cfg);
        String o = Origin.of(url(cfg));
        return o.isEmpty() ? "" : cfg.getString(key(o), "");
    }

    /** Provision: a token sent together with (or after) an address belongs to that address's server. "" removes it. */
    static void setToken(SharedPreferences.Editor e, String url, String token) {
        String o = Origin.of(url);
        if (o.isEmpty()) return;
        if (token.isEmpty()) e.remove(key(o)); else e.putString(key(o), token);
    }

    /** A token stored without its server (by a build that kept one token for any address) becomes the configured server's. */
    static synchronized void adopt(SharedPreferences cfg) {
        String old = cfg.getString("token", null);
        if (old == null) return;
        SharedPreferences.Editor e = cfg.edit().remove("token");
        String o = Origin.of(url(cfg));
        if (!o.isEmpty() && !old.isEmpty() && !cfg.contains(key(o))) e.putString(key(o), old);
        e.commit();
    }
}
