// The selected box: its client (src/api), its session id and its model (BoxSession), and the way from "the app is opened" to "signed in"
// (the `gate`). One box at a time; switching boxes makes a new client and model, so a box's clock and model never mix with another's.
//
// The gate follows the page's boot (Sinko web/app.js boot, line 1382): no password yet and Sinko's groups there is the claim screen; no
// password and no groups is "setup is not finished" (checked again every 30 s: a ready-made box makes its groups during its first start);
// a password is the stored session when it still works, a silent sign-in when "Keep me signed in" is on, or the sign-in screen.
import { ApiError, baseUrlFor, createClient, createHostGuard, setActiveClient, type Client, type HostGuard } from '../api';
import { parseBoxInfo, type BoxInfo } from '../core/box';
import { t } from '../i18n';
import { boxAccess, claimBox, noPasswordSet, PROBLEM_TEXT, signInProblem, type AuthAnswer, type SignInProblem } from './auth';
import { createBoxSession, type BoxSession } from './model';
import type { Box, BoxIdentity, BoxesStore } from './boxes';
import type { Sessions } from './session';
import { createStore, type Store } from './store';

export interface Current { box: Box | null; client: Client | null; session: BoxSession | null }

/** What /api/auth says about this box and this phone's session. */
export interface AuthState {
  /** No password is set (a fresh Pi-hole, or a ready-made box before it is claimed). */
  open: boolean;
  /** The stored session is still good. */
  valid: boolean;
  /** Signing in needs a code from an authenticator app too. */
  totp: boolean;
}

export type SignInResult = { ok: true } | { ok: false; status: number; body: unknown; message: string; problem: SignInProblem };

/** Where the app is on the way to "signed in". The screens render the phase (app/index.tsx). */
export type Gate =
  | { phase: 'starting' }
  /** No box is chosen, or the parent asked for another one. */
  | { phase: 'find' }
  | { phase: 'checking' }
  /** The selected box did not answer. */
  | { phase: 'unreachable'; message: string }
  /** No password yet, and Sinko is on the box: choose one. */
  | { phase: 'claim' }
  /** No password and no Sinko groups: wait. `since` is when this was first seen (phone time, ms), `checkedAt` the last look. */
  | { phase: 'notInstalled'; since: number; checkedAt: number }
  /** `note` is one calm line (the session ended, the password was changed, the box restarted); `totp`: ask for the code too. */
  | { phase: 'signIn'; note: string; totp: boolean }
  | { phase: 'ready' };

export interface Connection {
  current: Store<Current>;
  gate: Store<Gate>;
  /** Restores the boxes and the selected box's session, connects to it and checks it. */
  start(): Promise<void>;
  connect(box: Box | null): Promise<void>;
  /** Adds a box by its address (or finds it, by boxId or address) and selects it. */
  addBox(host: string, name?: string, identity?: BoxIdentity): Promise<Box>;
  /** addBox, then check(): what the find screen does with the box the parent picked. */
  chooseBox(host: string, info: BoxInfo | null): Promise<void>;
  /** The gate for the selected box (app.js boot). */
  check(): Promise<void>;
  /** Back to the find screen; the saved boxes stay. */
  findAgain(): void;
  authState(): Promise<AuthState>;
  /** The claim screen's form, after its own checks (passwordProblem). */
  claim(password: string, keep?: boolean): Promise<void>;
  /** POST /api/auth (app.js login). `keep`: "Keep me signed in" (ignored while a code is needed). */
  signIn(password: string, totp?: number, keep?: boolean): Promise<SignInResult>;
  signOut(): Promise<void>;
  /** The session is gone (app.js endSession): the sign-in screen with this note. */
  endSession(note?: string): Promise<void>;
  /** Switches "Keep me signed in" on from the settings: signs in with `password` to prove it, then keeps that session and the password. */
  keepSignedIn(password: string): Promise<SignInResult>;
  /** Switches "Keep me signed in" off: the password is forgotten, the session stays. */
  forgetPassword(): Promise<void>;
  /** Signing in to the selected box needs a 6-digit code (as last seen). */
  totp(): boolean;
}

export interface ConnectionDeps {
  boxes: BoxesStore;
  sessions: Sessions;
  fetch?: typeof fetch;
  hosts?: HostGuard;
  now?: () => number;
  setTimeout?: (f: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

/** app.js POLL_MS for a box that is still setting itself up (the page asks the parent to reload; the app looks again by itself). */
export const NOT_INSTALLED_RETRY_MS = 30000;
/** A 401 this soon after the box stopped answering is a box that restarted: boxBackNote. */
const RESTART_NOTE_MS = 10 * 60000;

export function createConnection(deps: ConnectionDeps): Connection {
  const { boxes, sessions } = deps;
  const hosts = deps.hosts || createHostGuard();
  const now = deps.now || Date.now;
  const later = deps.setTimeout || ((f, ms) => setTimeout(f, ms));
  const cancel = deps.clearTimeout || ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const current = createStore<Current>({ box: null, client: null, session: null });
  const gate = createStore<Gate>({ phase: 'starting' });
  let totp = false;                   // the box asks for a code (GET /api/auth, or the last sign-in)
  let silentBlocked = false;          // a silent sign-in failed: none again until the parent signs in
  let renewing: Promise<boolean> | null = null;
  let lastSilentAt = 0;               // phone time the box last did not answer
  let endNote = '';                   // the note for the sign-in screen, set by what ended the session
  let retryTimer: unknown = null;

  function need(): { box: Box; client: Client } {
    const c = current.get();
    if (!c.box || !c.client) throw new ApiError(0, t('noBoxSelected'));
    return { box: c.box, client: c.client };
  }
  function setGate(g: Gate) {
    if (retryTimer !== null) { cancel(retryTimer); retryTimer = null; }
    gate.set(g);
  }

  async function connect(box: Box | null): Promise<void> {
    if (!box) { setActiveClient(null); current.set({ box: null, client: null, session: null }); return; }
    await sessions.restore(box.id);
    totp = false; silentBlocked = false; lastSilentAt = 0;
    const client = createClient({
      baseUrl: () => baseUrlFor(box.host),
      sid: () => sessions.sid(box.id),
      renewSession,
      // A 401 for a session that is not the current one any more (signed out, or signed in again since) ends nothing.
      onSessionEnded: (failedSid) => { if (sessions.sid(box.id) === failedSid) void endSession(); },
      onAnswer: (status) => { if (status === 0) lastSilentAt = now(); },
      hosts,
      fetch: deps.fetch,
    });
    const session = createBoxSession(client, { onLoaded: () => { void boxes.seen(box.id); } });
    setActiveClient(client);
    current.set({ box, client, session });
  }

  /** POST /api/auth and, when it worked, the new session (the previous one, if any, is closed: never two at once). */
  async function postAuth(client: Client, box: Box, password: string, code?: number): Promise<SignInResult> {
    const body: { password: string; totp?: number } = { password };
    if (code !== undefined) body.totp = code;
    try {
      const j = await client.call<AuthAnswer>('POST', '/api/auth', { body, noSid: true, quiet401: true });
      const s = j.session || {};
      if (s.valid !== true || typeof s.sid !== 'string' || !s.sid) {
        return { ok: false, status: 200, body: j, message: '', problem: signInProblem(200, j) };
      }
      totp = s.totp === true || code !== undefined;              // a code that was taken is two-factor, whatever the answer says
      const before = sessions.sid(box.id);
      await sessions.set(box.id, s.sid);
      if (before && before !== s.sid) await client.call('DELETE', '/api/auth', { sid: before, quiet401: true }).catch(() => {});
      return { ok: true };
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      const body = (e.body || {}) as AuthAnswer;
      if (body.session && body.session.totp === true) totp = true;
      const problem = signInProblem(e.status, body);
      if (problem === 'needCode' || problem === 'wrongCode' || problem === 'reusedCode') totp = true;
      return { ok: false, status: e.status, body: e.body, message: e.message, problem };
    }
  }

  /** A 401 on a request with the current session: one silent sign-in with the kept password, if there is one and no code is needed. */
  function renewSession(failedSid: string): Promise<boolean> {
    const c = current.get();
    if (!c.box || !c.client) return Promise.resolve(false);
    const box = c.box, client = c.client;
    const sid = sessions.sid(box.id);
    if (sid && sid !== failedSid) return Promise.resolve(true);         // another request has signed in again already
    if (renewing) return renewing;
    if (silentBlocked || totp || !sessions.kept.get()[box.id]) return Promise.resolve(false);
    renewing = (async () => {
      const password = await sessions.password(box.id);
      if (!password) return false;
      const r = await postAuth(client, box, password);
      if (r.ok) return true;
      silentBlocked = true;
      if (r.problem === 'wrongPassword') { await sessions.keep(box.id, null); endNote = t('loginPwChanged'); }
      else if (totp) await sessions.keep(box.id, null);              // two-factor is on now: a silent sign-in cannot work
      return false;
    })().finally(() => { renewing = null; });
    return renewing;
  }

  async function endSession(note?: string): Promise<void> {
    const c = current.get();
    if (!c.box) return;
    await sessions.clear(c.box.id);
    const text = note || endNote || (lastSilentAt && now() - lastSilentAt < RESTART_NOTE_MS ? t('boxBackNote') : t('sessionEnded'));
    endNote = '';
    setGate({ phase: 'signIn', note: text, totp });
  }

  /** box.json, read without a session: the box's own name and number, so the boxes list can show it and find it again. */
  async function refreshIdentity(client: Client, box: Box): Promise<BoxInfo | null> {
    const info = await client.call<unknown>('GET', '/pb/box.json', { noSid: true, quiet401: true }).then(parseBoxInfo, () => null);
    if (info && ((info.boxId && info.boxId !== box.boxId) || (info.hostname && (info.hostname !== box.hostname || info.hostname !== box.name)))) {
      await boxes.update(box.id, { boxId: info.boxId || box.boxId, hostname: info.hostname || box.hostname, name: info.hostname || box.name });
      const updated = boxes.state.get().boxes.find((b) => b.id === box.id);
      if (updated) current.update((cur) => (cur.box && cur.box.id === box.id ? { ...cur, box: updated } : cur));
    }
    return info;
  }

  async function check(): Promise<void> {
    const c = current.get();
    if (!c.box || !c.client) { setGate({ phase: 'find' }); return; }
    const box = c.box, client = c.client;
    const before = gate.get();
    if (before.phase !== 'notInstalled') setGate({ phase: 'checking' });
    let access;
    try {
      access = await boxAccess(client);
    } catch (e) {
      setGate({ phase: 'unreachable', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    void refreshIdentity(client, box).catch(() => undefined);
    if (access.kind === 'open') { setGate({ phase: 'claim' }); return; }
    if (access.kind === 'notInstalled') {
      const since = before.phase === 'notInstalled' ? before.since : now();
      setGate({ phase: 'notInstalled', since, checkedAt: now() });
      retryTimer = later(() => { retryTimer = null; void check(); }, NOT_INSTALLED_RETRY_MS);
      return;
    }
    totp = access.totp;
    if (totp && sessions.kept.get()[box.id]) await sessions.keep(box.id, null);
    if (sessions.sid(box.id)) {
      try {
        const j = await client.call<AuthAnswer>('GET', '/api/auth', { quiet401: true });
        if (j.session && j.session.valid === true) { setGate({ phase: 'ready' }); return; }
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401) {
          setGate({ phase: 'unreachable', message: e instanceof Error ? e.message : String(e) });
          return;
        }
      }
      await sessions.clear(box.id);
    }
    let note = '';
    if (!totp && sessions.kept.get()[box.id]) {
      const password = await sessions.password(box.id);
      const r = password ? await postAuth(client, box, password) : null;
      if (r && r.ok) { setGate({ phase: 'ready' }); return; }
      if (r && r.problem === 'noConnection') { setGate({ phase: 'unreachable', message: r.message }); return; }
      if (r && r.problem === 'wrongPassword') { await sessions.keep(box.id, null); note = t('loginPwChanged'); }
      else if (r) note = t(PROBLEM_TEXT[r.problem], { e: r.message });
      if (totp) await sessions.keep(box.id, null);
    }
    setGate({ phase: 'signIn', note, totp });
  }

  async function addBox(host: string, name?: string, identity?: BoxIdentity): Promise<Box> {
    const box = await boxes.add(host, name, identity);
    await boxes.select(box.id);
    await connect(box);
    return box;
  }

  return {
    current,
    gate,
    async start() {
      await boxes.restore();
      const box = boxes.active();
      await connect(box);
      if (!box) { setGate({ phase: 'find' }); return; }
      await check();
    },
    connect,
    addBox,
    async chooseBox(host, info) {
      await addBox(host, info && info.hostname ? info.hostname : undefined, info ? { boxId: info.boxId, hostname: info.hostname } : undefined);
      await check();
    },
    check,
    findAgain() { setGate({ phase: 'find' }); },
    /** app.js noPasswordSet (line 532, with the stricter reading of auth.ts) and probeAuth (line 519). */
    async authState() {
      const { box, client } = need();
      let anonymous: AuthAnswer;
      try {
        anonymous = await client.call<AuthAnswer>('GET', '/api/auth', { noSid: true, quiet401: true });
      } catch (e) {
        if (!(e instanceof ApiError) || e.status === 0) throw e;                // the box did not answer: nothing is known
        anonymous = (e.body || {}) as AuthAnswer;
      }
      if (noPasswordSet(anonymous)) return { open: true, valid: true, totp: false };
      const anonTotp = !!(anonymous.session && anonymous.session.totp === true);
      if (!sessions.sid(box.id)) return { open: false, valid: false, totp: anonTotp };
      try {
        const j = await client.call<AuthAnswer>('GET', '/api/auth', { quiet401: true });
        const s = j.session || {};
        return { open: false, valid: s.valid === true, totp: s.totp === true };
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await sessions.clear(box.id);
          const s = ((e.body || {}) as AuthAnswer).session || {};
          return { open: false, valid: false, totp: s.totp === true };
        }
        throw e;
      }
    },
    async claim(password, keep) {
      const { box, client } = need();
      const r = await claimBox(client, password);
      if (r.kind === 'signedIn') {
        totp = r.totp;
        await sessions.set(box.id, r.sid);
        if (keep && !totp) await sessions.keep(box.id, password);
        silentBlocked = false;
        setGate({ phase: 'ready' });
        return;
      }
      if (r.kind === 'savedOnly') { setGate({ phase: 'signIn', note: t('claimSignIn'), totp }); return; }
      if (r.kind === 'taken') throw new ClaimTaken();
      throw new ApiError(r.status, t('claimFail', { e: r.message }));
    },
    async signIn(password, code, keep) {
      const { box, client } = need();
      const r = await postAuth(client, box, password, code);
      if (r.ok) {
        silentBlocked = false;
        if (keep !== undefined) await sessions.keep(box.id, keep && !totp ? password : null);
        else if (totp) await sessions.keep(box.id, null);
        setGate({ phase: 'ready' });
      }
      return r;
    },
    /** app.js logout (line 609): the session is closed on the box, and the session id and the kept password are forgotten. */
    async signOut() {
      const { box, client } = need();
      const sid = sessions.sid(box.id);
      // Forgotten first: a request still on its way then answers for an old session, which neither signs in again nor ends anything.
      silentBlocked = true;
      await sessions.clear(box.id);
      await sessions.keep(box.id, null);
      setGate({ phase: 'signIn', note: '', totp });
      if (sid) await client.call('DELETE', '/api/auth', { sid, quiet401: true }).catch(() => {});
    },
    endSession,
    async keepSignedIn(password) {
      const { box, client } = need();
      if (totp) return { ok: false, status: 400, body: {}, message: t('keepSignedInTotp'), problem: 'needCode' };
      const r = await postAuth(client, box, password);
      if (r.ok) { await sessions.keep(box.id, password); silentBlocked = false; }
      return r;
    },
    async forgetPassword() {
      const { box } = need();
      await sessions.keep(box.id, null);
    },
    totp: () => totp,
  };
}

/** PATCH /api/config answered 401: the box was claimed by someone else first (quick-start card, step 3). */
export class ClaimTaken extends Error {
  constructor() { super(t('claimTaken')); this.name = 'ClaimTaken'; }
}
