package dash.tv;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;

/**
 * Opens an installed app by its package from outside the TV: the link dashtv://launch/<package>, e.g. as the `activity` of
 * Home Assistant's remote.turn_on (Android TV Remote), which starts links on the TV. HA's own way with a bare package
 * name goes through the Play Store (market://launch?id=package), which stopped answering on Google TV (2026-11-13).
 * Shows nothing itself: it starts the app and is gone.
 */
public class Launch extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Uri u = getIntent() == null ? null : getIntent().getData();
        String pkg = u == null || u.getLastPathSegment() == null ? "" : u.getLastPathSegment();
        if (pkg.matches("[A-Za-z0-9_.]+")) {
            PackageManager pm = getPackageManager();
            Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
            if (i == null) i = pm.getLaunchIntentForPackage(pkg);
            if (i != null) try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception e) { /* gone meanwhile */ }
        }
        finish();
    }
}
