package dash.tv;

import android.content.ContentResolver;
import android.content.Context;
import android.database.ContentObserver;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;

/**
 * Keeps Wireless debugging on (`--ez adb true`, Provision; off by default), so the machine that set this TV up still
 * reaches it over adb after a restart: Android switches Wireless debugging off at every start and whenever the Wi-Fi
 * drops. The computers paired with the TV stay paired; only they get in. Needs WRITE_SECURE_SETTINGS, granted once
 * over adb (README.md); without it one line in the log and nothing else.
 * Android lets it on by itself only on a Wi-Fi access point where "Always allow on this network" was once chosen. On
 * any other it asks on the TV's screen, and switches it off again unless someone there says Allow. So it is switched
 * on only with the Wi-Fi up, and at most twice per connection (the second time five minutes after the first): a TV on
 * an access point nobody allowed asks twice, then is left alone until its Wi-Fi connects again or it restarts.
 */
final class AdbKeep {
    private static final String KEY = "adb_wifi_enabled";
    private static final long UP_MS = 20000;        // after the Wi-Fi came up: Android's own look at it comes first
    private static final long HELD_MS = 60000;      // on for this long: the try held, and a drop after it is the Wi-Fi's
    private static final long SECOND_MS = 5 * 60000;
    private static final int TRIES = 2;
    private static AdbKeep it;
    private final ContentResolver cr;
    private final ConnectivityManager cm;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private long notBefore;   // elapsedRealtime the next try waits for
    private long triedAt;     // elapsedRealtime of the last try; 0: none on this connection that is still to be judged
    private int failed;       // tries on this connection that didn't hold
    private boolean denied;

    /** On or off as the settings say (HomeGuard when it connects or goes, Provision when the switch is sent). */
    static synchronized void apply(Context c) {
        boolean on = HomeGuard.it != null && Cfg.of(c).getBoolean("adb", false);
        if (on == (it != null)) return;
        if (on) it = new AdbKeep(c.getApplicationContext()); else { it.end(); it = null; }
    }

    private AdbKeep(Context c) {
        cr = c.getContentResolver();
        cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
        cr.registerContentObserver(Settings.Global.getUriFor(KEY), false, seen);
        cm.registerDefaultNetworkCallback(net, ui);   // says at once what the network is now, so this is also the first look
    }

    private void end() {
        cr.unregisterContentObserver(seen);
        try { cm.unregisterNetworkCallback(net); } catch (Exception e) { /* not registered */ }
        ui.removeCallbacksAndMessages(null);
    }

    private final ContentObserver seen = new ContentObserver(ui) {
        @Override public void onChange(boolean self) { later(2000); }
    };

    private final ConnectivityManager.NetworkCallback net = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network n) { failed = 0; triedAt = 0; notBefore = 0; later(UP_MS); }   // a new connection: perhaps an access point that is allowed
    };

    private void later(long ms) { ui.removeCallbacks(check); ui.postDelayed(check, ms); }

    private boolean wifi() {
        Network n = cm.getActiveNetwork();
        NetworkCapabilities nc = n == null ? null : cm.getNetworkCapabilities(n);
        return nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
    }

    private final Runnable check = new Runnable() {
        @Override public void run() {
            ui.removeCallbacks(this);
            if (denied || Settings.Global.getInt(cr, KEY, 0) == 1) return;   // on: the observer says when it goes off
            if (!wifi()) return;   // no Wi-Fi (or a cable, where there is no Wireless debugging): the network callback says when
            long now = SystemClock.elapsedRealtime();
            if (triedAt != 0) {   // the last try: did it hold?
                if (now - triedAt >= HELD_MS) failed = 0;
                else if (++failed < TRIES) notBefore = now + SECOND_MS;
                else Log.i(Web.TAG, "Wireless debugging doesn't stay on: this Wi-Fi access point isn't allowed (the TV asks; choose Always allow on this network). Left off until the Wi-Fi connects again");
                triedAt = 0;
            }
            if (failed >= TRIES) return;
            if (now < notBefore) { later(notBefore - now); return; }
            try {
                Settings.Global.putInt(cr, KEY, 1);
                Log.i(Web.TAG, "Wireless debugging was off: switched on");
            } catch (SecurityException e) {
                denied = true;
                Log.i(Web.TAG, "Wireless debugging can't be kept on: adb shell pm grant dash.tv android.permission.WRITE_SECURE_SETTINGS");
                return;
            }
            triedAt = now;
        }
    };
}
