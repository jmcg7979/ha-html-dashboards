package dash.tv;

import java.util.Map;

/**
 * The screensaver's line about the house: the weather now, from the entity the page names (tvhost.saver, from its status
 * line: Saver.java). Plain Java (no Android), so test.sh runs it on the JVM. (No "what's playing" line: while music plays
 * the screensaver doesn't come.)
 */
final class Lines {
    private Lines() { }

    /** An entity's state and attributes, as text; null when HA doesn't have it. */
    interface Get {
        String state(String id);
        String attr(String id, String key);
    }

    /** "72° · Partly cloudy" from a weather entity; "" when it isn't reporting. texts: condition -> words (the page's). */
    static String weather(Get g, String entity, Map<String, String> texts) {
        if (entity == null || entity.isEmpty()) return "";
        String s = g.state(entity);
        if (s == null || s.isEmpty() || s.equals("unavailable") || s.equals("unknown")) return "";
        String t = g.attr(entity, "temperature"), words = texts.getOrDefault(s, s);
        long deg;
        try { deg = Math.round(Double.parseDouble(t)); } catch (RuntimeException e) { return words; }
        return deg + "° · " + words;
    }
}
