// npm run build-guides: bundles the router guides of src/content/routers (<brand>.<lang>.md, and the pictures in screenshots/<brand>/)
// into src/content/routers/guides.ts, because Metro does not load .md files. Run it after every change there: test/content.test.ts fails
// when guides.ts is out of date. The format is in src/content/routers/README.md.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src', 'content', 'routers');
const GUIDE = /^([a-z0-9-]+)\.(en|ar)\.md$/;
const PICTURE = /^([a-z0-9-]+)(\.(?:en|ar))?\.(png|jpg)$/;

const text: Record<string, Record<string, string>> = {};
for (const name of readdirSync(dir).sort()) {
  const m = GUIDE.exec(name);
  if (!m) continue;
  (text[m[1]] = text[m[1]] || {})[m[2]] = readFileSync(join(dir, name), 'utf8');
}
const shots: Record<string, string[]> = {};
const shotDir = join(dir, 'screenshots');
for (const brand of Object.keys(text)) {
  shots[brand] = [];
  const bdir = join(shotDir, brand);
  if (!existsSync(bdir) || !statSync(bdir).isDirectory()) continue;
  for (const file of readdirSync(bdir).sort()) if (PICTURE.test(file)) shots[brand].push(file);
}

const lines = [
  '// Made by npm run build-guides from the router guides in this folder (<brand>.<lang>.md) and their pictures (screenshots/). Do not',
  '// edit: change those, then run it again. The format is in README.md.',
  '',
  'export const GUIDE_TEXT: Record<string, Partial<Record<\'en\' | \'ar\', string>>> = ' + JSON.stringify(text, null, 2) + ';',
  '',
  '/** The pictures by brand, then by slot (or slot.lang): require()d so the app bundles them. */',
  'export const SCREENSHOTS: Record<string, Record<string, number>> = {',
  ...Object.keys(shots).map((brand) => '  ' + JSON.stringify(brand) + ': {' + shots[brand].map((file) => {
    const m = PICTURE.exec(file) as RegExpExecArray;
    return ' ' + JSON.stringify(m[1] + (m[2] || '')) + ': require(' + JSON.stringify('./screenshots/' + brand + '/' + file) + '),';
  }).join('') + (shots[brand].length ? ' ' : '') + '},'),
  '};',
  '',
];
const out = join(dir, 'guides.ts');
writeFileSync(out, lines.join('\n'));
const count = Object.values(text).reduce((n, langs) => n + Object.keys(langs).length, 0);
console.log(`Bundled ${count} router guides and ${Object.values(shots).reduce((n, s) => n + s.length, 0)} pictures into src/content/routers/guides.ts.`);
