// The Pi-hole session of each box. The page keeps its session id in sessionStorage (app.js SID_KEY, line 17); the app keeps it in the
// phone's keychain (expo-secure-store), one per box, so coming back to the app within the session's lifetime needs no new sign-in, and
// no second session is opened while the stored one works (Pi-hole has 16 in all). Read synchronously from memory by the API client;
// written through to the secure storage.
//
// "Keep me signed in" (off until the parent switches it on) also keeps the parent password there, so the app can sign in again by itself
// when the box asks. Both are stored AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: never in a backup, never on another phone (on Android,
// expo-secure-store's plugin leaves its data out of Auto Backup).
import { createStore, type Store } from './store';

export interface SecretOptions { keychainAccessible?: number }
/** expo-secure-store's shape (the tests use a Map). Keys may only hold letters, digits, ".", "-" and "_". */
export interface SecretStorage {
  getItemAsync(key: string, options?: SecretOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecretOptions): Promise<void>;
  deleteItemAsync(key: string, options?: SecretOptions): Promise<void>;
}

const sidKey = (boxId: string) => 'sinko.sid.' + boxId;
const passwordKey = (boxId: string) => 'sinko.pw.' + boxId;

export interface Sessions {
  /** Session ids by box id; '' or absent = signed out. Subscribe to notice a sign-out (a 401). */
  state: Store<Record<string, string>>;
  /** Box ids with a kept password ("Keep me signed in" is on). */
  kept: Store<Record<string, boolean>>;
  sid(boxId: string): string;
  /** Reads the stored session id and whether a password is kept. */
  restore(boxId: string): Promise<string>;
  set(boxId: string, sid: string): Promise<void>;
  clear(boxId: string): Promise<void>;
  /** The kept password, '' when none. */
  password(boxId: string): Promise<string>;
  /** Keeps the password ("Keep me signed in" on), or forgets it (null). */
  keep(boxId: string, password: string | null): Promise<void>;
}

/** `thisDeviceOnly` is expo-secure-store's AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY (the app passes it; the tests pass a marker). */
export function createSessions(storage: SecretStorage, thisDeviceOnly?: number): Sessions {
  const options: SecretOptions | undefined = thisDeviceOnly === undefined ? undefined : { keychainAccessible: thisDeviceOnly };
  const state = createStore<Record<string, string>>({});
  const kept = createStore<Record<string, boolean>>({});
  const read = async (key: string) => { try { return (await storage.getItemAsync(key, options)) || ''; } catch { return ''; } };
  const forget = async (key: string) => { try { await storage.deleteItemAsync(key, options); } catch { /* nothing stored */ } };
  return {
    state,
    kept,
    sid: (boxId) => state.get()[boxId] || '',
    async restore(boxId) {
      const sid = await read(sidKey(boxId));
      const pw = await read(passwordKey(boxId));
      state.update((s) => ({ ...s, [boxId]: sid }));
      kept.update((k) => ({ ...k, [boxId]: !!pw }));
      return sid;
    },
    async set(boxId, sid) {
      state.update((s) => ({ ...s, [boxId]: sid }));
      await storage.setItemAsync(sidKey(boxId), sid, options);
    },
    async clear(boxId) {
      state.update((s) => ({ ...s, [boxId]: '' }));
      await forget(sidKey(boxId));
    },
    password: (boxId) => read(passwordKey(boxId)),
    async keep(boxId, password) {
      if (password) await storage.setItemAsync(passwordKey(boxId), password, options);
      else await forget(passwordKey(boxId));
      kept.update((k) => ({ ...k, [boxId]: !!password }));
    },
  };
}
