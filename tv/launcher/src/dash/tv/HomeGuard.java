package dash.tv;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * Keeps our launcher in front of the stock one. Google TV won't let another app be the real Home (with the stock
 * launcher turned off it falls back to an empty system screen and keeps restarting it: README.md), so the stock
 * launcher stays installed and this service opens HomeActivity whenever the stock home screen comes to the front:
 * Home pressed, an app closed, start-up. Only the stock launcher's and the cast screen's window changes reach it (res/xml/home_guard.xml);
 * its other panels (inputs, profile, quick settings) are left alone.
 * Switched on over adb (README.md, Set up a TV); turning it off, or `--ez guard false` via Provision, gives the stock home back.
 * It also runs the take-overs over a playing app (Watcher.java follows HA, Overlay.java shows them; `--ez overlay false`
 * turns them off): an accessibility service is the one part of the app the TV keeps running while another app is in front.
 * And it keeps three small things going that need a part of the app that is always there (keepers).
 * The remote's keys come here only while a take-over sits in its corner over an app (hearKeys), and only Back is taken.
 */
public class HomeGuard extends AccessibilityService {
    private final Presses presses = new Presses();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable again = () -> { if (presses.again(SystemClock.elapsedRealtime(), HomeActivity.resumedAt)) home(); };

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence cls = e.getClassName(), pkg = e.getPackageName();
        if (pkg != null && pkg.toString().equals("com.google.android.apps.mediashell")) {   // a cast screen (e.g. Music Assistant's)
            if (cls != null && cls.toString().endsWith("CastWebContentsActivity")) { HomeActivity.castAt = System.currentTimeMillis(); HomeActivity.coverCast(this); }
            return;
        }
        if (cls == null || !cls.toString().endsWith(".HomeActivity") && !cls.toString().endsWith(".MainActivity")) {
            // a screen of the stock launcher this service doesn't know: one of its other screens, or its home screen under
            // a new name after an update of Google's, in which case ours no longer comes up; said once per name in a row
            if (cls != null && cls.toString().endsWith("Activity") && !cls.toString().equals(unknown)) { unknown = cls.toString(); Log.i(Web.TAG, "stock launcher screen left alone: " + unknown); }
            return;
        }
        // one launch per Home press; a press that comes too soon after one is answered when the gap is over (Presses.java)
        main.removeCallbacks(again);
        long wait = presses.seen(SystemClock.elapsedRealtime());
        if (wait == 0) home(); else main.postDelayed(again, wait);
    }
    private String unknown = "";

    /**
     * Our home screen in front of the stock one, unless that is switched off. No brake of our own for a screen that dies
     * as it starts: Android has one. After the app's second crash in a row it leaves this service off for half an hour,
     * then an hour (seen on a Google TV, 2026-11-14), and Google's home screen stays up meanwhile.
     */
    private void home() {
        if (!Cfg.of(this).getBoolean("guard", true)) return;
        startActivity(new Intent(this, HomeActivity.class).setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NO_ANIMATION));
    }

    /** Android is short of memory: a take-over page that is only waiting goes (the next take-over loads one), and the banners. */
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level != TRIM_MEMORY_RUNNING_CRITICAL && level < TRIM_MEMORY_BACKGROUND) return;
        Overlay.trim();
        HomeActivity.trim();
    }

    private static final long SCREEN_ON_PRELOAD_MS = 2000;
    private static final long BOOT_MS = 2 * 60000;   // the TV started less than this ago
    static HomeGuard it;   // the overlay window needs this service (Overlay.preload)
    private boolean listening;
    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (Intent.ACTION_SCREEN_OFF.equals(i.getAction())) Overlay.close();   // also drops a preload still waiting
            else Overlay.preloadIn(SCREEN_ON_PRELOAD_MS);   // on again over an app
        }
    };

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        it = this;
        Watcher.start(this, () -> Overlay.show(this), view -> HomeActivity.bringUp(this, view));
        keepers(this);
        // The TV has just started: the stock home screen may have come up before this service was connected, and then
        // nothing tells it so. Our screen is started once.
        if (SystemClock.elapsedRealtime() < BOOT_MS) home();
        if (listening) return;   // connected again without having been destroyed: the receiver is still there
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        registerReceiver(screen, f);
        listening = true;
    }

    /** What runs for as long as this service does, each with its own switch (Provision): no screensaver while sound plays
     *  (Awake), the Cast receiver held (CastHold), Wireless debugging kept on (AdbKeep). Off when this service is gone. */
    static void keepers(Context c) { Awake.apply(c); CastHold.apply(c); AdbKeep.apply(c); }

    @Override
    public void onDestroy() {
        if (it == this) { it = null; keepers(this); }
        main.removeCallbacks(again);
        try { unregisterReceiver(screen); } catch (Exception e) { /* not registered */ }
        listening = false;
        Watcher.stop();
        Overlay.close();
        super.onDestroy();
    }

    /**
     * The remote's keys pass through this service (on) or not at all (off). On only while a take-over sits in its
     * corner over an app (Overlay): its window leaves the remote with the app, and Back is taken here to dismiss it.
     */
    static void hearKeys(boolean on) {
        HomeGuard g = it;
        if (g == null) return;
        try {
            AccessibilityServiceInfo i = g.getServiceInfo();
            if (i == null) return;
            int f = AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;
            i.flags = on ? i.flags | f : i.flags & ~f;
            g.setServiceInfo(i);
        } catch (Exception e) { Log.i(Web.TAG, "the remote's keys " + (on ? "on" : "off") + ": " + e); }
    }

    @Override
    protected boolean onKeyEvent(KeyEvent e) { return Overlay.key(e); }

    @Override
    public void onInterrupt() { }
}
