package dash.tv;

import java.util.HashMap;
import java.util.Map;

/**
 * What a link from the page may start (tvhost.open, and a tap on a link that isn't a web address). Only these shapes,
 * each rebuilt from its parts so nothing else a link carries (a component, extras, flags) reaches Android:
 *   market://details?id=<package>                                        the Play Store page of an app (the Apps card's "Get")
 *   dashtv://launch/<package>                                            an installed app (Launch.java's link)
 *   intent:#Intent;action=android.settings.SETTINGS;end                  Android's Settings
 *   intent://<host/path?query>#Intent;scheme=https;package=<package>;end a web address opened in one named app
 *                                                                        (a YouTube search from the Music page)
 * Anything else is REFUSED here; HomeActivity then still accepts a link that Android TV's Watch Next list holds, word for word.
 * Plain string work: it runs on a plain JVM for test.sh.
 */
final class Links {
    static final int REFUSED = 0, STORE = 1, APP = 2, SETTINGS = 3, WEB_IN_APP = 4;
    static final String SETTINGS_ACTION = "android.settings.SETTINGS", VIEW_ACTION = "android.intent.action.VIEW";
    private static final String STORE_PREFIX = "market://details?id=", APP_PREFIX = "dashtv://launch/";
    private static final String INTENT = "intent:", MARK = "#Intent;", END = ";end";

    final int kind;
    final String pkg;    // STORE, APP, WEB_IN_APP: the package
    final String data;   // STORE: the link itself; WEB_IN_APP: the web address

    private Links(int kind, String pkg, String data) { this.kind = kind; this.pkg = pkg; this.data = data; }

    private static final Links NO = new Links(REFUSED, "", "");

    /** A package name as Android writes them (no check that it is installed). */
    static boolean isPackage(String s) { return s != null && s.matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+"); }

    static Links of(String uri) {
        if (uri == null) return NO;
        if (uri.startsWith(STORE_PREFIX)) {
            String p = uri.substring(STORE_PREFIX.length());
            return isPackage(p) ? new Links(STORE, p, uri) : NO;
        }
        if (uri.startsWith(APP_PREFIX)) {
            String p = uri.substring(APP_PREFIX.length());
            return isPackage(p) ? new Links(APP, p, "") : NO;
        }
        int m = uri.indexOf(MARK);
        if (!uri.startsWith(INTENT) || m < 0 || !uri.endsWith(END) || uri.length() < m + MARK.length() + END.length() - 1) return NO;
        String head = uri.substring(INTENT.length(), m);
        String body = uri.substring(m + MARK.length() - 1, uri.length() - END.length());   // ";key=value;key=value" or ""
        Map<String, String> f = new HashMap<>();
        if (!body.isEmpty()) for (String part : body.substring(1).split(";", -1)) {
            int eq = part.indexOf('=');
            if (eq <= 0) return NO;
            String k = part.substring(0, eq);
            if (!k.equals("action") && !k.equals("scheme") && !k.equals("package")) return NO;   // a component, extras, flags, a selector...
            if (f.put(k, part.substring(eq + 1)) != null) return NO;
        }
        String action = f.get("action"), scheme = f.get("scheme"), pkg = f.get("package");
        if (head.isEmpty()) return SETTINGS_ACTION.equals(action) && scheme == null && pkg == null ? new Links(SETTINGS, "", "") : NO;
        if (!head.startsWith("//") || head.length() < 3 || !isPackage(pkg)) return NO;
        if (!"https".equals(scheme) && !"http".equals(scheme)) return NO;
        if (action != null && !action.equals(VIEW_ACTION)) return NO;
        String web = scheme + ":" + head;
        return Origin.of(web).isEmpty() ? NO : new Links(WEB_IN_APP, pkg, web);
    }
}
