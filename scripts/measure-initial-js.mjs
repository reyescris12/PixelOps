/**
 * Measures the JavaScript the browser must download before the app boots:
 * the entry <script type="module"> plus every <link rel="modulepreload"> in dist/index.html.
 * Usage: node scripts/measure-initial-js.mjs   (run after `npm run build`)
 */
import { readFileSync, statSync, readdirSync } from 'fs';
import { gzipSync } from 'zlib';
import { join } from 'path';

const dist = join(process.cwd(), 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf-8');
const eager = new Set();
for (const m of html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) eager.add(m[1]);
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) eager.add(m[1]);

let raw = 0;
let gz = 0;
const rows = [];
for (const href of eager) {
  const buf = readFileSync(join(dist, href.replace(/^\//, '')));
  const g = gzipSync(buf).length;
  raw += buf.length;
  gz += g;
  rows.push({ file: href.replace('/assets/', ''), kB: +(buf.length / 1024).toFixed(1), gzipKB: +(g / 1024).toFixed(1) });
}
rows.sort((a, b) => b.kB - a.kB);
console.table(rows);

const allJs = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));
const totalAll = allJs.reduce((s, f) => s + statSync(join(dist, 'assets', f)).size, 0);
console.log(`INITIAL JS: ${(raw / 1024).toFixed(1)} kB raw / ${(gz / 1024).toFixed(1)} kB gzip across ${eager.size} files`);
console.log(`ALL JS:     ${(totalAll / 1024).toFixed(1)} kB raw across ${allJs.length} files`);
