// Finding a Sinko box on the home network. Four ways, the first three at once, and every box shown as soon as it answers:
//   bonjour  _sinko._tcp, which a box from Sinko 3.2 announces (architecture.md, "Finding the box"),
//   local    http://sinko.local (the name of a ready-made box) and <hostname>.local of every box this phone knows,
//   scan     every address of the phone's own /24, only on Wi-Fi: 1.5 s each, 16 at a time, never the phone itself,
//   manual   an address or a name the parent types.
// A host counts as a Sinko box only when its /pb/box.json passes parseBoxInfo. One that answers /api/auth like Pi-hole but has no box.json
// is Pi-hole without Sinko, or Sinko older than 3.0: it is listed apart, with what to do. No React and no native module here: the app
// passes its Bonjour, network and permission checks in (src/state/native.ts), the tests pass fakes.
import { ApiError, createClient, createHostGuard, HostRefused, isPrivateIpv4, parseHost, type HostGuard } from '../api';
import { parseBoxInfo, type BoxInfo } from '../core/box';
import { t } from '../i18n';
import { sameHost, type Box } from './boxes';
import { createStore, type Store } from './store';

export type Via = 'bonjour' | 'local' | 'scan' | 'manual' | 'dev';

/** A box that answered. `savedId`: the box this phone knows already (same boxId, or same address). */
export interface FoundBox { key: string; ip: string; port: number; info: BoxInfo; via: Via[]; savedId: string | null }
/** Pi-hole without Sinko 3 at this address. */
export interface OldBox { ip: string; port: number }

export type Probe = { kind: 'sinko'; info: BoxInfo } | { kind: 'pihole' } | { kind: 'none' };

/** One service as react-native-zeroconf resolves it. */
export interface BonjourService { name: string; port: number; addresses: string[] }
export interface Bonjour {
  /** Starts browsing for _sinko._tcp; returns the function that stops it. `onDenied`: iOS refused (Local Network is off). */
  browse(onService: (s: BonjourService) => void, onDenied: () => void): () => void;
}
export type LocalAccess = 'granted' | 'denied' | 'unknown';

export interface DiscoveryDeps {
  /** GET /pb/box.json, then /api/auth (src/state/discovery.ts probeHost). */
  probe?: (ip: string, port: number, timeoutMs: number) => Promise<Probe>;
  hosts?: HostGuard;
  fetch?: typeof fetch;
  bonjour?: Bonjour;
  /** Is the phone on Wi-Fi, and its address there (expo-network). */
  network: () => Promise<{ wifi: boolean; ip: string }>;
  /** The Local Network permission (iOS; Android 17's ACCESS_LOCAL_NETWORK). May show the system prompt. */
  access?: () => Promise<LocalAccess>;
  /** The boxes this phone knows. */
  saved: () => Box[];
  /** Development builds: the mock box (127.0.0.1:8080 on the iOS Simulator, 10.0.2.2:8080 on the Android emulator). */
  devHosts?: { ip: string; port: number }[];
  now?: () => number;
  setTimeout?: (f: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

export interface DiscoveryState {
  running: boolean;
  /** About 10 s have passed (or the search is over): the screen shows the next step (typing the address). */
  slow: boolean;
  boxes: FoundBox[];
  old: OldBox[];
  /** null until the network was looked at. */
  wifi: boolean | null;
  access: LocalAccess | null;
  /** The scan of the /24: how many addresses were asked, of how many; null when there is no scan. */
  scan: { checked: number; total: number } | null;
}

export type ManualResult =
  | { kind: 'found'; box: FoundBox }
  | { kind: 'old'; host: string }
  | { kind: 'nothing'; host: string }
  | { kind: 'refused'; message: string };

export interface Discovery {
  state: Store<DiscoveryState>;
  start(): void;
  stop(): void;
  manual(text: string): Promise<ManualResult>;
}

export const SCAN = { timeoutMs: 1500, parallel: 16 };
export const PROBE_TIMEOUT_MS = 3000;
export const SLOW_MS = 10000;
const READY_MADE = 'sinko.local';

/** What a box answers at ip:port, through the host rule and without a session. */
export async function probeHost(ip: string, port: number, timeoutMs: number, hosts?: HostGuard, doFetch?: typeof fetch): Promise<Probe> {
  const client = createClient({ baseUrl: () => 'http://' + ip + (port === 80 ? '' : ':' + port), sid: () => '', hosts, fetch: doFetch });
  try {
    const info = parseBoxInfo(await client.call<unknown>('GET', '/pb/box.json', { noSid: true, quiet401: true, timeoutMs }));
    if (info) return { kind: 'sinko', info };
  } catch (e) {
    if (!(e instanceof ApiError) || e.status === 0) return { kind: 'none' };
  }
  // Pi-hole v6 answers /api/auth with a session object (200 without a password, 401 with one), whatever else the host is.
  try {
    const j = await client.call<{ session?: unknown }>('GET', '/api/auth', { noSid: true, quiet401: true, timeoutMs });
    return j && typeof j.session === 'object' && j.session ? { kind: 'pihole' } : { kind: 'none' };
  } catch (e) {
    const b = e instanceof ApiError ? (e.body as { session?: unknown } | null) : null;
    return b && typeof b.session === 'object' && b.session ? { kind: 'pihole' } : { kind: 'none' };
  }
}

/** "192.168.1.50" for port 80, "127.0.0.1:8080" otherwise: what the boxes list keeps. */
export function hostOf(ip: string, port: number): string { return port === 80 ? ip : ip + ':' + port; }

/** The addresses of the phone's /24, without the phone itself, the network's own address and its broadcast. */
export function subnetAddresses(phoneIp: string): string[] {
  if (!isPrivateIpv4(phoneIp)) return [];
  const parts = phoneIp.split('.'), base = parts.slice(0, 3).join('.'), own = Number(parts[3]);
  const out: string[] = [];
  for (let i = 1; i <= 254; i++) if (i !== own) out.push(base + '.' + i);
  return out;
}

export function createDiscovery(deps: DiscoveryDeps): Discovery {
  const hosts = deps.hosts || createHostGuard();
  const probe = deps.probe || ((ip: string, port: number, ms: number) => probeHost(ip, port, ms, hosts, deps.fetch));
  const later = deps.setTimeout || ((f, ms) => setTimeout(f, ms));
  const cancel = deps.clearTimeout || ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const empty = (): DiscoveryState => ({ running: false, slow: false, boxes: [], old: [], wifi: null, access: null, scan: null });
  const state = createStore<DiscoveryState>(empty());
  const patch = (p: Partial<DiscoveryState>) => state.update((s) => ({ ...s, ...p }));
  let run = 0;                       // a new start() makes the answers of the previous one stale
  let stopBonjour: (() => void) | null = null;
  let slowTimer: unknown = null;

  function savedIdFor(ip: string, port: number, info: BoxInfo): string | null {
    const saved = deps.saved();
    const byId = info.boxId ? saved.find((b) => b.boxId === info.boxId) : undefined;
    const known = byId || saved.find((b) => sameHost(b.host, hostOf(ip, port)));
    return known ? known.id : null;
  }

  /** A box answered: listed once, by its boxId when it has one (the same box can answer Bonjour, its .local name and the scan). */
  function found(ip: string, port: number, info: BoxInfo, via: Via): FoundBox {
    const key = info.boxId || hostOf(ip, port);
    let result: FoundBox | null = null;
    state.update((s) => {
      const i = s.boxes.findIndex((b) => b.key === key || (b.ip === ip && b.port === port));
      if (i >= 0) {
        const b = s.boxes[i];
        result = { ...b, via: b.via.indexOf(via) >= 0 ? b.via : [...b.via, via] };
        const list = s.boxes.slice(); list[i] = result;
        return { ...s, boxes: list };
      }
      result = { key, ip, port, info, via: [via], savedId: savedIdFor(ip, port, info) };
      return { ...s, boxes: [...s.boxes, result], old: s.old.filter((o) => !(o.ip === ip && o.port === port)) };
    });
    return result!;
  }
  function oldBox(ip: string, port: number) {
    state.update((s) => (s.old.some((o) => o.ip === ip && o.port === port) || s.boxes.some((b) => b.ip === ip && b.port === port)
      ? s : { ...s, old: [...s.old, { ip, port }] }));
  }

  async function ask(mine: number, ip: string, port: number, via: Via, timeoutMs: number): Promise<Probe> {
    const p = await probe(ip, port, timeoutMs);
    if (mine !== run) return p;
    if (p.kind === 'sinko') found(ip, port, p.info, via);
    else if (p.kind === 'pihole') oldBox(ip, port);
    return p;
  }

  async function byName(mine: number, name: string) {
    let ip: string;
    try { ip = await hosts.address(name); } catch { return; }
    if (mine === run) await ask(mine, ip, 80, 'local', PROBE_TIMEOUT_MS);
  }

  async function scan(mine: number, phoneIp: string) {
    const all = subnetAddresses(phoneIp);
    if (!all.length) return;
    let next = 0, checked = 0;
    patch({ scan: { checked: 0, total: all.length } });
    const worker = async () => {
      while (mine === run && next < all.length) {
        const ip = all[next++];
        await ask(mine, ip, 80, 'scan', SCAN.timeoutMs).catch(() => undefined);
        checked++;
        if (mine === run) patch({ scan: { checked, total: all.length } });
      }
    };
    await Promise.all(Array.from({ length: SCAN.parallel }, worker));
  }

  function stop() {
    run++;
    if (stopBonjour) { stopBonjour(); stopBonjour = null; }
    if (slowTimer !== null) { cancel(slowTimer); slowTimer = null; }
    patch({ running: false, slow: true });
  }

  return {
    state,
    start() {
      stop();
      const mine = run;
      state.set({ ...empty(), running: true });
      slowTimer = later(() => { slowTimer = null; if (mine === run) patch({ slow: true }); }, SLOW_MS);
      const jobs: Promise<unknown>[] = [];
      if (deps.access) {
        jobs.push(deps.access().then((a) => { if (mine === run) patch({ access: a }); }, () => undefined));
      }
      if (deps.bonjour) {
        try {
          stopBonjour = deps.bonjour.browse((svc) => {
            if (mine !== run) return;
            const ips = svc.addresses.filter((a) => isPrivateIpv4(a));
            ips.forEach((ip) => { void ask(mine, ip, svc.port || 80, 'bonjour', PROBE_TIMEOUT_MS).catch(() => undefined); });
          }, () => { if (mine === run) patch({ access: 'denied' }); });
        } catch { stopBonjour = null; }
      }
      const names = [READY_MADE];
      deps.saved().forEach((b) => { const n = b.hostname ? b.hostname + '.local' : ''; if (n && names.indexOf(n) < 0) names.push(n); });
      names.forEach((n) => jobs.push(byName(mine, n)));
      (deps.devHosts || []).forEach((h) => jobs.push(ask(mine, h.ip, h.port, 'dev', PROBE_TIMEOUT_MS).catch(() => undefined)));
      jobs.push(deps.network().then((net) => {
        if (mine !== run) return;
        patch({ wifi: net.wifi });
        if (net.wifi) return scan(mine, net.ip);
      }, () => { if (mine === run) patch({ wifi: null }); }));
      // Bonjour goes on answering until stop(): the search is "over" when everything else is.
      void Promise.all(jobs).then(() => { if (mine === run) patch({ running: false, slow: true }); });
    },
    stop,
    async manual(text) {
      const p = parseHost(text);
      if (!p) return { kind: 'refused', message: t('hostInvalid', { host: text.trim() }) };
      let ip: string;
      try { ip = await hosts.address(p.host); } catch (e) {
        return { kind: 'refused', message: e instanceof HostRefused ? e.message : t('hostNotFound', { host: p.host }) };
      }
      const port = p.port === null ? 80 : p.port;
      const r = await ask(run, ip, port, 'manual', PROBE_TIMEOUT_MS);
      const shown = p.port === null ? p.host : p.host + ':' + p.port;
      if (r.kind === 'sinko') return { kind: 'found', box: found(ip, port, r.info, 'manual') };
      if (r.kind === 'pihole') return { kind: 'old', host: shown };
      return { kind: 'nothing', host: shown };
    },
  };
}
