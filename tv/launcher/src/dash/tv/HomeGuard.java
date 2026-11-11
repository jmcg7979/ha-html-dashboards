package dash.tv;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
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
 */
public class HomeGuard extends AccessibilityService {
    private long last;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence cls = e.getClassName(), pkg = e.getPackageName();
        if (pkg != null && pkg.toString().equals("com.google.android.apps.mediashell")) {   // a cast screen (e.g. Music Assistant's)
            if (cls != null && cls.toString().endsWith("CastWebContentsActivity")) { HomeActivity.castAt = System.currentTimeMillis(); HomeActivity.coverCast(this); }
            return;
        }
        if (cls == null || !cls.toString().endsWith(".HomeActivity") && !cls.toString().endsWith(".MainActivity")) return;
        if (!getSharedPreferences("cfg", MODE_PRIVATE).getBoolean("guard", true)) return;
        long now = System.currentTimeMillis();
        if (now - last < 400) return;   // one launch per Home press
        last = now;
        Intent i = new Intent(this, HomeActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        startActivity(i);
    }

    static HomeGuard it;   // the overlay window needs this service (HomeActivity: Overlay.preload)
    private final android.content.BroadcastReceiver screen = new android.content.BroadcastReceiver() {
        @Override public void onReceive(android.content.Context c, Intent i) {
            if (Intent.ACTION_SCREEN_OFF.equals(i.getAction())) Overlay.close();
            else new android.os.Handler(getMainLooper()).postDelayed(() -> Overlay.preload(HomeGuard.this), 2000);   // on again over an app
        }
    };

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        it = this;
        Watcher.start(this, () -> Overlay.show(this));
        android.content.IntentFilter f = new android.content.IntentFilter(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        registerReceiver(screen, f);
    }

    @Override
    public void onDestroy() {
        if (it == this) it = null;
        try { unregisterReceiver(screen); } catch (Exception e) { /* not registered */ }
        Watcher.stop();
        Overlay.close();
        super.onDestroy();
    }

    @Override
    public void onInterrupt() { }
}
