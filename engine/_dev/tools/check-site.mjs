#!/usr/bin/env node
// Checks one site's dashboard config without a browser or Home Assistant: it builds the site (assemble.sh, into a
// temporary folder), imports home.js, popups.js and every dashboard in node, and reads the card modules' source.
//   node check-site.mjs <site> [--entities FILE] [--mock] [--json] [--variant name=a,b]
//     <site>            a folder under sites/, or the path of a site folder (one with dash/home.js)
//     --entities FILE   the entity ids the real HA has, one per line (tools that save a HA snapshot write it)
//     --mock            compare entity ids with the site's mock/states.mjs instead
//     --variant tv=a,b  a dashboard that reads ?tv= while it loads is checked once per value (found in its source if not given)
// Fails (exit 1) on: a module that doesn't load; a card type with no module; an option a card never reads; a key in a
// tap action the engine never reads; a link to a pop-up, view, page or drawer that doesn't exist; a home.js key that is
// read but doesn't exist (the option values it leaves undefined are counted); an entity id that isn't in the list.
// sites/<site>/checks/not-in-ha.txt names the ids the config keeps although HA doesn't have them now (id # why).
// Warns (exit code unchanged) about home.js keys nothing reads, a key written twice in home.js, nested options nothing
// reads, and pop-ups a card can open that the dashboard doesn't have. What it could not check is listed too, so a clean
// run doesn't claim more than it looked at. --json prints the same as one object.
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { build, override, siteFolder, ROOT } from '../test/stub.mjs';

const t0 = Date.now();
const argv = process.argv.slice(2), flag = (f) => argv.includes(f);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const site = argv.find((a, i) => !a.startsWith('--') && !['--entities', '--variant'].includes(argv[i - 1]));
if (!site || flag('--help')) { console.error('usage: check-site.mjs <site> [--entities FILE] [--mock] [--json] [--variant name=a,b]'); process.exit(2); }
const forced = new Map(argv.flatMap((a, i) => (argv[i - 1] === '--variant' ? [[a.split('=')[0], (a.split('=')[1] || '').split(',')]] : [])));

// ---------------- findings ----------------
// One entry per distinct problem: the same card reached through three dashboards is one finding with three places.
const found = { error: new Map(), warning: new Map() };
function report(level, check, file, where, message, same) {
  const key = check + '|' + (same || file + '|' + where + '|' + message), place = file + (where ? ': ' + where : '');
  const f = found[level].get(key);
  if (!f) found[level].set(key, { check, file, path: where, message, also: [] });
  else if (place !== f.file + (f.path ? ': ' + f.path : '') && !f.also.includes(place)) f.also.push(place);
}
const notChecked = [], info = [];

// ---------------- reading source ----------------
// lex(text) gives two copies of the same length as the text: `code` without comments, `bare` also without the insides
// of strings and regular expressions (the code inside a template's ${ } is kept). Positions and line breaks stay put.
function lex(src) {
  const code = [], bare = []; let i = 0, last = '', word = ''; const n = src.length;
  const put = (s, c, b) => { for (const ch of s) { code.push(c || ch === '\n' ? ch : ' '); bare.push(b || ch === '\n' ? ch : ' '); } };
  const regexHere = () => !last || '(,=:[!&|?{};+-*%<>~^'.includes(last) || /^(return|typeof|case|in|of|delete|void|throw)$/.test(word);
  (function run(inTemplate) {
    let depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; put(src.slice(i, j)); i = j; continue; }
      if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; put(src.slice(i, j)); i = j; continue; }
      if (c === '"' || c === "'") { let j = i + 1; while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        put(c, true, true); put(src.slice(i + 1, j), true); put(src[j] || '', true, true); i = j + 1; last = c; word = ''; continue; }
      if (c === '`') { put(c, true, true); i++;
        while (i < n && src[i] !== '`') {
          if (src[i] === '\\') { put(src.slice(i, i + 2), true); i += 2; } else if (src[i] === '$' && src[i + 1] === '{') { put('${', true, true); i += 2; run(true); put('}', true, true); i++; }
          else { put(src[i], true); i++; } }
        put('`', true, true); i++; last = '`'; word = ''; continue; }
      if (c === '/' && regexHere()) { let j = i + 1, cls = false;
        while (j < n && src[j] !== '\n' && (cls || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
        put('/', true, true); put(src.slice(i + 1, j), true); put(src[j] || '', true, true); i = j + 1; last = ')'; word = ''; continue; }
      if (inTemplate) { if (c === '{') depth++; else if (c === '}') { if (!depth) return; depth--; } }
      put(c, true, true); i++;
      if (/[\w$]/.test(c)) { word = /[\w$]/.test(last) && /[\w$]/.test(src[i - 2] || '') ? word + c : c; last = c; } else if (!/\s/.test(c)) { last = c; word = ''; }
    }
  })(false);
  return { code: code.join(''), bare: bare.join('') };
}
// The build: engine + the site's files on top, as deployed. In it the store's readers are wrapped (a test double, see
// ../test/stub.mjs), so the ids a config function asks the store for are seen.
let asking = null, store = null;   // asking: the set that collects ids while one config function runs
override('core/store.js', Object.fromEntries(['st', 'isOn', 'num', 'attr'].map((f) => [f, (id, ...more) => { if (asking && typeof id === 'string') asking.add(id); return store[f](id, ...more); }])), site);
const dir = build(site);
const siteRoot = siteFolder(site), siteDir = path.join(siteRoot, 'dash'), siteName = path.basename(siteRoot);
const sources = new Map();   // path in the build -> { rel, code, bare, text, fromSite }
function source(rel) {
  if (!sources.has(rel)) { const file = path.join(dir, rel);
    if (!fs.existsSync(file)) { sources.set(rel, null); return null; }
    const text = fs.readFileSync(file, 'utf8'); sources.set(rel, { rel, text, ...lex(text), fromSite: fs.existsSync(path.join(siteDir, rel)) }); }
  return sources.get(rel);
}
const lineOf = (s, pos) => s.text.slice(0, pos).split('\n').length;
// a folder's modules; deep: with those in folders of its own (a card's parts: cards/music/, core/remote/)
const jsFiles = (d, deep = false) => (fs.existsSync(path.join(dir, d)) ? fs.readdirSync(path.join(dir, d), { recursive: deep }).filter((f) => f.endsWith('.js')).map((f) => (d === '.' ? f : d + '/' + f.split(path.sep).join('/'))) : []);
// every module of the dashboard: the engine's and the site's (not third-party code, the generated icons or the boot shell)
const allFiles = [...jsFiles('.').filter((f) => !['icons.js', 'boot.js'].includes(f)), ...jsFiles('core', true), ...jsFiles('cards', true), ...jsFiles('pages', true), ...jsFiles('dashboards')];
const IDENT = '[A-Za-z_$][\\w$]*', rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const splitTop = (s) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if ('([{'.includes(ch)) d++; if (')]}'.includes(ch)) d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };

// ---------------- which options a card reads ----------------
// Cards are written as `export default function name(cfg, ctx)` and read options as cfg.x. This follows the config
// object through the file: cfg.x, destructuring, another name given to it, a helper it is handed to (in this file or
// an imported one), another card it is spread into. Anything it can't follow makes the card "not checked" rather than
// guessed at. Reads are collected per file and name, not per function, so the list errs on the side of "is read".
function follow(rel, name, out, seen) {
  const key = rel + '|' + name; if (seen.has(key)) return; seen.add(key);
  const s = source(rel); if (!s) { out.unsure.add(`${rel} is missing`); return; }
  const N = `(?<![\\w$])${rx(name)}(?![\\w$])`;
  for (const m of s.bare.matchAll(new RegExp(`${N}\\s*\\??\\.\\s*(${IDENT})`, 'g'))) out.reads.add(m[1]);
  for (const m of s.code.matchAll(new RegExp(`${N}\\s*\\[\\s*(['"])([\\w$-]+)\\1\\s*\\]`, 'g'))) out.reads.add(m[2]);
  for (const m of s.bare.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${N}(?!\\s*[.\\[(])`, 'g'))) names(m[1], out, rel);
  const params = [];   // where parameter lists are, so a parameter isn't taken for a use
  for (const m of s.bare.matchAll(new RegExp(`function\\s*(?:${IDENT})?\\s*\\(([^)]*)\\)|\\(([^()]*)\\)\\s*=>|(?<![\\w$.])(${IDENT})\\s*=>`, 'g'))) params.push([m.index, m.index + m[0].length]);
  for (const m of s.bare.matchAll(new RegExp(N, 'g'))) {
    const p = m.index, e = p + name.length, after = s.bare.slice(e, e + 40).trimStart(), before = s.bare.slice(Math.max(0, p - 200), p).trimEnd();
    if (/^(\?\.|\.(?!\.)|\[\s*['"])/.test(after)) continue;                       // name.x / name['x']: read above
    if (after[0] === '[') { out.unsure.add(`${rel} reads options by a computed name`); continue; }
    if (params.some(([a, b]) => p >= a && p < b)) continue;                        // a parameter
    if (/^=(?![=>])/.test(after) || /\}\s*=$/.test(before)) continue;             // assigned to, or destructured (read above)
    const spread = before.endsWith('...');
    const lead = spread ? before : before.replace(new RegExp(`(?:${IDENT}\\s*\\.\\s*)+$`), '').trimEnd();   // const base = cam.cfg
    const alias = !spread && /^([,;)\n]|$)/.test(after || '\n') && given(lead);
    if (alias) { follow(rel, alias, out, seen); continue; }                       // const c = cfg;  const next = pick ? other : cfg
    const open = opener(s.bare, p);
    if (open && s.bare[open] === '{') {
      const lead = s.bare.slice(Math.max(0, open - 200), open).trimEnd();
      if (!spread && /[{,]$/.test(before) && /^[,}]/.test(after)) continue;       // { cfg, el }: kept under its own name, and .cfg.x is read above
      const asKey = !spread && new RegExp(`(${IDENT})\\s*:$`).exec(before);
      if (asKey) { follow(rel, asKey[1], out, seen); continue; }                  // { options: cfg }
      const named = spread && given(lead);
      if (named) { follow(rel, named, out, seen); continue; }                     // const o = { ...cfg, more };  const next = pick ? { ...cfg, more } : cfg
      const outer = spread && /[(,]$/.test(lead) ? opener(s.bare, open) : null;
      if (outer != null && s.bare[outer] === '(' && passed(rel, s, outer, open, out, seen)) continue;   // helper({ ...cfg, more })
      out.unsure.add(`${rel} copies its options somewhere this can't follow (line ${lineOf(s, p)})`); continue;
    }
    if (open != null && s.bare[open] === '(') {
      if (/(?<![\w$.])(if|while|return|typeof)\s*$/.test(s.bare.slice(Math.max(0, open - 12), open)) || /^(\)|&&|\|\||\?)/.test(after) && /(\(|&&|\|\||!)$/.test(before)) continue;   // only tested
      if (passed(rel, s, open, p, out, seen)) continue;
    }
    out.unsure.add(`${rel} hands its options to something this can't follow (line ${lineOf(s, p)})`);
  }
}
// the name a value is given, when the text before it ends in `name =` or `name = test ?` / `name = test ? other :`
function given(before) { const m = /[=?:]$/.test(before) && new RegExp(`(?<![\\w$])(${IDENT})\\s*=(?![=>])[^;=]*$`).exec(before); return m ? m[1] : null; }
function names(list, out, rel) {   // the names in a destructuring pattern
  for (const part of splitTop(list)) { const t = part.trim(); if (!t) continue;
    if (t.startsWith('...')) out.unsure.add(`${rel} takes the rest of its options (${t})`); else out.reads.add(t.split(/[:=]/)[0].trim()); }
}
function opener(bare, pos) {   // the bracket that encloses this position
  let d = 0;
  for (let i = pos - 1; i >= 0; i--) { const c = bare[i]; if (')]}'.includes(c)) d++; else if ('([{'.includes(c)) { if (!d) return i; d--; } }
  return null;
}
// the options are argument number k of a call: find the function and follow its parameter
function passed(rel, s, open, pos, out, seen) {
  const callee = new RegExp(`(?<![\\w$.])(${IDENT})\\s*$`).exec(s.bare.slice(Math.max(0, open - 80), open));
  if (!callee || /^(if|while|for|switch|return|function|catch)$/.test(callee[1])) return false;
  const k = splitTop(s.bare.slice(open + 1, pos)).length - 1, fn = callee[1];
  const local = paramOf(s, new RegExp(`function\\s+${rx(fn)}\\s*\\(([^)]*)\\)|(?<![\\w$.])${rx(fn)}\\s*=\\s*(?:async\\s*)?(?:\\(([^()]*)\\)|(${IDENT}))\\s*=>`), k);
  if (local) return param(rel, local, out, seen);
  for (const m of s.code.matchAll(/import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g)) {
    const to = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[3])), t = source(to); if (!t) continue;
    if (m[1] === fn) {   // another module's default export: a card handing its options to another card
      const def = paramOf(t, new RegExp(`export\\s+default\\s+(?:async\\s+)?(?:function\\s*(?:${IDENT})?\\s*\\(([^)]*)\\)|\\(([^()]*)\\)\\s*=>)`), k);
      return def ? param(to, def, out, seen) : false;
    }
    const pick = (m[2] || '').split(',').map((x) => x.trim().split(/\s+as\s+/)).find((x) => (x[1] || x[0]) === fn);
    if (pick) { const def = paramOf(t, new RegExp(`export\\s+(?:async\\s+)?function\\s+${rx(pick[0])}\\s*\\(([^)]*)\\)|export\\s+const\\s+${rx(pick[0])}\\s*=\\s*(?:async\\s*)?(?:\\(([^()]*)\\)|(${IDENT}))\\s*=>`), k);
      return def ? param(to, def, out, seen) : false; }
  }
  return false;
}
function paramOf(s, re, k) { const m = re.exec(s.bare); if (!m) return null; const list = splitTop(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3] || ''); return list[k] ? list[k].trim().replace(/\s*=[^=].*$/s, '') || null : null; }
function param(rel, p, out, seen) { if (p.startsWith('{')) names(p.slice(1, p.lastIndexOf('}')), out, rel); else if (new RegExp(`^${IDENT}$`).test(p)) follow(rel, p, out, seen); else return false; return true; }

// the line of a card in a site file, when the file writes that type exactly once
function lineHint(file, type) { const s = source(file); if (!s) return ''; const hits = [...s.code.matchAll(new RegExp(`type:\\s*['"]${rx(type)}['"]`, 'g'))]; return hits.length === 1 ? `, line ${lineOf(s, hits[0].index)}` : ''; }
const cardInfo = new Map();
function optionsOf(type) {
  if (cardInfo.has(type)) return cardInfo.get(type);
  const rel = `cards/${type}.js`, s = source(rel), out = { reads: new Set(), unsure: new Set(), exists: !!s, opens: [] };
  cardInfo.set(type, out);
  if (!s) return out;
  const head = paramOf(s, new RegExp(`export\\s+default\\s+(?:async\\s+)?(?:function\\s*(?:${IDENT})?\\s*\\(([^)]*)\\)|\\(([^()]*)\\)\\s*=>)`), 0);
  if (head) { if (!param(rel, head, out, new Set())) out.unsure.add(`${rel}: its first parameter isn't a plain name`); }
  else if (!/export\s+default\s+(?:async\s+)?(?:function\s*[\w$]*\s*\(\s*\)|\(\s*\)\s*=>)/.test(s.bare)) out.unsure.add(`${rel}: no default export this can read`);
  // pop-ups the card opens by a fixed name: location.hash = '#recordings', or cfg.nav || '#review' (an option replaces it)
  for (const m of s.code.matchAll(new RegExp(`location\\.hash\\s*=\\s*(?:${IDENT}\\.(${IDENT})\\s*\\|\\|\\s*)?'#?([\\w-]+)'(?!\\s*\\+)`, 'g'))) out.opens.push({ popup: m[2], unless: m[1] });
  return out;
}
const generic = { reads: new Set(), unsure: new Set() };   // options the layout reads on every card (span, show, class, grow, ...)
follow('core/layout.js', 'cfg', generic, new Set());
// tap actions: the keys core/actions.js reads on an action, and the option names cards hand to run()
const actionKeys = new Set(), actionSlots = new Set(['tap', 'hold', 'action']);
{ const a = source('core/actions.js');
  if (a) { for (const m of a.bare.matchAll(new RegExp(`(?<![\\w$.])a\\.(${IDENT})`, 'g'))) actionKeys.add(m[1]); }   // run() calls the action `a`
  for (const f of allFiles) { const s = source(f); if (s) for (const m of s.bare.matchAll(new RegExp(`(?<![\\w$.])run\\(\\s*(?:${IDENT}\\s*\\??\\.\\s*)+(${IDENT})\\s*[,)|]`, 'g'))) actionSlots.add(m[1]); } }
const isAction = (key) => actionSlots.has(key) || /Tap$/.test(key);
// option names whose value is a view (or view/page): cards send them as the detail of a dash:view event
const viewKeys = new Set(['view']);
for (const f of [...jsFiles('cards', true), 'core/actions.js']) { const s = source(f); if (s) for (const m of s.code.matchAll(new RegExp(`'dash:view',\\s*\\{\\s*detail:\\s*(?:${IDENT}\\.)+(${IDENT})`, 'g'))) if (m[1] !== 'tap') viewKeys.add(m[1]); }
const enginePopups = new Set(); { const p = source('core/popup.js'), m = p && /ENGINE_POPUPS\s*=\s*\{([^}]*)\}/.exec(p.bare); if (m) splitTop(m[1]).forEach((x) => { const k = x.split(':')[0].trim(); if (k) enginePopups.add(k); }); }

// ---------------- loading the config ----------------
store = await import(pathToFileURL(path.join(dir, 'core/store.real.js')).href);
globalThis.fetch = () => Promise.reject(new Error('check-site: no network'));   // nothing a config function starts leaves this process
process.on('unhandledRejection', () => {});
// what a module reads from the page address while it is imported (a dashboard that differs per screen: ?tv=<id>)
let search = '', searchReads = 0, importing = false; const paramsRead = new Set();
Object.defineProperty(globalThis.location, 'search', { get() { if (importing) searchReads++; return search; }, set(v) { search = v; }, configurable: true });
{ const get = URLSearchParams.prototype.get; URLSearchParams.prototype.get = function (k) { if (importing) paramsRead.add(k); return get.call(this, k); }; }
async function imp(rel, query) {
  importing = true; paramsRead.clear(); const before = searchReads;
  try { return { mod: await import(pathToFileURL(path.join(dir, rel)).href + (query ? '?' + query : '')), params: [...paramsRead], read: searchReads > before }; }
  catch (e) { report('error', 'load', rel, '', `doesn't load: ${String(e && e.message || e).split('\n')[0]}`); return { mod: null, params: [], read: false }; }
  finally { importing = false; }
}
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const home = (await imp('home.js')).mod || {};
const popupsMod = fs.existsSync(path.join(dir, 'popups.js')) ? (await imp('popups.js')).mod : null;

// where a config object was written, when it is an export of a site module (so a shared pop-up is reported once, in popups.js)
const origin = new Map();
const own = (obj, file, where) => { if (obj && typeof obj === 'object' && !origin.has(obj)) origin.set(obj, { file, where }); };
function exportsOf(mod, file) {
  for (const [name, v] of Object.entries(mod || {})) {
    if (name === 'default' && plain(v) && !Array.isArray(v.views)) { own(v, file, ''); if (file === 'popups.js') Object.entries(v).forEach(([id, p]) => own(p, file, id)); }
    else if (name !== 'default') { own(v, file, name); if (Array.isArray(v)) v.forEach((x, i) => own(x, file, `${name}[${i}]`)); }
  }
}
exportsOf(popupsMod, 'popups.js');

// the values a dashboard looks up with a page-address parameter: the keys of the table it indexes with it
//   const id = new URLSearchParams(location.search).get('tv'); const tv = TVS[id]   ->   the keys of TVS
function variantsIn(rel, name) {
  if (forced.has(name)) return { values: forced.get(name), how: 'given with --variant' };
  const s = source(rel), v = s && new RegExp(`(${IDENT})\\s*=\\s*new\\s+URLSearchParams\\(\\s*location\\.search\\s*\\)\\.get\\(\\s*['"]${rx(name)}['"]`).exec(s.code);
  const table = v && new RegExp(`(?<![\\w$.])(${IDENT})\\[\\s*${rx(v[1])}\\s*\\]`).exec(s.bare);
  const def = table && new RegExp(`(?:const|let|var)\\s+${rx(table[1])}\\s*=\\s*\\{`).exec(s.bare);
  if (!def) return null;
  const start = def.index + def[0].length; let d = 1, i = start; while (i < s.bare.length && d) { if (s.bare[i] === '{') d++; else if (s.bare[i] === '}') d--; i++; }
  const values = splitTop(s.code.slice(start, i - 1)).map((x) => x.split(':')[0].trim().replace(/^['"]|['"]$/g, '')).filter((x) => /^[\w-]+$/.test(x));
  return values.length ? { values, how: `the keys of ${table[1]} in ${rel}` } : null;
}
const dashboards = [];   // { label, file, dash }
// Main first and the component gallery last, so a card that several dashboards share is reported where it is used for real
const GALLERY = 'dashboards/gallery.js';   // gallery.html shows copies of the other dashboards' cards, one type at a time
{ const rank = (f) => (f === 'dashboards/main.js' ? 0 : f === GALLERY ? 2 : 1), list = jsFiles('dashboards').sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  const loaded = [];
  for (const rel of list) { const r = await imp(rel); if (r.mod) loaded.push([rel, r]); }
  for (const [rel, r] of loaded) exportsOf(r.mod, rel);
  for (const [rel, r] of loaded) {
    const d = r.mod.default; if (!plain(d) || !Array.isArray(d.views)) continue;   // a module of parts or one view, not a dashboard
    const name = path.basename(rel, '.js');
    dashboards.push({ label: name, file: rel, dash: d });
    for (const p of r.params) {
      if (!new RegExp(`\\.get\\(\\s*['"]${rx(p)}['"]`).test(source(rel).code)) continue;   // read by a module it imports, not by the dashboard
      const v = variantsIn(rel, p);
      if (!v) { notChecked.push(`${rel} reads ?${p}= while it loads and this found no list of its values: only the page without it was checked (give --variant ${p}=a,b)`); continue; }
      info.push(`${rel}: checked without ?${p}= and once for each of ${v.values.length} values (${v.how}): ${v.values.join(', ')}`);
      for (const val of v.values) {
        search = `?${p}=${val}`; const x = await imp(rel, `${p}=${val}`); search = '';
        if (x.mod && !x.read) notChecked.push(`${rel}?${p}=${val}: the address is read by a module it imports, so this variant could not be loaded on its own`);
        if (x.mod && plain(x.mod.default)) dashboards.push({ label: `${name}?${p}=${val}`, file: rel, dash: x.mod.default, variant: `?${p}=${val}` });
      }
    }
  } }
if (!dashboards.length) report('error', 'load', 'dashboards/', '', 'no dashboard loaded (a dashboard is a module whose default export has `views`)');

// ---------------- entity ids ----------------
const listed = opt('--entities') ? new Set(fs.readFileSync(opt('--entities'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) : null;
const mockFile = path.join(siteRoot, 'mock/states.mjs'), mockName = `sites/${siteName}/mock/states.mjs`;
let mock = null;
if (fs.existsSync(mockFile)) { try { mock = (await import(pathToFileURL(mockFile).href)).S || null; } catch (e) { if (flag('--mock')) report('error', 'load', mockName, '', `doesn't load: ${e.message.split('\n')[0]}`); else notChecked.push(`${mockName} doesn't load (${e.message.split('\n')[0]}): nothing is said about the mock`); mock = undefined; } }
const DOMAINS = new Set(('alarm_control_panel automation binary_sensor button calendar camera climate cover device_tracker event fan image input_boolean input_button input_datetime ' +
  'input_number input_select input_text light lock media_player number person remote scene script select sensor siren sun switch text time timer todo update vacuum valve water_heater weather zone').split(' '));
if (listed) listed.forEach((id) => DOMAINS.add(id.split('.')[0]));
if (mock) Object.keys(mock).forEach((id) => DOMAINS.add(id.split('.')[0]));
const isId = (v) => typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(v) && DOMAINS.has(v.slice(0, v.indexOf('.')));
const ids = new Map();   // id -> { file, where, dash: used by a dashboard (not only named in home.js) }
function sawId(id, file, where, dash) { const e = ids.get(id); if (!e) ids.set(id, { file, where, dash }); else if (dash && !e.dash) { e.dash = true; if (e.file === 'home.js' && file !== 'home.js') e.usedAt = file + ': ' + where; } }
// literals in the site's own files, with their line (a service name after call: is not an entity; neither is a prefix ids are built from)
const siteFiles = allFiles.filter((f) => source(f) && source(f).fromSite);
let builtAtRunTime = 0;
for (const f of siteFiles) { const s = source(f);
  for (const m of s.code.matchAll(/(['"`])([a-z_]+\.[a-z0-9_]+)\1/g)) {
    if (!isId(m[2]) || /\b(?:call\s*[:(]|service\s*:|\w*prefix\s*:)[^,;{}]*$/i.test(s.code.slice(Math.max(0, m.index - 120), m.index))) continue;
    sawId(m[2], f, 'line ' + lineOf(s, m.index), f !== 'home.js'); }
  builtAtRunTime += (s.code.match(/`[^`\n]*\b[a-z_]+\.[a-z0-9_]*\$\{/g) || []).filter((t) => DOMAINS.has(/([a-z_]+)\.[a-z0-9_]*\$\{$/.exec(t)[1])).length; }

// ---------------- walking a dashboard ----------------
const SKIP_RUN = new Set(['onOpen', 'after']);   // functions that do something rather than say something: never run here
const fns = new Map();   // every function in the config, once: fn -> { file, where, key }
const undefinedAt = [];  // { file, where, key }
const cardCount = { cards: 0, types: new Set() };
const literalUndefined = new Set();   // option names some source sets to undefined on purpose:  height: undefined
for (const f of allFiles) { const s = source(f); if (s) for (const m of s.bare.matchAll(new RegExp(`(${IDENT})\\s*:\\s*undefined(?![\\w$])`, 'g'))) literalUndefined.add(m[1]); }

function checkDashboard({ label, file, dash }) {
  const views = new Set(), popups = new Map([...enginePopups].map((k) => [k, null])), drawers = new Set(), links = [], cardTypes = new Map();
  for (const v of dash.views) { if (!v || !v.id) { report('error', 'link', file, 'views', 'a view without an id'); continue; } views.add(v.id); (v.pages || []).forEach((p) => views.add(v.id + '/' + p.id)); }
  Object.entries(dash.popups || {}).forEach(([id, p]) => popups.set(id, p));
  const at = (obj, f, w) => origin.get(obj) || { file: f, where: w };
  const join = (w, k) => (w ? w + (k.startsWith('[') ? '' : '.') + k : k);

  // every value below one card (or below the dashboard, outside cards): ids, links, functions, undefined values
  function values(v, key, f, w, card, depth, inAction, inList) {
    if (typeof v === 'string') {
      if (isId(v) && key !== 'call' && !/prefix/i.test(key)) sawId(v, f, w, true);
      link(key, v, f, w, card);
      return;
    }
    if (typeof v === 'function') { if (!fns.has(v)) fns.set(v, { file: f, where: w, key, label, links: (k, s, ww) => link(k, s, f, ww, card) }); return; }
    if (v === undefined && depth) { undefinedAt.push({ file: f, where: w, key, type: card && card.type }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => { const o = plain(x) ? at(x, f, `${w}[${i}]`) : { file: f, where: `${w}[${i}]` }; if (!(key === 'cards' && plain(x))) values(x, key, o.file, o.where, card, depth + 1, inAction, true); }); return; }
    if (!plain(v)) return;
    const action = isAction(key);   // inList: v is an item of a list, so its keys are option names; an object some code indexes by a computed name (labels[value]) holds data
    for (const k of Object.keys(v)) {
      if (isId(k)) sawId(k, f, w + ' (key)', true);
      if (action && !actionKeys.has(k)) report('error', 'action', f, join(w, k), `'${k}' is not something a tap action reads (core/actions.js)`, `${k}|${card && card.type}`);
      else if (card && !action && !inAction && !isId(k) && !(namesIndexed.has(key) && !inList) && v[k] !== undefined && !nameRead(k)) report('warning', 'nested', f, join(w, k), `no code reads a key named '${k}' (inside the options of a ${card.type} card)`, `${k}|${card.type}`);
      if (k === 'cards' && Array.isArray(v[k])) continue;   // nested cards are cards of their own (below)
      values(v[k], k, f, join(w, k), card, depth + 1, inAction || action);
    }
  }
  function link(key, v, f, w, card) {
    if ((key === 'nav' || key === 'open' || key === 'more') && v[0] === '#') links.push({ kind: 'popup', to: v.slice(1), file: f, where: w });
    else if (viewKeys.has(key) || (key === 'tap' && !['toggle', 'none'].includes(v))) links.push({ kind: 'view', to: v, file: f, where: w });
    else if (key === 'drawer' && !(card && card.type === 'drawer')) links.push({ kind: 'drawer', to: v, file: f, where: w });
  }
  function cards(list, f, w) {
    (list || []).forEach((c, i) => {
      const o = plain(c) ? at(c, f, `${w}[${i}]`) : { file: f, where: `${w}[${i}]` };
      if (!plain(c)) { report('error', 'type', o.file, o.where, `not a card: ${c === undefined ? 'undefined' : JSON.stringify(c)}`); return; }
      cardCount.cards++;
      if (typeof c.type !== 'string') { report('error', 'type', o.file, o.where, 'a card without a type'); return; }
      cardCount.types.add(c.type);
      const card = optionsOf(c.type);
      if (!cardTypes.has(c.type)) cardTypes.set(c.type, []);
      cardTypes.get(c.type).push(c);
      if (!card.exists) report('error', 'type', o.file, o.where, `card type '${c.type}' has no module (cards/${c.type}.js)`, c.type);
      else if (!card.unsure.size) for (const k of Object.keys(c)) {
        if (c[k] === undefined || generic.reads.has(k) || card.reads.has(k)) continue;
        report('error', 'option', o.file, `${o.where} (${c.type}${lineHint(o.file, c.type)})`, `option '${k}' is never read by the ${c.type} card`, `${c.type}|${k}`);
      }
      if (c.type === 'drawer' && c.id) drawers.add(c.id);
      for (const k of Object.keys(c)) { if (k === 'cards' && Array.isArray(c[k])) continue;
        if (c[k] === undefined) undefinedAt.push({ file: o.file, where: join(o.where, k), key: k, type: c.type });
        else values(c[k], k, o.file, join(o.where, k), c, 0, false); }
      if (Array.isArray(c.cards)) cards(c.cards, o.file, join(o.where, 'cards'));
    });
  }
  dash.views.forEach((v) => {
    if (!plain(v)) return; const o = at(v, file, `views.${v.id}`);
    const secs = (list, w) => (list || []).forEach((sec, i) => { for (const k of Object.keys(sec || {})) if (k !== 'cards') values(sec[k], k, o.file, `${w}[${i}].${k}`, null, 1, false); cards(sec && sec.cards, o.file, `${w}[${i}].cards`); });
    for (const k of Object.keys(v)) if (k !== 'sections' && k !== 'pages') values(v[k], k, o.file, join(o.where, k), null, 1, false);
    secs(v.sections, join(o.where, 'sections'));
    (v.pages || []).forEach((p) => { for (const k of Object.keys(p)) if (k !== 'sections') values(p[k], k === 'id' ? '' : k, o.file, join(o.where, `pages.${p.id}.${k}`), null, 1, false); secs(p.sections, join(o.where, `pages.${p.id}.sections`)); });
  });
  Object.entries(dash.popups || {}).forEach(([id, p]) => {
    if (!plain(p)) return; const o = at(p, file, `popups.${id}`);
    for (const k of Object.keys(p)) if (k !== 'cards' && k !== 'pages') values(p[k], k, o.file, join(o.where, k), null, 1, false);
    cards(p.cards, o.file, join(o.where, 'cards'));
    (p.pages || []).forEach((pg, i) => { for (const k of Object.keys(pg)) if (k !== 'cards') values(pg[k], k, o.file, join(o.where, `pages[${i}].${k}`), null, 1, false); cards(pg.cards, o.file, join(o.where, `pages[${i}].cards`)); });
  });
  for (const k of Object.keys(dash)) if (k !== 'views' && k !== 'popups') values(dash[k], k, file, k, null, 1, false);
  (dash.tabs || []).forEach((t, i) => links.push({ kind: 'view', to: t, file, where: `tabs[${i}]` }));
  ((dash.unload || {}).keep || []).forEach((t, i) => links.push({ kind: 'view', to: t, file, where: `unload.keep[${i}]` }));

  // config functions that take no argument are run (they only read state); what they ask the store for and what they
  // return is looked at like the rest. With --mock they run a second time with the mock's states.
  const runAll = () => { for (const [fn, o] of fns) { if (o.label !== label || fn.length || SKIP_RUN.has(o.key)) continue;
    asking = new Set(); const quiet = console.error, warn = console.warn; console.error = console.warn = () => {};
    let r; try { r = fn(); o.ran = true; } catch (e) { o.threw = true; } finally { console.error = quiet; console.warn = warn; }
    if (r && typeof r.then === 'function') { r.catch(() => {}); r = null; }
    for (const id of asking) if (isId(id)) sawId(id, o.file, o.where + '()', true);
    asking = null;
    if (typeof r === 'string') o.links(o.key, r, o.where + '()');
    else if (plain(r) || Array.isArray(r)) results(r, o.key, o, o.where + '()', 0); } };
  const results = (v, key, o, w, depth) => { if (depth > 6) return;
    if (typeof v === 'string') { if (isId(v) && key !== 'call') sawId(v, o.file, w, true); o.links(key, v, w); }
    else if (Array.isArray(v)) v.forEach((x) => results(x, key, o, w, depth + 1));
    else if (plain(v)) for (const k of Object.keys(v)) results(v[k], k, o, w + '.' + k, depth + 1); };
  runAll();
  if (flag('--mock') && mock && store) { store.applyEntities({ a: Object.fromEntries(Object.entries(mock).map(([k, v]) => [k, { s: v.s, a: v.a || {}, lc: 1, lu: 1 }])) }); runAll(); store.applyEntities({ r: Object.keys(mock) }); }
  // links written inside any function: { nav: '#x' }, { view: 'a/b' }, { drawer: 'x' }
  for (const [fn, o] of fns) { if (o.label !== label) continue; const text = Function.prototype.toString.call(fn);
    for (const m of text.matchAll(/\b(nav|view|drawer)\s*:\s*(['"])([^'"$]+)\2/g)) o.links(m[1], m[3], o.where + ' (in the function)'); }

  for (const l of links) {
    if (l.kind === 'popup') { const [id, page] = l.to.split('/'), p = popups.get(id);
      if (!popups.has(id)) { if (file === GALLERY && deadPopups.has(id)) continue;   // a copy of a card already reported in its own dashboard
        deadPopups.add(id); report('error', 'link', l.file, l.where, `opens pop-up '#${id}', which ${label} doesn't have`, `${file}|#${id}`); }
      else if (page != null && !(p && p.pages && (p.pages.some((x) => x.title && x.title.toLowerCase() === page.toLowerCase()) || +page < p.pages.length))) report('error', 'link', l.file, l.where, `opens page '${page}' of pop-up '#${id}', which has no such page`, `${file}|#${l.to}`); }
    else if (file === GALLERY) continue;   // its cards are copies taken out of their dashboard: their view and drawer links lead nowhere there
    else if (l.kind === 'view') { if (l.to && !views.has(l.to)) report('error', 'link', l.file, l.where, `goes to view '${l.to}', which ${label} doesn't have`, `${file}|view|${l.to}`); }
    else if (!drawers.has(l.to)) report('error', 'link', l.file, l.where, `opens drawer '${l.to}', which ${label} doesn't have`, `${file}|drawer|${l.to}`);
  }
  // a card that opens a pop-up by a fixed name: the dashboard should have it (a warning: the button may be off by an option)
  for (const [type, list] of cardTypes) for (const o of optionsOf(type).opens) {
    if (!popups.has(o.popup) && list.some((c) => !(o.unless && c[o.unless]))) report('warning', 'opens', file, label, `has a ${type} card, which can open pop-up '#${o.popup}': ${label} doesn't have it`, `${file}|${type}|${o.popup}`); }
}
const deadPopups = new Set();

// names some code reads as a property, takes apart by name or writes in quotes: `.x`, { x } = …, 'x'. The loose test for
// keys this can't trace exactly: no reader of that name anywhere means nothing reads it; a reader of that name proves little.
const namesRead = new Set();
for (const f of allFiles) { const s = source(f); if (!s) continue;
  for (const m of s.bare.matchAll(new RegExp(`\\.\\s*(${IDENT})`, 'g'))) namesRead.add(m[1]);
  for (const m of s.code.matchAll(/(['"])([\w$-]+)\1/g)) namesRead.add(m[2]);
  if (f !== 'home.js') for (const m of s.bare.matchAll(/\{([^{}]*)\}\s*(?==(?![=>])|\)\s*(?:=>|\{))/g)) splitTop(m[1]).forEach((x) => { const k = x.trim().replace(/^\.\.\./, '').split(/[:=]/)[0].trim(); if (k) namesRead.add(k); }); }
const nameRead = (k) => namesRead.has(k) || /^\d+$/.test(k);
const namesIndexed = new Set();   // x.impact[name], Object.values(x.lights): the keys below such a name are data
for (const f of allFiles) { const s = source(f); if (!s) continue;
  for (const m of s.bare.matchAll(new RegExp(`(${IDENT})\\s*(?:\\|\\|\\s*\\{\\s*\\}\\s*\\)\\s*)?\\[(?!\\s*['"\\d\\]])`, 'g'))) namesIndexed.add(m[1]);   // labels[v], (cfg.labels || {})[v]
  for (const m of s.bare.matchAll(new RegExp(`Object\\.(?:values|entries|keys)\\(\\s*(?:${IDENT}\\s*\\.\\s*)*(${IDENT})\\s*[)|]`, 'g'))) namesIndexed.add(m[1]);
  for (const m of s.bare.matchAll(new RegExp(`(${IDENT})\\s*=\\s*(?:${IDENT}\\s*\\.\\s*)+(${IDENT})\\s*(?:\\|\\||[,;\\n])`, 'g'))) if (namesIndexed.has(m[1])) namesIndexed.add(m[2]); }   // const IMPACT = d.impact || {}; IMPACT[name]

for (const d of dashboards) checkDashboard(d);

// ---------------- home.js: what is read, what is missing, what nothing reads ----------------
const homeRead = new Set(), homeWhole = new Set(), homeMap = new Set(), homeMissing = new Map();
{ const P = (a) => a.join('.');
  const get = (pth) => pth.reduce((v, k) => (v == null ? undefined : v[k]), home);
  for (const f of allFiles) { const s = source(f); if (!s) continue;
    const alias = new Map(), defs = [];   // a name in this file -> the path in home.js it stands for
    if (f === 'home.js') Object.keys(home).forEach((k) => alias.set(k, [k]));
    for (const m of s.code.matchAll(/import\s*\*\s*as\s+([\w$]+)\s+from\s*['"]([^'"]+)['"]/g)) if (path.posix.normalize(path.posix.join(path.posix.dirname(f), m[2])) === 'home.js') alias.set(m[1], []);
    for (const m of s.code.matchAll(/import\s*(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) if (path.posix.normalize(path.posix.join(path.posix.dirname(f), m[2])) === 'home.js')
      m[1].split(',').forEach((x) => { const [a, b] = x.trim().split(/\s+as\s+/); if (a) alias.set(b || a, [a]); });
    if (!alias.size) continue;
    const chain = new RegExp(`(?<![\\w$])(?<!(?<!\\.\\.)\\.)(${IDENT})((?:\\.${IDENT})*)`, 'g');
    for (let round = 0, grew = true; grew && round < 6; round++) { grew = false;   // const S = H.security; const W = S.window_floors
      for (const m of s.bare.matchAll(new RegExp(`(?<![\\w$.])(${IDENT})\\s*=\\s*(${IDENT})((?:\\.${IDENT})*)\\s*(?=[,;\\n]|$)`, 'gm'))) {
        if (!alias.has(m[2]) || alias.has(m[1])) continue;
        const to = [...alias.get(m[2]), ...m[3].split('.').filter(Boolean)], v = get(to);
        if (v && typeof v === 'object') { alias.set(m[1], to); defs.push(m.index + m[0].length); grew = true; } } }
    for (const m of s.bare.matchAll(chain)) {
      if (!alias.has(m[1])) continue;
      const end = m.index + m[0].length, after = s.bare.slice(end, end + 30), before = s.bare.slice(Math.max(0, m.index - 30), m.index);
      if (f === 'home.js' && (/(?:const|let|var|function)\s+$/.test(before) || /^\s*:/.test(after) && !m[2])) continue;   // where it is defined
      if (alias.get(m[1]).length === 0 && !m[2]) continue;   // the whole of home.js handed on (the engine gives it to cards as ctx.home)
      if (/^\s*=(?![=>])/.test(after)) continue;            // const S = H.security: the name being given
      let cur = get(alias.get(m[1])); const at = [...alias.get(m[1])]; if (at.length) homeRead.add(P(at));
      let stopped = false;
      for (const seg of m[2].split('.').filter(Boolean)) {
        const isNs = !at.length;
        if (!(isNs || plain(cur))) { stopped = true; if (Array.isArray(cur)) homeWhole.add(P(at)); break; }   // a method or a property of a value
        if (!Object.prototype.hasOwnProperty.call(cur, seg) && !(isNs && seg in cur)) {
          if (!(seg in Object.prototype) && s.fromSite) { const k = P([...at, seg]); if (!homeMissing.has(k)) homeMissing.set(k, []); homeMissing.get(k).push(`${f}:${lineOf(s, m.index)}`); }
          stopped = true; break; }
        cur = cur[seg]; at.push(seg); homeRead.add(P(at));
      }
      if (stopped || !cur || typeof cur !== 'object') continue;
      if (defs.includes(end)) continue;   // only given another name
      if (/^\s*\[/.test(after) || /Object\.(?:values|entries|keys)\(\s*$/.test(before) || /\b(?:in|of)\s+$/.test(before)) homeMap.add(P(at)); else homeWhole.add(P(at));
    }
    // ctx.home.x / home.x in a card
    if (!s.fromSite) for (const m of s.bare.matchAll(new RegExp(`(?<![\\w$])home\\.(${IDENT})`, 'g'))) if (m[1] in home) homeRead.add(m[1]);
  }
  for (const [k, places] of homeMissing) {
    const last = k.split('.').pop(), n = undefinedAt.filter((u) => u.key === last).length;
    undefinedAt.forEach((u) => { if (u.key === last) u.explained = true; });
    report('error', 'home-missing', 'home.js', k, `doesn't exist, but is read at ${places.slice(0, 12).join(', ')}${places.length > 12 ? ` (+${places.length - 12})` : ''}` + (n ? `; ${n} option value${n > 1 ? 's are' : ' is'} undefined because of it` : ''));
  }
  const homeSelf = new Set([...(source('home.js') || { bare: '' }).bare.matchAll(new RegExp(`\\.\\s*(${IDENT})`, 'g'))].map((m) => m[1]));   // .x in home.js: read through a local name there
  const idsUnder = (v) => { let n = 0; (function w(x) { if (isId(x)) n++; else if (x && typeof x === 'object') { Object.keys(x).forEach((k) => { if (isId(k)) n++; }); Object.values(x).forEach(w); } })(v); return n; };
  const unread = (pth, v, why) => report('warning', 'home-unread', 'home.js', pth, why + (idsUnder(v) ? ` (${idsUnder(v)} entity id${idsUnder(v) > 1 ? 's' : ''} under it)` : ''));
  // exact: the path is never read and nothing above it is handed on whole. loose: something above it is handed on (to a
  // card, a page, a loop), so only "no code reads a key of this name" can be said.
  (function walk(v, at, loose, depth) {
    if (Array.isArray(v)) { const seen = new Set();
      v.forEach((x) => { if (plain(x)) for (const k of Object.keys(x)) { if (seen.has(k) || isId(k)) continue; seen.add(k);
        if (!nameRead(k)) unread(P(at) + '[].' + k, v.map((y) => y && y[k]), 'no code reads a key of this name');
        else v.forEach((y) => { if (y && y[k] && typeof y[k] === 'object') walk(y[k], [...at, '[]', k], true, depth + 1); }); } });
      return; }
    if (!plain(v) && at.length) return;
    // a map: its keys are data (entity ids, or names some code looks up with a computed index), not names to find readers for
    const isMap = homeMap.has(P(at)) || Object.keys(v).some(isId) || (at.length > 0 && namesIndexed.has(at[at.length - 1]) && !Object.keys(v).some((k) => homeRead.has(P([...at, k]))));
    for (const k of Object.keys(v)) {
      const p = [...at, k], ps = P(p), child = v[k];
      if (isMap) { if (child && typeof child === 'object') walk(child, p, true, depth + 1); continue; }
      if (!at.length || (!loose && !at.includes('[]'))) {
        if (!homeRead.has(ps) && !(at.length && homeSelf.has(k))) { unread(ps, child, at.length ? 'nothing reads it' : 'nothing reads this export'); continue; }
      } else if (!nameRead(k)) { unread(ps, child, 'no code reads a key of this name'); continue; }
      if (child && typeof child === 'object') walk(child, p, loose || homeWhole.has(ps) || homeMap.has(ps), depth + 1);
    }
  })(home, [], false, 0);
}
// duplicate keys in an object literal of home.js: the later one silently replaces the earlier one
{ const s = source('home.js');
  if (s) { const stack = []; let prev = '';
    for (let i = 0; i < s.bare.length; i++) { const c = s.bare[i];
      if (c === '{') stack.push({ object: /^(|[=([,:?]|return|=>\s*\()$/.test(prev) || prev.endsWith('('), keys: new Map(), open: i });
      else if (c === '}') stack.pop();
      else if ((prev === '{' || prev === ',') && stack.length && stack[stack.length - 1].object) {
        const m = /^(?:(['"])([^'"\n]*)\1|([A-Za-z_$][\w$]*)|(\d+))\s*:(?!:)/.exec(s.code.slice(i, i + 200));
        if (m) { const k = m[2] != null ? m[2] : m[3] || m[4], top = stack[stack.length - 1];
          if (top.keys.has(k)) report('warning', 'home-duplicate', 'home.js', `line ${lineOf(s, i)}`, `key '${k}' is written twice in one object (first at line ${top.keys.get(k)}); the later one wins`);
          else top.keys.set(k, lineOf(s, i)); } }
      if (!/\s/.test(c)) prev = /[\w$]/.test(c) && /[\w$]$/.test(prev) && /[\w$]/.test(s.bare[i - 1]) ? prev + c : c === '(' && prev === '=>' ? '=>(' : c === '>' && prev === '=' ? '=>' : c; } } }

// ---------------- undefined values ----------------
// An undefined value is an error where a missing home.js key explains it (above). The others are optional values a
// config passes on without having them ({ icon: x.icon }): counted, not judged.
{ const rest = undefinedAt.filter((u) => !u.explained && !literalUndefined.has(u.key) && u.file !== GALLERY), by = {};
  rest.forEach((u) => { by[u.key] = (by[u.key] || 0) + 1; });
  if (rest.length) info.push(`${rest.length} option values are undefined with no missing home.js key behind them (optional values passed on empty): ` + Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(', ')); }

// ---------------- entity ids against the list ----------------
const ran = [...fns.values()].filter((o) => o.ran).length, threw = [...fns.values()].filter((o) => o.threw).length, notRun = fns.size - ran - threw;
const known = flag('--mock') ? (mock ? new Set(Object.keys(mock)) : null) : listed;
const what = flag('--mock') ? mockName : path.relative(ROOT, path.resolve(opt('--entities') || ''));
if (flag('--mock') && mock === null) report('error', 'load', mockName, '', 'no mock states to compare with');
// Ids the site's config names on purpose though HA doesn't have them now (an integration that only makes them in some of
// its modes): sites/<site>/checks/not-in-ha.txt, one id per line with the reason after '#'. Listed as information, and an
// entry HA does have, or nothing names any more, is an error so the list can't go stale.
const absentFile = path.join(siteRoot, 'checks', 'not-in-ha.txt');
const absentOk = new Set(!flag('--mock') && fs.existsSync(absentFile) ? fs.readFileSync(absentFile, 'utf8').split('\n').map((l) => l.split('#')[0].trim()).filter(Boolean) : []);
if (known && absentOk.size) {
  for (const id of absentOk) { if (known.has(id)) report('error', 'entity', 'checks/not-in-ha.txt', id, `${id} is in ${what} now: take it off this list`); else if (!ids.has(id)) report('error', 'entity', 'checks/not-in-ha.txt', id, `${id} isn't named by the site's config any more: take it off this list`); }
  info.push(`${absentOk.size} ids are named by the config and known not to be in HA now (checks/not-in-ha.txt)`);
}
if (known) { for (const [id, o] of [...ids].sort()) if (!known.has(id) && !absentOk.has(id)) report('error', 'entity', o.file, o.where, `${id} is not in ${what}` + (o.usedAt ? ` (used at ${o.usedAt})` : o.dash ? '' : ' (named in home.js; no dashboard uses it)')); }
else notChecked.push(`entity ids (${ids.size} found): no --entities FILE and no --mock`);
notChecked.push(`${notRun} of ${fns.size} config functions take an argument and were not run, ${threw} stopped with an error: ids and links they build can't be seen` + (builtAtRunTime ? `; ${builtAtRunTime} ids are put together from parts in the site's files (\`sensor.\${x}_y\`) and seen only where such a function ran` : ''));
{ const unsure = [...cardCount.types].filter((t) => optionsOf(t).unsure.size);
  if (unsure.length) notChecked.push(`options of ${unsure.length} card type${unsure.length > 1 ? 's' : ''}: ` + unsure.map((t) => `${t} (${[...optionsOf(t).unsure][0]})`).join('; ')); }
if (mock) { const used = [...ids].filter(([, o]) => o.dash).map(([id]) => id), lacking = used.filter((id) => !(id in mock)).sort(), usedSet = new Set(ids.keys());
  const idle = Object.keys(mock).filter((id) => !usedSet.has(id));
  const by = Object.entries(lacking.reduce((a, id) => { const d = id.split('.')[0]; a[d] = (a[d] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`).join(', ');
  info.push(`mock: ${lacking.length} of the ${used.length} ids the dashboards use have no state in mock/states.mjs${by ? ` (${by})` : ''}; ${idle.length} of its ${Object.keys(mock).length} states are for ids this didn't see used`);
  info.mock = { lacking, idle }; }

// ---------------- output ----------------
const TITLES = { load: 'Does not load', type: 'Card types', option: 'Options a card never reads', action: 'Tap actions', link: 'Links to pop-ups, views and drawers',
  'home-missing': 'home.js keys that are read but do not exist', entity: 'Entity ids', nested: 'Nested options nothing reads', opens: 'Pop-ups a card can open', 'home-unread': 'home.js keys nothing reads', 'home-duplicate': 'Duplicate keys in home.js' };
const errors = [...found.error.values()], warnings = [...found.warning.values()];
const summary = { site: siteName, dashboards: dashboards.map((d) => d.label), cards: cardCount.cards, cardTypes: cardCount.types.size, entityIds: ids.size, errors: errors.length, warnings: warnings.length, ms: Date.now() - t0 };
if (flag('--json')) console.log(JSON.stringify({ ...summary, findings: { errors, warnings }, notChecked, info: [...info], mock: info.mock || null }, null, 1));
else {
  const names = [...new Set(dashboards.map((d) => d.label.split('?')[0]))].map((n) => { const k = dashboards.filter((d) => d.label.split('?')[0] === n).length; return k > 1 ? `${n} ×${k}` : n; });
  console.log(`check-site ${siteName}: ${dashboards.length} dashboard${dashboards.length === 1 ? '' : 's'} (${names.join(', ')}), ${cardCount.cards} cards of ${cardCount.types.size} types, ${ids.size} entity ids`);
  const show = (list, level) => { for (const check of Object.keys(TITLES)) { const l = list.filter((f) => f.check === check); if (!l.length) continue;
    console.log(`\n${TITLES[check]} (${l.length}${level === 'warning' ? ', warning' + (l.length > 1 ? 's' : '') : ''})`);
    for (const f of l) console.log(`  ${f.file}${f.path ? ': ' + f.path : ''}: ${f.message}` + (f.also.length ? `   [+${f.also.length} more: ${f.also.slice(0, 2).join('; ')}${f.also.length > 2 ? '; …' : ''}]` : '')); } };
  show(errors, 'error'); show(warnings, 'warning');
  if (notChecked.length) console.log('\nNot checked\n' + notChecked.map((x) => '  ' + x).join('\n'));
  if (info.length) console.log('\nInformation\n' + info.map((x) => '  ' + x).join('\n'));
  console.log(`\ncheck-site ${siteName}: ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
process.exit(errors.length ? 1 : 0);
