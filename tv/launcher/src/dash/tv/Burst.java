package dash.tv;

/**
 * "Three times within a minute": the brake on anything the launcher does again after a failure (a page whose renderer
 * died is loaded again; a page that left the dashboard's server is sent back). Plain Java: runs on a plain JVM for test.sh.
 */
final class Burst {
    static final long WINDOW_MS = 60000;
    private long a, b;   // the two times before this one (0: none yet)

    /** Notes one more at `now` (any steady clock, ms, above 0). True when it is the third inside the window. */
    boolean third(long now) {
        boolean yes = a != 0 && now - a < WINDOW_MS;
        a = b; b = now;
        return yes;
    }
}
