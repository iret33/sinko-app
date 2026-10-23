// The guided setup of one box: the page's setup list (Sinko web/app.js renderSetup line 1027, answerCounter line 1073, hideSetup line 1076),
// the router check that ticks it, and adding a child's device (submitDevice, line 969). What the page did while drawing the list (write
// setup.done once everything is done) is a subscriber of the model here, so it happens once whichever screen is open.
import type { Client } from '../api/client';
import {
  Poller, deviceRequest, routerPointsHere, setupList, shadowRowsFor, wakeOnActive, type AppStateLike, type Device, type SetupList,
} from '../core';
import { t } from '../i18n';
import { isolate, ltr } from '../i18n/format';
import type { BoxSession, BoxView } from './model';
import { createStore, type Store } from './store';

/** What the live router check last saw: `pointsHere` null until it has looked once; `checkedAt` phone time (ms). */
export interface RouterLive { pointsHere: boolean | null; checkedAt: number }

/** How often the router check looks while the parent waits for the first device (ms). */
export const ROUTER_CHECK_MS = 5000;

export interface Setup {
  session: BoxSession;
  /** The address the app talks to the box at: the page's location.hostname ('' until it is known). */
  host: Store<string>;
  router: Store<RouterLive>;
  /** The setup list of the model in `view` (the session's view by default); null until the model is loaded. */
  list(view?: BoxView): SetupList | null;
  /** Starts what renderSetup does besides drawing: setup.done is written once everything is done. Returns stop(). */
  watch(): () => void;
  /** The live router check runs while at least one screen holds it. Returns release(). */
  followRouter(): () => void;
  /** app.js answerCounter (line 1073): Yes or Not now to the counter question. */
  answerCounter(yes: boolean): Promise<void>;
  /** app.js hideSetup (line 1076): "Hide this list". */
  hide(): Promise<void>;
  /** app.js submitDevice (line 969): makes `addr` a child's device named `name`. */
  addDevice(addr: string, name: string): Promise<void>;
}

export interface SetupDeps {
  session: BoxSession;
  client: Client;
  /** The address the box is reached at (Connection.address). */
  address: () => Promise<string>;
  /** React Native's AppState: nothing is polled while the app is in the background. */
  appState?: AppStateLike;
  now?: () => number;
  setTimeout?: (f: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

const DEVICES = '/api/network/devices?max_devices=200&max_addresses=50';

export function createSetup(deps: SetupDeps): Setup {
  const { session, client } = deps;
  const now = deps.now || Date.now;
  const host = createStore('');
  const router = createStore<RouterLive>({ pointsHere: null, checkedAt: 0 });
  let holders = 0;
  let poller: Poller | null = null;
  let stopWake: (() => void) | null = null;

  void deps.address().then((ip) => { host.set(ip); }, () => undefined);

  function list(view?: BoxView): SetupList | null {
    const v = view || session.view.get();
    return v.model ? setupList(v.model, v.boxInfo, client.clock.nowSec(), host.get()) : null;
  }

  function watch(): () => void {
    let saving = false, wasShown = false, written = false;
    const check = () => {
      const l = list();
      if (!l) return;
      if (l.save && !saving && !written) {
        // The page says "Everything is set up." when the list had been shown. It reads setupWasShown after the write, by which time its
        // own render has reset it, so the page never says it; the app keeps what it was when the write began.
        const shown = wasShown;
        saving = true;
        session.writeState((st) => { st.setup.done = true; })
          // Written once per session: a load that left before this write and answers after it still has setup.done false, and the page
          // would write it again then.
          .then(() => { written = true; if (shown) session.toast(t('setupDoneToast')); }, () => undefined)
          .then(() => { saving = false; });
      }
      wasShown = !l.hide;
    };
    check();
    return session.view.subscribe(check);
  }

  /** One look at the box's devices. When a device now uses the box and the model does not know yet, the model is loaded again. */
  async function lookAtRouter(): Promise<void> {
    const m = session.model();
    if (!m) return;
    if (routerPointsHere(m, client.clock.nowSec(), host.get())) { router.set({ pointsHere: true, checkedAt: now() }); return; }
    const j = await client.call<{ devices?: Device[] }>('GET', DEVICES);
    const yes = routerPointsHere({ devices: j.devices || [], myIp: m.myIp }, client.clock.nowSec(), host.get());
    router.set({ pointsHere: yes, checkedAt: now() });
    if (yes) await session.load();
  }

  function followRouter(): () => void {
    holders++;
    if (!poller) {
      const appState = deps.appState;
      poller = new Poller({
        tasks: [{ name: 'router', every: ROUTER_CHECK_MS, run: lookAtRouter }],
        visible: appState ? () => appState.currentState !== 'background' : undefined,
        now: deps.now, setTimeout: deps.setTimeout, clearTimeout: deps.clearTimeout,
      });
      poller.start();
      stopWake = appState ? wakeOnActive(poller, appState) : null;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--holders > 0 || !poller) return;
      poller.stop(); poller = null;
      if (stopWake) { stopWake(); stopWake = null; }
    };
  }

  function answerCounter(yes: boolean): Promise<void> {
    return session.run(() => session.writeState((st) => { st.telemetry = { on: yes }; }), t(yes ? 'boxCounterOnToast' : 'setupLaterToast'));
  }

  function hide(): Promise<void> {
    return session.run(() => session.writeState((st) => { st.setup.done = true; }));
  }

  function addDevice(addr: string, name: string): Promise<void> {
    const m = session.model();
    if (!m) return Promise.resolve();
    const n = name.trim();
    const shown = n ? isolate(n) : ltr(addr);           // the name, or the address, kept whole inside an Arabic sentence
    const services = (session.view.get().catalog || { services: [] }).services;
    const shadow = shadowRowsFor(addr, m.devices, m.clients, m.groups, false, services);
    return session.run(async () => {
      const r = deviceRequest(m, addr, name);
      await client.call(r.method, r.path, { body: r.body });
      // The page sends this request with call() itself, not putClient, so its run() clears no DNS cache after adding a device. The app
      // does (run() posts /api/action/restartdns after the action), on purpose: a child's device that asked for an app before it was added
      // would otherwise keep the answers Pi-hole had cached for it, and an app blocked for children would still open on it for a while.
      session.rulesChanged();
    }, () => t('deviceAdded', { n: shown })).then(() => {
      if (shadow.length) session.toast(t('shadowedToast', { n: shown, r: shadow.map((x) => ltr(x.client)).join(', ') }), true);
    });
  }

  return { session, host, router, list, watch, followRouter, answerCounter, hide, addDevice };
}
