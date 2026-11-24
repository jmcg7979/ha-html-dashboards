// Which unit test files a set of changed files calls for: a pre-commit hook runs only those.
//   node tests-for.mjs <changed file, from the repository's root> ...   prints one test file per line, or the word "all"
// A test file is called for when it is changed itself, or when a changed engine module is one it loads (load() and
// override() in the test, then every import from there on, in the build's layout: engine/ with the example site on top).
// "all" when the answer can't be read from imports: a change under engine/_dev/ that isn't a test (the stub, the
// assembler, the mock, the tools some tests run), or under engine/ha/. A test that reaches into the repository itself
// (it imports ROOT from the stub) runs on every change. A full run (node --test engine/_dev/test/) and every deploy run all of them.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TESTS = 'engine/_dev/test', LAYERS = ['engine', 'sites/example/dash'];
const real = (p) => LAYERS.map((l) => path.join(l, p)).reverse().find((f) => fs.existsSync(path.join(ROOT, f)));   // the site's file wins, as in a build
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// build path -> the build paths it imports; a computed import (`../cards/${type}.js`) is every .js of that folder
const graph = new Map();
function imports(p) {
  if (graph.has(p)) return graph.get(p);
  const out = new Set(), file = real(p); graph.set(p, out);
  if (!file) return out;
  const dir = path.posix.dirname(p), text = read(file);
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"`])(\.{1,2}\/[^'"`]*)\1/g)) {
    const to = path.posix.normalize(path.posix.join(dir, m[2]));
    if (!to.includes('${')) { out.add(to); continue; }
    const folder = to.slice(0, to.indexOf('${')).replace(/[^/]*$/, '');
    for (const l of LAYERS) { const d = path.join(ROOT, l, folder); if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.js')) out.add(folder + f); }
  }
  return out;
}
function closure(roots) {
  const seen = new Set(), todo = [...roots];
  while (todo.length) { const p = todo.pop(); if (seen.has(p)) continue; seen.add(p); todo.push(...imports(p)); }
  return new Set([...seen].map(real).filter(Boolean));
}

const changed = process.argv.slice(2).map((f) => f.split(path.sep).join('/'));
const isTest = (f) => f.startsWith(TESTS + '/') && f.endsWith('.test.mjs');
if (changed.some((f) => (f.startsWith('engine/_dev/') && !isTest(f)) || f.startsWith('engine/ha/'))) { console.log('all'); process.exit(0); }
const modules = new Set(changed.filter((f) => /\.m?js$/.test(f) && !isTest(f)));
for (const name of fs.readdirSync(path.join(ROOT, TESTS)).filter((f) => f.endsWith('.test.mjs')).sort()) {
  const file = `${TESTS}/${name}`, text = read(file);
  const wanted = () => { const loads = [...text.matchAll(/\b(?:load|override)\(\s*'([^']+)'/g)].map((m) => m[1]);
    if (/\b(?:load|override)\(\s*[^'\s]/.test(text)) return true;   // a module named by a variable: can't tell
    return [...closure(loads)].some((f) => modules.has(f)); };
  if (changed.includes(file) || (modules.size && (/\bROOT\b/.test(text) || wanted()))) console.log(file);
}
