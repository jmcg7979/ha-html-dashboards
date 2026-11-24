package dash.tv;

import java.util.Locale;

/**
 * Where a page lives, for the questions the launcher asks about a URL: is this the configured dashboard's server (the
 * bridge answers, the token is given), is it the built-in page, is it still inside the dashboard's folder.
 * Plain string work on purpose: it must give the same answer for every URL a WebView can report (odd characters in a
 * query or fragment included), and it runs on a plain JVM for test.sh.
 */
final class Origin {
    private Origin() { }

    /** The built-in pages (assets/): the fallback home screen. */
    static final String BUILT_IN = "file:///android_asset/";

    /** scheme://host[:port] of an http(s) URL: lower case, without the scheme's own port, without a user name; else "". */
    static String of(String url) {
        if (url == null) return "";
        int i = url.indexOf("://");
        if (i <= 0) return "";
        String scheme = url.substring(0, i).toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) return "";
        String host = url.substring(i + 3, hostEnd(url, i + 3));
        host = host.substring(host.lastIndexOf('@') + 1).toLowerCase(Locale.ROOT);   // what stands before an @ is a user name, not the host: the server is what follows it
        String own = scheme.equals("http") ? ":80" : ":443";
        if (host.endsWith(own)) host = host.substring(0, host.length() - own.length());
        else if (host.endsWith(":")) host = host.substring(0, host.length() - 1);
        if (host.isEmpty()) return "";
        for (int k = 0; k < host.length(); k++) if (host.charAt(k) <= ' ') return "";
        return scheme + "://" + host;
    }

    /** Both are http(s) URLs on the same server. */
    static boolean same(String url, String other) {
        String o = of(url);
        return !o.isEmpty() && o.equals(of(other));
    }

    static boolean builtIn(String url) { return url != null && url.startsWith(BUILT_IN); }

    /** The path of an http(s) URL, "/" when it has none: /local/dash/start.html */
    static String path(String url) {
        if (of(url).isEmpty()) return "/";
        int a = hostEnd(url, url.indexOf("://") + 3), e = url.length();
        for (int k = a; k < url.length(); k++) { char ch = url.charAt(k); if (ch == '?' || ch == '#') { e = k; break; } }
        String p = url.substring(a, e).replace('\\', '/');
        return p.isEmpty() ? "/" : p;
    }

    /** The folder a URL's page sits in, with its closing slash: /local/dash/ */
    static String folder(String url) {
        String p = path(url);
        return p.substring(0, p.lastIndexOf('/') + 1);
    }

    /** `url` is a page on `home`'s server, inside the folder `home` is in (the dashboard itself, not another page there). */
    static boolean inFolder(String url, String home) { return same(url, home) && path(url).startsWith(folder(home)); }

    private static int hostEnd(String url, int from) {
        for (int k = from; k < url.length(); k++) {
            char ch = url.charAt(k);
            if (ch == '/' || ch == '?' || ch == '#' || ch == '\\') return k;
        }
        return url.length();
    }
}
