// The app's own native module (ios/, android/): the IPv4 addresses a host name resolves to. src/state/app.ts hands it to the API client's
// host rule (src/api/hosts.ts); the tests use a fake instead, so nothing else imports this file.
import { requireNativeModule } from 'expo';

const SinkoNet = requireNativeModule<{ lookupIpv4(host: string): Promise<string[]> }>('SinkoNet');

export function lookupIpv4(host: string): Promise<string[]> {
  return SinkoNet.lookupIpv4(host);
}
