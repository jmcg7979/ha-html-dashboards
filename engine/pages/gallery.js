// Component gallery (?d=gallery): every card type a site uses, built from the site's own configs with live data.
// Each type is shown full width, half and a third, so its compact states (container queries) sit side by side.
// Nothing is hand-maintained per site: a new card type, or a new use in a dashboard or pop-up, appears on its own.
// gallery.html shows these views at phone, in-between, panel and desktop sizes, with a style baseline / compare check.
//   export default gallery({ sources: [['Main', main.views], ['Mobile', mobile.views], ['Systems', [systems]]], popups, settings })

// category per card type; a type not listed lands in Other
const CATS = [
  { id: 'controls', title: 'Controls', icon: 'gesture-tap-button', types: ['tile', 'stat', 'buttons', 'segments', 'select', 'swatches', 'kpi', 'label', 'heading', 'time', 'stepper', 'timer-list', 'area-pick', 'stack', 'strip', 'routine'] },
  { id: 'home', title: 'Home', icon: 'home-outline', types: ['people', 'alarm', 'openings', 'bays', 'agenda', 'month', 'windows', 'map', 'logbook', 'attention'] },
  { id: 'climate', title: 'Climate & weather', icon: 'weather-partly-cloudy', types: ['room-climate', 'thermostat', 'weather', 'wx-now', 'wx-days', 'wx-hours', 'radar', 'chart', 'trend'] },
  { id: 'media', title: 'Media & cameras', icon: 'cctv', types: ['camera', 'camera-wall', 'frigate-player', 'reviews', 'media', 'media-detail', 'music', 'image', 'drawer'] },
  { id: 'systems', title: 'Systems', icon: 'server-network', types: ['health', 'host', 'devices', 'topology', 'print-job', 'ams', 'prints'] },
];
// heavy or full-screen cards: one example, full width only (every camera is a live stream; 4 frames already multiply them)
const ONCE = new Set(['camera', 'reviews', 'camera-wall', 'drawer', 'radar', 'frigate-player', 'map', 'topology', 'month', 'music']);
const MAX = 2;   // examples per type (first use in each source, up to this many)

export function gallery({ sources = [], popups = {}, settings } = {}) {
  const found = new Map();   // type -> [{ cfg, from }]
  const add = (c, from) => {
    if (!c || !c.type) return;
    const list = found.get(c.type) || found.set(c.type, []).get(c.type);
    if (list.length < (ONCE.has(c.type) ? 1 : MAX) && !list.some((x) => x.from === from)) list.push({ cfg: c, from });
  };
  const walkCards = (cards, from) => (cards || []).forEach((c) => { add(c, from); walkCards(c.cards, from); });   // nested cards too, so every type gets its own frames
  const walkView = (v, from) => {
    if (!v || v.frame) return;
    const at = from + ' › ' + (v.title || v.id);
    (v.sections || []).forEach((s) => walkCards(s.cards, at));
    (v.pages || []).forEach((p) => (p.sections || []).forEach((s) => walkCards(s.cards, at)));
  };
  sources.forEach(([from, views]) => (views || []).forEach((v) => walkView(v, from)));
  Object.entries(popups).forEach(([id, p]) => walkCards(p.pages ? p.pages.flatMap((pg) => pg.cards || []) : p.cards, 'Pop-up › ' + (p.title || id)));

  const at = (cfg, span) => { const c = { ...cfg, span }; delete c.show; delete c.grow; return c; };
  const sectionFor = (type, ex) => ({ span: 3, cols: 12, cards: [
    { type: 'label', text: type + '  ·  ' + ex.from, span: 12 },
    ...(ONCE.has(type) ? [at(ex.cfg, 12)] : [at(ex.cfg, 12), at(ex.cfg, 6), at(ex.cfg, 4)])] });
  const placed = new Set();
  const views = CATS.map((cat) => ({ id: cat.id, title: cat.title, icon: cat.icon, sections: cat.types.filter((t) => found.has(t)).flatMap((t) => { placed.add(t); return found.get(t).map((ex) => sectionFor(t, ex)); }) }));
  const rest = [...found.keys()].filter((t) => !placed.has(t));
  if (rest.length) views.push({ id: 'other', title: 'Other', icon: 'shape-outline', sections: rest.flatMap((t) => found.get(t).map((ex) => sectionFor(t, ex))) });
  return { title: 'Gallery', profile: 'portal', settings, popups, views: views.filter((v) => v.sections.length) };
}
