// The model of one box and the ways to change it: Sinko web/app.js load() (line 707), run() (line 793), putGroup (line 463), putClient
// (line 468), flushDns (line 458) and writeState (line 769), with loadBoxInfo (line 477), which load() runs. Every later screen uses these.
//
// The page keeps all of it in globals (M, catalog, domainMap, boxInfo, busy, rulesDirty); here one BoxSession holds them for one box, and
// what the page did with render() and toast() goes to subscribers (the `view` store) instead.
import { ApiError, type Client } from '../api/client';
import {
  G, SVC, deviceLabel, editState, learnedRules, parseBoxInfo, parseState, shadowRowsFor,
  type BoxInfo, type Catalog, type CatalogService, type ClientRow, type Device, type Group, type GroupsByName, type LearnedRule,
  type SinkoState,
} from '../core';
import { t } from '../i18n';
import { stateWritable } from './compat';
import { createStore, type Store } from './store';

/** One app on the box: its catalog entry, its Pi-hole group, and whether children are kept from it now. */
export interface ServiceEntry { meta: CatalogService; group: Group; blocked: boolean }
/** One child's device: its client row, the name to show, whether it is paused, its network-table entry and the rows that override it. */
export interface Kid { row: ClientRow; name: string; paused: boolean; dev: Device | null; shadow: ClientRow[] }

/** app.js M (line 744). */
export interface Model {
  groups: GroupsByName;
  services: ServiceEntry[];
  kids: Kid[];
  clients: ClientRow[];
  devices: Device[];
  myIp: string;
  byIp: Record<string, Device>;
  offline: boolean;
  state: SinkoState;
  learned: LearnedRule[];
}

/** A message the page would show as a toast. The view has it for as long as the page shows it. */
export interface Notice { text: string; error: boolean; at: number }

/** What the screens read. A new object whenever anything in it changes. */
export interface BoxView {
  model: Model | null;
  /** The page's banner: "Setup is not finished on this box" when Sinko's groups are missing (app.js line 725). */
  banner: string;
  busy: boolean;
  catalog: Catalog | null;
  /** pb/domains.json: domain -> app id, for the live picture. */
  domainMap: Record<string, string> | null;
  /** /pb/box.json, parsed and checked; null on an older box, which has none. */
  boxInfo: BoxInfo | null;
  notice: Notice | null;
  /** Phone time (ms) of the last load that worked. */
  loadedAt: number;
}

export interface BoxSession {
  view: Store<BoxView>;
  load(): Promise<Model | null>;
  run(fn: () => unknown, okMsg?: string | (() => string)): Promise<void>;
  putGroup(g: Group, enabled: boolean): Promise<void>;
  putClient(c: ClientRow, groups: number[]): Promise<void>;
  flushDns(): Promise<void>;
  writeState(mutator: (st: SinkoState) => void): Promise<void>;
  /** The model as last loaded (app.js M). */
  model(): Model | null;
  /** app.js toast (line 413): a message for the parent (the `notice` of the view). */
  toast(text: string, error?: boolean): void;
  /** A rule changed by a request of the caller's own: the next run() clears the DNS cache afterwards, as after putGroup and putClient. */
  rulesChanged(): void;
}

export interface BoxSessionOptions {
  /** Called after every load that worked (the boxes list keeps when each box was last seen). */
  onLoaded?: () => void;
  now?: () => number;
}

/** How long app.js toast (line 419) shows a message (ms). */
export const TOAST_MS = 2600, TOAST_ERROR_MS = 6000;

/** app.js q (line 454). */
function q(s: string): string { return encodeURIComponent(s); }

export function createBoxSession(client: Client, options?: BoxSessionOptions): BoxSession {
  const opts = options || {};
  const now = opts.now || Date.now;
  const call = client.call;
  const view = createStore<BoxView>({ model: null, banner: '', busy: false, catalog: null, domainMap: null, boxInfo: null, notice: null, loadedAt: 0 });
  const patch = (p: Partial<BoxView>) => view.update((v) => ({ ...v, ...p }));
  // The page's globals.
  let M: Model | null = null;
  let catalog: Catalog | null = null;
  let domainMap: Record<string, string> | null = null;
  let boxInfo: BoxInfo | null = null;
  let busy = false;
  // Pi-hole keeps answers it learned before a block, so a rule change only reaches an app once that cache is cleared. Every rule change
  // marks the box dirty; after the action, one quick resolver restart empties the cache (app.js line 455).
  let rulesDirty = false;

  /** app.js toast (line 413): the message stays 2.6 s, or 6 s when something went wrong, then the view has none. */
  function toast(text: string, error: boolean) {
    const notice = { text, error, at: now() };
    patch({ notice });
    const timer = setTimeout(() => { if (view.get().notice === notice) patch({ notice: null }); }, error ? TOAST_ERROR_MS : TOAST_MS);
    const t0 = timer as unknown as { unref?: () => void };
    if (typeof t0 === 'object' && t0 && t0.unref) t0.unref();          // Node (the tests): a message never keeps the process alive
  }

  /**
   * app.js loadBoxInfo (line 477). /pb/box.json, read without signing in. An older box has no such file and every feature that needs it
   * stays off. No answer at all keeps what was known; a file that is not what it should be counts as no file.
   */
  function loadBoxInfo(): Promise<BoxInfo | null> {
    return call<unknown>('GET', '/pb/box.json', { noSid: true, quiet401: true })
      .then((j) => j, (e: unknown) => (e instanceof ApiError && e.status === 0 ? undefined : null))
      .then((j) => { if (j !== undefined) boxInfo = parseBoxInfo(j); return boxInfo; }, () => { boxInfo = null; return null; });
  }

  /** app.js load (line 707): the same eight requests in parallel, the same model. */
  async function load(): Promise<Model | null> {
    type Groups = { groups?: Group[] };
    type Clients = { clients?: ClientRow[] };
    type Devices = { devices?: Device[] };
    const r = await Promise.all([
      call<Groups>('GET', '/api/groups'),
      call<Clients>('GET', '/api/clients'),
      call<Devices>('GET', '/api/network/devices?max_devices=200&max_addresses=50').catch((): Devices => ({ devices: [] })),
      call<{ remote_addr?: string }>('GET', '/api/info/client').catch(() => ({} as { remote_addr?: string })),
      catalog ? Promise.resolve(catalog) : call<Catalog>('GET', '/pb/services.json', { noSid: true, quiet401: true }),
      // A missing file (an older install) is cached as "no names"; a failed fetch is retried on the next load.
      domainMap ? Promise.resolve({ domains: domainMap }) : call<{ domains?: unknown }>('GET', '/pb/domains.json', { noSid: true, quiet401: true })
        .catch((e: unknown) => (e instanceof ApiError && e.status === 404 ? { domains: {} } : null)),
      loadBoxInfo(),
      // The rules the box learned (My box shows them; the services list says how many). Not there on an older box: none.
      call<{ domains?: unknown }>('GET', '/api/domains').catch(() => ({ domains: [] })),
    ]);
    const map = r[5] && r[5].domains && typeof r[5].domains === 'object' ? (r[5].domains as Record<string, string>) : null;
    catalog = r[4]; domainMap = map || domainMap;
    const byName: GroupsByName = {};
    (r[0].groups || []).forEach((g) => { byName[g.name] = g; });
    const ok = [G.kids, G.offline, G.paused, G.state].every((n) => byName[n]);
    if (!ok) {
      M = null;
      patch({ model: null, banner: t('waitBody'), catalog, domainMap, boxInfo });
      return null;
    }
    const cat = catalog;
    const kidId = byName[G.kids].id, pausedId = byName[G.paused].id;
    const devicesByMac: Record<string, Device> = {}, devicesByIp: Record<string, Device> = {};
    (r[2].devices || []).forEach((d) => {
      devicesByMac[(d.hwaddr || '').toLowerCase()] = d;
      (d.ips || []).forEach((ip) => { devicesByIp[ip.ip] = d; });
    });
    const kids: Kid[] = (r[1].clients || []).filter((c) => (c.groups || []).indexOf(kidId) >= 0)
      .map((c) => {
        const key = c.client.toLowerCase();
        const dev = devicesByMac[key] || devicesByIp[c.client] || null;
        const paused = c.groups.indexOf(pausedId) >= 0;
        return { row: c, name: c.comment || deviceLabel(dev) || c.client, paused, dev,
          shadow: shadowRowsFor(c.client, r[2].devices || [], r[1].clients || [], byName, paused, cat.services) };
      });
    const services = cat.services.map((s) => {
      const g = byName[SVC + s.id];
      return { meta: s, group: g, blocked: !!(g && g.enabled) };
    }).filter((s) => s.group);
    M = {
      groups: byName, services, kids, clients: r[1].clients || [],
      devices: r[2].devices || [], myIp: r[3].remote_addr || '', byIp: devicesByIp,
      offline: !!byName[G.offline].enabled, state: parseState(byName[G.state].comment),
      learned: learnedRules(r[7].domains),
    };
    patch({ model: M, banner: '', catalog, domainMap, boxInfo, loadedAt: now() });
    if (opts.onLoaded) opts.onLoaded();
    return M;
  }

  /** app.js flushDns (line 458). */
  function flushDns(): Promise<void> {
    if (!rulesDirty) return Promise.resolve();
    rulesDirty = false;
    return call('POST', '/api/action/restartdns').then(() => {}, () => { /* the rule change itself already worked */ });
  }

  /** app.js putGroup (line 463): switch one group on or off (an app blocked, the internet off). */
  function putGroup(g: Group, enabled: boolean): Promise<void> {
    rulesDirty = true;
    return call('PUT', '/api/groups/' + q(g.name), { body: { name: g.name, comment: g.comment || '', enabled: !!enabled } })
      .then(() => { g.enabled = !!enabled; });
  }

  /** app.js putClient (line 468): the groups of one client row. */
  function putClient(c: ClientRow, groups: number[]): Promise<void> {
    rulesDirty = true;
    return call('PUT', '/api/clients/' + q(c.client), { body: { comment: c.comment || '', groups } }).then(() => {});
  }

  /**
   * app.js writeState (line 769). Re-read first so a change the scheduler just made is never overwritten; editState keeps every field the
   * mutator does not touch, including the ones only the scheduler writes.
   */
  function writeState(mutator: (st: SinkoState) => void): Promise<void> {
    // A box with a newer contract (box.json's api): writing back what this app can read would drop the keys it does not know (compat.ts).
    if (!stateWritable(boxInfo)) return Promise.reject(new Error(t('appUpdateNeeded')));
    return call<{ groups?: Group[] }>('GET', '/api/groups/' + q(G.state)).then((j) => {
      const g = (j.groups || [])[0] || (M as Model).groups[G.state];
      const next = editState(g.comment, mutator);
      return call('PUT', '/api/groups/' + q(G.state), { body: { name: G.state, comment: next.json, enabled: false } })
        .then(() => {
          if (!M) return;
          M.groups[G.state].comment = next.json;
          M.state = next.state;
          patch({ model: { ...M } });
        });
    });
  }

  /** app.js run (line 793): one action at a time, a message when it worked or failed, the cache cleared, then the model again. */
  function run(fn: () => unknown, okMsg?: string | (() => string)): Promise<void> {
    if (busy) return Promise.resolve();
    busy = true; patch({ busy: true });
    return Promise.resolve().then(fn)
      .then(() => { if (okMsg) toast(typeof okMsg === 'function' ? okMsg() : okMsg, false); })
      .catch((e: unknown) => {
        const err = e as { status?: number; message?: string } | null | undefined;
        if (err && err.status !== 401) toast(t('failed', { e: err.message || String(e) }), true);
      })
      .then(flushDns)
      .then(() => { busy = false; patch({ busy: false }); return load().then(() => {}, () => {}); });
  }

  return { view, load, run, putGroup, putClient, flushDns, writeState, model: () => M, toast: (text, error) => toast(text, !!error),
    rulesChanged: () => { rulesDirty = true; } };
}
