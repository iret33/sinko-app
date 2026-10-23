// HTTP to a Sinko box: Pi-hole v6's API (/api/...) and Sinko's own files (/pb/...). Modelled on Sinko web/app.js call() (line 428),
// noteBoxClock (line 385) and serverNowSec (line 382).
//
// The page runs on the box and talks to the same origin; the app talks to whichever box is selected, so the base URL is given
// (http://192.168.1.50). The rest is the page's: the session id travels in a header named `sid`, and cookies are never used. Pi-hole sets
// a `sid` cookie on every signed-in answer, and a request that carries that cookie without the header counts as a cookie sign-in, which
// then needs a CSRF token for anything but a read. So every request goes with credentials: 'omit', which in both of React Native's fetch
// implementations (Expo's, the default from SDK 52, and React Native's own) means no cookie is sent and none is stored, and no Cookie
// header is ever set by hand (test/api/cookies.test.ts proves it against the mock box, which sets the cookie like Pi-hole).
import { timing } from '../core/box';
import { t } from '../i18n';

/**
 * app.js ApiError (line 427): `status` is the HTTP status (0 = the box did not answer: no connection, a timeout, an answer cut off), `message`
 * is for people, `body` the parsed answer ({} when it was not JSON), so callers can read body.error.message and body.session.
 */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body === undefined ? {} : body;
  }
}

/** app.js CLOCK_STEP_MS (line 354): the box's clock moving by more than this between two answers is a jump. */
export const CLOCK_STEP_MS = 30000;

/**
 * The box's clock, learned from the Date header of every answer (the box has no real-time clock and the phone's can be anywhere): timers,
 * bedtime and "last online" are compared by the box with ITS clock. app.js serverOffsetMs, offsetKnown, clockStepHoldUntil.
 */
export class BoxClock {
  offsetMs = 0;              // box clock minus this phone's clock
  known = false;             // offsetMs has been read from an answer at least once
  stepHoldUntil = 0;         // phone time (ms) until which the box's clock is taken to be catching up after a jump
  private readonly phoneNow: () => number;

  constructor(phoneNow: () => number = Date.now) { this.phoneNow = phoneNow; }

  /**
   * app.js noteBoxClock (line 385). The box can step by hours or days at once when it reaches a time server after a long time without
   * internet; the scheduler then needs a pass (up to five minutes) to write box.json again, so for that long the file's age says nothing.
   */
  note(offsetMs: number): void {
    if (this.known && Math.abs(offsetMs - this.offsetMs) > CLOCK_STEP_MS) this.stepHoldUntil = this.phoneNow() + timing.clockStepHold;
    this.offsetMs = offsetMs;
    this.known = true;
  }

  /** The Date header of an answer (app.js call, line 438); ignored when it is missing or not a date. */
  noteDate(header: string | null | undefined): void {
    const boxTime = Date.parse(header || '');
    if (!isNaN(boxTime)) this.note(boxTime - this.phoneNow());
  }

  /** app.js serverNowSec (line 382): now on the box's clock, in seconds. */
  nowSec(): number { return (this.phoneNow() + this.offsetMs) / 1000; }

  /** The box's clock jumped a moment ago (app.js schedulerSilent, line 493: Date.now() < clockStepHoldUntil). */
  stepping(): boolean { return this.phoneNow() < this.stepHoldUntil; }
}

export interface CallOptions {
  /** A JSON value to send (Content-Type: application/json). */
  body?: unknown;
  /** A multipart form to send as it is (fetch writes the boundary). */
  form?: FormData;
  /** Send no session id: the claim and the no-password check. */
  noSid?: boolean;
  /** Send this session id instead of the current one: the password check's second session. */
  sid?: string;
  /** A 401 does not sign out: for checks that must tell a wrong two-factor code from a lost session (read error.body). */
  quiet401?: boolean;
  /** The answer is plain text (a streamed run): resolves { text }. */
  text?: boolean;
  /** The answer is a file: resolves { blob }. */
  blob?: boolean;
  /** Give up after this long (ms). Default 10 s; 0 or null waits as long as it takes (the rebuild of the block lists). */
  timeoutMs?: number | null;
}

export interface ClientConfig {
  /** The selected box, e.g. http://192.168.1.50 (no trailing slash). */
  baseUrl: () => string;
  /** The current session id, '' when signed out. */
  sid: () => string;
  /** A 401 without quiet401: the session is gone (app.js endSession). */
  onSessionEnded?: () => void;
  clock?: BoxClock;
  fetch?: typeof fetch;
}

export const DEFAULT_TIMEOUT_MS = 10000;

/** Files under /pb/ are the box's own and its web server lets a browser keep them for an hour: always ask for a fresh copy. */
export function isBoxFile(path: string): boolean { return path.indexOf('/pb/') === 0; }

export interface Client {
  call<T = unknown>(method: string, path: string, options?: CallOptions): Promise<T>;
  clock: BoxClock;
}

/** One box's client: call() as in app.js, against `baseUrl()`, with its own clock. */
export function createClient(config: ClientConfig): Client {
  const clock = config.clock || new BoxClock();
  const doFetch = config.fetch || ((input: RequestInfo, init?: RequestInit) => fetch(input, init));

  async function call<T = unknown>(method: string, path: string, options?: CallOptions): Promise<T> {
    const opts = options || {};
    const headers: Record<string, string> = { Accept: opts.blob ? 'application/zip, */*' : 'application/json' };
    let payload: BodyInit | undefined;
    if (opts.form) payload = opts.form;
    else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(opts.body); }
    const useSid = opts.sid !== undefined ? opts.sid : (opts.noSid ? '' : config.sid());
    if (useSid) headers.sid = useSid;
    if (isBoxFile(path)) { headers['Cache-Control'] = 'no-cache'; headers.Pragma = 'no-cache'; }

    const ms = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
    const abort = ms ? new AbortController() : null;
    const timer = abort ? setTimeout(() => abort.abort(), ms as number) : null;
    try {
      let r: Response;
      try {
        r = await doFetch(config.baseUrl() + path, {
          method, headers, body: payload, credentials: 'omit', cache: 'no-store', signal: abort ? abort.signal : undefined,
        });
      } catch {
        throw new ApiError(0, t('noConnection'));
      }
      clock.noteDate(r.headers.get('Date'));
      if (opts.blob && r.ok) {
        try { return { blob: await r.blob() } as T; } catch { throw new ApiError(0, t('noConnection')); }
      }
      let txt: string;
      try { txt = await r.text(); } catch { throw new ApiError(0, t('noConnection')); }     // the answer was cut off (FTL restarting)
      let j: unknown = {};
      try { j = txt ? JSON.parse(txt) : {}; } catch { j = {}; }
      if (r.status === 401) {
        if (!opts.quiet401 && config.onSessionEnded) config.onSessionEnded();
        throw new ApiError(401, t('sessionEnded'), j);
      }
      if (!r.ok) {
        const e = (j as { error?: { message?: string; key?: string; hint?: string | null } } | null)?.error;
        let m = e ? (e.message || e.key || String(e)) : ('HTTP ' + r.status);
        if (e && e.hint) m += ' (' + e.hint + ')';
        throw new ApiError(r.status, m, j);
      }
      if (opts.text) return { text: txt } as T;
      return j as T;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  return { call, clock };
}

/** "192.168.1.50", "192.168.1.50:8080" or "http://sinko.local/" -> "http://192.168.1.50" ... (no path, no trailing slash). */
export function baseUrlFor(host: string): string {
  const h = host.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(h) ? h : 'http://' + h;
}
