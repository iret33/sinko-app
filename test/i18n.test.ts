// The strings: the ones copied from Sinko's page, the app's own (src/i18n/en.ts and ar.ts), and t(). The first test is Sinko
// tests/box.test.js "both languages have exactly the same strings, with the same placeholders", run on every string the app has.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ar, appAr } from '../src/i18n/ar';
import { appEn, en } from '../src/i18n/en';
import strings from '../src/i18n/sinko-strings.json';
import { getLang, guessLang, list, setLang, t } from '../src/i18n';
import { PROBLEM_TEXT } from '../src/state/auth';

const S = strings as unknown as { en: Record<string, unknown>; ar: Record<string, unknown> };
const ROOT = join(__dirname, '..');

test('both languages have exactly the same strings, with the same placeholders: the page\'s, and the app\'s', () => {
  const ph = (s: unknown) => (typeof s === 'string' ? s.match(/\{\w+\}/g) || [] : []).sort().join();
  for (const [a, b] of [[S.en, S.ar], [en, ar]] as const) {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    for (const k of Object.keys(a)) assert.equal(ph(a[k]), ph(b[k]), k);
  }
});

test('the app\'s own words never replace the page\'s: a word that means the same is the page\'s, under its own name', () => {
  const clash = Object.keys(appEn).filter((k) => k in S.en);
  assert.deepEqual(clash, []);
  assert.deepEqual(Object.keys(appAr).sort(), Object.keys(appEn).sort());
  for (const k of Object.keys(S.en)) assert.equal(en[k], S.en[k], k);
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

test('every word the app asks for is there in English and Arabic', () => {
  const asked = new Set<string>(Object.values(PROBLEM_TEXT));
  for (const file of [...sources(join(ROOT, 'app')), ...sources(join(ROOT, 'src'))]) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) asked.add(m[1]);
    for (const m of text.matchAll(/\bt\([^)]*\?\s*'([A-Za-z0-9_]+)'\s*:\s*'([A-Za-z0-9_]+)'/g)) { asked.add(m[1]); asked.add(m[2]); }
  }
  assert.ok(asked.size > 60, 'the scan found the words (' + asked.size + ')');
  const missing = [...asked].filter((k) => typeof en[k] !== 'string' || typeof ar[k] !== 'string');
  assert.deepEqual(missing, []);
});

test('the Local Network prompt: the same English in app.json and locales/en.json, and Arabic in locales/ar.json', () => {
  const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;
  const loc = (l: string) => JSON.parse(readFileSync(join(ROOT, app.locales[l]), 'utf8')).ios.NSLocalNetworkUsageDescription as string;
  assert.equal(loc('en'), app.ios.infoPlist.NSLocalNetworkUsageDescription);
  assert.match(loc('ar'), /^[\u0600-\u06FF\s،.]+$/, 'Arabic words only');
  assert.deepEqual(app.ios.infoPlist.NSBonjourServices, ['_sinko._tcp', '_http._tcp']);
  assert.deepEqual(app.ios.infoPlist.NSAppTransportSecurity, { NSAllowsLocalNetworking: true }, 'never NSAllowsArbitraryLoads');
});

test('the "boxes online" line says the number only when it is not two (Sinko tests/box.test.js)', () => {
  for (const lang of ['en', 'ar'] as const) {
    assert.ok((S[lang].boxCounterOnline as string).includes('{n}'), lang);
    assert.ok(!(S[lang].boxCounterOnlineTwo as string).includes('{n}'), lang + ': two is said in words, so the number is not repeated');
  }
});

test('t() is the page\'s t(): placeholders, Arabic, English when a word is missing, the key when both are', () => {
  setLang('en');
  assert.equal(t('deviceAdded', { n: 'Sara-iPad' }), 'Sara-iPad added');
  assert.equal(t('subBlocked', { n: 3, t: 19 }), '3 of 19 apps blocked.');
  assert.equal(t('no-such-key'), 'no-such-key');
  setLang('ar');
  assert.equal(getLang(), 'ar');
  assert.equal(t('deviceAdded', { n: 'Sara-iPad' }), 'تمت إضافة Sara-iPad');
  assert.deepEqual(list('days'), ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']);
  setLang('en');
  assert.equal(list('days')[0], 'Sun');
  assert.deepEqual(list('noConnection'), [], 'not a list');
});

test('the phone\'s language picks Arabic or English', () => {
  assert.equal(guessLang('ar-BH'), 'ar');
  assert.equal(guessLang('AR'), 'ar');
  assert.equal(guessLang('en-GB'), 'en');
  assert.equal(guessLang('fr'), 'en');
  assert.equal(guessLang(null), 'en');
});
