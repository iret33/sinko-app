// The API client against a fake fetch: what it sends, how it reads the box's clock, and how answers become values or ApiErrors.
// The same client against the mock box (and its cookies) is test/api/cookies.test.ts.
import assert from 'node:assert/strict';

import { ApiError, BoxClock, CLOCK_STEP_MS, baseUrlFor, createClient, type CallOptions } from '../../src/api/client';
import { timing } from '../../src/core/box';

type Seen = { url: string; init: RequestInit & { headers: Record<string, string> } };
type Answer = { status?: number; body?: string; headers?: Record<string, string> } | (() => Promise<Response>);

function fakeBox(answers: Answer[], now?: () => number) {
  const seen: Seen[] = [];
  let ended = 0;
  let sid = 'abc';
  const fetchImpl = (async (input: RequestInfo, init?: RequestInit) => {
    seen.push({ url: String(input), init: init as Seen['init'] });
    const a = answers.shift() || {};
    if (typeof a === 'function') return a();
    return new Response(a.body === undefined ? '{}' : a.body, { status: a.status || 200, headers: a.headers || {} });
  }) as typeof fetch;
  const client = createClient({ baseUrl: () => 'http://192.168.1.50', sid: () => sid, onSessionEnded: () => { ended++; },
    fetch: fetchImpl, clock: new BoxClock(now) });
  return { client, seen, ended: () => ended, setSid: (s: string) => { sid = s; } };
}
const rejects = async (p: Promise<unknown>): Promise<ApiError> => {
  try { await p; } catch (e) { assert.ok(e instanceof ApiError, String(e)); return e; }
  throw new Error('expected an ApiError');
};

test('what is sent: JSON headers, the session id in a `sid` header, and never a cookie', async () => {
  const box = fakeBox([{}, {}, {}, {}]);
  await box.client.call('GET', '/api/groups');
  await box.client.call('PUT', '/api/groups/pb-state', { body: { name: 'pb-state', comment: '{}', enabled: false } });
  await box.client.call('PATCH', '/api/config', { body: { config: {} }, noSid: true });
  await box.client.call('DELETE', '/api/auth', { sid: 'second' });
  const [get, put, claim, del] = box.seen;
  assert.equal(get.url, 'http://192.168.1.50/api/groups');
  assert.deepEqual(get.init.headers, { Accept: 'application/json', sid: 'abc' }, 'no Content-Type without a body');
  assert.equal(get.init.method, 'GET');
  assert.equal(get.init.body, undefined);
  assert.deepEqual(put.init.headers, { Accept: 'application/json', 'Content-Type': 'application/json', sid: 'abc' });
  assert.equal(put.init.body, '{"name":"pb-state","comment":"{}","enabled":false}');
  assert.deepEqual(claim.init.headers, { Accept: 'application/json', 'Content-Type': 'application/json' }, 'noSid: no session at all');
  assert.equal(del.init.headers.sid, 'second', 'sid: this session instead of the current one');
  for (const s of box.seen) {
    assert.equal(s.init.credentials, 'omit', 'cookies are neither sent nor stored');
    assert.equal(s.init.cache, 'no-store');
    assert.ok(!Object.keys(s.init.headers).some((h) => h.toLowerCase() === 'cookie'), 'no Cookie header by hand');
  }
  box.setSid('');
  await box.client.call('GET', '/api/auth');
  assert.equal(box.seen[4].init.headers.sid, undefined, 'signed out: no empty sid header');
});

test('files under /pb/ are always asked for afresh', async () => {
  const box = fakeBox([{}, {}]);
  await box.client.call('GET', '/pb/services.json', { noSid: true });
  await box.client.call('GET', '/api/pb/not-a-file');
  assert.equal(box.seen[0].init.headers['Cache-Control'], 'no-cache');
  assert.equal(box.seen[0].init.headers.Pragma, 'no-cache');
  assert.equal(box.seen[1].init.headers['Cache-Control'], undefined);
});

test('a multipart form is sent as it is, and the answer can be text or a file', async () => {
  const box = fakeBox([{ body: '{"files":[]}' }, { body: '[i] Neutrino emissions detected...\n[✓] done' }, { body: 'PK\u0003\u0004zip', headers: { 'Content-Type': 'application/zip' } }]);
  const form = new FormData();
  form.append('import', '{"config":false}');
  assert.deepEqual(await box.client.call('POST', '/api/teleporter', { form }), { files: [] });
  assert.equal(box.seen[0].init.body, form);
  assert.equal(box.seen[0].init.headers['Content-Type'], undefined, 'fetch writes the multipart boundary itself');
  assert.deepEqual(await box.client.call('POST', '/api/action/gravity', { text: true, timeoutMs: null }), { text: '[i] Neutrino emissions detected...\n[✓] done' });
  assert.equal(box.seen[1].init.signal, undefined, 'the rebuild of the block lists has no time limit');
  const file = await box.client.call<{ blob: Blob }>('GET', '/api/teleporter', { blob: true });
  assert.equal(box.seen[2].init.headers.Accept, 'application/zip, */*');
  assert.equal(await file.blob.text(), 'PK\u0003\u0004zip');
});

test('errors keep the status and the parsed answer; 401 signs out unless quiet401', async () => {
  const session401 = JSON.stringify({ session: { valid: false, totp: true, sid: null, csrf: null, validity: -1, message: 'password incorrect' } });
  const box = fakeBox([
    { status: 401, body: session401 },
    { status: 401, body: session401 },
    { status: 400, body: JSON.stringify({ error: { key: 'bad_request', message: 'No 2FA token found in JSON payload', hint: null } }) },
    { status: 404, body: JSON.stringify({ error: { key: 'not_found', message: 'Not found', hint: 'check the name' } }) },
    { status: 500, body: '<html>oops</html>' },
    { status: 429, body: JSON.stringify({ error: { key: 'api_seats_exceeded', hint: null } }) },
  ]);
  let e = await rejects(box.client.call('GET', '/api/groups'));
  assert.equal(e.status, 401);
  assert.equal(box.ended(), 1, 'the session is gone');
  e = await rejects(box.client.call('POST', '/api/auth', { body: { password: 'x' }, noSid: true, quiet401: true }));
  assert.equal(e.status, 401);
  assert.equal(box.ended(), 1, 'quiet401: the caller decides');
  assert.deepEqual((e.body as { session: { totp: boolean } }).session.totp, true, 'and can read body.session');
  e = await rejects(box.client.call('POST', '/api/auth', { body: { password: 'x' }, quiet401: true }));
  assert.equal(e.status, 400);
  assert.equal(e.message, 'No 2FA token found in JSON payload');
  assert.equal((e.body as { error: { message: string } }).error.message, 'No 2FA token found in JSON payload');
  e = await rejects(box.client.call('GET', '/api/groups/x'));
  assert.equal(e.message, 'Not found (check the name)', 'the hint goes with the message');
  e = await rejects(box.client.call('GET', '/api/groups'));
  assert.equal(e.status, 500);
  assert.equal(e.message, 'HTTP 500', 'an answer that is not JSON');
  assert.deepEqual(e.body, {});
  e = await rejects(box.client.call('POST', '/api/auth', { noSid: true }));
  assert.equal(e.message, 'api_seats_exceeded', 'the key when there is no message');
  assert.equal(box.ended(), 1);
});

test('status 0: the box did not answer, answered too late, or its answer was cut off', async () => {
  const box = fakeBox([
    () => Promise.reject(new TypeError('Network request failed')),
    async () => ({ ok: true, status: 200, headers: new Headers(), text: () => Promise.reject(new TypeError('terminated')) }) as unknown as Response,
  ]);
  let e = await rejects(box.client.call('GET', '/api/groups'));
  assert.equal(e.status, 0);
  assert.equal(e.message, 'Cannot reach the family box. Check that it is switched on and connected.');
  e = await rejects(box.client.call('GET', '/api/groups'));
  assert.equal(e.status, 0, 'a body that never arrived whole');
});

test('a timeout rejects with status 0 (with a fetch that honours the abort signal, like the real ones)', async () => {
  const fetchImpl = ((_url: RequestInfo, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')));
  })) as typeof fetch;
  const client = createClient({ baseUrl: () => 'http://box', sid: () => '', fetch: fetchImpl });
  const started = Date.now();
  const e = await rejects(client.call('GET', '/api/groups', { timeoutMs: 80 }));
  assert.equal(e.status, 0);
  assert.ok(Date.now() - started < 2000);
  const defaults: CallOptions = {};
  assert.equal(defaults.timeoutMs, undefined, 'no option = the 10 s default');
});

test('the box\'s clock comes from the Date header of every answer, also of errors', async () => {
  let phone = Date.UTC(2026, 9, 23, 10, 0, 0);
  const at = (ms: number) => ({ headers: { Date: new Date(ms).toUTCString() } });
  const box = fakeBox([at(phone + 3 * 3600e3), { ...at(phone + 3 * 3600e3 + 20e3), status: 500 }, at(phone + 3 * 3600e3 + 60e3), { headers: { Date: 'garbage' } }, {}], () => phone);
  const clock = box.client.clock;
  assert.equal(clock.known, false);
  assert.equal(clock.nowSec(), phone / 1000, 'the phone\'s clock until the box has answered');
  await box.client.call('GET', '/api/groups');
  assert.equal(clock.offsetMs, 3 * 3600e3, 'the box is three hours ahead of this phone');
  assert.equal(clock.nowSec(), phone / 1000 + 3 * 3600);
  assert.equal(clock.stepping(), false, 'the first reading is not a jump');
  await rejects(box.client.call('GET', '/api/groups'));
  assert.equal(clock.offsetMs, 3 * 3600e3 + 20e3, 'an error answer still has a Date');
  assert.equal(clock.stepping(), false, '20 s is not a jump (the header counts whole seconds)');
  await box.client.call('GET', '/api/groups');
  assert.equal(clock.offsetMs, 3 * 3600e3 + 60e3);
  assert.equal(clock.stepping(), true, 'more than 30 s between two answers is a jump');
  assert.equal(clock.stepHoldUntil, phone + timing.clockStepHold);
  phone += timing.clockStepHold;
  assert.equal(clock.stepping(), false, 'held for six minutes, then judged again');
  await box.client.call('GET', '/api/groups');
  await box.client.call('GET', '/api/groups');
  assert.equal(clock.offsetMs, 3 * 3600e3 + 60e3, 'a missing or unreadable Date header changes nothing');
  assert.equal(CLOCK_STEP_MS, 30000);
});

test('a box address becomes a base URL', () => {
  assert.equal(baseUrlFor('192.168.1.50'), 'http://192.168.1.50');
  assert.equal(baseUrlFor(' 127.0.0.1:8080/ '), 'http://127.0.0.1:8080');
  assert.equal(baseUrlFor('http://sinko.local/'), 'http://sinko.local');
  assert.equal(baseUrlFor('https://10.0.2.2:8443'), 'https://10.0.2.2:8443');
});
