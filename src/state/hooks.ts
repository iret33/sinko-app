// React's view of the stores, and of the language (a screen that calls useLang() is drawn again when it changes).
import { useSyncExternalStore } from 'react';

import { getLang, onLangChange, type Lang } from '../i18n';
import type { Store } from './store';

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useLang(): Lang {
  return useSyncExternalStore(onLangChange, getLang, getLang);
}
