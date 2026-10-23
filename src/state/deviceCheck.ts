// "Check this device" in the guide for setting Sinko on one device by hand: has the box heard from that device since the parent tapped Check?
//
// The check starts at the tap, on the BOX's clock (the times in the query log are the box's, and the phone's clock can be anywhere), and
// follows /api/queries from there: it passes as soon as a query comes from one of the device's addresses. That reacts at once, while a
// device's lastQuery in /api/network/devices is written by FTL only now and then. After a minute without such a query it also takes a
// lastQuery from after the tap (a box whose privacy level hides who asked shows no addresses in its log); after three minutes it says the box
// has not heard from the device. The phone running the app is the address the box sees it at (/api/info/client).
import type { BoxClock, Client } from '../api/client';
import { deviceIps, type Device, type QueryRow } from '../core';
import { createStore, type Store } from './store';

export type DeviceTarget = { kind: 'thisPhone' } | { kind: 'device'; ips: string[] };

export type DeviceCheckState =
  | { phase: 'idle' }
  /** `since`: the tap, in whole seconds on the box's clock. `slow`: a minute has gone by, and lastQuery counts too. */
  | { phase: 'watching'; since: number; ips: string[]; slow: boolean }
  /** The box heard from the device at `at` (box clock), from `ip`. */
  | { phase: 'passed'; via: 'query' | 'lastQuery'; ip: string; at: number }
  | { phase: 'notSeen'; ips: string[] }
  /** The check could not start: the box did not say this phone's address. */
  | { phase: 'failed' };

/** How the check waits (ms). Mutable, so tests can shorten it. */
export const DEVICE_CHECK = { every: 2000, lastQueryAfter: 60000, giveUpAfter: 180000 };
/** Rows per look at the query log. */
const LENGTH = 200;
/** Seconds of the log read again on every look, like the live picture's feed (pb-core.js Feed overlap). */
const OVERLAP = 2;

export interface DeviceCheck {
  state: Store<DeviceCheckState>;
  start(target: DeviceTarget): Promise<void>;
  stop(): void;
}

export interface DeviceCheckDeps {
  call: Client['call'];
  clock: BoxClock;
  /** Phone time (ms). */
  now?: () => number;
  setTimeout?: (f: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

export function createDeviceCheck(deps: DeviceCheckDeps): DeviceCheck {
  const { call, clock } = deps;
  const now = deps.now || Date.now;
  const later = deps.setTimeout || ((f, ms) => setTimeout(f, ms));
  const cancel = deps.clearTimeout || ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const state = createStore<DeviceCheckState>({ phase: 'idle' });
  let run = 0;
  let timer: unknown = null;

  function stop() {
    run++;
    if (timer !== null) { cancel(timer); timer = null; }
  }

  async function start(target: DeviceTarget): Promise<void> {
    stop();
    const mine = run;
    const since = Math.floor(clock.nowSec());          // the tap, before anything else is asked
    const startedAt = now();
    let ips: string[];
    if (target.kind === 'thisPhone') {
      const j = await call<{ remote_addr?: unknown }>('GET', '/api/info/client').catch(() => null);
      ips = j && typeof j.remote_addr === 'string' && j.remote_addr ? [j.remote_addr] : [];
    } else {
      ips = target.ips.filter((ip) => !!ip);
    }
    if (mine !== run) return;
    if (!ips.length) { state.set({ phase: 'failed' }); return; }
    let from = since;
    let slow = false;
    state.set({ phase: 'watching', since, ips, slow });

    const pass = (via: 'query' | 'lastQuery', ip: string, at: number) => { if (mine === run) state.set({ phase: 'passed', via, ip, at }); };

    async function look(): Promise<void> {
      timer = null;
      if (mine !== run) return;
      const elapsed = now() - startedAt;
      // Asked first, whatever the time: a phone that comes back to the app after a while finds what happened while it was away.
      const q = await call<{ queries?: unknown }>('GET', '/api/queries?from=' + from + '&length=' + LENGTH).catch(() => null);
      if (mine !== run) return;
      const rows = q && Array.isArray(q.queries) ? (q.queries as QueryRow[]) : [];
      const hit = rows.find((r) => !!r && !!r.client && typeof r.client.ip === 'string' && ips.indexOf(r.client.ip) >= 0
        && typeof r.time === 'number' && r.time >= since);
      if (hit) { pass('query', hit.client!.ip as string, hit.time); return; }
      let newest: number | null = null;
      rows.forEach((r) => { if (r && typeof r.time === 'number' && (newest === null || r.time > newest)) newest = r.time; });
      if (newest !== null) from = Math.max(from, Math.floor(Math.min(newest, clock.nowSec())) - OVERLAP);
      if (elapsed >= DEVICE_CHECK.lastQueryAfter) {
        const j = await call<{ devices?: Device[] }>('GET', '/api/network/devices?max_devices=200&max_addresses=50').catch(() => null);
        if (mine !== run) return;
        for (const d of (j && Array.isArray(j.devices) ? j.devices : [])) {
          const ip = deviceIps(d).find((a) => ips.indexOf(a) >= 0);
          if (ip && d.lastQuery >= since) { pass('lastQuery', ip, d.lastQuery); return; }
        }
        if (!slow) { slow = true; state.set({ phase: 'watching', since, ips, slow }); }
      }
      if (elapsed >= DEVICE_CHECK.giveUpAfter) { state.set({ phase: 'notSeen', ips }); return; }
      timer = later(() => { void look(); }, DEVICE_CHECK.every);
    }
    await look();
  }

  return { state, start, stop };
}
