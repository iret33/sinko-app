// Port of Sinko web/pb-core.js Poller (lines 317-384). The page pauses while it is hidden (document.visibilityState); an app pauses
// while it is in the background (React Native's AppState): see appStateVisible and wakeOnActive below, which take the AppState object as
// an argument so this file needs no React Native.

export interface PollerTask {
  name: string;
  every: number;
  run: () => unknown;
}
interface TaskSlot extends PollerTask {
  fails: number;
  timer: unknown;
  due: number;
  running: boolean;
}
export interface PollerOptions {
  tasks?: PollerTask[];
  onError?: (name: string, err: unknown, fails: number) => void;
  onOk?: (name: string) => void;
  visible?: () => boolean;
  now?: () => number;
  setTimeout?: (f: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  maxBackoff?: number;
  stagger?: number;
}

/**
 * pb-core.js Poller (line 330). Runs named tasks on their own schedules: each starts right away (staggered a little), then repeats
 * `every` ms AFTER the previous run finished, so requests never pile up. A failing task backs off (x2 each time, up to 30 s) and recovers
 * by itself. Nothing runs while the app is not visible; when it is visible again, tasks that are due run at once (call wake()).
 *
 *   const poller = new Poller({ tasks: [{ name: 'queries', every: 3500, run: () => promise }],
 *                               onError: (name, err, fails) => {}, visible: appStateVisible(AppState) });
 *   poller.start(); const stop = wakeOnActive(poller, AppState);
 *   poller.stop(); stop();
 *
 * setTimeout/clearTimeout/now/visible can be replaced, which is how the tests drive it with a fake clock.
 */
export class Poller {
  tasks: TaskSlot[];
  onError: (name: string, err: unknown, fails: number) => void;
  onOk: (name: string) => void;
  visible: () => boolean;
  now: () => number;
  setTimeout: (f: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  maxBackoff: number;
  stagger: number;
  active: boolean;

  constructor(options: PollerOptions) {
    this.tasks = (options.tasks || []).map((t) => ({ name: t.name, every: t.every, run: t.run, fails: 0, timer: null, due: 0, running: false }));
    this.onError = options.onError || (() => {});
    this.onOk = options.onOk || (() => {});
    this.visible = options.visible || (() => true);
    this.now = options.now || (() => new Date().getTime());
    this.setTimeout = options.setTimeout || ((f, ms) => setTimeout(f, ms));
    this.clearTimeout = options.clearTimeout || ((id) => { clearTimeout(id as ReturnType<typeof setTimeout>); });
    this.maxBackoff = options.maxBackoff || 30000;
    this.stagger = options.stagger === undefined ? 250 : options.stagger;
    this.active = false;
  }

  /** pb-core.js Poller.prototype.start (line 344). */
  start(): void {
    this.active = true;
    this.tasks.forEach((t, i) => { this._plan(t, i * this.stagger); });
  }

  /** pb-core.js Poller.prototype.stop (line 349). */
  stop(): void {
    this.active = false;
    this.tasks.forEach((t) => { if (t.timer !== null) { this.clearTimeout(t.timer); t.timer = null; } });
  }

  /** pb-core.js Poller.prototype.wake (line 355): call when the app becomes visible again; whatever is due runs now. */
  wake(): void {
    const now = this.now();
    if (!this.active || !this.visible()) return;
    this.tasks.forEach((t) => {
      if (!t.running && t.due <= now) { if (t.timer !== null) this.clearTimeout(t.timer); this._plan(t, 0); }
    });
  }

  /** pb-core.js Poller.prototype._plan (line 362). */
  _plan(t: TaskSlot, delay: number): void {
    t.due = this.now() + delay;
    if (t.timer !== null) this.clearTimeout(t.timer);
    t.timer = this.setTimeout(() => { t.timer = null; this._tick(t); }, delay);
  }

  /** pb-core.js Poller.prototype._tick (line 368). */
  _tick(t: TaskSlot): void {
    if (!this.active) return;
    if (!this.visible()) { t.due = 0; return; }              // paused: wake() picks it up again
    t.running = true;
    const done = (ok: boolean, err?: unknown): void => {
      t.running = false;
      if (!this.active) return;
      if (ok) { t.fails = 0; this.onOk(t.name); }
      else { t.fails++; this.onError(t.name, err, t.fails); }
      this._plan(t, ok ? t.every : Math.min(this.maxBackoff, t.every * Math.pow(2, t.fails)));
    };
    let result: unknown;
    try { result = t.run(); } catch (e) { return done(false, e); }
    const p = result as { then?: unknown } | null | undefined;
    if (p && typeof p.then === 'function') (p as PromiseLike<unknown>).then(() => { done(true); }, (e) => { done(false, e); });
    else done(true);
  }
}

// ------------------------------------------------------------------ "the page is hidden", for an app
/** What these helpers need of React Native's AppState (pass AppState itself). */
export interface AppStateLike {
  currentState: string | null | undefined;
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

/**
 * The app's version of document.visibilityState === 'visible': everything but 'background'. 'inactive' (iOS, for a moment while the app
 * switcher or a system sheet is up) still shows the app, and 'unknown' is what Android may report before the first change.
 */
export function appStateVisible(appState: AppStateLike): () => boolean {
  return () => appState.currentState !== 'background';
}

/** The page's visibilitychange -> poller.wake(): runs what is due as soon as the app comes back. Returns the unsubscribe function. */
export function wakeOnActive(poller: Poller, appState: AppStateLike): () => void {
  const sub = appState.addEventListener('change', (state) => { if (state !== 'background') poller.wake(); });
  return () => sub.remove();
}
