package dash.tv;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.AudioPlaybackConfiguration;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import java.util.List;

/**
 * No screensaver and no sleep while the TV plays sound: Google TV only counts presses of the remote, so music from a
 * player app that shows nothing, from a phone (Spotify, a cast) or behind our own screen ran into the screensaver and
 * then into sleep, still playing. Android tells any app which players are running (not whose they are): while one plays
 * media and sound really comes out, a screen wake lock is held. It keeps an awake TV awake; it never wakes one, and it
 * ends no screensaver that is already up. Video apps keep the screen on themselves; for them this changes nothing.
 * Started by HomeGuard, so it works whatever is in front. `--ez awake false` (Provision) turns it off.
 */
final class Awake {
    private static final long CHECK_MS = 20000;   // while a player runs: is sound still coming out?
    private static final long LET_GO_MS = 15000;  // a gap between two songs is not the end of the music
    private static Awake it;
    private final AudioManager am;
    private final PowerManager.WakeLock lock;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean media, going;   // a media player is running; the lock is about to be let go

    /** On or off as the settings say (HomeGuard when it connects, Provision when the switch is sent). */
    static synchronized void apply(Context c) {
        boolean on = HomeGuard.it != null && Cfg.of(c).getBoolean("awake", true);
        if (on == (it != null)) return;
        if (on) it = new Awake(c.getApplicationContext()); else { it.end(); it = null; }
    }

    // The screen wake lock is deprecated with no replacement a service can use (the others need a window in front).
    // ON_AFTER_RELEASE: the screensaver's wait starts when the music ends, not at the last press of the remote.
    @SuppressWarnings("deprecation")
    private Awake(Context c) {
        am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        lock = ((PowerManager) c.getSystemService(Context.POWER_SERVICE))
            .newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ON_AFTER_RELEASE, "dash.tv:music");
        lock.setReferenceCounted(false);
        am.registerAudioPlaybackCallback(heard, ui);
        heard.onPlaybackConfigChanged(am.getActivePlaybackConfigurations());
    }

    private void end() {
        am.unregisterAudioPlaybackCallback(heard);
        ui.removeCallbacksAndMessages(null);
        if (lock.isHeld()) lock.release();
    }

    private final AudioManager.AudioPlaybackCallback heard = new AudioManager.AudioPlaybackCallback() {
        @Override public void onPlaybackConfigChanged(List<AudioPlaybackConfiguration> running) {
            boolean m = false;
            for (AudioPlaybackConfiguration p : running) {
                int u = p.getAudioAttributes().getUsage();
                if (u == AudioAttributes.USAGE_MEDIA || u == AudioAttributes.USAGE_GAME || u == AudioAttributes.USAGE_UNKNOWN) m = true;
            }
            media = m;
            check.run();
        }
    };

    private final Runnable letGo = new Runnable() {
        @Override public void run() { going = false; if (lock.isHeld()) { lock.release(); Log.i(Web.TAG, "the sound has stopped: the screensaver may come again"); } }
    };

    /** A running player that is silent (paused inside, or still filling up) does not count: sound has to come out. */
    private final Runnable check = new Runnable() {
        @Override public void run() {
            ui.removeCallbacks(this);
            boolean on = media && am.isMusicActive();
            if (on) {
                ui.removeCallbacks(letGo); going = false;
                if (!lock.isHeld()) { lock.acquire(); Log.i(Web.TAG, "sound is playing: no screensaver meanwhile"); }
            } else if (lock.isHeld() && !going) { going = true; ui.postDelayed(letGo, LET_GO_MS); }
            if (media) ui.postDelayed(this, CHECK_MS);
        }
    };
}
