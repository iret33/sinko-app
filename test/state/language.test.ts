// The language (src/state/language.ts): the phone's by default, the settings' choice once made, and the layout direction to go with it.
import assert from 'node:assert/strict';

import { getLang, setLang } from '../../src/i18n';
import type { KeyValueStorage } from '../../src/state/boxes';
import { LANG_KEY, createLanguage, type Direction } from '../../src/state/language';

function setup(phone: string, savedIsRtl: boolean, saved?: string) {
  const data = new Map<string, string>(saved ? [[LANG_KEY, saved]] : []);
  const storage: KeyValueStorage = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v); }, removeItem: async (k) => { data.delete(k); } };
  const calls: string[] = [];
  let rtl = savedIsRtl;
  const direction: Direction = {
    get isRTL() { return rtl; },
    allowRTL: (b) => { calls.push('allow ' + b); },
    forceRTL: (b) => { calls.push('force ' + b); },
  };
  let now = 1000;
  const lang = createLanguage({ storage, phoneTag: () => phone, direction, reload: async () => { calls.push('reload'); }, now: () => now });
  return { lang, data, calls, setRtl: (b: boolean) => { rtl = b; }, tick: (ms: number) => { now += ms; } };
}
afterEach(() => setLang('en'));

test('first start: the phone\'s language, and no restart when the layout already matches', async () => {
  const ar = setup('ar-BH', true);
  assert.equal(await ar.lang.start(), 'ar');
  assert.equal(getLang(), 'ar');
  assert.deepEqual(ar.calls, ['allow true', 'force true'], 'right to left, and no reload');
  const en = setup('en-GB', false);
  assert.equal(await en.lang.start(), 'en');
  assert.deepEqual(en.calls, ['allow false', 'force false']);
  const fr = setup('fr-FR', false);
  assert.equal(await fr.lang.start(), 'en', 'neither Arabic nor English: English');
});

test('the settings\' choice wins over the phone\'s, and changing the direction restarts the app once', async () => {
  const s = setup('ar-BH', true);
  await s.lang.start();
  s.calls.length = 0;
  await s.lang.choose('en');
  assert.equal(s.data.get(LANG_KEY), 'en');
  assert.deepEqual(s.calls, ['allow false', 'force false', 'reload'], 'an Arabic phone with the app in English is left to right');
  // After the restart the layout follows: no second restart.
  s.setRtl(false); s.calls.length = 0; s.tick(60000);
  assert.equal(await s.lang.start(), 'en');
  assert.deepEqual(s.calls, ['allow false', 'force false']);
});

test('a restart that did not change the direction is not tried again at once (no loop)', async () => {
  const s = setup('en-GB', false, 'ar');
  await s.lang.start();
  assert.deepEqual(s.calls, ['allow true', 'force true', 'reload']);
  s.calls.length = 0; s.tick(1000);
  await s.lang.start();
  assert.deepEqual(s.calls, ['allow true', 'force true'], 'still left to right after the restart: wait for the next start');
});
