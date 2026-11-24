package dash.tv;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.function.Consumer;

/**
 * Voice for the page (tvhost.listen): Android's speech recognizer, the TV's own (on Google TV that is Google's), heard
 * through the microphone the recognizer picks. The remote's mic button can't be used for this: it never reaches an app,
 * Google TV hands it straight to Assistant (measured on a Google TV, README.md).
 * Needs RECORD_AUDIO, granted over adb (README.md); without it, or without a recognizer, can() is false and the page
 * shows no mic.
 * What is heard goes to the page as `tv:hear` events, detail { state, text, error }:
 *   listening  the recognizer is ready for speech
 *   words      what it has so far (text)
 *   done       the final words (text)
 *   error      nothing usable (error: nomatch, silence, mic, network, busy, other)
 * One listen at a time; stop() or the screen leaving the front ends it without a `done`.
 * warm() (the page's search is open): a recognizer is made and bound ahead, and made again after each listen, so a press
 * doesn't wait for Google's recognizer service to start: measured on a Google TV, 2026-11-17, a cold first listen
 * opened the remote's mic 2.9 s after the press, the ones after it 0.2-0.5 s. cool() lets it go.
 */
final class Ear {
    private final Context ctx;
    private final Consumer<String> send;   // the JSON detail of one event, to the page
    private SpeechRecognizer rec, spare;
    private boolean keepWarm;

    Ear(Context ctx, Consumer<String> send) { this.ctx = ctx; this.send = send; }

    static boolean can(Context c) {
        return c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            && SpeechRecognizer.isRecognitionAvailable(c);
    }

    /** On the main thread: a recognizer ready for the next listen, until cool(). */
    void warm() {
        keepWarm = true;
        if (spare != null || rec != null || !can(ctx)) return;
        try { spare = SpeechRecognizer.createSpeechRecognizer(ctx); } catch (RuntimeException e) { Log.i(Web.TAG, "no recognizer: " + e); return; }
        // Android 13+: asking what it supports binds the service and has it start up now (older: bound at the first listen)
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                spare.checkRecognitionSupport(intent(), ctx.getMainExecutor(), new RecognitionSupportCallback() {
                    @Override public void onSupportResult(RecognitionSupport s) { }
                    @Override public void onError(int code) { }
                });
            } catch (RuntimeException e) { /* bound at the first listen then */ }
        }
    }

    /** On the main thread: no recognizer kept ready (the search closed, or the screen left the front). */
    void cool() {
        keepWarm = false;
        SpeechRecognizer s = spare; spare = null;
        if (s != null) try { s.destroy(); } catch (RuntimeException e) { /* already gone */ }
    }

    private Intent intent() {
        return new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_WEB_SEARCH)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.getPackageName());
    }

    /** On the main thread. A recognizer that can't start says so with an `error` event. */
    void start() {
        stop();
        if (!can(ctx)) { event("error", null, "mic"); return; }
        if (spare != null) { rec = spare; spare = null; }
        else try { rec = SpeechRecognizer.createSpeechRecognizer(ctx); } catch (RuntimeException e) { Log.i(Web.TAG, "no recognizer: " + e); event("error", null, "other"); return; }
        final SpeechRecognizer me = rec;
        rec.setRecognitionListener(new RecognitionListener() {
            private boolean mine() { return rec == me; }
            @Override public void onReadyForSpeech(Bundle b) { if (mine()) event("listening", null, null); }
            @Override public void onPartialResults(Bundle b) { String t = best(b); if (mine() && t != null) event("words", t, null); }
            @Override public void onResults(Bundle b) {
                if (!mine()) return;
                String t = best(b);
                if (t == null || t.trim().isEmpty()) event("error", null, "nomatch"); else event("done", t, null);
                end();
            }
            @Override public void onError(int code) { if (!mine()) return; event("error", null, kind(code)); end(); }
            @Override public void onBeginningOfSpeech() { }
            @Override public void onRmsChanged(float db) { }
            @Override public void onBufferReceived(byte[] buf) { }
            @Override public void onEndOfSpeech() { }
            @Override public void onEvent(int type, Bundle b) { }
        });
        try { rec.startListening(intent()); } catch (RuntimeException e) { Log.i(Web.TAG, "listen failed: " + e); end(); event("error", null, "other"); }
    }

    /** Ends a listen still going, quietly (the page asked, or the screen left the front). */
    void stop() {
        if (rec == null) return;
        try { rec.cancel(); } catch (RuntimeException e) { /* already gone */ }
        end();
    }

    private void end() {
        SpeechRecognizer r = rec; rec = null;
        if (r != null) try { r.destroy(); } catch (RuntimeException e) { /* already gone */ }
        if (keepWarm) warm();   // ready for the next press
    }

    private void event(String state, String text, String error) {
        try {
            JSONObject d = new JSONObject().put("state", state);
            if (text != null) d.put("text", text);
            if (error != null) d.put("error", error);
            send.accept(d.toString());
        } catch (Exception e) { /* not sent */ }
    }

    private static String best(Bundle b) {
        ArrayList<String> l = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return l == null || l.isEmpty() ? null : l.get(0);
    }

    private static String kind(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_NO_MATCH: return "nomatch";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "silence";
            case SpeechRecognizer.ERROR_AUDIO:
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "mic";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER: return "network";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "busy";
            default: Log.i(Web.TAG, "listen error " + code); return "other";
        }
    }
}
