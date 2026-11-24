// Writes version.json into an assembled site: a content hash per file (modules, stylesheets, pictures, fonts, sounds,
// vendored scripts), and v, the hash of them all. boot.js asks for every module and stylesheet by its hash, core/asset.js
// for the rest; a change to any file changes v, which is what makes open screens reload (core/update.js).
import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import path from 'node:path'; import crypto from 'node:crypto';
const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));   // an assembled site (_dev/assemble.sh)
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex').slice(0, 10);
// not hashed: the pages that fetch version.json (never cached: their job is to ask), the file itself, notes and markers
const SKIP = /^(version\.json|LICENSE.*|\..*)$|\.(html|md|txt)$/;
const list = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (['_dev', 'node_modules'].includes(f)) continue; if (fs.statSync(p).isDirectory()) walk(p); else if (!SKIP.test(f)) list.push(path.relative(root, p).split(path.sep).join('/')); } })(root);
list.sort();
const files = {}; let all = '';
for (const rel of list) { const h = md5(fs.readFileSync(path.join(root, rel))); files[rel] = h; all += rel + h; }
const v = md5(Buffer.from(all, 'utf8'));
fs.writeFileSync(path.join(root, 'version.json'), '{"v":"' + v + '","files":{' + list.map((k) => `"${k}":"${files[k]}"`).join(',') + '}}');
console.log(`version.json: ${list.length} files, v ${v}`);
