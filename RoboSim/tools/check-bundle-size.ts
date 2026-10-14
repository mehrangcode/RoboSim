// NFR-PERF-04: initial JS of the app shell (entry + modulepreloads in index.html) must stay < 300 KB gzipped.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 300 * 1024;
const apps = process.argv.slice(2);
let failed = false;

for (const app of apps.length ? apps : ['apps/web', 'apps/admin']) {
  const dist = join(app, 'dist');
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const initial = new Set(
    [...html.matchAll(/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="\/?([^"]+\.js)"/g)].map(
      (m) => m[1] ?? '',
    ),
  );
  let total = 0;
  for (const file of initial) total += gzipSync(readFileSync(join(dist, file))).length;
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const ok = total <= BUDGET_BYTES;
  failed ||= !ok;
  console.warn(
    `${ok ? '✔' : '✖'} ${app}: initial JS ${kb(total)} gz (budget ${kb(BUDGET_BYTES)}, ${initial.size} file(s))`,
  );
}
process.exit(failed ? 1 : 0);
