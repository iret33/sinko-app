// The app never stores or sends a cookie for the box, although the box sets one on every signed-in answer.
//
// Node's fetch has no cookie store, so the requests here go through `nativeLikeFetch`, which handles cookies the way the app's fetch does
// on a phone: Expo's fetch (the global one since SDK 52; expo/ios/Expo/Fetch/ExpoURLSessionTask.swift and
// expo/android/.../fetch/NativeRequest.kt) and React Native's own (RCTNetworking.mm, NetworkingModule.kt) both store and send cookies
// unless credentials is 'omit'. The first test shows that this harness and the mock box really do store and send the cookie when a
// request lets them; the second runs the app's own client through sign-in, load, writes, a run and sign-out and finds nothing.
import assert from 'node:assert/strict';

import { createClient } from '../../src/api/client';
import { createBoxesStore, createConnection, createSessions, type KeyValueStorage, type SecretStorage } from '../../src/state';
import { startMockBox, type MockBox } from '../mockBox';

function nativeLikeFetch() {
  const jar = new Map<string, string>();                 // name -> value, for the one box
  const log = { setCookieAnswers: 0, cookieRequests: 0 };
  const f = (async (input: RequestInfo, init?: RequestInit) => {
    const handles = !init || init.credentials !== 'omit';
    const headers = new Headers(init && init.headers);
    if (handles && jar.size) headers.set('Cookie', Array.from(jar, ([k, v]) => k + '=' + v).join('; '));
    if (headers.has('Cookie')) log.cookieRequests++;
    const r = await fetch(input, { ...init, headers });
    const set = r.headers.getSetCookie();
    if (set.length) log.setCookieAnswers++;
    if (handles) {
      for (const c of set) {
        const [pair, ...attrs] = c.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
        if (attrs.some((a) => /^\s*max-age=-/i.test(a))) jar.delete(name); else jar.set(name, value);
      }
    }
    return r;
  }) as typeof fetch;
  return { fetch: f, jar, log };
}
const memory = (): KeyValueStorage => {
  const m = new Map<string, string>();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, removeItem: async (k) => { m.delete(k); } };
};
const secrets = (): SecretStorage => {
  const m = new Map<string, string>();
  return { getItemAsync: async (k) => m.get(k) ?? null, setItemAsync: async (k, v) => { m.set(k, v); }, deleteItemAsync: async (k) => { m.delete(k); } };
};

let box: MockBox;
beforeAll(async () => { box = await startMockBox(); });
afterAll(async () => { await box.stop(); });

test('control: the box sets a sid cookie like Pi-hole, a fetch that allows cookies keeps and sends it, and a cookie alone can read but not write', async () => {
  await box.dev('/reset-counters', {});
  const h = nativeLikeFetch();
  const signIn = await h.fetch(box.url + '/api/auth', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test' }) });
  assert.equal(signIn.status, 200);
  assert.match(signIn.headers.get('set-cookie') || '', /^sid=\w+; SameSite=Strict; Path=\/; Max-Age=1800; HttpOnly$/);
  assert.ok(h.jar.has('sid'), 'stored');
  const read = await h.fetch(box.url + '/api/groups', { credentials: 'include' });
  assert.equal(read.status, 200, 'the cookie alone signs in for a read');
  const write = await h.fetch(box.url + '/api/groups/pb-svc-youtube', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'pb-svc-youtube', comment: 'sinko: YouTube', enabled: true }) });
  assert.equal(write.status, 401, 'but a write signed in by cookie needs a CSRF token');
  const status = await box.dev<{ cookies: { requestsWithCookie: number } }>('/status');
  assert.equal(status.cookies.requestsWithCookie, 2, 'the box saw the cookie twice');
});

test('the app\'s client stores no cookie and sends none: sign-in, load, writes, a run, the password check\'s second session, sign-out', async () => {
  await box.dev('/reset-counters', {});
  const h = nativeLikeFetch();
  const boxes = createBoxesStore(memory());
  const conn = createConnection({ boxes, sessions: createSessions(secrets()), fetch: h.fetch });
  await conn.addBox(box.url.replace('http://', ''));
  assert.deepEqual(await conn.authState(), { open: false, valid: false, totp: false });
  assert.deepEqual(await conn.signIn('test'), { ok: true });
  const { session, client } = conn.current.get();
  assert.ok(session && client);
  const model = await session.load();
  assert.ok(model && model.services.length > 10);
  await session.run(() => session.putGroup(model.groups['pb-svc-youtube'], true));
  await session.writeState((st) => { st.setup.done = true; });
  // The password check of My box: a second session, opened without the first one and closed with its own id.
  const second = await client.call<{ session: { sid: string } }>('POST', '/api/auth', { body: { password: 'test' }, noSid: true, quiet401: true });
  await client.call('DELETE', '/api/auth', { sid: second.session.sid, quiet401: true });
  assert.equal((await conn.authState()).valid, true);
  await conn.signOut();

  assert.ok(h.log.setCookieAnswers >= 10, 'the box set its cookie on every signed-in answer (' + h.log.setCookieAnswers + ')');
  assert.equal(h.jar.size, 0, 'nothing was stored');
  assert.equal(h.log.cookieRequests, 0, 'nothing was sent');
  const status = await box.dev<{ cookies: { requestsWithCookie: number } }>('/status');
  assert.equal(status.cookies.requestsWithCookie, 0, 'and the box agrees: no request carried a cookie');
});

test('a client used directly passes credentials: omit on every request (so the native stack handles no cookies)', async () => {
  const seen: (RequestCredentials | undefined)[] = [];
  const spy = (async (input: RequestInfo, init?: RequestInit) => { seen.push(init && init.credentials); return fetch(input, init); }) as typeof fetch;
  const client = createClient({ baseUrl: () => box.url, sid: () => '', fetch: spy });
  await client.call('GET', '/api/auth', { quiet401: true }).catch(() => {});
  await client.call('GET', '/pb/box.json', { noSid: true });
  await client.call('POST', '/api/auth', { body: { password: 'test' }, noSid: true });
  assert.deepEqual(seen, ['omit', 'omit', 'omit']);
});
