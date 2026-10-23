// The app's one connection, wired to the phone: the boxes list and the language in AsyncStorage, the session ids and the kept password
// in the keychain (expo-secure-store, this device only), names looked up by the app's native module (modules/sinko-net), and the
// discovery with Bonjour, the network and the Local Network permission (src/state/native.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reloadAppAsync } from 'expo';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { I18nManager } from 'react-native';

import { lookupIpv4 } from '../../modules/sinko-net';
import { createHostGuard, isDevBuild, setDefaultLookup } from '../api';
import { createBoxesStore } from './boxes';
import { createConnection } from './connection';
import { createDiscovery } from './discovery';
import { createLanguage } from './language';
import { bonjour, localNetworkAccess, MOCK_HOST, network } from './native';
import { createSessions } from './session';

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

/** At start: the language (and its layout direction, which can restart the app), then the selected box. */
export async function boot(): Promise<void> {
  await language.start().catch(() => undefined);
  await connection.start();
}
