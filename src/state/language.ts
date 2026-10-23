// Which language the app speaks: the one chosen in the settings, else the phone's (app.js guessLang), kept like the page keeps its
// choice (app.js LANG_KEY, line 18). Arabic is laid out right to left through React Native's I18nManager, which only changes the layout
// when the app starts: so a change of language that changes the direction restarts the app (expo's reloadAppAsync).
//
// I18nManager is told both things, allowRTL and forceRTL, so the phone's own language cannot turn the layout around against the choice
// (an Arabic phone with the app in English stays left to right).
import { guessLang, setLang, type Lang } from '../i18n';
import type { KeyValueStorage } from './boxes';

export const LANG_KEY = 'sinko.lang';
const RELOADED_KEY = 'sinko.lang.reloadedAt';
/** A restart for the direction that did not take is not tried again for this long (no restart loop). */
const RELOAD_GUARD_MS = 30000;

export interface Direction {
  readonly isRTL: boolean;
  allowRTL(allow: boolean): void;
  forceRTL(force: boolean): void;
}

export interface LanguageDeps {
  storage: KeyValueStorage;
  /** The phone's first language (expo-localization getLocales()[0].languageTag). */
  phoneTag: () => string | null | undefined;
  direction: Direction;
  reload: () => Promise<void>;
  now?: () => number;
}

export interface Language {
  /** At start, before the first screen: the language, and the layout direction to go with it. */
  start(): Promise<Lang>;
  /** The settings' switch. Resolves after the restart was asked for, when one is needed. */
  choose(lang: Lang): Promise<void>;
}

export function createLanguage(deps: LanguageDeps): Language {
  const now = deps.now || Date.now;

  async function direct(lang: Lang, atStart: boolean): Promise<void> {
    const rtl = lang === 'ar';
    deps.direction.allowRTL(rtl);
    deps.direction.forceRTL(rtl);
    if (deps.direction.isRTL === rtl) return;
    if (atStart) {
      const last = Number(await deps.storage.getItem(RELOADED_KEY).catch(() => null)) || 0;
      if (last && now() - last < RELOAD_GUARD_MS) return;  // it did not take: the layout follows at the next start
    }
    await deps.storage.setItem(RELOADED_KEY, String(now())).catch(() => undefined);
    await deps.reload();
  }

  return {
    async start() {
      const saved = await deps.storage.getItem(LANG_KEY).catch(() => null);
      const lang: Lang = saved === 'ar' || saved === 'en' ? saved : guessLang(deps.phoneTag());
      setLang(lang);
      await direct(lang, true);
      return lang;
    },
    async choose(lang) {
      await deps.storage.setItem(LANG_KEY, lang);
      setLang(lang);
      await direct(lang, false);
    },
  };
}
