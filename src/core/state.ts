// The shared state: JSON in the description of the "pb-state" group, written by two programs, the parent page (and now this app)
// and the scheduler on the box (bin/sinko). Both normalise it with the same rules, and a value one of them does not know is lost on
// its next write. test/fixtures/state-cases.json (Sinko's tests/fixtures/state-cases.json) is the executable spec.
//
// Port of Sinko web/pb-core.js, "the shared state" (lines 386-511). Same behaviour, line by line.
import type { Marker, PowerState, SinkoState, UpdateState } from './types';

type Dict = Record<string, unknown>;

// pb-core.js lines 391-397
const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const NOTES_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases(\/tag\/[A-Za-z0-9_.+-]+)?$/;
const UPDATE_STATUSES = ['idle', 'running', 'ok', 'failed'];
const POWER_ACTIONS = ['reboot', 'poweroff'];
const HHMM_RE = /^\d\d:\d\d$/;
// "Blank" for update.error: the same characters bin/sinko lists (neither language's own idea of whitespace decides).
const BLANK_RE = /^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/;

/** pb-core.js defaultState (line 399). Every call returns a fresh copy. */
export function defaultState(): SinkoState {
  return {
    v: 1, timer: null,
    schedule: { enabled: false, start: '21:00', end: '06:00', days: [0, 1, 2, 3, 4, 5, 6] },
    scheduleActive: false,
    update: { auto: false, request: null, checkRequest: null, latest: null, notes: null, checked: 0, status: 'idle',
      from: null, to: null, at: 0, error: null, rolledBack: null },
    power: { request: null, action: null },
    telemetry: { on: null },
    community: null,
    setup: { done: false },
    learn: { on: false },
  };
}

// pb-core.js lines 414-416
export function isDict(x: unknown): x is Dict { return x !== null && typeof x === 'object' && !(x instanceof Array); }
function isNum(x: unknown): x is number { return typeof x === 'number' && isFinite(x); }
function isCount(x: unknown): x is number { return isNum(x) && x >= 0; }
/** pb-core.js truthy (line 418): Python's bool(). The scheduler normalises with it, so an empty list or object is false there. */
function truthy(x: unknown): boolean {
  if (x === null || x === undefined || x === false || x === 0 || x === '') return false;
  if (x instanceof Array) return x.length > 0;
  if (typeof x === 'object') return Object.keys(x).length > 0;
  return true;
}
const ASTRAL = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
/** pb-core.js charLength (line 426): length in characters, not UTF-16 units (the scheduler counts characters). */
function charLength(s: string): number { return s.replace(ASTRAL, 'x').length; }
/** pb-core.js charSlice (line 427). */
function charSlice(s: string, n: number): string {
  if (charLength(s) <= n) return s;
  let out = '', count = 0, i = 0, c;
  while (count < n && i < s.length) {
    c = s.charAt(i);
    if (/[\uD800-\uDBFF]/.test(c) && i + 1 < s.length) { c += s.charAt(i + 1); i++; }
    out += c; count++; i++;
  }
  return out;
}
/** pb-core.js nonce (line 438): a request marker (the time in ms) or a string of 1-40 characters. */
function nonce(x: unknown): Marker {
  if (isNum(x) && x > 0) return x;
  if (typeof x === 'string' && x.length > 0 && charLength(x) <= 40) return x;
  return null;
}
/** pb-core.js parseUpdate (line 443). */
function parseUpdate(raw: unknown): UpdateState {
  const out = defaultState().update;
  if (!isDict(raw)) return out;
  out.auto = raw.auto === true;
  out.request = nonce(raw.request);
  out.checkRequest = nonce(raw.checkRequest);
  (['latest', 'from', 'to'] as const).forEach((k) => {
    const v = raw[k];
    out[k] = typeof v === 'string' && SEMVER_RE.test(v) ? v : null;
  });
  out.notes = typeof raw.notes === 'string' && NOTES_RE.test(raw.notes) ? raw.notes : null;
  (['checked', 'at'] as const).forEach((k) => {
    const v = raw[k];
    out[k] = isCount(v) ? v : 0;
  });
  out.status = UPDATE_STATUSES.indexOf(raw.status as string) >= 0 ? (raw.status as UpdateState['status']) : 'idle';
  out.error = typeof raw.error === 'string' && !BLANK_RE.test(raw.error) ? charSlice(raw.error, 200) : null;
  out.rolledBack = typeof raw.rolledBack === 'boolean' ? raw.rolledBack : null;
  return out;
}
/** pb-core.js parsePower (line 457). */
function parsePower(raw: unknown): PowerState {
  const out = defaultState().power;
  if (isDict(raw) && POWER_ACTIONS.indexOf(raw.action as string) >= 0) {
    out.request = nonce(raw.request);
    out.action = out.request === null ? null : (raw.action as PowerState['action']);
  }
  return out;
}
/** pb-core.js validHHMM (line 465). */
function validHHMM(x: unknown): x is string { return typeof x === 'string' && HHMM_RE.test(x) && +x.slice(0, 2) <= 23 && +x.slice(3) <= 59; }

/** pb-core.js parseState (line 468): anything (the group description, "", garbage) -> a complete, valid state. Unknown keys are dropped. */
export function parseState(raw: unknown): SinkoState {
  const s = defaultState();
  let d: unknown = null;
  try { d = raw ? JSON.parse(raw as string) : null; } catch { d = null; }
  if (!isDict(d)) d = {};
  const dd = d as Dict;
  const tm = dd.timer;
  if (isDict(tm) && (tm.mode === 'free' || tm.mode === 'block') && isNum(tm.until)) {
    const snap = isDict(tm.snapshot) ? tm.snapshot : {}, services: Record<string, boolean> = {};
    if (isDict(snap.services)) { const sv = snap.services; Object.keys(sv).forEach((k) => { services[k] = truthy(sv[k]); }); }
    s.timer = { mode: tm.mode, until: tm.until, snapshot: { services, offline: truthy(snap.offline) } };
  }
  if (isDict(dd.schedule)) {
    const sc = dd.schedule;
    s.schedule.enabled = truthy(sc.enabled);
    if (validHHMM(sc.start)) s.schedule.start = sc.start;
    if (validHHMM(sc.end)) s.schedule.end = sc.end;
    if (sc.days instanceof Array) {
      s.schedule.days = (sc.days as unknown[])
        .filter((x, i, a): x is number => typeof x === 'number' && x % 1 === 0 && x >= 0 && x <= 6 && a.indexOf(x) === i)
        .sort((a, b) => a - b);
    }
  }
  s.scheduleActive = truthy(dd.scheduleActive);
  s.update = parseUpdate(dd.update);
  s.power = parsePower(dd.power);
  if (isDict(dd.telemetry) && typeof dd.telemetry.on === 'boolean') s.telemetry = { on: dd.telemetry.on };
  if (isDict(dd.community) && isCount(dd.community.online) && isNum(dd.community.at)) {
    s.community = { online: Math.floor(dd.community.online), at: dd.community.at };
  }
  if (isDict(dd.setup)) s.setup = { done: dd.setup.done === true };
  if (isDict(dd.learn)) s.learn = { on: dd.learn.on === true };
  return s;
}

/**
 * pb-core.js editState (line 506). One read-modify-write of the stored description: parse what is stored NOW (never a copy kept
 * earlier, the scheduler may have written since), let `mutate(state)` change only what this write is about, normalise again so nothing
 * the schema does not allow can be stored, and return { state, json }. Every field `mutate` does not touch survives.
 */
export function editState(raw: unknown, mutate: (st: SinkoState) => void): { state: SinkoState; json: string } {
  let st = parseState(raw);
  mutate(st);
  st = parseState(JSON.stringify(st));
  return { state: st, json: JSON.stringify(st) };
}
