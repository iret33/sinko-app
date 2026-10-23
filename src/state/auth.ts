// Signing in to a box: whether it has a password yet, choosing the first one (the claim), and what a failed sign-in means. Modelled on
// Sinko web/app.js noPasswordSet (line 532), sinkoInstalled (line 537), claim (line 548) and login (line 582), and on what Pi-hole's FTL
// answers (src/api/auth.c: get_session_object and api_auth).
import { ApiError, type Client } from '../api/client';
import { G } from '../core/groups';

/** The session object of GET and POST /api/auth. */
export interface SessionAnswer { valid?: unknown; totp?: unknown; sid?: unknown; validity?: unknown; message?: unknown }
export interface AuthAnswer { session?: SessionAnswer; error?: { key?: unknown; message?: unknown; hint?: unknown } }

/**
 * No password is set. FTL answers a box without one with { valid: true, sid: null, validity: -1 } (get_session_object, API_AUTH_EMPTYPASS),
 * and a request that carried a session with { valid: true, sid: "<the session>", validity: <seconds left> }. The page asks for valid
 * alone (app.js noPasswordSet, line 532: r.ok && valid); the app asks for all three, so a session that went along by accident (a stray
 * cookie in some fetch) cannot make a claimed box look open.
 */
export function noPasswordSet(answer: unknown): boolean {
  const s = answer && typeof answer === 'object' ? (answer as AuthAnswer).session : undefined;
  return !!s && s.valid === true && s.sid === null && s.validity === -1;
}

export type BoxAccess =
  /** No password, and Sinko's groups are there: the claim screen. */
  | { kind: 'open' }
  /** No password and no pb-state group: setup is not finished (a ready-made box makes its groups during its first start). */
  | { kind: 'notInstalled' }
  /** A password is set. `totp`: signing in needs a 6-digit code too. */
  | { kind: 'claimed'; totp: boolean };

/**
 * app.js boot (line 1382): GET /api/auth without a session, then, for a box with no password, GET /api/groups (app.js sinkoInstalled,
 * line 537). Rejects with status 0 when the box does not answer.
 */
export async function boxAccess(client: Client): Promise<BoxAccess> {
  let answer: unknown;
  try {
    answer = await client.call('GET', '/api/auth', { noSid: true, quiet401: true });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status === 0) throw e;
    answer = e.body;
  }
  if (!noPasswordSet(answer)) {
    const s = (answer as AuthAnswer | null)?.session;
    return { kind: 'claimed', totp: !!(s && s.totp === true) };
  }
  let installed = false;
  try {
    const j = await client.call<{ groups?: { name?: unknown }[] }>('GET', '/api/groups', { noSid: true, quiet401: true });
    installed = (j.groups || []).some((g) => !!g && g.name === G.state);
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) throw e;
  }
  return installed ? { kind: 'open' } : { kind: 'notInstalled' };
}

export type ClaimResult =
  /** The password is set and the app is signed in with it. */
  | { kind: 'signedIn'; sid: string; totp: boolean }
  /** The password is set, but signing in with it did not work: the sign-in screen, with the page's claimSignIn note. */
  | { kind: 'savedOnly' }
  /** The box answered 401: a password was set before this one, by somebody else (quick-start card, step 3). */
  | { kind: 'taken' }
  /** Nothing was saved. */
  | { kind: 'failed'; status: number; message: string };

/** How claim() waits between sign-in attempts (app.js claim, line 548: four tries, 1.2 s apart). */
export const CLAIM_RETRY = { tries: 4, delayMs: 1200 };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * app.js claim (line 548), after the form's checks (passwordProblem): PATCH /api/config with the password, without a session and without
 * signing out on a 401; then POST /api/auth, tried up to four times 1.2 s apart while Pi-hole is busy applying the change (no answer, or
 * a 5xx).
 */
export async function claimBox(client: Client, password: string, sleep: (ms: number) => Promise<void> = wait): Promise<ClaimResult> {
  try {
    await client.call('PATCH', '/api/config', { body: { config: { webserver: { api: { password } } } }, noSid: true, quiet401: true });
  } catch (e) {
    const err = e as ApiError;
    if (err && err.status === 401) return { kind: 'taken' };
    return { kind: 'failed', status: err && typeof err.status === 'number' ? err.status : 0, message: err && err.message ? err.message : String(e) };
  }
  for (let left = CLAIM_RETRY.tries; ; left--) {
    try {
      const j = await client.call<AuthAnswer>('POST', '/api/auth', { body: { password }, noSid: true, quiet401: true });
      const s = j.session || {};
      if (s.valid === true && typeof s.sid === 'string' && s.sid) return { kind: 'signedIn', sid: s.sid, totp: s.totp === true };
      return { kind: 'savedOnly' };
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (left > 1 && (!status || status >= 500)) { await sleep(CLAIM_RETRY.delayMs); continue; }
      return { kind: 'savedOnly' };
    }
  }
}

/** Why a sign-in did not work, in the words the sign-in screen has for it. */
export type SignInProblem =
  | 'noConnection'     // the box did not answer
  | 'wrongPassword'    // 401 with a session object ("password incorrect"), or 200 without a valid session
  | 'needCode'         // 400 "No 2FA token found in JSON payload": the password was right, the code is missing
  | 'wrongCode'        // 401 with only an error, "Invalid 2FA token"
  | 'reusedCode'       // 401 with only an error, "Reused 2FA token": a code is good once
  | 'seatsFull'        // 429 api_seats_exceeded: every session is taken (16 on Pi-hole; one ends 30 minutes after its last use)
  | 'tooManyTries'     // 429 rate_limiting: too many wrong passwords or codes in a short time
  | 'other';

/**
 * The page's reading of a failed sign-in (app.js login, line 600), made exact with FTL's answers (src/api/auth.c api_auth): the password
 * is checked first and a wrong one is the 401 that carries a session; then the code, whose problems are an error object without a
 * session; and a 429 says in its key whether the sessions are full or the box is slowing down wrong tries.
 */
export function signInProblem(status: number, body: unknown): SignInProblem {
  const j = (body && typeof body === 'object' ? body : {}) as AuthAnswer;
  const err = j.error && typeof j.error === 'object' ? j.error : null;
  const key = err && typeof err.key === 'string' ? err.key : '';
  const msg = err && typeof err.message === 'string' ? err.message : '';
  const codeMsg = /totp|2fa/i.test(msg);
  if (status === 0) return 'noConnection';
  if (status === 429) {
    if (key === 'rate_limiting' || /rate.?limit/i.test(msg)) return 'tooManyTries';
    return 'seatsFull';                                      // api_seats_exceeded, and what the page says for any 429 (tooMany)
  }
  if (status === 400 && codeMsg) return 'needCode';
  if (status === 401 && !j.session && codeMsg) return /reused/i.test(msg) ? 'reusedCode' : 'wrongCode';
  if (status === 401 || (status === 200 && !(j.session && j.session.valid === true))) return 'wrongPassword';
  return 'other';
}

/** The words for a SignInProblem (keys of src/i18n). */
export const PROBLEM_TEXT: Record<SignInProblem, string> = {
  noConnection: 'noConnection', wrongPassword: 'wrongPassword', needCode: 'boxPwNeedCode', wrongCode: 'codeWrong', reusedCode: 'codeReused',
  seatsFull: 'tooMany', tooManyTries: 'tooManyTries', other: 'failed',
};

/** The code field shows when the box says so, or when the answer is about a code. */
export function problemNeedsCode(p: SignInProblem): boolean {
  return p === 'needCode' || p === 'wrongCode' || p === 'reusedCode';
}
