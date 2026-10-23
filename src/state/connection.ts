// The selected box: its client (src/api), its session id and its model (BoxSession). One at a time; switching boxes makes new ones, so
// a box's clock and model never mix with another's.
import { ApiError, baseUrlFor, createClient, setActiveClient, type Client } from '../api';
import { createBoxSession, type BoxSession } from './model';
import type { Box, BoxesStore } from './boxes';
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

export type SignInResult = { ok: true } | { ok: false; status: number; body: unknown; message: string };

export interface Connection {
  current: Store<Current>;
  /** Restores the boxes and the selected box's session, and connects to it. */
  start(): Promise<void>;
  connect(box: Box | null): Promise<void>;
  /** Adds a box by its address (or finds it) and selects it. */
  addBox(host: string, name?: string): Promise<Box>;
  authState(): Promise<AuthState>;
  signIn(password: string, totp?: number): Promise<SignInResult>;
  signOut(): Promise<void>;
}

export function createConnection(deps: { boxes: BoxesStore; sessions: Sessions; fetch?: typeof fetch }): Connection {
  const { boxes, sessions } = deps;
  const current = createStore<Current>({ box: null, client: null, session: null });

  function need(): { box: Box; client: Client } {
    const c = current.get();
    if (!c.box || !c.client) throw new ApiError(0, 'No box is selected.');
    return { box: c.box, client: c.client };
  }

  async function connect(box: Box | null): Promise<void> {
    if (!box) { setActiveClient(null); current.set({ box: null, client: null, session: null }); return; }
    await sessions.restore(box.id);
    const client = createClient({
      baseUrl: () => baseUrlFor(box.host),
      sid: () => sessions.sid(box.id),
      onSessionEnded: () => { void sessions.clear(box.id); },          // app.js endSession: the sign-in screen follows from the sessions store
      fetch: deps.fetch,
    });
    const session = createBoxSession(client, { onLoaded: () => { void boxes.seen(box.id); } });
    setActiveClient(client);
    current.set({ box, client, session });
  }

  return {
    current,
    async start() {
      await boxes.restore();
      await connect(boxes.active());
    },
    connect,
    async addBox(host, name) {
      const box = await boxes.add(host, name);
      await boxes.select(box.id);
      await connect(box);
      return box;
    },
    /** app.js noPasswordSet (line 532) and probeAuth (line 519). */
    async authState() {
      const { box, client } = need();
      type Auth = { session?: { valid?: boolean; totp?: boolean } };
      // A box with no password answers GET /api/auth with a valid session even when no session id is sent. That is asked WITHOUT the
      // stored session id: with one, "valid" would only say that the session is fine, not that no password exists.
      let anonymous: Auth;
      try {
        anonymous = await client.call<Auth>('GET', '/api/auth', { noSid: true, quiet401: true });
        if (anonymous.session && anonymous.session.valid) return { open: true, valid: true, totp: false };
      } catch (e) {
        if (!(e instanceof ApiError) || e.status === 0) throw e;                // the box did not answer: nothing is known
        anonymous = (e.body || {}) as Auth;
      }
      if (!sessions.sid(box.id)) return { open: false, valid: false, totp: !!(anonymous.session && anonymous.session.totp) };
      try {
        const j = await client.call<Auth>('GET', '/api/auth', { quiet401: true });
        const s = j.session || {};
        return { open: false, valid: !!s.valid, totp: !!s.totp };
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await sessions.clear(box.id);
          const s = (e.body as Auth).session || {};
          return { open: false, valid: false, totp: !!s.totp };
        }
        throw e;
      }
    },
    /** POST /api/auth, the way the page signs in (app.js login, line 582). The caller says what went wrong from status and body. */
    async signIn(password, totp) {
      const { box, client } = need();
      const body: { password: string; totp?: number } = { password };
      if (totp !== undefined) body.totp = totp;
      try {
        const j = await client.call<{ session?: { valid?: boolean; sid?: string | null } }>('POST', '/api/auth', { body, noSid: true, quiet401: true });
        const s = j.session || {};
        if (!s.valid) return { ok: false, status: 200, body: j, message: '' };
        await sessions.set(box.id, s.sid || '');
        return { ok: true };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, status: e.status, body: e.body, message: e.message };
        throw e;
      }
    },
    /** app.js logout (line 609). */
    async signOut() {
      const { box, client } = need();
      if (sessions.sid(box.id)) await client.call('DELETE', '/api/auth', { quiet401: true }).catch(() => {});
      await sessions.clear(box.id);
    },
  };
}
