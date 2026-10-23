// The phone's side of finding a box, for src/state/discovery.ts: Bonjour (react-native-zeroconf), the network (expo-network) and the
// Local Network permission. Only the app imports this file; the tests give discovery fakes.
//
// Android: react-native-zeroconf's NSD backend asks the system's NsdManager, which does the multicast in its own process, so the app holds
// no multicast lock; CHANGE_WIFI_MULTICAST_STATE and the network permissions come from the library's manifest. Android 17's
// ACCESS_LOCAL_NETWORK is enforced for apps that target API 37 or declare it. A release build targets 36 and does not declare it, so
// checkLocalNetworkAccess() answers 'granted'; a development build does declare it (React Native's debug manifest, to reach Metro), so on
// an Android 17 phone the same call asks for it. When the target goes to 37, declare it in app.json (android.permissions): the find
// screen then asks for it in every build, and the HTTP requests to the box need it too.
import * as Network from 'expo-network';
import { Platform } from 'react-native';
import Zeroconf from 'react-native-zeroconf';

import type { Bonjour, LocalAccess } from './discovery';

const DNSSD_POLICY_DENIED = -65570;         // iOS: Local Network access is off for this app
const NSD_PERMISSION_DENIED = 7;            // Android 17: ACCESS_LOCAL_NETWORK is missing

export const bonjour: Bonjour = {
  browse(onService, onDenied) {
    const zc = new Zeroconf();
    zc.on('resolved', (s) => { onService({ name: s.name, port: s.port, addresses: s.ipv4 || [] }); });
    zc.on('error', (e) => {
      if (e && ((e.domain === 'DNSSD' && e.code === DNSSD_POLICY_DENIED) || (e.domain === 'NsdManager' && e.code === NSD_PERMISSION_DENIED))) onDenied();
    });
    zc.scan({ type: 'sinko', protocol: 'tcp', domain: 'local.' });
    return () => {
      try { zc.stop(); } catch { /* not scanning */ }
      zc.removeDeviceListeners();
    };
  },
};

/** iOS has no way to read the permission: the library browses for a short-lived service of its own (an _http._tcp one, which is why
 * NSBonjourServices lists that type too), and may show the system prompt while it does. */
export async function localNetworkAccess(): Promise<LocalAccess> {
  const zc = new Zeroconf();
  try {
    return await zc.checkLocalNetworkAccess({ type: 'http', protocol: 'tcp', timeout: 8 });
  } catch {
    return 'unknown';
  } finally {
    zc.removeDeviceListeners();
  }
}

export async function network(): Promise<{ wifi: boolean; ip: string }> {
  const state = await Network.getNetworkStateAsync();
  const wifi = state.type === Network.NetworkStateType.WIFI;
  const ip = wifi ? await Network.getIpAddressAsync().catch(() => '') : '';
  return { wifi, ip };
}

/** The mock box (npm run mock) as this simulator or emulator reaches the computer. */
export const MOCK_HOST = Platform.OS === 'android' ? { ip: '10.0.2.2', port: 8080 } : { ip: '127.0.0.1', port: 8080 };
