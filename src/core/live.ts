// The pure logic behind the live picture and the numbers: what Pi-hole did with a query, the app behind a domain, following
// /api/queries on the box's clock, which queries are worth animating, the most stopped apps, the day by the hour, and what the
// picture says about each child's device.
//
// Port of Sinko web/pb-core.js (statuses, names, numbers, following the query log, deciding what to animate, the numbers, device
// states: lines 15-171 and 251-315). The curves for the wires (lerp, wire, elbow, trace, pointAt) and formatCount are not ported yet.

// ------------------------------------------------------------------ statuses
// FTL's query status strings (get_query_status_str in FTL's datastructure.c). pb-core.js lines 17-20
const BLOCKED: Record<string, 1> = { GRAVITY: 1, REGEX: 1, DENYLIST: 1, EXTERNAL_BLOCKED_IP: 1, EXTERNAL_BLOCKED_NULL: 1, EXTERNAL_BLOCKED_NXRA: 1,
  EXTERNAL_BLOCKED_EDE15: 1, GRAVITY_CNAME: 1, REGEX_CNAME: 1, DENYLIST_CNAME: 1, DBBUSY: 1, SPECIAL_DOMAIN: 1 };
const ALLOWED: Record<string, 1> = { FORWARDED: 1, RETRIED: 1, RETRIED_DNSSEC: 1 };
const MEMORY: Record<string, 1> = { CACHE: 1, CACHE_STALE: 1 };

export type QueryKind = 'blocked' | 'allowed' | 'memory' | 'pending';

/** pb-core.js classify (line 23): blocked | allowed (sent on to the internet) | memory (answered by the box itself) | pending (not final). */
export function classify(status: unknown): QueryKind {
  const s = String(status || '').toUpperCase();
  if (BLOCKED[s]) return 'blocked';
  if (MEMORY[s]) return 'memory';
  if (ALLOWED[s]) return 'allowed';
  return 'pending';                                   // IN_PROGRESS, UNKNOWN, or a status a newer FTL adds
}

// ------------------------------------------------------------------ names
/** pb-core.js isHiddenDomain (line 32). */
export function isHiddenDomain(d: unknown): boolean { const s = String(d || '').toLowerCase(); return s === '' || s === 'hidden' || s === '<hidden>'; }
/** pb-core.js isHiddenClient (line 33). */
export function isHiddenClient(ip: unknown): boolean { return !ip || ip === '0.0.0.0' || ip === '::'; }

const TWO_LEVEL = /^(com|net|org|gov|edu|co|ac)\.[a-z]{2}$/;
/** pb-core.js baseDomain (line 37): 'r4---sn-x.googlevideo.com' -> 'googlevideo.com'; 'www.bahrain.com.bh' -> 'bahrain.com.bh'. */
export function baseDomain(domain: unknown): string {
  const parts = String(domain || '').toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return TWO_LEVEL.test(last2) ? parts.slice(-3).join('.') : last2;
}

/** pb-core.js appFor (line 45): the app id for a domain by its longest matching suffix, or null. `map` is pb/domains.json's "domains". */
export function appFor(domain: unknown, map: Record<string, string> | null | undefined): string | null {
  let d = String(domain || '').toLowerCase().replace(/\.$/, '');
  while (d) {
    if (map && Object.prototype.hasOwnProperty.call(map, d)) return map[d];
    const dot = d.indexOf('.');
    if (dot < 0) return null;
    d = d.slice(dot + 1);
  }
  return null;
}

// ------------------------------------------------------------------ numbers
/** pb-core.js percent (line 62): percent of `part` in `whole`, 0 when nothing happened, one decimal below 10. */
export function percent(part: number, whole: number): number {
  if (!whole) return 0;
  const p = 100 * part / whole;
  return p < 10 ? Math.round(p * 10) / 10 : Math.round(p);
}

// ------------------------------------------------------------------ following the query log
/** One row of /api/queries, as far as the feed reads it. */
export interface QueryRow {
  id: number;
  time: number;
  status: string;
  domain: string;
  client?: { ip?: string; name?: string | null } | null;
}
/** A query the feed has not delivered before. */
export interface FeedEvent {
  id: number;
  time: number;
  kind: QueryKind;
  status: string;
  domain: string;
  hiddenDomain: boolean;
  ip: string | null | undefined;
  name: string | null | undefined;
  hiddenClient: boolean;
}
export interface FeedOptions { length?: number; keep?: number; overlap?: number }

/**
 * pb-core.js Feed (line 80). Turns successive /api/queries responses into new events, once each.
 *
 *   const feed = new Feed(); let url = feed.url();      // first call reads a few recent rows, only to remember them
 *   feed.ingest(response)                               // the first response only primes it: no events
 *   ... url = feed.url(); events = feed.ingest(response) // later: only queries not seen before, oldest first
 *
 * `from` comes from the newest `time` in the server's own responses, never from the phone's clock, which may differ.
 * Rows that are not final yet (IN_PROGRESS) are skipped WITHOUT being remembered, because FTL returns them again
 * later with their final status.
 */
export class Feed {
  length: number;
  keep: number;
  overlap: number;                 // seconds re-read on every poll
  seen: Record<string, 1>;
  order: number[];
  from: number | null;
  primed: boolean;
  privacy: boolean;                // true: the box hides queries (privacy level 3) or has none to show
  truncated: boolean;              // true: a poll came back full, so some queries were probably not shown

  constructor(options?: FeedOptions) {
    const o = options || {};
    this.length = o.length || 60;
    this.keep = o.keep || 800;
    this.overlap = o.overlap === undefined ? 2 : o.overlap;
    this.seen = {};
    this.order = [];
    this.from = null;
    this.primed = false;
    this.privacy = false;
    this.truncated = false;
  }

  /** pb-core.js Feed.prototype.url (line 92). */
  url(): string {
    // The first call reads a few recent rows just to remember them (so they are never replayed as "new").
    return this.from === null ? '/api/queries?length=20' : '/api/queries?from=' + this.from + '&length=' + this.length;
  }

  /** pb-core.js Feed.prototype._remember (line 96). */
  _remember(id: number): void {
    this.seen[id] = 1;
    this.order.push(id);
    while (this.order.length > this.keep) delete this.seen[this.order.shift() as number];
  }

  /** pb-core.js Feed.prototype.ingest (line 101). `serverNow` is the box's clock in seconds. */
  ingest(resp: unknown, serverNow?: number): FeedEvent[] {
    const r0 = resp as { queries?: unknown; cursor?: unknown; time?: unknown } | null | undefined;
    const rows: QueryRow[] = r0 && r0.queries instanceof Array ? (r0.queries as QueryRow[]) : [];
    // The original stores `rows.length === 0 && resp && resp.cursor === null`, which is the falsy null or undefined when there is no
    // response at all; this port stores false then (a boolean, the same truthiness).
    this.privacy = rows.length === 0 && !!r0 && r0.cursor === null;
    let newest: number | null = null, i: number, r: QueryRow;
    const fresh: FeedEvent[] = [];
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (typeof r.time === 'number' && (newest === null || r.time > newest)) newest = r.time;
    }
    // A row stamped later than the box's own clock (it stepped back after a wrong boot time) must not pin `from` in the future.
    const cap = typeof serverNow === 'number' && serverNow > 0 ? serverNow : Infinity;
    if (newest !== null) this.from = Math.max(0, Math.floor(Math.min(newest, cap) - this.overlap));
    else if (this.from === null && r0) this.from = Math.floor(Number(r0.time) || 0) || null;
    if (!this.primed) {                                   // the first answer only tells us where "now" is
      this.primed = true;
      for (i = 0; i < rows.length; i++) if (classify(rows[i].status) !== 'pending') this._remember(rows[i].id);
      if (this.from === null) this.from = 0;
      return [];
    }
    this.truncated = rows.length >= this.length;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (this.seen[r.id] || classify(r.status) === 'pending') continue;
      this._remember(r.id);
      fresh.push({
        id: r.id, time: r.time, kind: classify(r.status), status: r.status,
        domain: r.domain, hiddenDomain: isHiddenDomain(r.domain),
        ip: r.client && r.client.ip, name: r.client && r.client.name, hiddenClient: isHiddenClient(r.client && r.client.ip),
      });
    }
    fresh.sort((a, b) => a.time - b.time || a.id - b.id);
    return fresh;
  }
}

// ------------------------------------------------------------------ deciding what to animate
/** What the pacer weighs: a feed event, after the page has named its app and its child. */
export interface PacedEvent { kind?: string; app?: string | null; child?: boolean; [k: string]: unknown }

/** pb-core.js priority (line 136): higher = more worth showing. Blocked, known apps and children's devices first; memory answers last. */
export function priority(ev: PacedEvent): number {
  return (ev.kind === 'blocked' ? 4 : 0) + (ev.app ? 3 : 0) + (ev.child ? 2 : 0) + (ev.kind === 'memory' ? -1 : 0);
}

/**
 * pb-core.js Pacer (line 144). Hands out queued events at a gentle pace and never lets the queue grow: when it is full, the least
 * interesting event is dropped (it still counts in the numbers, it just does not get its own packet).
 */
export class Pacer<E extends PacedEvent = PacedEvent> {
  gap: number;                     // ms between packets: about 2.6 per second at most
  max: number;
  queue: E[];
  last: number;
  dropped: number;

  constructor(options?: { gap?: number; max?: number }) {
    const o = options || {};
    this.gap = o.gap === undefined ? 380 : o.gap;
    this.max = o.max || 10;
    this.queue = [];
    this.last = -1e12;
    this.dropped = 0;
  }

  /** pb-core.js Pacer.prototype.push (line 152). */
  push(events: E[]): void {
    let i, j, worst;
    for (i = 0; i < events.length; i++) {
      this.queue.push(events[i]);
      if (this.queue.length > this.max) {
        worst = 0;
        for (j = 1; j < this.queue.length; j++) if (priority(this.queue[j]) < priority(this.queue[worst])) worst = j;
        this.queue.splice(worst, 1);
        this.dropped++;
      }
    }
  }

  /** pb-core.js Pacer.prototype.next (line 165): the next event to animate at time `now` (ms), or null if it is too soon or nothing waits. */
  next(now: number): E | null {
    if (!this.queue.length || now - this.last < this.gap) return null;
    let best = 0, i;
    for (i = 1; i < this.queue.length; i++) if (priority(this.queue[i]) > priority(this.queue[best])) best = i;
    this.last = now;
    return this.queue.splice(best, 1)[0];
  }
}

// ------------------------------------------------------------------ the numbers
export interface AppCount { app: string | null; count: number }

/**
 * pb-core.js topByApp (line 257). The most stopped things, by app: domains from /api/stats/top_domains?blocked=true are grouped by the app
 * they belong to (googlevideo.com and youtube.com are both "youtube"); domains of no known app are counted together as `other`, never
 * guessed to be "ads" and never shown as raw hostnames. Returns [{ app, count }] biggest first (`other` has app: null).
 */
export function topByApp(domains: { domain: string; count: number }[] | null | undefined, map: Record<string, string> | null | undefined,
  limit?: number, only?: string[]): AppCount[] {
  const tally: Record<string, number> = {};
  let other = 0, i, d, app, out: AppCount[] = [], allowed: Record<string, boolean> | null = null;
  if (only) { const a: Record<string, boolean> = {}; only.forEach((id) => { a[id] = true; }); allowed = a; }
  for (i = 0; i < (domains || []).length; i++) {
    d = (domains as { domain: string; count: number }[])[i];
    if (!d || isHiddenDomain(d.domain)) continue;
    app = appFor(d.domain, map);
    // `only`: the apps that are blocked for children. A tracker on netflix.com is blocked by an ad list, not by "blocking Netflix".
    if (app && (!allowed || allowed[app])) tally[app] = (tally[app] || 0) + (d.count || 0); else other += d.count || 0;
  }
  Object.keys(tally).forEach((k) => { out.push({ app: k, count: tally[k] }); });
  out.sort((a, b) => b.count - a.count);
  if (typeof limit === 'number') out = out.slice(0, limit);
  if (other) out.push({ app: null, count: other });          // everything else, always shown last and never cut off
  return out;
}

export interface HourBucket { t: number; total: number; blocked: number }

/**
 * pb-core.js hourly (line 278). /api/history (144 slots of 10 minutes) as 24 hourly buckets, oldest first: [{ t, total, blocked }].
 * Buckets count back from the newest slot, so the phone's clock and time zone do not matter.
 */
export function hourly(history: unknown): HourBucket[] {
  const h = history as { history?: unknown } | null | undefined;
  const slots = h && h.history instanceof Array ? (h.history as { timestamp: number; total?: number; blocked?: number }[]) : [];
  const out: HourBucket[] = [];
  let i, k, b;
  for (i = 0; i < 24; i++) out.push({ t: 0, total: 0, blocked: 0 });
  if (!slots.length) return out;
  const last = slots[slots.length - 1].timestamp;
  for (i = 0; i < slots.length; i++) {
    k = 23 - Math.floor((last - slots[i].timestamp) / 3600);
    if (k < 0 || k > 23) continue;
    b = out[k];
    if (!b.t || slots[i].timestamp < b.t) b.t = slots[i].timestamp;
    b.total += slots[i].total || 0;
    b.blocked += slots[i].blocked || 0;
  }
  return out;
}

// ------------------------------------------------------------------ is each child's device protected?
export type DeviceStateName = 'overridden' | 'unknown' | 'unreachable' | 'offline' | 'paused' | 'active' | 'quiet';
export interface DeviceStateInput {
  serverNow: number;
  lastQuery?: number;
  paused?: boolean;
  offline?: boolean;
  shadowed?: boolean;
  recent?: boolean;
  unknown?: boolean;
}

/**
 * pb-core.js deviceState (line 308). What the picture shows for one child's device, in this order of importance:
 *   overridden  another Pi-hole rule overrides this child's rules (NOT protected)
 *   unknown     the box cannot tell when devices were last online (privacy setting, or the device list failed): "rules set",
 *               never "not seen" (a guess that would worry a parent for nothing). Pause and internet-off are still known.
 *   unreachable it has not asked the box anything for 24 h, or the box has never seen it (probably not using the box)
 *   offline     the internet is switched off (the big button, bedtime or an offline break)
 *   paused      this device was paused
 *   active      it asked something in the last 5 minutes
 *   quiet       nothing right now
 * `serverNow` and `lastQuery` are seconds on the BOX's clock; lastQuery 0/undefined means never.
 */
export function deviceState(d: DeviceStateInput): DeviceStateName {
  if (d.shadowed) return 'overridden';
  if (d.unknown) return d.offline ? 'offline' : d.paused ? 'paused' : d.recent ? 'active' : 'unknown';
  if (!d.lastQuery || d.serverNow - d.lastQuery > 24 * 3600) return d.recent ? 'active' : 'unreachable';
  if (d.offline) return 'offline';
  if (d.paused) return 'paused';
  return d.recent || d.serverNow - d.lastQuery < 300 ? 'active' : 'quiet';
}
