// Everything on the Systems page that needs a look, worst first, each with the system it belongs to (tap = its page);
// a calm "all normal" state otherwise. Below it, the backups with their age (late after `stale` hours).
// { type: 'attention', nodes: [{ name, icon, page, ...health def }], extra: [{ name, icon, page, updates|checks... }],
//   backups: [{ name, icon, entity (none: "Not set up"), stale: 26, next: entity, parse: (state) => Date }] }
import { h, esc, icon, setHTML } from '../core/dom.js';
import { st, watch, tick } from '../core/store.js';
import { assess, nodeIds, LEVEL_TONE, LEVEL_ICON } from '../core/assess.js';
import { since, until } from '../core/time.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

export default function attention(cfg) {
  const el = h(`<div class="attn"><div class="atop"><span class="attn-title">Needs a look</span><span class="acount"></span></div><div class="attn-list"></div>
    ${cfg.backups ? `<div class="abk"><span class="attn-title">Backups</span><div class="abks"></div></div>` : ''}</div>`);
  const list = el.querySelector('.attn-list'), count = el.querySelector('.acount'), nodes = [...cfg.nodes, ...(cfg.extra || [])];
  const draw = () => {
    const items = [];
    nodes.forEach((n) => assess(n).reasons.forEach((r) => items.push({ ...r, n })));
    // many things silent at once is one cause (their host or HA's link to it is down): one line for them, not a list
    const gone = items.filter((i) => i.kind === 'silent' && i.text === i.n.name + ' not reporting');
    if (gone.length > 3) { const names = gone.map((i) => i.n.name); items.splice(0, items.length, ...items.filter((i) => !gone.includes(i)),
      { level: 1, kind: 'silent', text: `${gone.length} not reporting`, n: { name: names.slice(0, 3).join(', ') + ` +${names.length - 3}`, icon: gone[0].n.icon, page: gone[0].n.page } }); }
    items.sort((a, b) => b.level - a.level || (a.kind === 'update') - (b.kind === 'update'));
    count.textContent = items.length ? String(items.length) : '';
    count.style.setProperty('--t', `var(--${LEVEL_TONE[items.reduce((a, i) => Math.max(a, i.level), 0)]})`);
    setHTML(list, items.length ? items.map((i, k) => `<button class="aitem" data-k="${k}" style="--t:var(--${LEVEL_TONE[i.level]})"><span class="aic">${icon(i.kind === 'update' ? 'arrow-up-circle-outline' : LEVEL_ICON[i.level])}</span>
        <span class="atx"><span class="awhat">${esc(i.text)}</span><span class="awho">${icon(i.n.icon)}${esc(i.n.name)}</span></span></button>`).join('')
      : `<div class="aok">${icon('check-circle-outline')}<span>All systems normal</span><small>${nodes.length} devices, VMs and containers checked</small></div>`);
    list._items = items;
    requestAnimationFrame(fit);
  };
  // only whole items: the ones that don't fit the list's height go, and the last line says how many (no half-cut item)
  const fit = () => {
    const rows = [...list.querySelectorAll('.aitem')]; list.querySelectorAll('.attn-more').forEach((x) => x.remove());
    rows.forEach((r) => { r.hidden = false; });
    if (list.scrollHeight <= list.clientHeight + 1) return;
    const more = h('<div class="attn-more"></div>'); list.appendChild(more);
    let n = 0;
    while (list.scrollHeight > list.clientHeight + 1 && n < rows.length - 1) { rows[rows.length - 1 - n].hidden = true; n++; more.textContent = `+${n} more`; }
  };
  new ResizeObserver(() => requestAnimationFrame(fit)).observe(list);
  watch(nodes.flatMap(nodeIds), draw);
  list.addEventListener('click', (ev) => { const b = ev.target.closest('.aitem'); const i = b && list._items[+b.dataset.k]; if (i && i.n.page) window.dispatchEvent(new CustomEvent('dash:view', { detail: i.n.page })); });

  if (cfg.backups) {
    const box = el.querySelector('.abks');
    const bdraw = () => setHTML(box, cfg.backups.map((b) => {
      const e = b.entity ? st(b.entity) : null, silent = !e || e.state === 'unavailable', t = e ? (b.parse ? b.parse(e.state) : new Date(e.state)) : null, ok = t && !isNaN(t);
      const late = !ok || Date.now() - t > (b.stale || 26) * 3600e3, nx = b.next && st(b.next), nt = nx && new Date(nx.state);
      return `<div class="bk" style="--t:var(--${late ? 'lamp' : 'sage'})"><span class="aic">${icon(b.icon)}</span><span class="atx"><span class="awhat">${esc(b.name)}</span>
        <span class="awho">${ok ? since(t) : !b.entity ? 'Not set up' : silent ? 'Not reporting' : 'No backup yet'}${nt && !isNaN(nt) ? ' · next ' + until(nt) : ''}</span></span><span class="bkst">${icon(late ? 'alert' : 'check')}</span></div>`;
    }).join(''));
    watch(cfg.backups.flatMap((b) => [b.entity, b.next]).filter(Boolean), bdraw); tick(() => { if (!(Date.now() % 60000 < 1000)) return; bdraw(); });
  }
  return el;
}
