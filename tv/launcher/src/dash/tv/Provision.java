package dash.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * Set-up over adb (README.md, Set up a TV). Only the adb shell can send this: the receiver requires DUMP.
 *   am broadcast -a dash.tv.PROVISION -n dash.tv/.Provision --es url <dashboard url> --es id <tv id> --es name <name> [--es token <HA token>] [--es ma_token <Music Assistant token>]
 * Extras that are left out keep their value; --ez clear true wipes everything first.
 * --ez guard false: HomeGuard stops bringing this screen up (the stock home screen shows), true: again.
 * --ez overlay false: no take-overs over a playing app (Overlay.java), true: again.
 * The tokens are kept in the app's private storage only.
 */
public class Provision extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        SharedPreferences.Editor e = c.getSharedPreferences("cfg", Context.MODE_PRIVATE).edit();
        if (i.getBooleanExtra("clear", false)) e.clear();
        for (String k : new String[] { "url", "id", "name", "token", "ma_token" }) {
            String v = i.getStringExtra(k);
            if (v != null) e.putString(k, v);
        }
        if (i.getBooleanExtra("probe", false)) { setResultData(HomeActivity.watchNext(c, 30)); return; }   // diagnostics: --ez probe true
        if (i.hasExtra("guard")) e.putBoolean("guard", i.getBooleanExtra("guard", true));
        if (i.hasExtra("overlay")) e.putBoolean("overlay", i.getBooleanExtra("overlay", true));
        e.commit();
        Watcher.restart();   // a new URL or token
        setResultData("ok");
        HomeActivity.reconfigured();
    }
}
