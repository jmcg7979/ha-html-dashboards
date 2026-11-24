package dash.tv;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

/**
 * Keeps the TV's Cast receiver from being the first thing Android ends when memory runs out (`--ez cast true`,
 * Provision; off by default). The part of it that listens for casts (the service below, in a process of its own) runs
 * as a plain started service, which Android counts among the cached processes: opening a big app on a 2 GB TV got it
 * killed, and it came back deaf (it answered, but reported nothing that played). A process counts as much as whoever
 * is bound to it, and this app counts as visible while HomeGuard is on: so this app binds that service, and asks
 * nothing of it. Android brings a bound service back by itself when its process does end.
 */
final class CastHold implements ServiceConnection {
    private static final ComponentName CAST = new ComponentName("com.google.android.apps.mediashell", "com.google.android.apps.mediashell.MediaShellCastReceiverService");
    private static final long AGAIN_MS = 30000;
    private static CastHold it;
    private final Context c;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean bound, ended;

    /** On or off as the settings say (HomeGuard when it connects or goes, Provision when the switch is sent). */
    static synchronized void apply(Context c) {
        boolean on = HomeGuard.it != null && Cfg.of(c).getBoolean("cast", false);
        if (on == (it != null)) return;
        if (on) { it = new CastHold(c.getApplicationContext()); it.bind(); } else { it.end(); it = null; }
    }

    private CastHold(Context c) { this.c = c; }

    private void bind() {
        if (ended) return;
        try {
            bound = c.bindService(new Intent().setComponent(CAST), this, Context.BIND_AUTO_CREATE);
            Log.i(Web.TAG, bound ? "the Cast receiver is held: it ranks with this app" : "the Cast receiver can't be held: this TV has no such service");
        } catch (Exception e) { bound = false; Log.i(Web.TAG, "the Cast receiver can't be held: " + e); }
        if (!bound) try { c.unbindService(this); } catch (Exception e) { /* nothing was bound */ }
    }

    private void end() {
        ended = true;
        ui.removeCallbacksAndMessages(null);
        if (bound) try { c.unbindService(this); } catch (Exception e) { /* gone already */ }
        bound = false;
    }

    @Override public void onServiceConnected(ComponentName n, IBinder b) { }
    @Override public void onNullBinding(ComponentName n) { }   // it hands out nothing to talk to: the hold is there all the same
    @Override public void onServiceDisconnected(ComponentName n) { Log.i(Web.TAG, "the Cast receiver's process ended while held; Android starts it again"); }
    /** The Cast app was updated or stopped by force: this hold is dead for good, a new one is made. */
    @Override public void onBindingDied(ComponentName n) {
        try { c.unbindService(this); } catch (Exception e) { /* gone already */ }
        bound = false;
        ui.postDelayed(this::bind, AGAIN_MS);
    }
}
