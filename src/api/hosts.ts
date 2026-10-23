// The host rule. The box speaks plain http on the home network, and its address is not known in advance, so Android must allow cleartext
// to any host (app.json, usesCleartextTraffic) and iOS allows local networking. What keeps the parent's password and the session off the
// internet is this rule, in the API client itself: it only ever talks to a private IPv4 address (10/8, 172.16/12, 192.168/16).
//
// A name is judged by the address it resolves to, never by its ending: Sinko's local name can be anything (kids.home), and a name that
// ends in .local could still be answered by something else. The client then talks to that address, not to the name, so the name cannot
// resolve to another address between the check and the request, and iOS's transport rules (which exempt addresses) need no exception
// for the name. Development builds also allow the mock box's two addresses (127.0.0.1 from the iOS Simulator, 10.0.2.2 from the Android
// emulator).
import { t } from '../i18n';
import { ApiError } from './errors';

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16. Nothing else: not loopback, link-local, 100.64/10 (carrier NAT) nor any IPv6. */
export function isPrivateIpv4(ip: string): boolean {
  if (!IPV4.test(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The mock box (npm run mock) as the iOS Simulator and the Android emulator reach this computer. */
export const DEV_ADDRESSES = ['127.0.0.1', '10.0.2.2'];

/** The rule for one address. */
export function addressAllowed(ip: string, dev: boolean): boolean {
  return isPrivateIpv4(ip) || (dev && DEV_ADDRESSES.indexOf(ip) >= 0);
}

export function isIpv4(s: string): boolean { return IPV4.test(s); }

/** A host name the rule can look up: labels of letters, digits and hyphens. */
export function isHostName(s: string): boolean {
  return s.length <= 253 && s.split('.').every((l) => LABEL.test(l)) && !IPV4.test(s);
}

export interface ParsedHost { scheme: 'http' | 'https'; host: string; port: number | null }

/** "192.168.1.50", "192.168.1.50:8080", "http://Sinko.local/" -> { scheme, host (small letters), port }; null when it is not one. */
export function parseHost(input: string): ParsedHost | null {
  const m = /^(?:(https?):\/\/)?([^/:\s?#]+)(?::(\d{1,5}))?\/*$/i.exec(input.trim());
  if (!m) return null;
  const host = m[2].toLowerCase().replace(/\.$/, ''), port = m[3] ? Number(m[3]) : null;
  if (port !== null && (port < 1 || port > 65535)) return null;
  if (!isIpv4(host) && !isHostName(host)) return null;
  return { scheme: (m[1] || 'http').toLowerCase() as 'http' | 'https', host, port };
}

/** Why a host was refused. `status` stays 0 (no answer from a box), so callers that only ask "did the box answer" need not know. */
export class HostRefused extends ApiError {
  reason: 'notPrivate' | 'notFound' | 'invalid';
  host: string;
  constructor(reason: 'notPrivate' | 'notFound' | 'invalid', host: string) {
    super(0, t(reason === 'notPrivate' ? 'hostNotPrivate' : reason === 'notFound' ? 'hostNotFound' : 'hostInvalid', { host }));
    this.name = 'HostRefused';
    this.reason = reason;
    this.host = host;
  }
}

/** The IPv4 addresses a name resolves to ([] when nobody answers). The app's is the native module in modules/sinko-net. */
export type Lookup = (name: string) => Promise<string[]>;

export interface HostGuard {
  /** "http://<host>[:port]" -> "http://<allowed address>[:port]", or rejects with HostRefused. */
  origin(baseUrl: string): Promise<string>;
  /** The address `host` resolves to and passes the rule, or rejects with HostRefused. */
  address(host: string): Promise<string>;
}

export interface HostGuardOptions {
  lookup?: Lookup;
  /** A development build: the mock box's addresses are allowed too. */
  dev?: boolean;
  /** How long a name's address is kept (ms). */
  ttlMs?: number;
  /** How long a lookup may take (ms): a .local name nobody answers for can keep the resolver busy for many seconds. */
  lookupTimeoutMs?: number;
  now?: () => number;
}

let defaultLookup: Lookup = async () => [];
/** The app sets the native lookup at start (src/state/app.ts); the tests leave the default, which knows no names. */
export function setDefaultLookup(lookup: Lookup): void { defaultLookup = lookup; }

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(fallback); });
  });
}

export function createHostGuard(options?: HostGuardOptions): HostGuard {
  const o = options || {};
  const dev = o.dev === undefined ? isDevBuild() : o.dev;
  const ttl = o.ttlMs === undefined ? 60000 : o.ttlMs;
  const timeout = o.lookupTimeoutMs === undefined ? 4000 : o.lookupTimeoutMs;
  const now = o.now || Date.now;
  const cache = new Map<string, { ip: string; until: number }>();

  async function address(host: string): Promise<string> {
    if (isIpv4(host)) {
      if (!addressAllowed(host, dev)) throw new HostRefused('notPrivate', host);
      return host;
    }
    if (!isHostName(host)) throw new HostRefused('invalid', host);
    const hit = cache.get(host);
    if (hit && hit.until > now()) return hit.ip;
    const found = await withTimeout((o.lookup || defaultLookup)(host), timeout, []);
    if (!found.length) throw new HostRefused('notFound', host);
    const ip = found.find((a) => addressAllowed(a, dev));
    if (!ip) throw new HostRefused('notPrivate', host);
    cache.set(host, { ip, until: now() + ttl });
    return ip;
  }

  return {
    address,
    async origin(baseUrl) {
      const p = parseHost(baseUrl);
      if (!p) throw new HostRefused('invalid', baseUrl);
      const ip = await address(p.host);
      return p.scheme + '://' + ip + (p.port !== null ? ':' + p.port : '');
    },
  };
}

/** React Native's __DEV__; false where it is not defined. */
export function isDevBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}
