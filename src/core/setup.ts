// The setup list on the main screen: which steps are done, and the number the router is given.
//
// Port of Sinko web/app.js routerPointsHere (line 1016), the list of renderSetup (line 1027) without the page's DOM, and the address of
// renderHelp (line 485). The page reads its globals (M, boxInfo, serverNowSec(), location.hostname); here they are arguments.
import { usableIpv4, type BoxInfo } from './box';
import type { Device, SinkoState } from './types';

/**
 * app.js routerPointsHere (line 1016): a device other than the parent's own phone (and other than the box itself) has asked the box
 * something in the last 7 days on the box's clock, so the router sends devices here. `nowSec` is the box's clock; `hostname` is the page's
 * location.hostname, for the app the address it talks to the box at.
 */
export function routerPointsHere(model: { devices: Device[]; myIp: string }, nowSec: number, hostname: string): boolean {
  return model.devices.some((d) => {
    if (!d.lastQuery || nowSec - d.lastQuery > 7 * 86400) return false;
    const ips = (d.ips || []).map((i) => i.ip);
    if (model.myIp && ips.indexOf(model.myIp) >= 0) return false;
    return !ips.some((ip) => ip === '127.0.0.1' || ip === '::1' || ip === hostname);
  });
}

export type SetupItemId = 'pw' | 'router' | 'child' | 'counter';
export interface SetupItem { id: SetupItemId; done: boolean }
export interface SetupList {
  items: SetupItem[];
  doneCount: number;
  /** Every item is done. */
  all: boolean;
  /** The page writes setup.done = true now (it also waits while a write of it is on its way). */
  save: boolean;
  /** The list is not shown: it was dismissed or finished before, or everything is done. */
  hide: boolean;
}

/**
 * The list of app.js renderSetup (line 1027): the parent password (always done: the page is signed in), the router, the first child's
 * device, and the counter question, which is asked only when box.json says a counter address is configured (a box without box.json does
 * not ask). When everything is done the page remembers it in setup.done, so the list does not come back if the router changes later.
 */
export function setupList(model: { devices: Device[]; myIp: string; kids: unknown[]; state: SinkoState }, boxInfo: BoxInfo | null,
  nowSec: number, hostname: string): SetupList {
  const s = model.state;
  const items: SetupItem[] = [
    { id: 'pw', done: true },
    { id: 'router', done: routerPointsHere(model, nowSec, hostname) },
    { id: 'child', done: model.kids.length > 0 },
  ];
  if (boxInfo && boxInfo.counter === true) items.push({ id: 'counter', done: s.telemetry.on !== null });
  const doneCount = items.filter((i) => i.done).length;
  const all = doneCount === items.length;
  return { items, doneCount, all, save: all && !s.setup.done, hide: s.setup.done || all };
}

/**
 * The number of app.js renderHelp (line 485): the box's own address from box.json, else the address the page was opened by when that is
 * a number a router could take (usableIpv4). Never a name: a router takes only numbers there. '' when there is none (helpBodyNoIp).
 */
export function routerAddress(boxInfo: BoxInfo | null, hostname: string): string {
  return (boxInfo && boxInfo.ip) || usableIpv4((hostname || '').toLowerCase());
}
