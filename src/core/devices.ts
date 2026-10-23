// Adding a child's device: the devices the add sheet offers, and the one request that makes an address a child's device.
//
// Port of Sinko web/app.js renderPicker (line 919, its list and what each button shows, without the DOM) and submitDevice (line 969, the
// request it sends, without the page's dialog and toasts). The page reads its global M and serverNowSec(); here they are arguments.
import { deviceAddr, deviceLabel } from './addresses';
import { G, kidGroupIds, type GroupsByName } from './groups';
import type { ClientRow, Device, Group } from './types';

/**
 * The list of app.js renderPicker (line 919): network-table devices that are not a child's device yet (neither by the address they would be
 * added by nor by any of their addresses), that asked the box within 30 days on its clock, newest first, at most 25. An entry with no
 * address to add it by (IPv6 only, see deviceAddr) is left out.
 */
export function pickerDevices(model: { clients: ClientRow[]; groups: GroupsByName; devices: Device[] }, nowSec: number): Device[] {
  const taken: Record<string, boolean> = {};
  model.clients.forEach((c) => {
    if (c.groups.indexOf(model.groups[G.kids].id) >= 0) taken[c.client.toLowerCase()] = true;
  });
  return model.devices.filter((d) => {
    const addr = deviceAddr(d).toLowerCase();
    if (!addr || taken[addr]) return false;
    if ((d.ips || []).some((i) => taken[i.ip])) return false;
    return !!d.lastQuery && nowSec - d.lastQuery < 30 * 86400;
  }).sort((a, b) => b.lastQuery - a.lastQuery).slice(0, 25);
}

/** One button of the picker. */
export interface PickerEntry {
  device: Device;
  /** What the device is added by (deviceAddr). */
  addr: string;
  /** The host name FTL knows ('' when none): what the name field is filled with. */
  name: string;
  /** What the button says: the host name, else the maker, else the address. */
  label: string;
  /** It is the phone the parent is using (its address is /api/info/client's): "This device". */
  mine: boolean;
  /** The first address, '' when none. */
  ip: string;
  vendor: string;
  lastQuery: number;
}

/** app.js renderPicker (line 919): each device of pickerDevices with what its button shows. */
export function pickerEntries(model: { clients: ClientRow[]; groups: GroupsByName; devices: Device[]; myIp: string }, nowSec: number): PickerEntry[] {
  return pickerDevices(model, nowSec).map((d) => {
    const addr = deviceAddr(d);
    const ips = (d.ips || []).map((i) => i.ip);
    return {
      device: d, addr, name: deviceLabel(d), label: deviceLabel(d) || d.macVendor || addr,
      mine: !!model.myIp && ips.indexOf(model.myIp) >= 0, ip: ips[0] || '', vendor: d.macVendor || '', lastQuery: d.lastQuery,
    };
  });
}

export type DeviceRequest =
  | { method: 'PUT'; path: string; body: { comment: string; groups: number[] } }
  | { method: 'POST'; path: '/api/clients'; body: { client: string; comment: string; groups: number[] } };

/**
 * The request of app.js submitDevice (line 969). A client row for this address already exists (any letters' case): it keeps its groups and
 * gets every group a child's device needs (kidGroupIds), and its comment becomes the name, or stays when no name was given. Otherwise a new
 * row with those groups and the name. `name` is the name field as typed (the page trims it).
 */
export function deviceRequest(model: { clients: ClientRow[]; groups: GroupsByName; services: { group: Group }[] }, addr: string,
  name: string): DeviceRequest {
  const n = name.trim();
  const existing = model.clients.filter((c) => c.client.toLowerCase() === addr.toLowerCase())[0];
  const need = kidGroupIds(model);
  if (existing) {
    const merged = existing.groups.concat(need).filter((v, i, a) => a.indexOf(v) === i);
    return { method: 'PUT', path: '/api/clients/' + encodeURIComponent(existing.client), body: { comment: n || existing.comment || '', groups: merged } };
  }
  return { method: 'POST', path: '/api/clients', body: { client: addr, comment: n, groups: need } };
}
