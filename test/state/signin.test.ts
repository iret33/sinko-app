// From "the app is opened" to "signed in", against the development box: the claim of a box with no password (npm run mock -- --open),
// signing out and in, a wrong password, "Keep me signed in" across a restart of the app, a session that ends while the app is open, the
// two-factor answers, the two kinds of 429, and a box with a newer contract than the app.
import assert from 'node:assert/strict';

import { ApiError } from '../../src/api/client';
import { setLang, t } from '../../src/i18n';
import {
  ClaimTaken, boxFeatures, createBoxesStore, createConnection, createSessions, parseBoxInfoForTest, type Connection, type KeyValueStorage, type SecretStorage,
} from './signinHelpers';
import { startMockBox, type MockBox } from '../mockBox';

const memory = (): KeyValueStorage => {
  const m = new Map<string, string>();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, removeItem: async (k) => { m.delete(k); } };
};
const secrets = (): SecretStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItemAsync: async (k) => data.get(k) ?? null, setItemAsync: async (k, v) => { data.set(k, v); }, deleteItemAsync: async (k) => { data.delete(k); } };
};

/** One phone: its storage outlives an app (a restart is a new connection on the same storage). `timers` are the 30 s rechecks. */
function phone(box: MockBox) {
  const storage = memory(), keychain = secrets();
  const sent: string[] = [];
  const timers: (() => void)[] = [];
  /** Requests to this path wait until release(): an answer that is still on its way. */
  let hold: { path: string; waiting: (() => void)[] } | null = null;
  const spy = (async (input: RequestInfo, init?: RequestInit) => {
    const what = (init?.method || 'GET') + ' ' + String(input).replace(/^http:\/\/[^/]+/, '');
    if (hold && what === hold.path) { const h = hold; await new Promise<void>((r) => h.waiting.push(r)); }
    sent.push(what);
    return fetch(input, init);
  }) as typeof fetch;
  function app(): Connection {
    return createConnection({ boxes: createBoxesStore(storage), sessions: createSessions(keychain), fetch: spy,
      setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {} });
  }
  return {
    app, keychain, sent, timers, url: box.url,
    hold: (path: string) => { hold = { path, waiting: [] }; },
    release: () => { const h = hold; hold = null; if (h) h.waiting.forEach((r) => r()); },
  };
}
const gateOf = (c: Connection) => c.gate.get();

describe('a box with no password yet (--open)', () => {
  let box: MockBox;
  beforeAll(async () => { box = await startMockBox(['--open']); setLang('en'); });
  afterAll(async () => { await box.stop(); });

  test('setup not finished: wait, look again every 30 s, then the claim screen once the groups are there', async () => {
    await box.dev('/installed', { done: false });
    const p = phone(box);
    const conn = p.app();
    await conn.addBox(p.url);
    await conn.check();
    const first = gateOf(conn);
    assert.equal(first.phase, 'notInstalled');
    assert.equal(p.timers.length, 1, 'a recheck is planned');
    p.timers.shift()!();
    await new Promise((r) => setTimeout(r, 300));
    const second = gateOf(conn);
    assert.ok(second.phase === 'notInstalled' && first.phase === 'notInstalled' && second.since === first.since, 'still waiting, since the first look');
    await box.dev('/installed', { done: true });
    p.timers.shift()!();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(gateOf(conn).phase, 'claim');
  });

  test('the claim: choose the password, signed in at once; a second phone then finds it taken and signs in instead', async () => {
    const p = phone(box);
    const conn = p.app();
    await conn.addBox(p.url);
    await conn.check();
    assert.equal(gateOf(conn).phase, 'claim');
    p.sent.length = 0;
    await conn.claim('family-pass-1');
    assert.equal(gateOf(conn).phase, 'ready');
    assert.deepEqual(p.sent.filter((s) => !s.includes('box.json')), ['PATCH /api/config', 'POST /api/auth']);
    const { box: saved } = conn.current.get();
    assert.ok(saved && conn.current.get().client);
    assert.match(p.keychain.data.get('sinko.sid.' + saved.id) || '', /^sid\d+$/, 'the session is kept');
    assert.equal(p.keychain.data.has('sinko.pw.' + saved.id), false, 'Keep me signed in was off: no password kept');
    assert.equal((await conn.authState()).valid, true);
    const model = await conn.current.get().session!.load();
    assert.ok(model && model.services.length > 0, 'and the box can be read with it');

    // Another phone, which still saw the claim screen, tries to choose a password too: the box answers 401.
    const late = phone(box).app();
    await late.addBox(p.url);
    await assert.rejects(late.claim('someone-else-2'), (e: Error) => e instanceof ClaimTaken && e.message === t('claimTaken'));
    await late.check();
    assert.equal(gateOf(late).phase, 'signIn', 'it is a claimed box now: the sign-in screen');
  });
});

describe('a box with a password (test)', () => {
  let box: MockBox;
  beforeAll(async () => { box = await startMockBox(); setLang('en'); });
  afterAll(async () => { await box.stop(); });
  afterEach(async () => {
    for (const [path, body] of [['/totp', { code: null }], ['/seats', { full: false }], ['/rate-limit', { on: false }], ['/box-info', { reset: true }]] as const) {
      await box.dev(path, body);
    }
  });

  test('sign in, sign out (the box closes the session), a wrong password, sign in again', async () => {
    const p = phone(box);
    const conn = p.app();
    await conn.addBox(p.url);
    await conn.check();
    assert.deepEqual(gateOf(conn), { phase: 'signIn', note: '', totp: false });
    const wrong = await conn.signIn('not-it');
    assert.ok(!wrong.ok && wrong.problem === 'wrongPassword' && wrong.status === 401);
    assert.equal(gateOf(conn).phase, 'signIn');
    assert.deepEqual(await conn.signIn('test'), { ok: true });
    assert.equal(gateOf(conn).phase, 'ready');
    const b = conn.current.get().box!;
    const sid = p.keychain.data.get('sinko.sid.' + b.id)!;
    await conn.signOut();
    assert.deepEqual(gateOf(conn), { phase: 'signIn', note: '', totp: false });
    assert.equal(p.keychain.data.has('sinko.sid.' + b.id), false);
    const old = await fetch(p.url + '/api/auth', { headers: { sid } });
    assert.equal(old.status, 401, 'the box no longer knows the old session: it was closed, not just forgotten');
    assert.deepEqual(await conn.signIn('test'), { ok: true });
  });

  test('signing out while a load is still on its way: no "session ended", and no silent sign-in behind the parent\'s back', async () => {
    const p = phone(box);
    const conn = p.app();
    await conn.addBox(p.url);
    await conn.check();
    await conn.signIn('test', undefined, true);
    const b = conn.current.get().box!;
    p.hold('GET /api/clients');
    const loading = conn.current.get().session!.load().catch((e: ApiError) => e);
    await new Promise((r) => setTimeout(r, 100));
    await conn.signOut();
    p.sent.length = 0;
    p.release();
    const r = await loading;
    assert.ok(r instanceof ApiError && r.status === 401, 'the late answer is a 401 for the closed session');
    assert.deepEqual(gateOf(conn), { phase: 'signIn', note: '', totp: false }, 'the sign-in screen without a note');
    assert.ok(!p.sent.includes('POST /api/auth'), 'not signed in again: ' + p.sent.join(', '));
    assert.equal(p.keychain.data.has('sinko.sid.' + b.id), false);
    assert.equal(p.keychain.data.has('sinko.pw.' + b.id), false, 'signing out forgets the kept password');
  });

  test('the stored session is used again while it works: a restart of the app opens no second session', async () => {
    const p = phone(box);
    const first = p.app();
    await first.addBox(p.url);
    await first.check();
    await first.signIn('test');
    p.sent.length = 0;
    const again = p.app();
    await again.start();
    assert.equal(gateOf(again).phase, 'ready');
    assert.ok(!p.sent.includes('POST /api/auth'), 'no sign-in: ' + p.sent.join(', '));
  });

  test('Keep me signed in survives a restart: a session the box ended is opened again without asking, and the request goes through', async () => {
    const p = phone(box);
    const conn = p.app();
    await conn.addBox(p.url);
    await conn.check();
    assert.deepEqual(await conn.signIn('test', undefined, true), { ok: true });
    const b = conn.current.get().box!;
    assert.equal(p.keychain.data.get('sinko.pw.' + b.id), 'test', 'the password is kept');

    // The box forgets the session (it timed out); the app is started again.
    const sid1 = p.keychain.data.get('sinko.sid.' + b.id)!;
    await fetch(p.url + '/api/auth', { method: 'DELETE', headers: { sid: sid1 } });
    const restarted = p.app();
    await restarted.start();
    assert.equal(gateOf(restarted).phase, 'ready', 'signed in by itself');
    const sid2 = p.keychain.data.get('sinko.sid.' + b.id)!;
    assert.ok(sid2 && sid2 !== sid1);

    // And while the app is open: the box ends the session, the next load signs in once and goes on.
    await fetch(p.url + '/api/auth', { method: 'DELETE', headers: { sid: sid2 } });
    p.sent.length = 0;
    const m = await restarted.current.get().session!.load();
    assert.ok(m, 'the load worked');
    assert.equal(p.sent.filter((s) => s === 'POST /api/auth').length, 1, 'one silent sign-in for the eight requests of a load');
    assert.equal(gateOf(restarted).phase, 'ready', 'no sign-in screen');
  });

  test('without Keep me signed in, a session that ends is the sign-in screen with a calm note', async () => {
    const p = phone(box);
    const conn = p.app();
    await conn.addBox(p.url);
    await conn.check();
    await conn.signIn('test');
    const b = conn.current.get().box!;
    await fetch(p.url + '/api/auth', { method: 'DELETE', headers: { sid: p.keychain.data.get('sinko.sid.' + b.id)! } });
    await assert.rejects(conn.current.get().session!.load(), (e: ApiError) => e.status === 401);
    assert.deepEqual(gateOf(conn), { phase: 'signIn', note: t('sessionEnded'), totp: false });
    assert.equal(p.keychain.data.has('sinko.sid.' + b.id), false);
  });

  test('a kept password that no longer works (changed on another phone) is forgotten: loginPwChanged', async () => {
    const p = phone(box);
    const conn = p.app();
    await conn.addBox(p.url);
    await conn.check();
    await conn.signIn('test', undefined, true);
    const b = conn.current.get().box!;
    p.keychain.data.set('sinko.pw.' + b.id, 'the-old-one');          // as if the password had been changed since
    await fetch(p.url + '/api/auth', { method: 'DELETE', headers: { sid: p.keychain.data.get('sinko.sid.' + b.id)! } });
    const restarted = p.app();
    await restarted.start();
    assert.deepEqual(gateOf(restarted), { phase: 'signIn', note: t('loginPwChanged'), totp: false });
    assert.equal(p.keychain.data.has('sinko.pw.' + b.id), false);
  });

  test('two-factor: the code field from the start, missing, wrong and reused codes, and no Keep me signed in', async () => {
    const p = phone(box);
    const conn = p.app();
    await conn.addBox(p.url);
    await conn.check();
    await conn.signIn('test', undefined, true);
    await conn.signOut();
    await box.dev('/totp', { code: '123456' });
    await conn.check();
    assert.deepEqual(gateOf(conn), { phase: 'signIn', note: '', totp: true }, 'GET /api/auth says a code is needed');
    const missing = await conn.signIn('test');
    assert.ok(!missing.ok && missing.status === 400 && missing.problem === 'needCode');
    const wrongPw = await conn.signIn('nope', 111111);
    assert.ok(!wrongPw.ok && wrongPw.problem === 'wrongPassword', 'the password is checked first');
    const wrong = await conn.signIn('test', 111111);
    assert.ok(!wrong.ok && wrong.status === 401 && wrong.problem === 'wrongCode');
    assert.deepEqual(wrong.body, { error: { key: 'unauthorized', message: 'Invalid 2FA token', hint: null }, took: 0.0001 }, 'no session object');
    assert.deepEqual(await conn.signIn('test', 123456, true), { ok: true });
    const b = conn.current.get().box!;
    assert.equal(p.keychain.data.has('sinko.pw.' + b.id), false, 'with a code, the password is not kept: a silent sign-in cannot work');
    assert.equal(conn.totp(), true);
    const refused = await conn.keepSignedIn('test');
    assert.ok(!refused.ok && refused.message === t('keepSignedInTotp'));
    await conn.signOut();
    const reused = await conn.signIn('test', 123456);
    assert.ok(!reused.ok && reused.problem === 'reusedCode' && reused.status === 401, 'a code is good once');
  });

  test('429: every session taken, or too many wrong tries, each with its own words', async () => {
    const p = phone(box);
    const conn = p.app();
    await conn.addBox(p.url);
    await box.dev('/seats', { full: true });
    const seats = await conn.signIn('test');
    assert.ok(!seats.ok && seats.status === 429 && seats.problem === 'seatsFull');
    await box.dev('/seats', { full: false });
    await box.dev('/rate-limit', { on: true });
    const tries = await conn.signIn('test');
    assert.ok(!tries.ok && tries.status === 429 && tries.problem === 'tooManyTries');
  });

  test('a box with a newer contract (api 2): read, never written; and learning only from 3.1.0', async () => {
    const p = phone(box);
    const conn = p.app();
    await conn.addBox(p.url);
    await conn.check();
    await conn.signIn('test');
    await box.dev('/box-info', { api: 2 });
    const session = conn.current.get().session!;
    const m = await session.load();
    assert.ok(m, 'it can be read');
    p.sent.length = 0;
    await assert.rejects(session.writeState((st) => { st.setup.done = true; }), (e: Error) => e.message === t('appUpdateNeeded'));
    assert.deepEqual(p.sent, [], 'not even the read before the write');
    await box.dev('/box-info', { api: 1 });
    await session.load();
    await session.writeState((st) => { st.setup.done = true; });
    assert.equal(session.model()!.state.setup.done, true, 'api 1 is this app\'s: written');

    assert.deepEqual(boxFeatures(parseBoxInfoForTest('3.1.0')), { learning: true });
    assert.deepEqual(boxFeatures(parseBoxInfoForTest('3.2.0')), { learning: true });
    assert.deepEqual(boxFeatures(parseBoxInfoForTest('3.0.4')), { learning: false }, 'learning came with 3.1.0');
    assert.deepEqual(boxFeatures(parseBoxInfoForTest('')), { learning: false }, 'an unknown version: hidden');
    assert.deepEqual(boxFeatures(null), { learning: false });
  });

  test('the box\'s own name and number from box.json go into the boxes list', async () => {
    const id = 'fedcba9876543210fedcba9876543210';
    await box.dev('/box-info', { boxId: id, hostname: 'kids-box', api: 1 });
    const p = phone(box);
    const conn = p.app();
    await conn.addBox(p.url);
    await conn.check();
    await new Promise((r) => setTimeout(r, 200));
    const b = conn.current.get().box!;
    assert.equal(b.boxId, id);
    assert.equal(b.hostname, 'kids-box');
    assert.equal(b.name, 'kids-box');
  });
});
