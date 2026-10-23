// The app's one connection, wired to the phone: the boxes list and the language in AsyncStorage, the session ids and the kept password
// in the keychain (expo-secure-store, this device only), names looked up by the app's native module (modules/sinko-net), and the
// discovery with Bonjour, the network and the Local Network permission (src/state/native.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reloadAppAsync } from 'expo';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { AppState, I18nManager } from 'react-native';

import { lookupIpv4 } from '../../modules/sinko-net';
import { createHostGuard, isDevBuild, setDefaultLookup } from '../api';
import { createBoxesStore } from './boxes';
import { createConnection } from './connection';
import { createDeviceCheck, type DeviceCheck } from './deviceCheck';
import { createDiscovery } from './discovery';
import { createLanguage } from './language';
import type { BoxSession } from './model';
import { bonjour, localNetworkAccess, MOCK_HOST, network } from './native';
import { createSessions } from './session';
import { createSetup, type Setup } from './setup';

setDefaultLookup(lookupIpv4);

export const hosts = createHostGuard({ lookup: lookupIpv4, dev: isDevBuild() });
export const boxes = createBoxesStore(AsyncStorage);
export const sessions = createSessions(SecureStore, SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY);
export const connection = createConnection({ boxes, sessions, hosts });
export const language = createLanguage({
  storage: AsyncStorage,
  phoneTag: () => getLocales()[0]?.languageTag,
  direction: {
    get isRTL() { return I18nManager.isRTL; },
    allowRTL: (b) => I18nManager.allowRTL(b),
    forceRTL: (b) => I18nManager.forceRTL(b),
  },
  reload: () => reloadAppAsync('language'),
});

/** A new search (the find screen makes one each time it opens). */
export function newDiscovery() {
  return createDiscovery({
    hosts, bonjour, network, access: localNetworkAccess,
    saved: () => boxes.state.get().boxes,
    devHosts: isDevBuild() ? [MOCK_HOST] : [],
  });
}

const setups = new WeakMap<BoxSession, Setup>();
/** The guided setup of the selected box (one per box session, shared by Home and the setup screens); null when no box is selected. */
export function currentSetup(): Setup | null {
  const { session, client } = connection.current.get();
  if (!session || !client) return null;
  let s = setups.get(session);
  if (!s) { s = createSetup({ session, client, address: () => connection.address(), appState: AppState }); setups.set(session, s); }
  return s;
}

/** A "Check this device" for the selected box. */
export function newDeviceCheck(): DeviceCheck | null {
  const client = connection.current.get().client;
  return client ? createDeviceCheck({ call: client.call, clock: client.clock }) : null;
}

/** At start: the language (and its layout direction, which can restart the app), then the selected box. */
export async function boot(): Promise<void> {
  await language.start().catch(() => undefined);
  await connection.start();
}
