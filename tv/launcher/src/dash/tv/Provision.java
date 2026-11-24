package dash.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.webkit.WebView;

/**
 * Set-up over adb (README.md, Set up a TV). Only the adb shell can send this: the receiver requires DUMP.
 *   am broadcast -a dash.tv.PROVISION -n dash.tv/.Provision --es url <dashboard url> --es id <tv id> --es name <name> [--es token <HA token>]
 * Extras that are left out keep their value; --ez clear true wipes everything first.
 * --es token: the token for the server the launcher points at once this broadcast is applied (its --es url, else the
 * address already set). Each server keeps its own; a server no token was sent for gets none (Cfg.java). --es token '' removes it.
 * --ez guard false: HomeGuard stops bringing this screen up (the stock home screen shows), true: again.
 * --ez overlay false: no take-overs over a playing app (Overlay.java), true: again.
 * --ez yield true: a page that is out of sight may be taken by Android before other apps' services when memory runs
 * out (Web.giveWay); false (the default): it ranks as high as this app.
 * --ez awake false: the screensaver may come while sound plays (Awake.java); true (the default): not while it plays.
 * --ez cast true: the Cast receiver is held so Android doesn't end it first when memory runs out (CastHold.java).
 * --ez adb true: Wireless debugging is switched on again whenever it is off (AdbKeep.java; needs WRITE_SECURE_SETTINGS).
 * --ez debug true: the pages can be inspected over adb (Chrome DevTools protocol: README.md, Looking inside a
 * TV's page); false: off again.
 * --ez photos false: the screensaver shows no photos, only the clock and the weather (a guest TV); true (the
 * default): the house's photos.
 * --ez probe true: changes nothing; the answer is the TV's Watch Next list (diagnostics).
 * The pages are loaded again when the broadcast carries an address or a token (the same address again: a plain reload),
 * not for the switches.
 * The token is kept in the app's private storage only.
 */
public class Provision extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (i.getBooleanExtra("probe", false)) { setResultData(HomeActivity.watchNext(c, 30)); return; }
        SharedPreferences cfg = Cfg.of(c);
        Cfg.adopt(cfg);
        String urlWas = Cfg.url(cfg), tokenWas = Cfg.token(cfg);
        SharedPreferences.Editor e = cfg.edit();
        boolean clear = i.getBooleanExtra("clear", false);
        if (clear) e.clear();
        for (String k : new String[] { "url", "id", "name" }) {
            String v = i.getStringExtra(k);
            if (v != null) e.putString(k, v);
        }
        String url = i.getStringExtra("url") != null ? i.getStringExtra("url") : clear ? "" : urlWas;
        boolean homeless = i.getStringExtra("token") != null && Origin.of(url).isEmpty();   // a token for no server: not kept
        if (i.getStringExtra("token") != null) Cfg.setToken(e, url, i.getStringExtra("token"));
        if (i.hasExtra("guard")) e.putBoolean("guard", i.getBooleanExtra("guard", true));
        if (i.hasExtra("debug")) e.putBoolean("debug", i.getBooleanExtra("debug", false));
        if (i.hasExtra("overlay")) e.putBoolean("overlay", i.getBooleanExtra("overlay", true));
        if (i.hasExtra("yield")) e.putBoolean("yield", i.getBooleanExtra("yield", false));
        for (String k : new String[] { "awake", "cast", "adb", "photos" }) if (i.hasExtra(k)) e.putBoolean(k, i.getBooleanExtra(k, false));
        e.commit();
        HomeGuard.keepers(c);
        if (i.hasExtra("debug")) try { WebView.setWebContentsDebuggingEnabled(i.getBooleanExtra("debug", false)); } catch (Exception x) { /* no WebView yet: HomeActivity sets it */ }
        boolean sent = clear || i.hasExtra("url") || i.hasExtra("token");
        if (!Cfg.url(cfg).equals(urlWas) || !Cfg.token(cfg).equals(tokenWas)) Watcher.restart();
        if (i.hasExtra("yield")) HomeActivity.yielding(i.getBooleanExtra("yield", false));
        if (sent || i.hasExtra("yield") || !cfg.getBoolean("overlay", true)) Overlay.close();   // the take-over page too: the next one is loaded when needed
        if (sent) HomeActivity.reconfigured();
        if (sent || i.hasExtra("yield")) Overlay.preloadIn(HomeActivity.PRELOAD_MS);   // (the preload only happens if an app is in front then)
        setResultData(homeless ? "no address set: send --es url with the token" : "ok");
    }
}
