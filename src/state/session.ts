// The Pi-hole session of each box. The page keeps its session id in sessionStorage (app.js SID_KEY, line 17); the app keeps it in the
// phone's keychain (expo-secure-store), one per box, so coming back to the app within the session's lifetime needs no new sign-in.
// Read synchronously from memory by the API client; written through to the secure storage.
import { createStore, type Store } from './store';

/** expo-secure-store's shape (the tests use a Map). Keys may only hold letters, digits, ".", "-" and "_". */
export interface SecretStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const key = (boxId: string) => 'sinko.sid.' + boxId;

export interface Sessions {
  /** Session ids by box id; '' or absent = signed out. Subscribe to notice a sign-out (a 401). */
  state: Store<Record<string, string>>;
  sid(boxId: string): string;
  restore(boxId: string): Promise<string>;
  set(boxId: string, sid: string): Promise<void>;
  clear(boxId: string): Promise<void>;
}

export function createSessions(storage: SecretStorage): Sessions {
  const state = createStore<Record<string, string>>({});
  return {
    state,
    sid: (boxId) => state.get()[boxId] || '',
    async restore(boxId) {
      let sid = '';
      try { sid = (await storage.getItemAsync(key(boxId))) || ''; } catch { sid = ''; }
      state.update((s) => ({ ...s, [boxId]: sid }));
      return sid;
    },
    async set(boxId, sid) {
      state.update((s) => ({ ...s, [boxId]: sid }));
      await storage.setItemAsync(key(boxId), sid);
    },
    async clear(boxId) {
      state.update((s) => ({ ...s, [boxId]: '' }));
      try { await storage.deleteItemAsync(key(boxId)); } catch { /* nothing stored */ }
    },
  };
}
