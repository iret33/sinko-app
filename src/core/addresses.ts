// Addresses of devices, and which Pi-hole client row FTL really uses for a child's device.
//
// Pi-hole (FTL) picks a client's groups from the client rows whose IP or subnet contains the address a query comes from (longest prefix
// wins, highest id on a tie) and only then looks at the device's MAC row. So an IP or subnet row silently overrides a child's MAC row.
// Same logic as shadowing_rows() in bin/sinko.
//
// Port of Sinko web/app.js (private inside the page): client matching (lines 615-701), deviceLabel (line 753), MAC_RE and IPV4_RE
// (lines 893-894), normalizeAddr (line 895) and deviceAddr (line 905).
import { type GroupsByName, neededGroupIds } from './groups';
import type { CatalogService, ClientRow, Device } from './types';

/** app.js MAC_RE (line 893). */
export const MAC_RE = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;
/** app.js IPV4_RE (line 894). */
export const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** app.js parseIpv4 (line 620): four bytes, or null. */
export function parseIpv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const out: number[] = [];
  for (let i = 1; i <= 4; i++) { if (+m[i] > 255) return null; out.push(+m[i]); }
  return out;
}

/** app.js parseIpv6 (line 627): sixteen bytes, or null. A zone ("%eth0") is ignored and an embedded IPv4 tail is understood. */
export function parseIpv6(text: string): number[] | null {
  let s = text;
  const zone = s.indexOf('%'); if (zone >= 0) s = s.slice(0, zone);
  if (s.indexOf(':') < 0 || !/^[0-9a-f:.]+$/i.test(s)) return null;
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const v4 = parseIpv4(tail[2]); if (!v4) return null;
    s = tail[1] + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split('::'); if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups = head.slice();
  if (halves.length === 2) { while (groups.length + rest.length < 8) groups.push('0'); }
  groups = groups.concat(rest);
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/i.test(groups[i])) return null;
    const v = parseInt(groups[i], 16); out.push(v >> 8, v & 255);
  }
  return out;
}

/** app.js parseIp (line 649). */
export function parseIp(text: unknown): number[] | null { const s = String(text || ''); return s.indexOf(':') >= 0 ? parseIpv6(s) : parseIpv4(s); }

export interface Net { bytes: number[]; bits: number }
/** app.js parseNet (line 650): an address or CIDR subnet; null for MAC, host name and :interface rows. */
export function parseNet(text: unknown): Net | null {
  const parts = String(text || '').split('/'); if (parts.length > 2) return null;
  const b = parseIp(parts[0]); if (!b) return null;
  let bits = b.length * 8;
  if (parts.length === 2) { if (!/^\d+$/.test(parts[1]) || +parts[1] > bits) return null; bits = +parts[1]; }
  return { bytes: b, bits };
}

/** app.js inNet (line 657). */
export function inNet(ip: number[], net: Net): boolean {
  if (ip.length !== net.bytes.length) return false;
  for (let i = 0, left = net.bits; left > 0; i++, left -= 8) {
    const mask = left >= 8 ? 255 : (255 << (8 - left)) & 255;
    if ((ip[i] & mask) !== (net.bytes[i] & mask)) return false;
  }
  return true;
}

/** app.js winningRow (line 665): the IP or subnet row FTL uses for `ip` (longest prefix, then highest id), or null. */
export function winningRow(ip: number[], clients: ClientRow[]): ClientRow | null {
  let best: ClientRow | null = null, bestKey: number | null = null;
  clients.forEach((c) => {
    const net = parseNet(c.client);
    if (!net || !inNet(ip, net)) return;
    const key = net.bits * 1e9 + (c.id || 0);
    if (bestKey === null || key > bestKey) { best = c; bestKey = key; }
  });
  return best;
}

/** app.js deviceIps (line 675): every address of a network-table device, the one in an "ip-<addr>" hwaddr too. */
export function deviceIps(d: Pick<Device, 'hwaddr' | 'ips'>): string[] {
  const ips = (d.ips || []).map((i) => i.ip).filter(Boolean);
  const hw = d.hwaddr || '';
  if (hw.indexOf('ip-') === 0 && ips.indexOf(hw.slice(3)) < 0) ips.push(hw.slice(3));
  return ips;
}

/**
 * app.js shadowRowsFor (line 688): client rows FTL would use instead of this MAC-registered child's own row, if they lack its pb groups.
 * `services` is services.json's list (the page read its global catalog).
 */
export function shadowRowsFor(addr: string, devices: Device[], clients: ClientRow[], byName: GroupsByName, paused: boolean,
  services: CatalogService[]): ClientRow[] {
  if (!MAC_RE.test(addr || '')) return [];
  const dev = devices.filter((d) => (d.hwaddr || '').toLowerCase() === addr.toLowerCase())[0];
  if (!dev) return [];
  const needed = neededGroupIds(byName, paused, services), found: Record<string, boolean> = {}, out: ClientRow[] = [];
  deviceIps(dev).forEach((ipText) => {
    const ip = parseIp(ipText); if (!ip) return;
    const row = winningRow(ip, clients);
    if (!row || found[row.client]) return;
    const have = row.groups || [];
    if (needed.some((id) => have.indexOf(id) < 0)) { found[row.client] = true; out.push(row); }
  });
  return out;
}

/** app.js deviceLabel (line 753): the first name FTL knows for a device, or ''. */
export function deviceLabel(d: Pick<Device, 'ips'> | null | undefined): string {
  if (!d) return '';
  const name = (d.ips || []).map((i) => i.name).filter(Boolean)[0];
  return name || '';
}

/** app.js normalizeAddr (line 895): a typed MAC (A4:83:E7:12:34:56), IPv4 or IPv6 address, tidied; null when it is none of them. */
export function normalizeAddr(value: string | null | undefined): string | null {
  const v = (value || '').trim();
  if (MAC_RE.test(v)) return v.replace(/-/g, ':').toUpperCase();
  if (IPV4_RE.test(v)) return v;
  if (v.indexOf(':') >= 0 && /^[0-9a-f:]+$/i.test(v) && v.length >= 3) return v.toLowerCase();  // IPv6
  return null;
}

/**
 * app.js deviceAddr (line 905): the address to register a network-table entry by. A real MAC is stable. An "ip-<addr>" entry means FTL has
 * no MAC for it: prefer its IPv4 address, and offer nothing for an IPv6-only entry (phones rotate their IPv6 privacy addresses daily,
 * which would silently end the filtering).
 */
export function deviceAddr(d: Pick<Device, 'hwaddr' | 'ips'>): string {
  const hw = d.hwaddr || '';
  if (hw.indexOf('ip-') !== 0) return hw.toUpperCase();
  if (parseIpv4(hw.slice(3))) return hw.slice(3);
  const v4 = (d.ips || []).map((i) => i.ip).filter((a) => parseIpv4(a))[0];
  return v4 || '';
}
