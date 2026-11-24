package dash.tv;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.service.dreams.DreamService;
import android.text.format.DateFormat;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;

/**
 * The TV's screensaver: photos from the house's albums, one at a time with a slow fade, and over them the time, the date,
 * and the weather now (README.md, Screensaver; no "what's playing": while music plays the screensaver doesn't come).
 * Without photos (a guest TV: --ez photos false; none listed; HA not answering; no token) it is the clock on black, in a
 * new place every minute.
 *   Photos: sensor.screensaver_photos lists them (README.md, Screensaver: your own job copies them to HA's media folder at screen size);
 *   each is loaded from /media/local/screensaver/<file> with the TV's token, one at a time, and kept in graphics memory
 *   only (two while they fade); a slide that has faded out frees its photo at once. A photo already the screen's shape fills it; any other is shown whole over a blurred, dimmed
 *   copy of itself. Shuffled, none shown twice until all were; the list is read again when the round is over.
 *   Weather: the page says which entity (tvhost.saver, kept as "saver" in the settings); Lines.java words it.
 * Plain views, nothing that moves but the fade: a moving picture makes the TV redraw all the time. Its own process
 * (:saver), so the settings are read from the file each time it starts (the page may have changed them).
 * Chosen over adb: settings put secure screensaver_components dash.tv/dash.tv.Saver
 */
public class Saver extends DreamService {
    static final String TAG = "DashTV";
    private static final long PHOTO_MS = 40000, FADE_MS = 2500, LINES_MS = 60000;
    private static final String LIST = "sensor.screensaver_photos", DIR = "/media/local/screensaver/";
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Random rnd = new Random();
    private HandlerThread netThread;
    private Handler net;
    private FrameLayout root, slides;
    private View scrim;
    private LinearLayout box;
    private TextView time, date, weather;
    private String origin = "", token = "";
    private JSONObject conf = new JSONObject();
    private final List<String> order = new ArrayList<>();
    private int next, failures;
    private boolean photos;   // a photo is on the screen: the clock sits in its corner over the scrim
    private String said = "";

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);   // any key ends it
        setFullscreen(true);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        slides = new FrameLayout(this);
        root.addView(slides, new FrameLayout.LayoutParams(-1, -1));
        scrim = new View(this);   // darker towards the bottom left, where the text is
        scrim.setBackground(new GradientDrawable(GradientDrawable.Orientation.BL_TR, new int[] { 0xB0000000, 0x40000000, 0x00000000 }));
        scrim.setVisibility(View.GONE);
        root.addView(scrim, new FrameLayout.LayoutParams(-1, -1));
        box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        time = text(96, 0xF2ECE6DA);
        date = text(26, 0xCCECE6DA);
        weather = text(22, 0xCCECE6DA);
        weather.setPadding(0, dp(14), 0, 0);
        for (TextView t : new TextView[] { time, date, weather }) box.addView(t);
        weather.setVisibility(View.GONE);
        root.addView(box, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START));
        setContentView(root);
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private TextView text(int sp, int color) {
        TextView t = new TextView(this);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setIncludeFontPadding(false);
        t.setShadowLayer(10, 0, 2, 0x99000000);
        return t;
    }

    // ---- the clock: on the minute; over photos in the bottom left corner (a little elsewhere each minute: no burn-in),
    // on black anywhere on the screen
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            Date now = new Date();
            time.setText(new SimpleDateFormat(DateFormat.is24HourFormat(Saver.this) ? "H:mm" : "h:mm", Locale.getDefault()).format(now));
            date.setText(new SimpleDateFormat("EEEE, MMMM d", Locale.getDefault()).format(now));
            place();
            ui.postDelayed(this, 60000 - System.currentTimeMillis() % 60000 + 50);
        }
    };

    private void place() {
        box.post(() -> {   // once it has its size
            int m = root.getWidth() / 16, w = root.getWidth() - box.getWidth() - 2 * m, h = root.getHeight() - box.getHeight() - 2 * m;
            if (photos) {   // bottom left, up to half a margin off it
                box.setTranslationX(m * 3 / 4 + rnd.nextInt(Math.max(1, m / 2)));
                box.setTranslationY(root.getHeight() - box.getHeight() - m * 3 / 4 - rnd.nextInt(Math.max(1, m / 2)));
            } else {
                box.setTranslationX(m + (w > 0 ? rnd.nextInt(w) : 0));
                box.setTranslationY(m + (h > 0 ? rnd.nextInt(h) : 0));
            }
        });
    }

    @Override
    public void onDreamingStarted() {
        super.onDreamingStarted();
        @SuppressWarnings("deprecation")   // the main process writes these; MULTI_PROCESS reads the file again if it changed
        SharedPreferences cfg = getSharedPreferences("cfg", Context.MODE_MULTI_PROCESS);
        origin = Origin.of(Cfg.url(cfg));
        token = Cfg.token(cfg);
        try { conf = new JSONObject(cfg.getString("saver", "{}")); } catch (Exception e) { conf = new JSONObject(); }
        tick.run();
        if (origin.isEmpty() || token.isEmpty()) { say("saver: no Home Assistant address or token: the clock only"); return; }
        netThread = new HandlerThread("saver");
        netThread.start();
        net = new Handler(netThread.getLooper());
        if (cfg.getBoolean("photos", true)) net.post(this::photo);   // off on a guest TV (Provision: --ez photos false)
        net.post(this::lines);
    }

    @Override public void onDreamingStopped() { stop(); super.onDreamingStopped(); }
    @Override public void onDetachedFromWindow() { stop(); super.onDetachedFromWindow(); }

    private void stop() {
        ui.removeCallbacksAndMessages(null);
        if (netThread != null) { net.removeCallbacksAndMessages(null); netThread.quit(); netThread = null; }
        if (slides != null) { for (int i = 0; i < slides.getChildCount(); i++) drop(slides.getChildAt(i)); slides.removeAllViews(); }
    }

    // ---- photos (on the "saver" thread)
    private void photo() {
        if (next >= order.size()) {   // a new round: the list again (photos added or taken out since)
            List<String> l = list();
            if (l != null) { order.clear(); order.addAll(l); Collections.shuffle(order, rnd); }
            next = 0;
            if (order.isEmpty()) { net.postDelayed(this::photo, 10 * 60000); return; }   // none (yet): the clock on black; ask again later
        }
        String f = order.get(next++);
        Bitmap b = null;
        byte[] body = get(DIR + f);
        if (body != null) {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inPreferredConfig = Bitmap.Config.ARGB_8888;   // (RGB_565 bands skies and the blur)
            b = BitmapFactory.decodeByteArray(body, 0, body.length, o);
        }
        if (b == null) {   // gone since the list was read, or HA not answering: the next one soon, then less often
            say("saver: photo " + f + " not loaded");
            net.postDelayed(this::photo, ++failures < 3 ? 5000 : PHOTO_MS);
            return;
        }
        failures = 0;
        Bitmap back = fits(b) ? null : blurSource(b);
        Bitmap hw = b.copy(Bitmap.Config.HARDWARE, false);   // the pixels in graphics memory only, not twice
        if (hw != null) { b.recycle(); b = hw; }
        Bitmap shown = b;
        ui.post(() -> show(shown, back));
        net.postDelayed(this::photo, PHOTO_MS);
    }

    private List<String> list() {
        JSONObject s = state(LIST);
        if (s == null) return null;
        JSONArray a = s.optJSONObject("attributes") == null ? null : s.optJSONObject("attributes").optJSONArray("photos");
        List<String> l = new ArrayList<>();
        for (int i = 0; a != null && i < a.length(); i++) {
            String f = a.optString(i);
            if (f.matches("[A-Za-z0-9_.-]+\\.jpg")) l.add(f);
        }
        return l;
    }

    /** The photo is the screen's shape (within 5 %): it fills the screen; else it is shown whole. */
    private boolean fits(Bitmap b) {
        float screen = root.getWidth() > 0 && root.getHeight() > 0 ? (float) root.getWidth() / root.getHeight() : 16f / 9;
        return Math.abs((float) b.getWidth() / b.getHeight() / screen - 1) < 0.05;
    }

    /** A tiny, blurred copy of the photo's middle, at the screen's shape: drawn full screen (filtered) it is a soft blur. */
    private Bitmap blurSource(Bitmap b) {
        float screen = root.getWidth() > 0 ? (float) root.getWidth() / root.getHeight() : 16f / 9;
        int w = b.getWidth(), h = Math.round(w / screen);
        if (h > b.getHeight()) { h = b.getHeight(); w = Math.round(h * screen); }
        Bitmap mid = Bitmap.createBitmap(b, (b.getWidth() - w) / 2, (b.getHeight() - h) / 2, w, h);
        int sw = 64, sh = Math.max(1, Math.round(sw / screen));
        Bitmap small = Bitmap.createScaledBitmap(mid, sw, sh, true);
        if (mid != b && mid != small) mid.recycle();
        int[] px = new int[sw * sh];
        small.getPixels(px, 0, sw, 0, 0, sw, sh);
        for (int pass = 0; pass < 3; pass++) { boxBlur(px, sw, sh, true); boxBlur(px, sw, sh, false); }
        Bitmap out = small.isMutable() ? small : small.copy(Bitmap.Config.ARGB_8888, true);
        out.setPixels(px, 0, sw, 0, 0, sw, sh);
        if (out != small) small.recycle();
        return out;
    }

    /** One pass of a 5-wide box blur along rows (or columns), edges held. */
    private static void boxBlur(int[] px, int w, int h, boolean rows) {
        int n = rows ? w : h, lines = rows ? h : w, r = 2;
        int[] line = new int[n];
        for (int l = 0; l < lines; l++) {
            for (int i = 0; i < n; i++) line[i] = px[rows ? l * w + i : i * w + l];
            for (int i = 0; i < n; i++) {
                int a = 0, rr = 0, g = 0, bb = 0;
                for (int k = -r; k <= r; k++) {
                    int c = line[Math.min(n - 1, Math.max(0, i + k))];
                    a += c >>> 24; rr += (c >> 16) & 255; g += (c >> 8) & 255; bb += c & 255;
                }
                int d = 2 * r + 1;
                px[rows ? l * w + i : i * w + l] = (a / d) << 24 | (rr / d) << 16 | (g / d) << 8 | (bb / d);
            }
        }
    }

    private void show(Bitmap b, Bitmap back) {
        if (netThread == null) return;   // stopped meanwhile
        FrameLayout slide = new FrameLayout(this);
        slide.setBackgroundColor(Color.BLACK);
        if (back != null) {
            ImageView bg = new ImageView(this);
            BitmapDrawable d = new BitmapDrawable(getResources(), back);
            d.setFilterBitmap(true);
            bg.setImageDrawable(d);
            bg.setScaleType(ImageView.ScaleType.FIT_XY);
            bg.setColorFilter(0xFF5A5A5A, PorterDuff.Mode.MULTIPLY);   // dimmed: the photo stands out
            slide.addView(bg, new FrameLayout.LayoutParams(-1, -1));
        }
        ImageView fg = new ImageView(this);
        fg.setImageBitmap(b);
        fg.setScaleType(back == null ? ImageView.ScaleType.CENTER_CROP : ImageView.ScaleType.FIT_CENTER);
        slide.addView(fg, new FrameLayout.LayoutParams(-1, -1));
        slide.setTag(new Bitmap[] { b, back });
        slide.setAlpha(0f);
        slides.addView(slide, new FrameLayout.LayoutParams(-1, -1));
        if (!photos) { photos = true; scrim.setVisibility(View.VISIBLE); place(); }
        slide.animate().alpha(1f).setDuration(FADE_MS).setListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator a) {   // the one under it goes (and its memory)
                while (slides.getChildCount() > 1) { drop(slides.getChildAt(0)); slides.removeViewAt(0); }
            }
        });
    }

    /** A slide that is no longer shown gives its photos' memory back at once (not at the next garbage collection). */
    private static void drop(View slide) {
        if (!(slide.getTag() instanceof Bitmap[])) return;
        for (View v : new View[] { ((FrameLayout) slide).getChildAt(0), ((FrameLayout) slide).getChildAt(1) }) if (v instanceof ImageView) ((ImageView) v).setImageDrawable(null);
        for (Bitmap x : (Bitmap[]) slide.getTag()) if (x != null) x.recycle();
        slide.setTag(null);
    }

    // ---- the lines (on the "saver" thread)
    private void lines() {
        Map<String, JSONObject> st = new HashMap<>();
        String wx = id(conf, "weather");
        if (wx != null) { JSONObject s = state(wx); if (s != null) st.put(wx, s); }
        Lines.Get g = new Lines.Get() {
            @Override public String state(String id) { JSONObject s = st.get(id); return s == null ? null : s.optString("state", null); }
            @Override public String attr(String id, String key) {
                JSONObject s = st.get(id), a = s == null ? null : s.optJSONObject("attributes");
                return a == null || a.isNull(key) ? null : a.optString(key, null);
            }
        };
        Map<String, String> texts = new HashMap<>();
        JSONObject c = conf.optJSONObject("conditions");
        if (c != null) for (Iterator<String> k = c.keys(); k.hasNext(); ) { String key = k.next(); texts.put(key, c.optString(key)); }
        String w = Lines.weather(g, wx, texts);
        ui.post(() -> { set(weather, w); place(); });
        net.postDelayed(this::lines, LINES_MS);
    }

    private static String id(JSONObject o, String k) { String v = o.optString(k, ""); return v.matches("[a-z_]+\\.[a-z0-9_]+") ? v : null; }

    private static void set(TextView t, String s) { t.setText(s); t.setVisibility(s.isEmpty() ? View.GONE : View.VISIBLE); }

    // ---- Home Assistant, with the TV's token
    private JSONObject state(String id) {
        byte[] b = get("/api/states/" + id);
        try { return b == null ? null : new JSONObject(new String(b, StandardCharsets.UTF_8)); } catch (Exception e) { return null; }
    }

    private byte[] get(String path) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(origin + path).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(20000);
            c.setRequestProperty("Authorization", "Bearer " + token);
            if (c.getResponseCode() != 200) { say("saver: " + path.replaceAll("/[^/]*$", "/…") + " answered " + c.getResponseCode()); return null; }
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                return out.toByteArray();
            }
        } catch (Exception e) {
            say("saver: Home Assistant not reached (" + e.getClass().getSimpleName() + ")");
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** One line in the TV's log, once per run of the same line. Never anything that holds the token. */
    private void say(String s) { if (!s.equals(said)) { said = s; Log.i(TAG, s); } }
}
