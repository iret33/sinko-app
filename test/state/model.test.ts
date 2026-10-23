// The model (load, run, putGroup, putClient, flushDns, writeState) against the development box, and the box itself playing the
// scheduler: timers, bedtime, update and restart requests, two-factor sign-in, devices and the client address.
import assert from 'node:assert/strict';

import { ApiError } from '../../src/api/client';
import { G, kidGroupIds, requestTime } from '../../src/core';
import { createBoxesStore, createConnection, createSessions, type BoxSession, type Connection, type KeyValueStorage, type SecretStorage } from '../../src/state';
import { eventually, startMockBox, type MockBox } from '../mockBox';

const memory = (): KeyValueStorage => {
  const m = new Map<string, string>();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, removeItem: async (k) => { m.delete(k); } };
};
const secrets = (): SecretStorage => {
  const m = new Map<string, string>();
  return { getItemAsync: async (k) => m.get(k) ?? null, setItemAsync: async (k, v) => { m.set(k, v); }, deleteItemAsync: async (k) => { m.delete(k); } };
};

let box: MockBox;
let conn: Connection;
let session: BoxSession;
const sent: string[] = [];
const spy = (async (input: RequestInfo, init?: RequestInit) => {
  sent.push((init && init.method ? init.method : 'GET') + ' ' + String(input).replace(/^http:\/\/[^/]+/, ''));
  return fetch(input, init);
}) as typeof fetch;
const call = <T = unknown>(method: string, path: string, body?: unknown) => conn.current.get().client!.call<T>(method, path, body === undefined ? undefined : { body });
const nowSec = () => conn.current.get().client!.clock.nowSec();

beforeAll(async () => {
  box = await startMockBox();
  await box.dev('/scheduler', { tickSeconds: 600, pickupSeconds: 0.2 });     // passes only when a test asks for one
  conn = createConnection({ boxes: createBoxesStore(memory()), sessions: createSessions(secrets()), fetch: spy });
  await conn.addBox(box.url);
  assert.deepEqual(await conn.signIn('test'), { ok: true });
  session = conn.current.get().session!;
});
afterAll(async () => { await box.stop(); });

test('load(): the same eight requests in parallel, and the model app.js builds', async () => {
  sent.length = 0;
  const m = await session.load();
  assert.ok(m);
  assert.deepEqual(sent.slice().sort(), ['GET /api/clients', 'GET /api/domains', 'GET /api/groups', 'GET /api/info/client',
    'GET /api/network/devices?max_devices=200&max_addresses=50', 'GET /pb/box.json', 'GET /pb/domains.json', 'GET /pb/services.json']);
  for (const n of Object.values(G)) assert.ok(m.groups[n], n);
  const v = session.view.get();
  assert.equal(m.services.length, v.catalog!.services.length, 'every app of services.json has its group');
  assert.ok(m.services.every((s) => s.group.name === 'pb-svc-' + s.meta.id && s.blocked === false));
  assert.deepEqual(m.kids, []);
  assert.equal(m.devices.length, 3);
  assert.equal(m.myIp, '192.168.1.21');
  assert.equal(m.offline, false);
  assert.equal(m.state.v, 1);
  assert.deepEqual(m.learned, []);
  assert.equal(v.boxInfo?.tz, 'Asia/Bahrain');
  assert.ok(v.domainMap && Object.keys(v.domainMap).length > 50, 'the domain map for the live picture');
  assert.equal(v.banner, '');
  assert.ok(v.loadedAt > 0);
  sent.length = 0;
  await session.load();
  assert.equal(sent.length, 6, 'services.json and domains.json are read once');
});

test('children: added with kidGroupIds, paused with putClient, overridden by an IP row; run() clears the DNS cache once', async () => {
  let m = (await session.load())!;
  await call('POST', '/api/clients', { client: 'AA:BB:CC:00:00:01', comment: 'Sara', groups: kidGroupIds(m) });
  m = (await session.load())!;
  assert.equal(m.kids.length, 1);
  const k = m.kids[0];
  assert.equal(k.name, 'Sara');
  assert.equal(k.dev?.ips[0].name, 'Sara-iPad', 'matched to its network-table entry by MAC');
  assert.equal(k.paused, false);
  assert.deepEqual(k.shadow, []);
  sent.length = 0;
  await session.run(() => session.putClient(k.row, k.row.groups.concat([m.groups[G.paused].id])), 'paused');
  assert.ok(sent.includes('PUT /api/clients/AA%3ABB%3ACC%3A00%3A00%3A01'));
  assert.equal(sent.filter((s) => s === 'POST /api/action/restartdns').length, 1, 'the cache is cleared after the action');
  assert.ok(sent.indexOf('POST /api/action/restartdns') > sent.indexOf('PUT /api/clients/AA%3ABB%3ACC%3A00%3A00%3A01'));
  assert.ok(sent.includes('GET /api/groups'), 'and the model is loaded again');
  assert.deepEqual(session.view.get().notice && session.view.get().notice!.text, 'paused');
  m = session.model()!;
  assert.equal(m.kids[0].paused, true);
  await call('POST', '/api/clients', { client: '192.168.1.0/24', comment: 'the whole LAN', groups: [0] });
  m = (await session.load())!;
  assert.deepEqual(m.kids[0].shadow.map((r) => r.client), ['192.168.1.0/24'], 'an IP row without the child\'s groups overrides it');
  await call('DELETE', '/api/clients/' + encodeURIComponent('192.168.1.0/24'));
});

test('run(): one action at a time, a message for a failure, and no cache flush when nothing changed', async () => {
  let ran = 0;
  let release: () => void = () => {};
  const first = session.run(() => new Promise<void>((r) => { ran++; release = r; }));
  assert.equal(session.view.get().busy, true);
  await session.run(() => { ran++; });
  assert.equal(ran, 1, 'a second action while one runs is dropped, like a second tap');
  release();
  await first;
  assert.equal(session.view.get().busy, false);
  sent.length = 0;
  await session.run(() => { throw new ApiError(500, 'database is locked'); });
  assert.deepEqual([session.view.get().notice?.text, session.view.get().notice?.error], ['That did not work: database is locked', true]);
  assert.ok(!sent.includes('POST /api/action/restartdns'), 'no rule changed');
});

test('putGroup and writeState: one group written, the state read-modified-written with what the scheduler wrote kept', async () => {
  const m = (await session.load())!;
  const yt = m.services.find((s) => s.meta.id === 'youtube')!;
  await session.run(() => session.putGroup(yt.group, true));
  assert.equal(session.model()!.services.find((s) => s.meta.id === 'youtube')!.blocked, true);
  // The scheduler writes between the page's reads: its fields survive the page's write.
  const g = (await call<{ groups: { comment: string }[] }>('GET', '/api/groups/pb-state')).groups[0];
  const st = JSON.parse(g.comment);
  st.update = { ...st.update, latest: '3.9.0', notes: 'https://github.com/iret33/sinko/releases/tag/v3.9.0', checked: 1800000000 };
  await call('PUT', '/api/groups/pb-state', { name: 'pb-state', comment: JSON.stringify(st), enabled: false });
  await session.writeState((s) => { s.schedule = { enabled: false, start: '22:00', end: '06:30', days: [0, 1, 2, 3, 4] }; });
  const stored = JSON.parse((await call<{ groups: { comment: string; enabled: boolean }[] }>('GET', '/api/groups/pb-state')).groups[0].comment);
  assert.equal(stored.update.latest, '3.9.0', 'the scheduler\'s field is kept');
  assert.equal(stored.schedule.start, '22:00');
  assert.equal(session.model()!.state.schedule.start, '22:00', 'the model has the new state at once');
  await session.writeState((s) => { s.update.latest = null; s.update.notes = null; });
});

test('the box ends a timer like Controller.tick: the rules from before come back', async () => {
  let m = (await session.load())!;
  const before: Record<string, boolean> = {};
  m.services.forEach((s) => { before[s.meta.id] = s.blocked; });
  await session.run(async () => {
    await session.putGroup(m.groups[G.offline], true);                        // an offline break
    await session.writeState((st) => { st.timer = { mode: 'block', until: Math.round(nowSec()) + 1, snapshot: { services: before, offline: false } }; });
  });
  assert.equal(session.model()!.offline, true);
  await new Promise((r) => setTimeout(r, 1500));
  await box.dev('/tick', {});
  m = (await session.load())!;
  assert.equal(m.state.timer, null, 'the timer is gone');
  assert.equal(m.offline, false, 'and the internet is back on');
});

test('the box switches bedtime on and off like Controller.tick, on its own wall clock (box.json: UTC+03:00)', async () => {
  const wall = new Date((nowSec() + 3 * 3600) * 1000);
  const minute = wall.getUTCHours() * 60 + wall.getUTCMinutes(), day = wall.getUTCDay();
  const hhmm = (n: number) => { const x = (n + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
  await session.writeState((st) => { st.schedule = { enabled: true, start: hhmm(minute - 1), end: hhmm(minute + 3), days: [day, (day + 6) % 7] }; });
  await box.dev('/tick', {});
  let m = (await session.load())!;
  assert.equal(m.state.scheduleActive, true, 'bedtime has started');
  assert.equal(m.offline, true, 'and the internet is off');
  await session.writeState((st) => { st.schedule.enabled = false; });
  await box.dev('/tick', {});
  m = (await session.load())!;
  assert.equal(m.state.scheduleActive, false);
  assert.equal(m.offline, false, 'bedtime over: the internet is back');
});

test('Update now and Check again: the box takes the marker, runs, and reports the outcome picked in the dev menu', async () => {
  await box.dev('/scheduler', { latest: '3.2.0', update: { outcome: 'ok', runSeconds: 0.5, outageSeconds: 0 }, check: { offline: false, seconds: 0.2 } });
  await session.writeState((st) => { st.update.checkRequest = requestTime(nowSec()); });
  await eventually(async () => (await session.load())!.state.update.latest === '3.2.0', 10000, 'the check');
  const s0 = session.model()!.state.update;
  assert.equal(s0.checkRequest, null, 'the marker is cleared');
  assert.equal(s0.notes, 'https://github.com/iret33/sinko/releases/tag/v3.2.0');
  await session.writeState((st) => { st.update.request = requestTime(nowSec()); });
  await eventually(async () => (await session.load())!.state.update.status === 'ok', 10000, 'the update');
  const s = session.model()!.state.update;
  assert.deepEqual([s.request, s.from, s.to, s.latest], [null, '3.1.0', '3.2.0', null]);
  const version = await conn.current.get().client!.call<{ text: string }>('GET', '/pb/version.txt', { text: true, noSid: true });
  assert.equal(version.text.trim(), '3.2.0', 'the box runs the new version');
  await box.dev('/scheduler', { latest: '3.3.0', update: { outcome: 'failed', rolledBack: false } });
  await session.writeState((st) => { st.update.latest = '3.3.0'; st.update.request = requestTime(nowSec()); });
  await eventually(async () => (await session.load())!.state.update.status === 'failed', 10000, 'the failed update');
  assert.equal(session.model()!.state.update.rolledBack, false);
  await box.dev('/scheduler', { latest: null, update: { outcome: 'ok' } });
});

test('Restart: the box takes the request and stops answering for a while (status 0), then answers again', async () => {
  await box.dev('/scheduler', { power: { outcome: 'act', restartSeconds: 1.5, endSessions: false } });
  await session.writeState((st) => { st.power = { request: requestTime(nowSec()), action: 'reboot' }; });
  await eventually(() => session.load().then(() => false, (e: ApiError) => e.status === 0), 5000, 'the box to go quiet');
  await eventually(() => session.load().then(() => true, () => false), 10000, 'the box to come back');
  assert.deepEqual(session.model()!.state.power, { request: null, action: null });
});

test('two-factor sign-in errors are Pi-hole\'s, and quiet401 keeps the session while the code is wrong', async () => {
  await box.dev('/totp', { code: '123456' });
  assert.equal((await conn.authState()).valid, true, 'signed in before the code is switched on');
  const missing = await conn.signIn('test');
  assert.deepEqual(missing.ok ? null : [missing.status, missing.message], [400, 'No 2FA token found in JSON payload']);
  const wrong = await conn.signIn('test', 111111);
  assert.ok(!wrong.ok);
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, { error: { key: 'unauthorized', message: 'Invalid 2FA token', hint: null }, took: 0.0001 }, 'no session object at all');
  assert.equal((await conn.authState()).valid, true, 'the old session is still there: a wrong code is not a sign-out');
  const badPassword = await conn.signIn('nope', 111111);
  assert.ok(!badPassword.ok && (badPassword.body as { session: { totp: boolean } }).session.totp === true, 'a wrong password says a code is needed');
  assert.deepEqual(await conn.signIn('test', 123456), { ok: true });
  await box.dev('/totp', { code: null });
});

test('a lost session signs out (401 without quiet401)', async () => {
  const sessions = createSessions(secrets());
  const other = createConnection({ boxes: createBoxesStore(memory()), sessions, fetch: spy });
  const b = await other.addBox(box.url);
  await sessions.set(b.id, 'not-a-session');
  await assert.rejects(other.current.get().session!.load(), (e: ApiError) => e.status === 401);
  assert.equal(sessions.sid(b.id), '', 'the session id is forgotten');
  assert.equal((await other.authState()).valid, false);
});

test('dev endpoints: a device asks the box now, and /api/info/client can be a phone that is not a child\'s', async () => {
  await box.dev('/devices/touch', { hwaddr: 'aa:bb:cc:00:00:02', ago: 10 });
  await box.dev('/client', { ip: '192.168.1.9' });
  const m = (await session.load())!;
  const ali = m.devices.find((d) => d.hwaddr === 'aa:bb:cc:00:00:02')!;
  assert.ok(Math.abs(ali.lastQuery - (nowSec() - 10)) < 3, 'lastQuery is on the box\'s clock');
  assert.equal(m.myIp, '192.168.1.9');
  await box.dev('/client', { ip: null });
});
