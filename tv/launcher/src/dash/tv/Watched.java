package dash.tv;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * The page's watch list and the last state heard for each entity on it: what Watcher asks "does this start something?".
 * An entity starts something when it changes INTO its listed state. States are kept from one connection to the next,
 * so a change that happened while the link was down is noticed in the next connection's first states; what is already
 * on the first time an entity is heard of starts nothing. A row may also name an attribute the entity must have (`has`):
 * it is then in its state only with that attribute set (not missing, not null). A TV's Music Assistant player says
 * "playing" for YouTube too (it mirrors the TV's Cast), and only its own music comes with an active_queue.
 * A row may name the player app that plays the entity's music on this TV (`play`: Watcher hands it the sound).
 * Plain Java: it runs on a plain JVM for test.sh.
 */
final class Watched {
    private final Map<String, String> want = new HashMap<>(), views = new HashMap<>(), needs = new HashMap<>(), plays = new HashMap<>(), last = new HashMap<>();
    private final Map<String, String> needed = new HashMap<>();    // the old list's `has`, while a new list is read
    private final Map<String, Boolean> had = new HashMap<>();      // entity -> its `has` attribute was set when last heard

    /** A new list is coming: forget the old one, keep the states of the entities for add() to pick up again. */
    void clear() { needed.clear(); needed.putAll(needs); want.clear(); views.clear(); needs.clear(); plays.clear(); }

    /** One row of the list. A row without an entity or a state is left out (false); the others still count. */
    boolean add(String entity, String state, String view) { return add(entity, state, view, null); }
    boolean add(String entity, String state, String view, String has) { return add(entity, state, view, has, null); }
    boolean add(String entity, String state, String view, String has, String play) {
        if (entity == null || entity.isEmpty() || state == null || state.isEmpty()) return false;
        want.put(entity, state);
        if (view != null && !view.isEmpty()) views.put(entity, view); else views.remove(entity);
        if (has != null && !has.isEmpty()) needs.put(entity, has); else needs.remove(entity);
        if (play != null && play.matches("[A-Za-z0-9_.]+")) plays.put(entity, play); else plays.remove(entity);
        return true;
    }

    /** The list is complete: states of entities no longer on it go, and of those that now ask for another attribute
     *  (what was heard says nothing about it: the entity counts as never heard of). */
    void done() {
        for (String e : want.keySet()) if (!java.util.Objects.equals(needs.get(e), needed.get(e))) { last.remove(e); had.remove(e); }
        needed.clear();
        last.keySet().retainAll(want.keySet());
        had.keySet().retainAll(needs.keySet());
    }

    /** The attribute this entity's row asks for, or null. */
    String needs(String entity) { return needs.get(entity); }

    /** The package of the player app this entity's row names, or null. */
    String plays(String entity) { return plays.get(entity); }

    boolean isEmpty() { return want.isEmpty(); }
    Set<String> entities() { return want.keySet(); }

    /** The states are too old to compare with (the link was down for long): the next ones heard start nothing. */
    void forget() { last.clear(); had.clear(); }

    /**
     * A state as HA sent it. `first`: it is part of a connection's first states, not a change.
     * Returns null (nothing starts), "" (a take-over) or the view this screen comes up on.
     */
    String heard(String entity, String state, boolean first) { return heard(entity, state, null, first); }
    /** The same, with the row's `has` attribute: `set` true / false as HA sent it, null when this change doesn't touch it;
     *  `state` null when the change is of attributes only. */
    String heard(String entity, String state, Boolean set, boolean first) {
        String on = want.get(entity);
        if (on == null) return null;
        String was = last.get(entity);
        boolean need = needs.containsKey(entity), wasOn = was != null && was.equalsIgnoreCase(on) && (!need || Boolean.TRUE.equals(had.get(entity)));
        if (state == null) state = was;
        if (state == null) return null;   // attributes of an entity whose state was never heard
        last.put(entity, state);
        if (need && set != null) had.put(entity, set);
        if (!state.equalsIgnoreCase(on) || need && !Boolean.TRUE.equals(had.get(entity))) return null;
        if (was == null ? first : wasOn) return null;   // already on when first heard of, or still on
        String view = views.get(entity);
        return view == null ? "" : view;
    }
}
