// The scheduler's side of the box, which Sinko's mock leaves out when it runs on its own: bin/sinko Controller.tick (timers end, bedtime
// switches the internet off and on) and the request protocol of docs/maintainers/architecture.md (update, check, restart, shut down), with
// outcomes picked from the dev menu. Modelled on SchedulerSim in tests/mock_pihole.py and on bin/sinko, NOT on the app's own code, so a
// mistake in the app is not copied into the mock that tests it.
import type { Admin } from './upstream.mts';

type Dict = Record<string, unknown>;
type Group = { id: number; name: string; enabled: boolean; comment: string | null };
type Timer = { mode: 'free' | 'block'; until: number; snapshot: { services: Record<string, boolean>; offline: boolean } };

export interface SchedulerConfig {
  /** Seconds between a write of the state and the scheduler acting on it (bin/sinko looks every TICK_SECONDS = 15). */
  pickupSeconds: number;
  /** Seconds between two passes of Controller.tick. */
  tickSeconds: number;
  /** What a check finds: a newer version, or null for "up to date". */
  latest: string | null;
  notes: string | null;
  update: {
    /** ok | failed | never (the request is never picked up) | hang (running, and the runner never reports). */
    outcome: 'ok' | 'failed' | 'never' | 'hang';
    rolledBack: boolean | null;
    error: string;
    runSeconds: number;
    /** Seconds the box does not answer at all while it updates (it restarts its services). */
    outageSeconds: number;
  };
  check: { offline: boolean; seconds: number };
  power: {
    /** act | ignore (the request is never picked up: the page says the box did not react). */
    outcome: 'act' | 'ignore';
    restartSeconds: number;
    /** Sign every phone out when the box restarts (Pi-hole v6 normally restores its sessions, so off by default). */
    endSessions: boolean;
  };
}

export function defaultConfig(): SchedulerConfig {
  return {
    pickupSeconds: 1, tickSeconds: 5, latest: null, notes: null,
    update: { outcome: 'ok', rolledBack: true, error: 'The download did not match its checksum.', runSeconds: 4, outageSeconds: 0 },
    check: { offline: false, seconds: 1 },
    power: { outcome: 'act', restartSeconds: 25, endSessions: false },
  };
}

export interface Box {
  /** Now on the box's clock (s), skew included. */
  now(): number;
  /** The box's wall-clock offset from UTC in minutes (box.json utcOffset), or null to use this computer's own time zone. */
  utcOffsetMin(): number | null;
  version: string;
  /** The box stops answering until this phone time (ms); Infinity = switched off. */
  outageUntil: number;
  /** Sign out every session the proxy has seen (a restart that does not restore sessions). */
  endSessions(): void;
}

function isDict(x: unknown): x is Dict { return x !== null && typeof x === 'object' && !Array.isArray(x); }
/** Python's bool(). */
function truthy(x: unknown): boolean {
  if (x === null || x === undefined || x === false || x === 0 || x === '') return false;
  if (Array.isArray(x)) return x.length > 0;
  if (typeof x === 'object') return Object.keys(x as object).length > 0;
  return true;
}
/** json.dumps(x, sort_keys=True), near enough to compare two timers. */
function stable(x: unknown): string {
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
  if (isDict(x)) return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
  return JSON.stringify(x === undefined ? null : x);
}
function asTimer(x: unknown): Timer | null {
  if (!isDict(x) || (x.mode !== 'free' && x.mode !== 'block') || typeof x.until !== 'number') return null;
  const snap = isDict(x.snapshot) ? x.snapshot : {};
  const services: Record<string, boolean> = {};
  if (isDict(snap.services)) for (const k of Object.keys(snap.services)) services[k] = truthy(snap.services[k]);
  return { mode: x.mode, until: x.until, snapshot: { services, offline: truthy(snap.offline) } };
}

/** bin/sinko in_schedule: a window that crosses midnight belongs to the day it STARTS on. Days in JavaScript numbering (0 = Sunday). */
export function inSchedule(sched: unknown, day: number, minute: number): boolean {
  if (!isDict(sched) || !truthy(sched.enabled) || !Array.isArray(sched.days) || !sched.days.length) return false;
  const hhmm = (v: unknown, d: string) => (typeof v === 'string' && /^\d\d:\d\d$/.test(v) ? v : d);
  const s = hhmm(sched.start, '21:00'), e = hhmm(sched.end, '06:00');
  const start = +s.slice(0, 2) * 60 + +s.slice(3), end = +e.slice(0, 2) * 60 + +e.slice(3);
  if (start === end) return false;
  const days = new Set(sched.days as number[]), yesterday = (day + 6) % 7;
  if (start < end) return days.has(day) && start <= minute && minute < end;
  if (minute >= start) return days.has(day);
  return minute < end && days.has(yesterday);
}

export class Scheduler {
  admin: Admin;
  box: Box;
  config: SchedulerConfig;
  services: string[] = [];
  handled: { update: unknown; check: unknown; power: unknown } = { update: null, check: null, power: null };
  log: { at: number; what: string }[] = [];
  private pickup: ReturnType<typeof setTimeout> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private busy: Promise<void> = Promise.resolve();

  constructor(admin: Admin, box: Box, config: SchedulerConfig) { this.admin = admin; this.box = box; this.config = config; }

  note(what: string): void {
    this.log.push({ at: Math.round(this.box.now()), what });
    if (this.log.length > 100) this.log.shift();
  }

  start(services: string[]): void {
    this.services = services;
    this.restartTicker();
  }
  restartTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = setInterval(() => { void this.tick(); }, Math.max(1, this.config.tickSeconds) * 1000);
  }
  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    if (this.pickup) clearTimeout(this.pickup);
  }

  /** One thing at a time, like the one scheduler process. */
  private serial(fn: () => Promise<void>): Promise<void> {
    this.busy = this.busy.then(fn).catch((e: unknown) => { this.note('error: ' + (e instanceof Error ? e.message : String(e))); });
    return this.busy;
  }

  private async groups(): Promise<Record<string, Group>> {
    const j = (await this.admin.call('GET', '/api/groups')) as { groups?: Group[] };
    const out: Record<string, Group> = {};
    for (const g of j.groups || []) out[g.name] = g;
    return out;
  }
  private async readState(): Promise<Dict> {
    const j = (await this.admin.call('GET', '/api/groups/pb-state')) as { groups?: Group[] };
    const g = (j.groups || [])[0];
    try { const d = JSON.parse((g && g.comment) || '{}'); return isDict(d) ? d : {}; } catch { return {}; }
  }
  private async writeState(st: Dict): Promise<void> {
    await this.admin.call('PUT', '/api/groups/pb-state', { name: 'pb-state', comment: JSON.stringify(st), enabled: false });
  }
  private async editState(mutate: (st: Dict) => void): Promise<void> {
    const st = await this.readState();
    mutate(st);
    await this.writeState(st);
  }

  /** The page wrote the state: the scheduler notices its request markers on its next pass. */
  stateWritten(): void {
    if (this.pickup) clearTimeout(this.pickup);
    this.pickup = setTimeout(() => { this.pickup = null; void this.serial(() => this.requests()); }, this.config.pickupSeconds * 1000);
  }

  /** SchedulerSim.after_state_write: store the marker as handled, clear it in the state, then act. */
  private async requests(): Promise<void> {
    const st = await this.readState();
    const up: Dict = isDict(st.update) ? st.update : {};
    const power: Dict = isDict(st.power) ? st.power : {};
    const now = Math.floor(this.box.now());
    const todo: [string, string | null][] = [];
    let marker = up.request;
    if (marker !== null && marker !== undefined && marker !== '' && marker !== this.handled.update && this.config.update.outcome !== 'never') {
      this.handled.update = marker;
      up.request = null;
      const to = (up.latest as string) || this.config.latest || this.box.version;
      Object.assign(up, { status: 'running', from: this.box.version, to, at: now, error: null, rolledBack: null });
      todo.push(['update', to]);
    }
    marker = up.checkRequest;
    if (marker !== null && marker !== undefined && marker !== '' && marker !== this.handled.check) {
      this.handled.check = marker;
      up.checkRequest = null;
      todo.push(['check', null]);
    }
    marker = power.request;
    if (marker !== null && marker !== undefined && marker !== '' && marker !== this.handled.power && this.config.power.outcome !== 'ignore') {
      this.handled.power = marker;
      const action = power.action as string;
      Object.assign(power, { request: null, action: null });
      // bin/sinko Maintenance._power: never cut the power in the middle of an installation, and never keep the request for later either.
      if (up.status === 'running') todo.push(['power-dropped', action]);
      else if (action === 'reboot' || action === 'poweroff') todo.push(['power', action]);
    }
    if (!todo.length) return;
    st.update = up; st.power = power;
    await this.writeState(st);
    for (const [kind, arg] of todo) {
      this.note(kind + (arg ? ' ' + arg : ''));
      if (kind === 'update') {
        const u = this.config.update;
        if (u.outageSeconds) this.box.outageUntil = Date.now() + u.outageSeconds * 1000;
        if (u.outcome !== 'hang') setTimeout(() => { void this.serial(() => this.finishUpdate(arg as string)); }, u.runSeconds * 1000);
      } else if (kind === 'check') {
        setTimeout(() => { void this.serial(() => this.finishCheck()); }, this.config.check.seconds * 1000);
      } else if (kind === 'power') {
        if (arg === 'poweroff') this.box.outageUntil = Infinity;                 // off until it is plugged back in (dev menu)
        else this.box.outageUntil = Date.now() + this.config.power.restartSeconds * 1000;
        if (this.config.power.endSessions) this.box.endSessions();
      }
    }
  }

  private async finishUpdate(to: string): Promise<void> {
    const u = this.config.update, now = Math.floor(this.box.now());
    await this.editState((st) => {
      const up: Dict = isDict(st.update) ? st.update : (st.update = {});
      if (u.outcome === 'ok') {
        Object.assign(up, { status: 'ok', to, at: now, error: null, checked: now, rolledBack: null });
        if (up.latest === to) { up.latest = null; up.notes = null; }                // it is installed now
      } else {
        Object.assign(up, { status: 'failed', at: now, error: u.error, rolledBack: u.rolledBack });
      }
    });
    if (u.outcome === 'ok') {
      this.box.version = to;
      if (this.config.latest === to) { this.config.latest = null; this.config.notes = null; }
    }
    this.note('update finished: ' + u.outcome);
  }

  private async finishCheck(): Promise<void> {
    if (this.config.check.offline) { this.note('check: offline, nothing changed'); return; }    // keep the old answer
    const now = Math.floor(this.box.now()), latest = this.config.latest, notes = this.config.notes;
    await this.editState((st) => {
      const up: Dict = isDict(st.update) ? st.update : (st.update = {});
      Object.assign(up, { checked: now, latest, notes: latest ? notes : null });
    });
    this.note('check: ' + (latest || 'up to date'));
  }

  /** The box's wall clock: weekday (0 = Sunday) and minute of the day. */
  private wall(): { day: number; minute: number } {
    const off = this.box.utcOffsetMin();
    const d = off === null ? new Date(this.box.now() * 1000) : new Date((this.box.now() + off * 60) * 1000);
    return off === null ? { day: d.getDay(), minute: d.getHours() * 60 + d.getMinutes() }
      : { day: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
  }

  /** bin/sinko Controller.apply: only groups that change are written, then the DNS cache is cleared. */
  private async apply(blocked: Record<string, boolean>, offline: boolean, groups: Record<string, Group>): Promise<void> {
    let changed = false;
    for (const id of this.services) {
      const g = groups['pb-svc-' + id], want = !!blocked[id];
      if (g && !!g.enabled !== want) { await this.admin.call('PUT', '/api/groups/' + encodeURIComponent(g.name), { name: g.name, comment: g.comment || '', enabled: want }); changed = true; }
    }
    const g = groups['pb-offline'];
    if (g && !!g.enabled !== offline) { await this.admin.call('PUT', '/api/groups/pb-offline', { name: g.name, comment: g.comment || '', enabled: offline }); changed = true; }
    if (changed) await this.admin.call('POST', '/api/action/restartdns');
  }

  /** bin/sinko Controller.tick: one pass over bedtime and the timer. */
  tick(): Promise<void> {
    return this.serial(async () => {
      const groups = await this.groups();
      if (!groups['pb-state']) return;
      let st: Dict;
      try { const d = JSON.parse(groups['pb-state'].comment || '{}'); st = isDict(d) ? d : {}; } catch { st = {}; }
      const blocked: Record<string, boolean> = {};
      for (const id of this.services) blocked[id] = !!(groups['pb-svc-' + id] && groups['pb-svc-' + id].enabled);
      const epoch = this.box.now(), { day, minute } = this.wall();
      const window = inSchedule(st.schedule, day, minute);
      let timer = asTimer(st.timer);
      const timerSeen = stable(timer);
      let scheduleActive = truthy(st.scheduleActive);
      let changed = false;
      if (window !== scheduleActive) {
        if (window) {                                       // bedtime starts
          if (timer && timer.mode === 'free') { await this.apply(timer.snapshot.services, true, groups); timer = null; this.note('bedtime started: free-time timer ended early'); }
          else if (timer) { timer.snapshot.offline = true; this.note('bedtime started during block timer'); }
          else { await this.apply(blocked, true, groups); this.note('bedtime started: internet off'); }
        } else {                                            // bedtime ends
          if (timer) { timer.snapshot.offline = false; this.note('bedtime ended during timer'); }
          else { await this.apply(blocked, false, groups); this.note('bedtime ended: internet on'); }
        }
        scheduleActive = window;
        changed = true;
      }
      if (timer && timer.until <= epoch) {
        await this.apply(timer.snapshot.services, timer.snapshot.offline || window, groups);
        this.note(timer.mode + ' timer finished: previous rules restored');
        timer = null;
        changed = true;
      }
      if (changed) {
        // Re-read right before writing so a schedule edited a moment ago is not overwritten; the scheduler owns only timer + scheduleActive.
        const fresh = await this.readState();
        if (stable(asTimer(fresh.timer)) === timerSeen) fresh.timer = timer;   // nobody touched the timer meanwhile, so this decision stands
        fresh.scheduleActive = scheduleActive;
        await this.writeState(fresh);
      }
    });
  }
}
