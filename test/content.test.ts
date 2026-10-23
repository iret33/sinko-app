// The router guides (src/content/routers, format in its README.md): bundled and up to date, read the way the format says, and never shown
// before they are filled in from a real router.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ROUTER_BRANDS, guideReady, parseGuide, routerGuide } from '../src/content/guide';
import { GUIDE_TEXT, SCREENSHOTS } from '../src/content/routers/guides';

const DIR = join(__dirname, '..', 'src', 'content', 'routers');

test('guides.ts is what npm run build-guides makes from the files: every guide and every picture', () => {
  const files = [...readdirSync(DIR)].filter((n) => /\.(en|ar)\.md$/.test(n)).sort();
  assert.deepEqual(files, ROUTER_BRANDS.flatMap((b) => [b + '.ar.md', b + '.en.md']).sort(), 'a guide in both languages for every brand, and no other');
  for (const f of files) {
    const [brand, lang] = f.split('.');
    assert.equal(GUIDE_TEXT[brand][lang as 'en' | 'ar'], readFileSync(join(DIR, f), 'utf8'), f + ' changed: run npm run build-guides');
  }
  for (const brand of ROUTER_BRANDS) {
    const dir = join(DIR, 'screenshots', brand);
    const pictures = existsSync(dir) ? [...readdirSync(dir)].filter((n) => /\.(png|jpg)$/.test(n)).map((n) => n.replace(/\.(png|jpg)$/, '')).sort() : [];
    assert.deepEqual(Object.keys(SCREENSHOTS[brand] || {}).sort(), pictures, brand + '\'s pictures changed: run npm run build-guides');
  }
});

test('every guide names its brand, and a guide that is not filled in is never shown', () => {
  for (const brand of ROUTER_BRANDS) {
    for (const lang of ['en', 'ar'] as const) {
      const g = routerGuide(brand, lang)!;
      assert.equal(g.brand, brand, brand + '.' + lang);
      assert.ok(g.name, brand + '.' + lang + ' has a name for its button');
      if (g.status !== 'ready') { assert.equal(guideReady(g, lang), false); continue; }
      assert.deepEqual(g.todos, [], brand + '.' + lang + ' is marked ready but still has TODO notes');
      assert.ok(g.steps.length > 0, brand + '.' + lang + ' is marked ready but has no steps');
      assert.ok(guideReady(g, lang), brand + '.' + lang + ' is marked ready but a picture is missing: ' + g.slots.join(', '));
    }
  }
});

test('the format: front matter, title, introduction, steps, bullets, pictures; TODO lines and comments are never shown', () => {
  const g = parseGuide([
    '---', 'brand: zain', 'name: Zain', 'status: ready', '---', '',
    '<!-- a note -->', '# Zain router', '', 'For the routers', 'Zain gives out.', '',
    'TODO: which models', '',
    '## Open the settings', '', 'Open http://192.168.8.1', 'in a browser.', '', '- user: admin', '', '![The sign-in page](screenshot:sign-in)', '',
    '## DNS', '', 'Type {ip} there.', '<!--', 'TODO: check the second field', '-->', '',
  ].join('\n'));
  assert.deepEqual([g.brand, g.name, g.status, g.title], ['zain', 'Zain', 'ready', 'Zain router']);
  assert.deepEqual(g.intro, [{ kind: 'text', text: 'For the routers Zain gives out.' }]);
  assert.deepEqual(g.steps, [
    { title: 'Open the settings', blocks: [{ kind: 'text', text: 'Open http://192.168.8.1 in a browser.' }, { kind: 'bullet', text: 'user: admin' },
      { kind: 'shot', slot: 'sign-in', alt: 'The sign-in page' }] },
    { title: 'DNS', blocks: [{ kind: 'text', text: 'Type {ip} there.' }] },
  ]);
  assert.deepEqual(g.todos.sort(), ['TODO: check the second field', 'which models']);
  assert.deepEqual(g.slots, ['sign-in']);
  assert.equal(guideReady(g, 'en'), false, 'TODOs left, and its picture is not in screenshots/zain');
  assert.equal(parseGuide('---\nstatus: done\n---\n# x').status, 'todo', 'only "ready" is ready');
});
