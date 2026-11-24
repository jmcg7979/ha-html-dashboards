package dash.tv;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.view.KeyEvent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Iterator;
import java.util.function.Consumer;

import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Follows the entity states the page asks for (HomeActivity's tvhost.watch: [{entity, state, view?, has?, play?}]; `has`: an
 * attribute the entity must have set to count as in its state; `play`: the package of the player app that plays this
 * entity's music on this TV, handTo below) over one HA WebSocket
 * (subscribe_entities with just those entities; the token sent for the dashboard's server). When one changes INTO its
 * state (Watched.java; a change made while the link was down for up to five minutes counts), on the main thread:
 * fire() (HomeGuard: Overlay.show, a take-over), or for an entry with a `view`, show(view) (HomeGuard: the home screen comes
 * up on that view, out of the screensaver: music started on this TV). Started by HomeGuard, so it lives as long as the TV's
 * accessibility service does. Reconnects after 10 s, later each time while it fails; a WebSocket client of its own (Android has none built in).
 * What stops it (a row of the list it can't use, a link that fails) is one line in the TV's log: adb logcat -s DashTV.
 */
final class Watcher implements Runnable {
    private static Watcher it;
    private final Context c;
    private final Runnable fire;
    private final Consumer<String> show;
    private final Watched list = new Watched();
    private static final long STALE_MS = 5 * 60000;   // states older than this are not compared with: a long gap starts nothing
    private long heardAt;                             // when HA was last heard (elapsedRealtime: standby counts); 0: never
    private long retryMs = 10000;                     // the wait before the next try
    private String said = "";                         // the last line logged, so a failure that repeats is logged once
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final SecureRandom rnd = new SecureRandom();
    private volatile Socket sock;
    private volatile boolean stopped;
    private Thread th;
    private OutputStream out;

    private Watcher(Context c, Runnable fire, Consumer<String> show) { this.c = c; this.fire = fire; this.show = show; }

    static synchronized void start(Context c, Runnable fire, Consumer<String> show) {
        stop();
        it = new Watcher(c.getApplicationContext(), fire, show);
        it.th = new Thread(it, "watcher");
        it.th.setDaemon(true);
        it.th.start();
    }

    static synchronized void stop() {
        if (it == null) return;
        it.stopped = true;
        it.drop();
        it = null;
    }

    /** the list, URL or token changed: start a new session */
    static synchronized void restart() { if (it != null) it.drop(); }

    private void drop() {   // ends the session (or the wait between sessions); run() starts the next one
        Socket s = sock; if (s != null) try { s.close(); } catch (IOException e) { /* closed */ }
        if (th != null) th.interrupt();
    }

    @Override public void run() {
        while (!stopped) {
            boolean again = false;
            try { session(); } catch (InterruptedException e) { again = true; }   // restarted: at once
            catch (Exception e) { again = Thread.interrupted(); if (!again && !stopped) say("watcher: " + e); }
            if (stopped) break;
            // HA down or the TV half asleep: the next try comes later each time (10 s, 20 s, 40 s, then every minute),
            // a little apart from the other TVs' tries; an answer from HA starts the count again
            if (!again) try { Thread.sleep(retryMs + rnd.nextInt(2000)); retryMs = Math.min(retryMs * 2, 60000); } catch (InterruptedException e) { /* restarted */ }
        }
    }

    /** One line in the TV's log, once per run of the same line. Never anything that holds the token. */
    private void say(String line) {
        String t = line.length() > 200 ? line.substring(0, 200) : line;
        if (t.equals(said)) return;
        said = t;
        Log.i(Web.TAG, t);
    }

    /** The page's list from the settings into `list`. A row without an entity or a state is left out; the others are followed. */
    private void readList(SharedPreferences cfg) {
        list.clear();
        int bad = 0;
        try {
            JSONArray rows = new JSONArray(cfg.getString("watch", "[]"));
            for (int i = 0; i < rows.length(); i++) {
                JSONObject o = rows.optJSONObject(i);
                if (o == null || !list.add(text(o, "entity"), text(o, "state"), text(o, "view"), text(o, "has"), text(o, "play"))) bad++;
            }
        } catch (Exception e) { say("watcher: the watch list can't be read: " + e); }
        list.done();
        if (bad > 0) say("watcher: " + bad + " row(s) of the watch list have no entity or no state and are left out");
    }

    private static String text(JSONObject o, String key) { return o.isNull(key) ? "" : o.optString(key); }

    private void session() throws Exception {
        SharedPreferences cfg = Cfg.of(c);
        String url = Cfg.url(cfg), tok = Cfg.token(cfg);
        readList(cfg);
        if (url.isEmpty() || tok.isEmpty() || list.isEmpty()) { Thread.sleep(50000); return; }

        Uri u = Uri.parse(url);
        boolean tls = "https".equals(u.getScheme());
        int port = u.getPort() > 0 ? u.getPort() : tls ? 443 : 80;
        Socket s = tls ? SSLSocketFactory.getDefault().createSocket() : new Socket();
        sock = s;
        try {
            if (s instanceof SSLSocket) {   // a bare TLS socket checks the certificate but not whose it is: ask for that too
                SSLParameters p = ((SSLSocket) s).getSSLParameters();
                p.setEndpointIdentificationAlgorithm("HTTPS");
                ((SSLSocket) s).setSSLParameters(p);
            }
            s.connect(new InetSocketAddress(u.getHost(), port), 10000);
            s.setSoTimeout(30000);
            out = s.getOutputStream();
            DataInputStream in = new DataInputStream(s.getInputStream());
            byte[] key = new byte[16]; rnd.nextBytes(key);
            out.write(("GET /api/websocket HTTP/1.1\r\nHost: " + u.getHost() + ":" + port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + Base64.encodeToString(key, Base64.NO_WRAP) + "\r\nSec-WebSocket-Version: 13\r\n\r\n")
                .getBytes(StandardCharsets.US_ASCII));
            out.flush();
            String status = line(in);
            if (!status.contains(" 101")) throw new IOException("no upgrade: " + status);
            while (!line(in).isEmpty()) { /* headers */ }

            if (heardAt != 0 && SystemClock.elapsedRealtime() - heardAt > STALE_MS) list.forget();
            int quiet = 0, id = 1;
            while (!stopped) {
                String msg;
                try { msg = read(in); quiet = 0; heardAt = SystemClock.elapsedRealtime(); }
                catch (SocketTimeoutException e) {   // 30 s without a word: ping; twice in a row: the link is dead
                    if (++quiet > 1) throw e;
                    send("{\"id\":" + (++id) + ",\"type\":\"ping\"}");
                    continue;
                }
                JSONObject m = new JSONObject(msg);
                String type = m.optString("type");
                if (type.equals("auth_required")) send(new JSONObject().put("type", "auth").put("access_token", tok).toString());
                else if (type.equals("auth_invalid")) { say("watcher: Home Assistant refuses the token"); Thread.sleep(300000); return; }   // a wrong token: don't hammer HA
                else if (type.equals("auth_ok")) { said = ""; retryMs = 10000; send(new JSONObject().put("id", 1).put("type", "subscribe_entities").put("entity_ids", new JSONArray(list.entities())).toString()); }
                else if (type.equals("event") && m.optInt("id") == 1) {
                    JSONObject ev = m.getJSONObject("event"), a = ev.optJSONObject("a"), ch = ev.optJSONObject("c");
                    // first states: nothing starts for what is already on, unless it was off when the link was last up
                    if (a != null) for (Iterator<String> k = a.keys(); k.hasNext(); ) {
                        String e = k.next(), need = list.needs(e);
                        JSONObject o = a.getJSONObject(e), at = o.optJSONObject("a");
                        act(e, list.heard(e, o.optString("s"), need == null ? null : (Boolean) (at != null && !at.isNull(need)), true));
                    }
                    if (ch != null) for (Iterator<String> k = ch.keys(); k.hasNext(); ) {
                        String e = k.next();
                        JSONObject plus = ch.getJSONObject(e).optJSONObject("+"), minus = ch.getJSONObject(e).optJSONObject("-");
                        String state = plus != null && plus.has("s") ? plus.getString("s") : null;
                        Boolean set = set(list.needs(e), plus, minus);
                        if (state == null && set == null) continue;   // other attributes only
                        act(e, list.heard(e, state, set, false));
                    }
                }
            }
        } finally {
            sock = null;
            try { s.close(); } catch (IOException e) { /* closed */ }
        }
    }

    /** A change's word on the attribute a row asks for: set (true), null or removed (false), not in this change (null). */
    private static Boolean set(String need, JSONObject plus, JSONObject minus) {
        if (need == null) return null;
        JSONObject a = plus == null ? null : plus.optJSONObject("a");
        if (a != null && a.has(need)) return !a.isNull(need);
        JSONArray gone = minus == null ? null : minus.optJSONArray("a");
        if (gone != null) for (int i = 0; i < gone.length(); i++) if (need.equals(gone.optString(i))) return false;
        return null;
    }

    /** What Watched.heard() answered: null nothing, "" a take-over, else the view this screen comes up on. */
    private void act(String entity, String what) {
        if (what == null) return;
        String app = list.plays(entity);
        if (app != null) handTo(app);
        if (what.isEmpty()) ui.post(fire); else ui.post(() -> show.accept(what));
    }

    /**
     * The music that just started plays through this app: it gets a Play key, as from the remote. A player app that lost
     * the sound to another app for good (a video in YouTube) stays silent when its server starts it again: only a Play
     * asked on the TV itself makes it take the sound back (SendSpin Player: "another app owns it", and Music Assistant
     * shows the queue playing meanwhile). An app that still has the sound just hears Play while playing.
     */
    private void handTo(String pkg) {
        try {
            c.sendBroadcast(new Intent(Intent.ACTION_MEDIA_BUTTON).setPackage(pkg)
                .putExtra(Intent.EXTRA_KEY_EVENT, new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY)));
            Log.i(Web.TAG, "watcher: Play to " + pkg);
        } catch (Exception e) { Log.i(Web.TAG, "watcher: Play to " + pkg + ": " + e); }
    }

    // ---- the WebSocket bits (RFC 6455): text frames, masked from us; ping / pong; close ----

    private static String line(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int ch;
        while ((ch = in.read()) != -1 && ch != '\n') if (ch != '\r') b.write(ch);
        if (ch == -1) throw new EOFException();
        return b.toString("US-ASCII");
    }

    private String read(DataInputStream in) throws IOException {
        ByteArrayOutputStream msg = new ByteArrayOutputStream();
        while (true) {
            int b0 = in.read();   // a timeout here (between frames) is the quiet-link check above
            if (b0 == -1) throw new EOFException();
            try { msg.write(frameBody(in, b0)); } catch (SocketTimeoutException e) { throw new IOException("cut off"); }   // mid-frame: drop the link
            if ((b0 & 0x0f) == 0x08) throw new EOFException("closed");
            if ((b0 & 0x80) != 0 && (b0 & 0x0f) <= 2) return msg.toString("UTF-8");
        }
    }

    /** the payload of one frame; control frames are answered here and give nothing */
    private byte[] frameBody(DataInputStream in, int b0) throws IOException {
        {
            int b1 = in.readUnsignedByte(), op = b0 & 0x0f;
            long len = b1 & 0x7f;
            if (len == 126) len = in.readUnsignedShort(); else if (len == 127) len = in.readLong();
            if (len < 0 || len > 16 << 20) throw new IOException("frame too big");
            byte[] mask = null;
            if ((b1 & 0x80) != 0) { mask = new byte[4]; in.readFully(mask); }
            byte[] p = new byte[(int) len];
            in.readFully(p);
            if (mask != null) for (int i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
            if (op == 9) { frame(0x0a, p); return new byte[0]; }   // ping: pong
            if (op >= 8) return new byte[0];
            return p;
        }
    }

    private void send(String text) throws IOException { frame(0x01, text.getBytes(StandardCharsets.UTF_8)); }

    private synchronized void frame(int op, byte[] p) throws IOException {
        ByteArrayOutputStream f = new ByteArrayOutputStream();
        f.write(0x80 | op);
        if (p.length < 126) f.write(0x80 | p.length);
        else if (p.length < 65536) { f.write(0x80 | 126); f.write(p.length >> 8); f.write(p.length & 0xff); }
        else { f.write(0x80 | 127); for (int i = 7; i >= 0; i--) f.write((int) ((long) p.length >> (8 * i)) & 0xff); }
        byte[] mask = new byte[4]; rnd.nextBytes(mask);
        f.write(mask);
        for (int i = 0; i < p.length; i++) f.write(p[i] ^ mask[i & 3]);
        out.write(f.toByteArray());
        out.flush();
    }
}
