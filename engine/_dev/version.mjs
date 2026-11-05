// Same as version.ps1 (for testing in the container / with node): writes ../version.json with a content hash per .js/.css file.
import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import path from 'node:path'; import crypto from 'node:crypto';
const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));   // an assembled site (_dev/assemble.sh)
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex').slice(0, 10);
const list = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (['_dev', 'vendor', 'node_modules'].includes(f)) continue; if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|css)$/.test(f)) list.push(path.relative(root, p).split(path.sep).join('/')); } })(root);
list.sort();
const files = {}; let all = '';
for (const rel of list) { const h = md5(fs.readFileSync(path.join(root, rel))); files[rel] = h; all += rel + h; }
const v = md5(Buffer.from(all, 'utf8'));
fs.writeFileSync(path.join(root, 'version.json'), '{"v":"' + v + '","files":{' + list.map((k) => `"${k}":"${files[k]}"`).join(',') + '}}');
console.log(`version.json: ${list.length} files, v ${v}`);
