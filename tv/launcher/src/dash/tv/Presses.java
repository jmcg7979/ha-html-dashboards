package dash.tv;

/**
 * Home presses, as HomeGuard sees them: each time the stock home screen comes up, ours goes in front of it. One press
 * makes the stock screen say so more than once, so inside GAP_MS of a launch nothing more is launched at once; but a
 * second press inside that time must not be lost (Home pressed fast, five times: the last came 0.1 s after a launch and
 * the stock screen stayed up, 2026-11-17). So what comes too soon is looked at again when the gap is over, and ours is
 * launched then unless it has been in front since. Plain Java: runs on a plain JVM for test.sh. Times: any steady clock, ms.
 */
final class Presses {
    static final long GAP_MS = 400;
    private long last = -GAP_MS, skipped = -1;

    /** The stock home screen came up at `now`. 0: launch ours now. Above 0: look again (`again`) in that many ms. */
    long seen(long now) {
        if (now - last >= GAP_MS) { last = now; skipped = -1; return 0; }
        skipped = now;
        return GAP_MS - (now - last);
    }

    /** The look again, at `now`; `oursAt`: when our screen last came to the front. True: launch ours. */
    boolean again(long now, long oursAt) {
        boolean yes = skipped >= 0 && oursAt < skipped;   // the stock screen came up after ours was last in front
        skipped = -1;
        if (yes) last = now;
        return yes;
    }
}
