// The words of the app, in English and Arabic. They are the parent page's own (src/i18n/sinko-strings.json, copied from Sinko by
// `npm run sync-strings`), so the app says what the page says. No React here: the API client uses it too.
import strings from './sinko-strings.json';

export type Lang = 'en' | 'ar';
type Table = Record<string, unknown>;
const STR = { en: strings.en as Table, ar: strings.ar as Table };

let lang: Lang = 'en';
const listeners = new Set<(l: Lang) => void>();

/** app.js guessLang (line 359): Arabic when the phone's language is Arabic, else English. Takes a BCP 47 tag ("ar-BH"). */
export function guessLang(languageTag: string | null | undefined): Lang {
  return (languageTag || '').toLowerCase().indexOf('ar') === 0 ? 'ar' : 'en';
}
export function getLang(): Lang { return lang; }
export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  listeners.forEach((l) => l(lang));
}
export function onLangChange(listener: (l: Lang) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Right to left for Arabic. */
export function dir(): 'rtl' | 'ltr' { return lang === 'ar' ? 'rtl' : 'ltr'; }
/** app.js locale (line 390): Arabic with Latin digits, or British English. */
export function locale(): string { return lang === 'ar' ? 'ar-BH-u-nu-latn' : 'en-GB'; }

/** app.js t (line 360): the string for `key` in the current language (English when it has none, the key itself when neither has it). */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = STR[lang][key];
  if (s === undefined) s = STR.en[key];
  if (typeof s !== 'string') return key;
  let out = s;
  if (vars) Object.keys(vars).forEach((k) => { out = out.split('{' + k + '}').join(String(vars[k])); });
  return out;
}

/** The lists among the strings (days, daysLong): [] when `key` is not one. */
export function list(key: string): string[] {
  const v = STR[lang][key] ?? STR.en[key];
  return Array.isArray(v) ? v.map(String) : [];
}

/** Where the strings came from. */
export const stringsSource = { sinkoVersion: strings.sinkoVersion, commit: strings.commit };
