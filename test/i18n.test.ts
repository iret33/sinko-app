// The strings copied from Sinko's page, and t(). The first test is Sinko tests/box.test.js "both languages have exactly the same strings,
// with the same placeholders", run on every string the app has (the page's and the My box sheet's), not only BOX_STR.
import assert from 'node:assert/strict';

import strings from '../src/i18n/sinko-strings.json';
import { getLang, guessLang, list, setLang, t } from '../src/i18n';

const S = strings as unknown as { en: Record<string, unknown>; ar: Record<string, unknown> };

test('both languages have exactly the same strings, with the same placeholders', () => {
  assert.deepEqual(Object.keys(S.en).sort(), Object.keys(S.ar).sort());
  const ph = (s: unknown) => (typeof s === 'string' ? s.match(/\{\w+\}/g) || [] : []).sort().join();
  for (const k of Object.keys(S.en)) assert.equal(ph(S.en[k]), ph(S.ar[k]), k);
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
