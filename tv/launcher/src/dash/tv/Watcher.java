package dash.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

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
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Follows the entity states that start a take-over (the page's list, HomeActivity's tvhost.watch: [{entity, state}]) over
 * one HA WebSocket (subscribe_entities with just those entities; the TV user's token). When one changes INTO its state,
 * fire() runs on the main thread (HomeGuard: Overlay.show). Started by HomeGuard, so it lives as long as the TV's
 * accessibility service does. Reconnects after 10 s; a WebSocket client of its own (Android has none built in).
 */
final class Watcher implements Runnable {
    private static Watcher it;
    private final Context c;
    private final Runnable fire;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final SecureRandom rnd = new SecureRandom();
    private volatile Socket sock;
    private volatile boolean stopped;
    private Thread th;
    private OutputStream out;

    private Watcher(Context c, Runnable fire) { this.c = c; this.fire = fire; }

    static synchronized void start(Context c, Runnable fire) {
        stop();
        it = new Watcher(c.getApplicationContext(), fire);
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
            try { session(); } catch (InterruptedException e) { again = true; } catch (Exception e) { again = Thread.interrupted(); }   // restarted: at once
            if (stopped) break;
            if (!again) try { Thread.sleep(10000); } catch (InterruptedException e) { /* restarted */ }
        }
    }

    private void session() throws Exception {
        SharedPreferences cfg = c.getSharedPreferences("cfg", Context.MODE_PRIVATE);
        String url = cfg.getString("url", ""), tok = cfg.getString("token", "");
        Map<String, String> want = new HashMap<>();
        JSONArray list = new JSONArray(cfg.getString("watch", "[]"));
        for (int i = 0; i < list.length(); i++) want.put(list.getJSONObject(i).getString("entity"), list.getJSONObject(i).getString("state"));
        if (url.isEmpty() || tok.isEmpty() || want.isEmpty()) { Thread.sleep(50000); return; }

        Uri u = Uri.parse(url);
        boolean tls = "https".equals(u.getScheme());
        int port = u.getPort() > 0 ? u.getPort() : tls ? 443 : 80;
        Socket s = tls ? javax.net.ssl.SSLSocketFactory.getDefault().createSocket() : new Socket();
        sock = s;
        try {
            s.connect(new InetSocketAddress(u.getHost(), port), 10000);
            s.setSoTimeout(30000);
            out = s.getOutputStream();
            DataInputStream in = new DataInputStream(s.getInputStream());
            byte[] key = new byte[16]; rnd.nextBytes(key);
            out.write(("GET /api/websocket HTTP/1.1\r\nHost: " + u.getHost() + ":" + port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + android.util.Base64.encodeToString(key, android.util.Base64.NO_WRAP) + "\r\nSec-WebSocket-Version: 13\r\n\r\n")
                .getBytes(StandardCharsets.US_ASCII));
            out.flush();
            String status = line(in);
            if (!status.contains(" 101")) throw new IOException("no upgrade: " + status);
            while (!line(in).isEmpty()) { /* headers */ }

            Map<String, String> now = new HashMap<>();
            int quiet = 0, id = 1;
            while (!stopped) {
                String msg;
                try { msg = read(in); quiet = 0; }
                catch (SocketTimeoutException e) {   // 30 s without a word: ping; twice in a row: the link is dead
                    if (++quiet > 1) throw e;
                    send("{\"id\":" + (++id) + ",\"type\":\"ping\"}");
                    continue;
                }
                JSONObject m = new JSONObject(msg);
                String type = m.optString("type");
                if (type.equals("auth_required")) send(new JSONObject().put("type", "auth").put("access_token", tok).toString());
                else if (type.equals("auth_invalid")) { Thread.sleep(300000); return; }   // a wrong token: don't hammer HA
                else if (type.equals("auth_ok")) send(new JSONObject().put("id", 1).put("type", "subscribe_entities").put("entity_ids", new JSONArray(want.keySet())).toString());
                else if (type.equals("event") && m.optInt("id") == 1) {
                    JSONObject ev = m.getJSONObject("event"), a = ev.optJSONObject("a"), ch = ev.optJSONObject("c");
                    if (a != null) for (Iterator<String> k = a.keys(); k.hasNext(); ) { String e = k.next(); now.put(e, a.getJSONObject(e).optString("s")); }   // first states: no take-over for what is already on
                    if (ch != null) for (Iterator<String> k = ch.keys(); k.hasNext(); ) {
                        String e = k.next();
                        JSONObject plus = ch.getJSONObject(e).optJSONObject("+");
                        if (plus == null || !plus.has("s")) continue;   // attributes only
                        String was = now.get(e), st = plus.getString("s"), on = want.get(e);
                        now.put(e, st);
                        if (on != null && st.equalsIgnoreCase(on) && (was == null || !was.equalsIgnoreCase(on))) ui.post(fire);
                    }
                }
            }
        } finally {
            sock = null;
            try { s.close(); } catch (IOException e) { /* closed */ }
        }
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
