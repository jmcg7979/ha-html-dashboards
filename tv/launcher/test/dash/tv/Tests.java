package dash.tv;

/**
 * Tests of the launcher's plain-Java parts (no Android class in them), run on this machine's JVM by ../../../test.sh:
 * Origin (whose page is this), Links (what a page may start), Watched (what starts a take-over), Burst (the brake),
 * Lines (the screensaver's weather line).
 */
public final class Tests {
    private static int run, failed;

    private static void eq(String what, Object want, Object got) {
        run++;
        if (want == null ? got == null : want.equals(got)) return;
        failed++;
        System.out.println("FAIL " + what + ": wanted " + want + ", got " + got);
    }

    public static void main(String[] a) {
        origin(); links(); watched(); burst(); lines(); presses();
        System.out.println("launcher tests: " + run + " checks, " + failed + " failed");
        if (failed > 0) System.exit(1);
    }

    private static void presses() {
        Presses p = new Presses();
        eq("the first press: ours now", 0L, p.seen(1000));
        eq("the stock screen says so again for the same press: wait out the gap", 300L, p.seen(1100));
        eq("ours came to the front after that: nothing more", false, p.again(1400, 1150));
        eq("a press well after: ours now", 0L, p.seen(5000));
        eq("another 0.1 s later (ours was in front at 5050): looked at again", 300L, p.seen(5100));
        eq("the stock screen came up after ours: ours again", true, p.again(5400, 5050));
        eq("and nothing is left over", false, p.again(5500, 5050));
        eq("a press right after that launch waits too", 100L, p.seen(5700));
        eq("ours never in front since: ours again", true, p.again(5800, 5050));
        eq("after the gap: at once", 0L, p.seen(6300));
    }

    private static void origin() {
        String ha = "http://192.0.2.10:8123/local/dash/start.html?d=tv&p=tv&tv=office";
        eq("origin", "http://192.0.2.10:8123", Origin.of(ha));
        eq("no path", "http://ha:8123", Origin.of("http://ha:8123"));
        eq("query right after the host", "http://ha:8123", Origin.of("http://ha:8123?x=1"));
        eq("case", "http://ha.local:8123", Origin.of("HTTP://HA.local:8123/x"));
        eq("the scheme's own port", "http://ha", Origin.of("http://ha:80/"));
        eq("https own port", "https://ha", Origin.of("https://ha:443/x"));
        eq("another port stays", "https://ha:80", Origin.of("https://ha:80/x"));
        eq("a user name is not the host", "http://evil.com", Origin.of("http://ha:8123" + "@evil.com/"));
        eq("a longer host is another host", "http://ha:8123.evil.com", Origin.of("http://ha:8123.evil.com/"));
        eq("backslash ends the host", "http://evil.com", Origin.of("http://evil.com\\@ha:8123/"));
        eq("odd characters after the host don't matter", "http://ha:8123", Origin.of("http://ha:8123/a?x={y}|z#^`"));
        eq("IPv6", "http://[fe80::1]:8123", Origin.of("http://[fe80::1]:8123/x"));
        for (String no : new String[] { null, "", "file:///android_asset/fallback.html", "about:blank", "intent://x#Intent;end", "http://", "http:///x", "javascript:1", "chrome-error://chromewebdata/", "://x" })
            eq("no origin: " + no, "", Origin.of(no));
        eq("same server", true, Origin.same("http://192.0.2.10:8123/auth/authorize?x", ha));
        eq("other port", false, Origin.same("http://192.0.2.10:8125/local/dash/start.html", ha));
        eq("other scheme", false, Origin.same("https://192.0.2.10:8123/", ha));
        eq("prefix host", false, Origin.same("http://192.0.2.10:8123.evil.com/", ha));
        eq("nothing is the same as nothing", false, Origin.same("", ""));
        eq("built in", true, Origin.builtIn("file:///android_asset/fallback.html#why"));
        eq("another file", false, Origin.builtIn("file:///sdcard/x.html"));
        eq("path", "/local/dash/start.html", Origin.path(ha));
        eq("path of a bare host", "/", Origin.path("http://ha:8123"));
        eq("folder", "/local/dash/", Origin.folder(ha));
        eq("the dashboard itself", true, Origin.inFolder("http://192.0.2.10:8123/local/dash/index.html?v=now#p", ha));
        eq("HA's sign-in page", false, Origin.inFolder("http://192.0.2.10:8123/auth/authorize?response_type=code", ha));
        eq("another server's same folder", false, Origin.inFolder("http://192.0.2.11:8123/local/dash/index.html", ha));
        eq("a dashboard at the root holds everything", true, Origin.inFolder("http://ha/x/y", "http://ha/"));
    }

    private static void kind(String what, int want, String uri) { eq(what, want, Links.of(uri).kind); }

    private static void links() {
        // what the pages send today
        Links store = Links.of("market://details?id=com.netflix.ninja");
        eq("store", Links.STORE, store.kind); eq("store pkg", "com.netflix.ninja", store.pkg); eq("store data", "market://details?id=com.netflix.ninja", store.data);
        Links app = Links.of("dashtv://launch/com.google.android.youtube.tv");
        eq("app", Links.APP, app.kind); eq("app pkg", "com.google.android.youtube.tv", app.pkg);
        kind("settings", Links.SETTINGS, "intent:#Intent;action=android.settings.SETTINGS;end");
        Links yt = Links.of("intent://www.youtube.com/results?search_query=blue%20in%20green#Intent;scheme=https;package=com.google.android.youtube.tv;end");
        eq("web in app", Links.WEB_IN_APP, yt.kind); eq("web pkg", "com.google.android.youtube.tv", yt.pkg);
        eq("web address", "https://www.youtube.com/results?search_query=blue%20in%20green", yt.data);
        kind("web in app, VIEW said", Links.WEB_IN_APP, "intent://x.com/a#Intent;action=android.intent.action.VIEW;scheme=http;package=a.b;end");
        // everything else
        kind("null", Links.REFUSED, null);
        kind("a plain web address", Links.REFUSED, "https://example.com/");
        kind("an app's own scheme", Links.REFUSED, "netflix://title/1");
        kind("a named activity", Links.REFUSED, "intent:#Intent;component=com.android.settings/.Settings;end");
        kind("a named activity with a web address", Links.REFUSED, "intent://x.com/#Intent;scheme=https;package=a.b;component=a.b/.Hidden;end");
        kind("extras", Links.REFUSED, "intent://x.com/#Intent;scheme=https;package=a.b;S.cmd=wipe;end");
        kind("flags", Links.REFUSED, "intent://x.com/#Intent;scheme=https;package=a.b;launchFlags=0x3;end");
        kind("a selector", Links.REFUSED, "intent://x.com/#Intent;scheme=https;package=a.b;SEL;component=c.d/.E;end");
        kind("another settings screen", Links.REFUSED, "intent:#Intent;action=android.settings.WIFI_SETTINGS;end");
        kind("another action", Links.REFUSED, "intent:#Intent;action=android.intent.action.FACTORY_RESET;end");
        kind("settings with a package", Links.REFUSED, "intent:#Intent;action=android.settings.SETTINGS;package=a.b;end");
        kind("a web address with no app named", Links.REFUSED, "intent://x.com/#Intent;scheme=https;end");
        kind("another scheme", Links.REFUSED, "intent://x/#Intent;scheme=file;package=a.b;end");
        kind("content scheme", Links.REFUSED, "intent://media/external#Intent;scheme=content;package=a.b;end");
        kind("the same key twice", Links.REFUSED, "intent://x.com/#Intent;scheme=https;scheme=file;package=a.b;end");
        kind("another action for a web address", Links.REFUSED, "intent://x.com/#Intent;action=android.intent.action.DELETE;scheme=https;package=a.b;end");
        kind("no end", Links.REFUSED, "intent:#Intent;action=android.settings.SETTINGS");
        kind("nothing in it", Links.REFUSED, "intent:#Intent;end");
        kind("no host", Links.REFUSED, "intent://#Intent;scheme=https;package=a.b;end");
        kind("store, not a package", Links.REFUSED, "market://details?id=a.b&referrer=x");
        kind("store search", Links.REFUSED, "market://search?q=x");
        kind("app, not a package", Links.REFUSED, "dashtv://launch/a.b/../c");
        kind("app, one word", Links.REFUSED, "dashtv://launch/settings");
        eq("package", true, Links.isPackage("com.wbd.stream")); eq("package with _ and digits", true, Links.isPackage("tv.emby_2.embyatv"));
        eq("not a package", false, Links.isPackage("com..x")); eq("not a package", false, Links.isPackage("a.b;c")); eq("null package", false, Links.isPackage(null));
    }

    private static void watched() {
        Watched w = new Watched();
        eq("a row is taken", true, w.add("input_boolean.timer", "on", ""));
        eq("no entity: left out", false, w.add("", "ALERT", ""));
        eq("null entity: left out", false, w.add(null, "on", null));
        eq("no state: left out", false, w.add("sensor.grid", "", ""));
        eq("a row with a view", true, w.add("media_player.tv", "playing", "now"));
        w.done();
        eq("the good rows are followed", 2, w.entities().size());
        eq("first states: already on starts nothing", null, w.heard("input_boolean.timer", "on", true));
        eq("first states: off", null, w.heard("media_player.tv", "idle", true));
        eq("still on", null, w.heard("input_boolean.timer", "on", false));
        eq("off", null, w.heard("input_boolean.timer", "off", false));
        eq("into its state: a take-over", "", w.heard("input_boolean.timer", "on", false));
        eq("into its state, with a view", "now", w.heard("media_player.tv", "playing", false));
        eq("case of the state doesn't matter", null, w.heard("media_player.tv", "PLAYING", false));
        eq("an entity not on the list", null, w.heard("light.x", "on", false));
        // the link dropped and came back: what changed meanwhile is in the new connection's first states
        w.heard("input_boolean.timer", "off", false);
        eq("turned on while the link was down", "", w.heard("input_boolean.timer", "on", true));
        eq("unchanged over the gap", null, w.heard("media_player.tv", "playing", true));
        // a long gap: nothing to compare with
        w.heard("input_boolean.timer", "off", false); w.forget();
        eq("after a long gap what is on starts nothing", null, w.heard("input_boolean.timer", "on", true));
        // a change for an entity never heard of before counts (HA sends changes only for what it listed first)
        Watched n = new Watched(); n.add("a.b", "on", ""); n.done();
        eq("a change with no state before it", "", n.heard("a.b", "on", false));
        // a new list keeps the states of the entities that stay
        w.heard("input_boolean.timer", "off", false);
        w.clear(); w.add("input_boolean.timer", "on", ""); w.add("sensor.new", "on", ""); w.done();
        eq("the view went with the old list", false, w.entities().contains("media_player.tv"));
        eq("kept entity, changed over the new list's start", "", w.heard("input_boolean.timer", "on", true));
        eq("new entity, already on", null, w.heard("sensor.new", "on", true));
        w.clear(); w.done();
        eq("an empty list", true, w.isEmpty());
        // a row with `has`: in its state only with that attribute set (a TV's MA player "plays" YouTube too, without a queue)
        Watched m = new Watched(); m.add("media_player.tv_ma", "playing", "now", "active_queue"); m.done();
        eq("the attribute a row asks for", "active_queue", m.needs("media_player.tv_ma"));
        eq("first states: idle, with its queue", null, m.heard("media_player.tv_ma", "idle", true, true));
        eq("playing another app's video: no queue", null, m.heard("media_player.tv_ma", "playing", false, false));
        eq("back to idle with its queue", null, m.heard("media_player.tv_ma", "idle", true, false));
        eq("its own music starts", "now", m.heard("media_player.tv_ma", "playing", null, false));
        eq("still playing", null, m.heard("media_player.tv_ma", "playing", null, false));
        eq("the queue goes while it plays (now the app's video)", null, m.heard("media_player.tv_ma", null, false, false));
        eq("the queue comes while it plays", "now", m.heard("media_player.tv_ma", null, true, false));
        eq("attributes only, nothing of ours", null, m.heard("media_player.tv_ma", null, null, false));
        Watched f = new Watched(); f.add("media_player.tv_ma", "playing", "now", "active_queue"); f.done();
        eq("attributes before any state", null, f.heard("media_player.tv_ma", null, true, false));
        eq("first states: a video already playing", null, f.heard("media_player.tv_ma", "playing", false, true));
        eq("music over the gap", "now", f.heard("media_player.tv_ma", "playing", true, true));
        // the list an older page left had no `has`: what was heard under it doesn't count for the new row
        Watched u = new Watched(); u.add("media_player.tv_ma", "playing", "now"); u.done();
        u.heard("media_player.tv_ma", "idle", true);
        u.clear(); u.add("media_player.tv_ma", "playing", "now", "active_queue"); u.done();
        eq("a row that gained `has`: music already playing starts nothing", null, u.heard("media_player.tv_ma", "playing", true, true));
        // `play`: the player app of a row
        Watched a = new Watched(); a.add("media_player.tv_app", "playing", "now", "active_queue", "com.example.player"); a.add("media_player.tv_ma", "playing", "now", "active_queue"); a.add("media_player.x", "playing", "now", "", "not a package!"); a.done();
        eq("the row's player app", "com.example.player", a.plays("media_player.tv_app"));
        eq("a row without one", null, a.plays("media_player.tv_ma"));
        eq("not a package name: left out", null, a.plays("media_player.x"));
        a.clear(); a.add("media_player.tv_app", "playing", "now", "active_queue"); a.done();
        eq("gone with the old list", null, a.plays("media_player.tv_app"));
    }

    private static void burst() {
        Burst b = new Burst();
        eq("first", false, b.third(1000)); eq("second", false, b.third(2000)); eq("third within a minute", true, b.third(30000));
        eq("fourth, still within a minute of the second", true, b.third(61000));
        Burst slow = new Burst();
        eq("1", false, slow.third(1000)); eq("2", false, slow.third(40000)); eq("the third is over a minute after the first", false, slow.third(62000));
        eq("but within a minute of the second and third", true, slow.third(90000));
        Burst rare = new Burst();
        eq("a", false, rare.third(1)); eq("b", false, rare.third(3600000)); eq("c", false, rare.third(7200000));
    }

    /** made-up states for Lines: "id" -> {state, key, value, key, value...} */
    private static Lines.Get states(java.util.Map<String, String[]> m) {
        return new Lines.Get() {
            @Override public String state(String id) { String[] e = m.get(id); return e == null ? null : e[0]; }
            @Override public String attr(String id, String key) {
                String[] e = m.get(id);
                for (int i = 1; e != null && i + 1 < e.length; i += 2) if (e[i].equals(key)) return e[i + 1];
                return null;
            }
        };
    }

    private static void lines() {
        java.util.Map<String, String> texts = java.util.Map.of("partlycloudy", "Partly cloudy");
        java.util.Map<String, String[]> m = new java.util.HashMap<>();
        m.put("weather.home", new String[] { "partlycloudy", "temperature", "71.6" });
        eq("weather", "72° · Partly cloudy", Lines.weather(states(m), "weather.home", texts));
        m.put("weather.home", new String[] { "unavailable" });
        eq("weather not reporting", "", Lines.weather(states(m), "weather.home", texts));
        m.put("weather.home", new String[] { "fog" });
        eq("weather without a temperature or words", "fog", Lines.weather(states(m), "weather.home", texts));

    }
}
