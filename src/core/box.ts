// The pure logic behind Sinko's "My box" sheet: what the update card shows, the plain-words readings of the box, the addresses, the
// password rules, what a restore keeps, and the timings the sheet waits for.
//
// Port of Sinko web/pb-box.js: every function exported there as PBBox.pure (lines 598-606), PBBox.timing (lines 610-615) and requestTime
// (line 646, private there; here it takes the box's clock as an argument).
import type { SinkoState, UpdateState } from './types';

// ------------------------------------------------------------------ constants (pb-box.js lines 264-286)
// The scheduler calls a run dead when nothing holds the update lock for 3 minutes (RUNNER_GRACE in bin/sinko) and then checks the box and
// says how it ended. A page that still reads "running" after this long therefore means the scheduler is not judging (it is stopped,
// or the clock is not believed), not that the update is merely slow.
export const STALL_SEC = 15 * 60;
const FAILED_SHOWN_SEC = 7 * 86400;      // the scheduler will not retry a failed version for a week: so the page keeps saying so
const OK_SHOWN_SEC = 10 * 60;
export const HEARTBEAT_LATE_SEC = 20 * 60;      // box.json is rewritten at least every 10 minutes (and not during an update): 20 minutes is silence
export const MIN_PASSWORD = 8;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const TZ_NAME = /^[A-Za-z0-9][A-Za-z0-9_+./-]{0,63}$/;
const UTC_OFFSET = /^([+-])(0\d|1[0-4]):([0-5]\d)$/;
// Text that reads like something to type: a program that needs a keyboard, a backtick, a shell expansion, "run:", or one of Sinko's own commands.
const COMMAND_LIKE = /\b(sudo|systemctl|journalctl|apt|apt-get)\b|`|\$\(|\brun:|\bsinko\s+(doctor|update|selfcheck|rollback|setup|configure|telemetry|remove|box-info|status|run)\b/i;
const UTC_ZONES = ['utc', 'etc/utc', 'uct', 'etc/uct', 'universal', 'etc/universal', 'zulu', 'etc/zulu'];
const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

// What a restore imports: ONLY the tables that hold children's devices, apps and rules. Never the configuration (that would change the
// address, the upstream servers and the password) and never DHCP leases. Spelled out, because a missing "import" means "everything".
export const RESTORE_IMPORT = { config: false, dhcp_leases: false, gravity: { group: true, adlist: true, adlist_by_group: true,
  domainlist: true, domainlist_by_group: true, client: true, client_by_group: true } };

/** pb-box.js counterOnlineKey (line 293): which sentence says how many Sinko boxes are online, or null (shown from two boxes up). */
export function counterOnlineKey(n: unknown): 'boxCounterOnline' | 'boxCounterOnlineTwo' | null {
  if (typeof n !== 'number' || !isFinite(n) || n < 2) return null;
  return n === 2 ? 'boxCounterOnlineTwo' : 'boxCounterOnline';
}

/** pb-box.js pageStamp (line 303): the release a page was installed as, from <meta name="sinko-version">; '' when it is not a version. */
export function pageStamp(content: unknown): string {
  return parseSemver(content) ? String(content).trim() : '';
}

/**
 * pb-box.js staleTarget (line 313): the version a page should reload for, or '': the box has another version than the one the page was
 * installed as. Never for an unstamped page, and never twice for the same version (`reloadedFor`).
 */
export function staleTarget(stamp: unknown, installed: unknown, reloadedFor: unknown): string {
  if (!parseSemver(stamp) || !parseSemver(installed)) return '';
  const s = String(stamp).trim(), i = String(installed).trim();
  return s === i || i === reloadedFor ? '' : i;
}

const PIHOLE_VERSION = /^v?(\d{1,3}(?:\.\d{1,3}){1,3})$/;
/**
 * pb-box.js piholeVersion (line 325): the Pi-hole core version out of GET /api/info/version, written "v6.3" the way `pihole -v` prints it;
 * '' when the answer has no plain release number.
 */
export function piholeVersion(info: unknown): string {
  const i = info as { version?: { core?: { local?: { version?: unknown } } } } | null | undefined;
  const v = i && i.version && i.version.core && i.version.core.local && i.version.core.local.version;
  const m = typeof v === 'string' ? PIHOLE_VERSION.exec(v.trim()) : null;
  return m ? 'v' + m[1] : '';
}

/** pb-box.js parseSemver (line 331). */
export function parseSemver(v: unknown): [number, number, number] | null {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(v === null || v === undefined ? '' : v).trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}
/** pb-box.js isNewer (line 336): true only when both are x.y.z versions and `a` is newer than `b`. */
export function isNewer(a: unknown, b: unknown): boolean {
  const x = parseSemver(a), y = parseSemver(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

export type UpdateView =
  | { phase: 'stalled' | 'running'; to: string | null; from: string | null }
  | { phase: 'starting'; to: string | null }
  | { phase: 'failed'; error: string | null; rolledBack: boolean | null; to: string | null; from: string | null; latest: string | null; notes: string | null }
  | { phase: 'ok'; to: string | null }
  | { phase: 'available'; latest: string | null; notes: string | null; checked: number }
  | { phase: 'current'; checked: number };

/**
 * pb-box.js updateView (line 355). What the update card shows, from the shared state and the clock:
 *   starting   the page asked and the scheduler has not picked it up yet
 *   running    the scheduler is updating (or `stalled`: it says so for too long, so the runner died)
 *   ok         it just finished
 *   failed     the last attempt failed (shown for a week, while that version is still the one on offer). `rolledBack` says whether the
 *              previous version is back: true, false (it is not working either) or null (not known); the card claims recovery only for true
 *   available  a newer version exists
 *   current    nothing to do
 * ctx: { now: seconds on the box's clock, current: the installed version ('' when unknown) }.
 */
export function updateView(st: SinkoState, ctx: { now: number; current: string }): UpdateView {
  const u = st.update, now = ctx.now, age = u.at ? now - u.at : Infinity;
  const newer = !!(u.latest && (!ctx.current || isNewer(u.latest, ctx.current)));
  if (u.status === 'running') {
    if (age > STALL_SEC) return { phase: 'stalled', to: u.to || u.latest, from: u.from };
    return { phase: 'running', to: u.to || u.latest, from: u.from };
  }
  if (u.request !== null) return { phase: 'starting', to: u.latest };
  // A failure counts for the version on offer (or when nobody knows which version it was): not for an older one that has been superseded.
  // "The previous version is back" while the version that failed is the one running is out of date: it was installed since, by hand.
  const contradicted = u.rolledBack === true && !!ctx.current && u.to === ctx.current && u.from !== u.to;
  if (u.status === 'failed' && age < FAILED_SHOWN_SEC && (!u.latest || !u.to || u.latest === u.to) && !contradicted) {
    return { phase: 'failed', error: u.error, rolledBack: u.rolledBack, to: u.to, from: u.from, latest: newer ? u.latest : null, notes: u.notes };
  }
  if (u.status === 'ok' && age < OK_SHOWN_SEC) return { phase: 'ok', to: u.to };
  if (newer) return { phase: 'available', latest: u.latest, notes: u.notes, checked: u.checked };
  return { phase: 'current', checked: u.checked };
}

/**
 * pb-box.js updateBusy (line 379). An update is running, or has been asked for and not picked up yet (or this page has just asked for one
 * and the write is on its way). The box drops a restart or shut-down asked for meanwhile, so the page does not offer them.
 */
export function updateBusy(st: { update?: Partial<UpdateState> } | null | undefined, ownUpdate: unknown): boolean {
  return !!(ownUpdate || (st && st.update && (st.update.status === 'running' || st.update.request !== null)));
}

/** pb-box.js temperature (line 384): in plain words from /api/info/sensors, { c, word: cool|warm|hot } or null when there is no sensor. */
export function temperature(sensors: unknown): { c: number; word: 'cool' | 'warm' | 'hot' } | null {
  const s = sensors as { cpu_temp?: unknown; unit?: unknown; hot_limit?: unknown } | null | undefined;
  if (!s || typeof s.cpu_temp !== 'number' || !isFinite(s.cpu_temp)) return null;
  const unit = String(s.unit || 'C').toUpperCase();
  function toC(v: number): number { return unit === 'F' ? (v - 32) * 5 / 9 : unit === 'K' ? v - 273.15 : v; }
  const c = toC(s.cpu_temp);
  // Pi-hole's own limit is 60: normal for a small board in a case, so the page only calls it hot from 70 up.
  const hot = Math.max(70, typeof s.hot_limit === 'number' && isFinite(s.hot_limit) ? toC(s.hot_limit) : 0);
  return { c: Math.round(c), word: c >= hot ? 'hot' : c >= hot - 15 ? 'warm' : 'cool' };
}

/** pb-box.js memory (line 395): from /api/info/system, { percent, word: ok|busy|full } or null. */
export function memory(system: unknown): { percent: number; word: 'ok' | 'busy' | 'full' } | null {
  const sys = system as { memory?: { ram?: Record<string, number> } } | null | undefined;
  const ram = sys && sys.memory && sys.memory.ram;
  if (!ram) return null;
  let p = typeof ram['%used'] === 'number' ? ram['%used'] : (ram.total > 0 ? 100 * (ram.total - (ram.available !== undefined ? ram.available : ram.free)) / ram.total : NaN);
  if (!isFinite(p)) return null;
  p = Math.max(0, Math.min(100, Math.round(p)));
  return { percent: p, word: p >= 90 ? 'full' : p >= 75 ? 'busy' : 'ok' };
}

export type DurationUnit = 'day' | 'hour' | 'minute';
/** pb-box.js durationParts (line 405): [[3, 'day'], [4, 'hour']] for 3 days 4 hours, the two biggest units. */
export function durationParts(sec: unknown): [number, DurationUnit][] {
  const s = Math.max(0, Math.floor((sec as number) || 0));
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (d) return h ? [[d, 'day'], [h, 'hour']] : [[d, 'day']];
  if (h) return m ? [[h, 'hour'], [m, 'minute']] : [[h, 'hour']];
  return [[Math.max(1, m), 'minute']];
}

/** pb-box.js roundGap (line 414): a gap between two clocks, rounded so it reads as "about 3 hours": whole minutes, then quarter hours. */
export function roundGap(sec: number): number {
  const s = Math.abs(sec);
  return s < 3600 ? Math.max(60, Math.round(s / 60) * 60) : Math.round(s / 900) * 900;
}

/** pb-box.js lastDevice (line 420): the device that asked the box most recently, { name, lastQuery } or null. */
export function lastDevice(devices: unknown): { name: string; lastQuery: number } | null {
  type D = { lastQuery: number; macVendor?: string; ips?: { ip?: string; name?: string | null }[] } | null | undefined;
  const list = (devices || []) as D[];
  let best: D = null, i;
  for (i = 0; i < list.length; i++) {
    const d = list[i];
    if (d && d.lastQuery > 0 && (!best || d.lastQuery > best.lastQuery)) best = d;
  }
  if (!best) return null;
  let name = '';
  (best.ips || []).forEach((a) => { if (!name && a && a.name) name = a.name; });
  return { name: name || best.macVendor || (best.ips && best.ips[0] && best.ips[0].ip) || '', lastQuery: best.lastQuery };
}

export interface AddressRow { kind: 'ip' | 'name' | 'local'; value: string }
export interface AddressInput { hostname?: unknown; port?: unknown; boxIp?: unknown; hosts?: unknown; nodename?: unknown }

/**
 * pb-box.js addressRows (line 438). The addresses the page can be reached at: [{ kind: 'ip'|'name'|'local', value }].
 * o: { hostname, port, boxIp: the address the box itself reports in /pb/box.json (or ''), hosts: Pi-hole's local records
 *    ("192.168.1.50 family.lan"), nodename: the box's own host name }.
 */
export function addressRows(o: AddressInput): AddressRow[] {
  const host = String(o.hostname || '').toLowerCase().replace(/^\[|\]$/g, ''), port = String(o.port || '');
  const suffix = port && port !== '80' && port !== '443' ? ':' + port : '';
  let ip = usableIpv4(o.boxIp) || (IPV4.test(host) ? host : '');
  const names: string[] = [];
  (o.hosts instanceof Array ? (o.hosts as unknown[]) : []).forEach((line) => {
    if (typeof line !== 'string') return;
    const parts = line.trim().split(/\s+/), lineIp = parts[0];
    if (!IPV4.test(lineIp)) return;
    const ours = ip ? lineIp === ip : parts.slice(1).map((n) => n.toLowerCase()).indexOf(host) >= 0;
    if (!ours) return;
    ip = ip || lineIp;
    parts.slice(1).forEach((n) => { n = n.toLowerCase(); if (HOSTNAME.test(n) && n !== 'localhost' && names.indexOf(n) < 0) names.push(n); });
  });
  if (host && !IPV4.test(host) && host !== 'localhost' && HOSTNAME.test(host) && names.indexOf(host) < 0) names.push(host);
  const mdns = typeof o.nodename === 'string' && LABEL.test(o.nodename) ? o.nodename.toLowerCase() + '.local' : '';
  if (mdns && names.indexOf(mdns) < 0) names.push(mdns);
  const rows: AddressRow[] = [];
  if (ip) rows.push({ kind: 'ip', value: ip });
  names.filter((n) => !/\.local$/.test(n)).forEach((n) => { rows.push({ kind: 'name', value: n + suffix }); });
  names.filter((n) => /\.local$/.test(n)).forEach((n) => { rows.push({ kind: 'local', value: n + suffix }); });
  return rows;
}

/** pb-box.js usableIpv4 (line 462): an address a router could be told; '' for 0.x, loopback, link-local, multicast and above, or not IPv4. */
export function usableIpv4(v: unknown): string {
  if (typeof v !== 'string' || !IPV4.test(v)) return '';
  const first = +v.split('.')[0], second = +v.split('.')[1];
  if (first === 0 || first === 127 || first >= 224 || (first === 169 && second === 254)) return '';
  return v;
}

/** /pb/box.json, parsed and checked. */
export interface BoxInfo { version: string; ip: string; tz: string; utcOffset: string; counter: boolean; mdns: boolean; at: number }

/**
 * pb-box.js parseBoxInfo (line 475). /pb/box.json as the box program writes it: { "v":1, "version", "ip", "tz", "utcOffset", "counter",
 * "mdns", "at" }. Anything that is not that shape is a missing file (null), and every field is checked on its own.
 */
export function parseBoxInfo(raw: unknown): BoxInfo | null {
  const r = raw as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== 'object' || r instanceof Array || r.v !== 1) return null;
  const tz = typeof r.tz === 'string' && TZ_NAME.test(r.tz) && r.tz.split('/').indexOf('..') < 0 ? r.tz : '';
  const off = typeof r.utcOffset === 'string' && UTC_OFFSET.test(r.utcOffset) ? r.utcOffset : '';
  const at = typeof r.at === 'number' && isFinite(r.at) && Math.floor(r.at) === r.at && r.at > 0 ? r.at : 0;
  const ver = typeof r.version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(r.version) ? r.version : '';
  return { version: ver, ip: usableIpv4(r.ip), tz, utcOffset: off, counter: r.counter === true, mdns: r.mdns === true, at };
}

/** pb-box.js heartbeatLate (line 485): box.json's `at` is more than 20 minutes behind the box's clock `nowSec`, so the scheduler is not running. */
export function heartbeatLate(info: BoxInfo | null | undefined, nowSec: unknown): boolean {
  return !!(info && info.at && typeof nowSec === 'number' && nowSec - info.at > HEARTBEAT_LATE_SEC);
}

/** pb-box.js offsetMinutes (line 489). */
function offsetMinutes(text: string | null | undefined): number | null {
  const m = UTC_OFFSET.exec(text || '');
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : null;
}

export type ZoneInfo = { kind: 'unknown' } | { kind: 'utc' } | { kind: 'zone'; label: string; differs: boolean | null };
/**
 * pb-box.js zoneInfo (line 501). What to tell the parent about the box's time zone, from box.json and the phone's offset (minutes east of
 * UTC; null when unknown). Only a zone that is named UTC counts as UTC: an offset of +00:00 alone is also London in winter.
 */
export function zoneInfo(info: BoxInfo | null | undefined, phoneOffsetMin: unknown): ZoneInfo {
  if (!info || (!info.tz && !info.utcOffset)) return { kind: 'unknown' };
  if (info.tz && UTC_ZONES.indexOf(info.tz.toLowerCase()) >= 0) return { kind: 'utc' };
  const off = offsetMinutes(info.utcOffset), parts: string[] = [];
  if (info.tz) parts.push(info.tz);
  if (info.utcOffset) parts.push('UTC' + info.utcOffset);
  return { kind: 'zone', label: parts.join(', '), differs: off === null || typeof phoneOffsetMin !== 'number' ? null : off !== phoneOffsetMin };
}

/** pb-box.js boxWallTime (line 511): the time of day on the box's own wall clock; '' when the offset is not known. */
export function boxWallTime(info: BoxInfo | null | undefined, epochSec: number, locale?: string): string {
  const off = info ? offsetMinutes(info.utcOffset) : null;
  if (off === null || !isFinite(epochSec)) return '';
  try { return new Date((epochSec + off * 60) * 1000).toLocaleTimeString(locale, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

/**
 * pb-box.js reasonDetails (line 522): the English technical reason of a failed update, for "details for whoever helps you"; '' when there is
 * nothing to show or when it looks like something to type.
 */
export function reasonDetails(error: unknown): string {
  const s = typeof error === 'string' ? error.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
  if (!s || COMMAND_LIKE.test(s)) return '';
  return s;
}

/**
 * pb-box.js restoreVerdict (line 534): whether Pi-hole took anything from a restored file, from its answer to POST /api/teleporter.
 * 'nothing' only when the answer lists what it processed and the group table is not among it.
 */
export function restoreVerdict(answer: unknown): 'ok' | 'nothing' {
  const a = answer as { files?: unknown; processed?: unknown } | null | undefined;
  const l = a && (a.files instanceof Array ? a.files : a.processed instanceof Array ? a.processed : null);
  return l && !(l as unknown[]).some((s) => /->group$/.test(String(s))) ? 'nothing' : 'ok';
}

/**
 * pb-box.js gravityVerdict (line 546): how a rebuild of the block lists ended, from the text FTL streamed. 'ok' when it shows at least one
 * success mark and no failure line, else 'partial'. Escape sequences go, and a carriage return counts as a line break.
 */
export function gravityVerdict(text: unknown): 'ok' | 'partial' {
  const s = String(text === undefined || text === null ? '' : text).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '\n');
  if (/^[ \t]*\[(✗|x|X)\]/m.test(s) || /gravity failed/i.test(s)) return 'partial';
  return /\[✓\]/.test(s) ? 'ok' : 'partial';
}

/** pb-box.js charCount (line 552). */
function charCount(s: unknown): number { return String(s).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, 'x').length; }
/** pb-box.js passwordProblem (line 554): the string key of the first problem with a new password, or null. */
export function passwordProblem(current: string, next: string, again: string): 'boxPwShort' | 'boxPwMismatch' | 'boxPwSame' | null {
  if (charCount(next) < MIN_PASSWORD) return 'boxPwShort';
  if (next !== again) return 'boxPwMismatch';
  if (next === current) return 'boxPwSame';
  return null;
}

/**
 * pb-box.js keepBoxFields (line 567). After a restore the stored state is the BACKUP's: this returns the mutator that puts back what belongs
 * to the box and not to the family's rules; the timer, bedtime and whether bedtime is on right now come from the backup.
 */
export function keepBoxFields(before: SinkoState): (st: SinkoState) => void {
  return (st) => {
    st.update = before.update; st.power = before.power; st.telemetry = before.telemetry;
    st.community = before.community; st.setup = before.setup;
  };
}

/** The Pi-hole groups Sinko cannot work without (pb-box.js line 575). */
const REQUIRED_GROUPS = ['pb-kids', 'pb-offline', 'pb-paused', 'pb-state'];
/** pb-box.js hasSinkoGroups (line 576). */
export function hasSinkoGroups(groups: unknown): boolean {
  const names: Record<string, boolean> = {};
  ((groups || []) as ({ name?: unknown } | null)[]).forEach((g) => { if (g && g.name) names[g.name as string] = true; });
  return REQUIRED_GROUPS.every((n) => names[n]);
}

export type LinkKey = 'home' | 'issues' | 'releases' | 'privacy' | 'license' | 'support' | 'buy';
/** pb-box.js safeLinks (line 583): only https links from links.json are shown; anything else is dropped. */
export function safeLinks(raw: unknown): Partial<Record<LinkKey, string>> {
  const r = raw as Record<string, unknown> | null | undefined;
  const out: Partial<Record<LinkKey, string>> = {};
  (['home', 'issues', 'releases', 'privacy', 'license', 'support', 'buy'] as const).forEach((k) => {
    const v = r && typeof r[k] === 'string' ? (r[k] as string).trim() : '';
    if (/^https:\/\/[^\s"'<>]+$/.test(v)) out[k] = v;
  });
  return out;
}

/** pb-box.js backupName (line 593): a file name for the download, the day (on this phone) in the name, nothing from the network. */
export function backupName(date: Date): string {
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return 'sinko-backup-' + date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate()) + '.zip';
}

// ------------------------------------------------------------------ PBBox.timing (pb-box.js lines 610-615)
/** How long the page waits before it says something did not happen (ms). Mutable on purpose, so tests can shorten the waits. */
export const timing = {
  checkOffline: 20000, checkSlow: 45000, powerStuck: 45000, powerStale: 60000, powerNoRestart: 180000, startLate: 90000, longDown: 600000,
  startLost: 360000,                // the scheduler waits up to 5 minutes between runs
  healthDown: 6000,                 // how long the box is silent before the health card stops showing its old readings
  heartbeatGrace: 60000,            // how long box.json must have been late (seen by this app) before the main screen says the scheduler is not running
  staleEvery: 60000,                // the least time between two looks at the box's version when the phone comes back to the app
  clockStepHold: 6 * 60000,         // after the box's clock was seen to jump: how long the scheduler gets to catch up before it is judged
};

/**
 * pb-box.js requestTime (line 646). The time of a request for the box: milliseconds on the BOX's clock (`boxNowSec`, from the Date header
 * of its last answer), never the phone's, which can be anywhere. The box acts on a request only when that time is close to its own clock,
 * so the old requests inside a restored backup do not fire. The Date header counts whole seconds, so the milliseconds are made up: without
 * them two requests of one kind within a second (two phones) would carry the same marker.
 */
export function requestTime(boxNowSec: number, random: () => number = Math.random): number {
  return Math.round(boxNowSec * 1000 + random() * 1000);
}
