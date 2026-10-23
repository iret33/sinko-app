// The guided setup against the development box (npm run mock -- --open): the claim, then every step of the setup list done through the
// box's dev endpoints (devices that ask the box, queries), setup.done written once, "Hide this list", adding a device the way submitDevice
// does (with the DNS cache cleared after it, which the page does not do), and "Check this device" on a box whose clock is not the phone's.
import assert from 'node:assert/strict';

import { pickerEntries, routerAddress } from '../../src/core';
import { setLang } from '../../src/i18n';
import {
  DEVICE_CHECK, createBoxesStore, createConnection, createDeviceCheck, createSessions, createSetup, type BoxSession, type Connection, type KeyValueStorage,
  type SecretStorage, type Setup,
} from '../../src/state';
import type { Client } from '../../src/api/client';
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
let client: Client;
let setup: Setup;
const sent: { what: string; body: unknown }[] = [];
const spy = (async (input: RequestInfo, init?: RequestInit) => {
  let body: unknown = null;
  try { body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { body = null; }
  sent.push({ what: (init && init.method ? init.method : 'GET') + ' ' + String(input).replace(/^http:\/\/[^/]+/, ''), body });
  return fetch(input, init);
}) as typeof fetch;
const what = () => sent.map((s) => s.what);
/** The timers of the router check: run by hand. */
const timers: (() => void)[] = [];
const runTimers = () => { const due = timers.splice(0); due.forEach((f) => f()); };
/** PUTs of the shared state that store setup.done = true. */
const doneWrites = () => sent.filter((s) => s.what === 'PUT /api/groups/pb-state'
  && JSON.parse(((s.body as { comment?: string }) || {}).comment || '{}').setup?.done === true).length;
const quietForDays = (days: number) => box.dev('/devices/touch', { ago: days * 86400 });
/** A message without the marks that keep names and addresses whole in Arabic (src/i18n/format.ts). */
const plain = (s: string | undefined) => (s || '').replace(/[\u2066-\u2069]/g, '');

beforeAll(async () => {
  box = await startMockBox(['--open']);
  setLang('en');
  await box.dev('/scheduler', { tickSeconds: 600, pickupSeconds: 0.2 });
  conn = createConnection({ boxes: createBoxesStore(memory()), sessions: createSessions(secrets()), fetch: spy });
  const b = await conn.addBox(box.url);
  await conn.check();
  assert.equal(conn.gate.get().phase, 'claim');
  await conn.claim('a-parent-password');
  assert.equal(conn.gate.get().phase, 'ready');
  assert.equal(conn.takeFreshClaim(b.id), true, 'the guided setup opens right after the claim');
  assert.equal(conn.takeFreshClaim(b.id), false, 'once');
  ({ session, client } = conn.current.get() as { session: BoxSession; client: Client });
  setup = createSetup({ session, client, address: () => conn.address(), setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {} });
});
afterAll(async () => { await box.stop(); });

test('the whole setup list: the router, the first child\'s device and the counter; then setup.done is written once', async () => {
  await quietForDays(8);                                        // only devices from more than a week ago: the router step is not done
  await session.load();
  await eventually(() => setup.host.get() !== '', 3000, 'the address the app talks to the box at');
  assert.equal(setup.host.get(), '127.0.0.1');
  assert.equal(routerAddress(session.view.get().boxInfo, setup.host.get()), '192.168.1.50', 'the router is given box.json\'s address');
  let list = setup.list()!;
  assert.deepEqual(list.items, [{ id: 'pw', done: true }, { id: 'router', done: false }, { id: 'child', done: false }, { id: 'counter', done: false }]);
  const stop = setup.watch();
  sent.length = 0;

  // The router: the live check looks at the devices (every 5 s in the app; here the timer is run by hand) until one asks the box.
  const release = setup.followRouter();
  runTimers();
  await eventually(() => setup.router.get().checkedAt > 0, 5000, 'the first look');
  assert.equal(setup.router.get().pointsHere, false);
  assert.ok(what().includes('GET /api/network/devices?max_devices=200&max_addresses=50'));
  await box.dev('/devices/touch', { hwaddr: 'aa:bb:cc:00:00:01' });   // the parent's own phone (/api/info/client): it does not count
  runTimers();
  await eventually(() => timers.length > 0, 5000, 'the next look to be planned');
  assert.equal(setup.router.get().pointsHere, false, 'the parent\'s phone is not the router');
  await box.dev('/devices/touch', { hwaddr: 'aa:bb:cc:00:00:02', ago: 2 });
  runTimers();
  await eventually(() => setup.router.get().pointsHere === true, 5000, 'a device to use the box');
  await eventually(() => setup.list()!.items[1].done, 5000, 'the model to be loaded again and the step ticked');
  release();

  // The first child's device: from the picker, as submitDevice adds it, then the DNS cache is cleared.
  const entries = pickerEntries(session.model()!, client.clock.nowSec());
  assert.deepEqual(entries.map((e) => [e.label, e.mine]).slice(0, 2), [['Sara-iPad', true], ['ali-galaxy', false]]);
  const ali = entries.find((e) => e.label === 'ali-galaxy')!;
  sent.length = 0;
  await setup.addDevice(ali.addr, ' Ali ');
  const post = sent.find((s) => s.what === 'POST /api/clients')!;
  assert.deepEqual(post.body, { client: 'AA:BB:CC:00:00:02', comment: 'Ali', groups: (post.body as { groups: number[] }).groups });
  assert.ok(what().indexOf('POST /api/action/restartdns') > what().indexOf('POST /api/clients'), 'the cache is cleared after the device is added');
  assert.equal(plain(session.view.get().notice?.text), 'Ali added');
  assert.deepEqual(session.model()!.kids.map((k) => k.name), ['Ali']);
  list = setup.list()!;
  assert.deepEqual(list.items.map((i) => i.done), [true, true, true, false]);
  assert.equal(doneWrites(), 0, 'not done yet');

  // The counter question, and with it everything: setup.done is written by the watcher, once.
  await setup.answerCounter(true);
  assert.equal(session.model()!.state.telemetry.on, true);
  await eventually(() => session.model()!.state.setup.done === true, 5000, 'setup.done');
  assert.equal(session.view.get().notice?.text, 'Everything is set up.', 'the list had been shown');
  for (let i = 0; i < 3; i++) await session.load();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(doneWrites(), 1, 'written once');
  list = setup.list()!;
  assert.deepEqual([list.all, list.hide, list.save], [true, true, false]);
  const stored = JSON.parse((await client.call<{ groups: { comment: string }[] }>('GET', '/api/groups/pb-state')).groups[0].comment);
  assert.deepEqual([stored.setup, stored.telemetry], [{ done: true }, { on: true }]);
  stop();
});

test('"Hide this list" writes setup.done with steps left; "Not now" answers the counter with false', async () => {
  await session.writeState((st) => { st.setup.done = false; st.telemetry = { on: null }; });
  assert.equal(setup.list()!.hide, false);
  await setup.answerCounter(false);
  assert.equal(session.model()!.state.telemetry.on, false);
  assert.equal(session.view.get().notice?.text, 'Okay. You can change this in My box.');
  await setup.hide();
  assert.equal(session.model()!.state.setup.done, true);
  assert.equal(setup.list()!.hide, true);
});

test('adding an address that has a client row already keeps its groups; an IP row that overrides it is said', async () => {
  await client.call('POST', '/api/clients', { body: { client: 'aa:bb:cc:00:00:44', comment: 'Lenovo', groups: [0] } });
  await client.call('POST', '/api/clients', { body: { client: '192.168.1.0/24', comment: 'the whole LAN', groups: [0] } });
  await box.dev('/devices/add', { hwaddr: 'aa:bb:cc:00:00:44', ip: '192.168.1.44', name: 'new-tablet', macVendor: 'Lenovo' });
  await session.load();
  sent.length = 0;
  await setup.addDevice('AA:BB:CC:00:00:44', '');
  const put = sent.find((s) => s.what === 'PUT /api/clients/aa%3Abb%3Acc%3A00%3A00%3A44')!;
  assert.ok(put, what().join('\n'));
  assert.equal((put.body as { comment: string }).comment, 'Lenovo', 'no name typed: the row keeps its own');
  assert.equal((put.body as { groups: number[] }).groups[0], 0, 'its own groups first');
  assert.ok(what().includes('POST /api/action/restartdns'));
  assert.deepEqual([plain(session.view.get().notice?.text), session.view.get().notice?.error],
    ['AA:BB:CC:00:00:44 added, but Pi-hole has another rule (192.168.1.0/24) that overrides it. Remove that rule in Pi-hole admin.', true]);
  await client.call('DELETE', '/api/clients/' + encodeURIComponent('192.168.1.0/24'));
});

describe('"Check this device" against the box, with its clock three hours ahead of the phone', () => {
  const timing = { ...DEVICE_CHECK };
  beforeAll(async () => {
    Object.assign(DEVICE_CHECK, { every: 150, lastQueryAfter: 1500, giveUpAfter: 4000 });
    await box.dev('/clock', { skewSec: 10800 });
    await quietForDays(8);
    await session.load();                                       // the client learns the box's clock from the Date header
    assert.ok(Math.abs(client.clock.offsetMs - 10800000) < 2000, 'the box is three hours ahead');
  });
  afterAll(async () => { Object.assign(DEVICE_CHECK, timing); await box.dev('/clock', { skewSec: 0 }); });

  test('a query from the device passes at once, while its lastQuery has not moved', async () => {
    const check = createDeviceCheck({ call: client.call, clock: client.clock });
    await check.start({ kind: 'device', ips: ['192.168.1.22'] });
    assert.equal(check.state.get().phase, 'watching');
    await box.dev('/queries/add', { ip: '192.168.1.40', domain: 'www.youtube.com' });     // another device
    await box.dev('/queries/add', { ip: '192.168.1.22', domain: 'www.example.com' });
    await eventually(() => check.state.get().phase === 'passed', 3000, 'the check');
    const s = check.state.get();
    assert.ok(s.phase === 'passed' && s.via === 'query' && s.ip === '192.168.1.22');
    const ali = (await session.load())!.devices.find((d) => d.hwaddr === 'aa:bb:cc:00:00:02')!;
    assert.ok(client.clock.nowSec() - ali.lastQuery > 7 * 86400, 'lastQuery lags: it still says a week ago');
    check.stop();
  });

  test('a query from before the tap does not count; after the first minute (shortened) lastQuery does', async () => {
    await box.dev('/queries/add', { ip: '192.168.1.30', ago: 30 });
    const check = createDeviceCheck({ call: client.call, clock: client.clock });
    await check.start({ kind: 'device', ips: ['192.168.1.30'] });
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(check.state.get().phase, 'watching', 'the query from 30 s before the tap is not this check\'s');
    await box.dev('/devices/touch', { ip: '192.168.1.30' });
    await eventually(() => check.state.get().phase === 'passed', 4000, 'lastQuery');
    const s = check.state.get();
    assert.ok(s.phase === 'passed' && s.via === 'lastQuery', JSON.stringify(s));
  });

  test('this phone is the address the box sees it at; a device that never asks is not heard from', async () => {
    const check = createDeviceCheck({ call: client.call, clock: client.clock });
    await check.start({ kind: 'thisPhone' });
    await box.dev('/queries/add', { ip: '192.168.1.21' });                               // the mock's /api/info/client
    await eventually(() => check.state.get().phase === 'passed', 3000, 'this phone');
    await check.start({ kind: 'device', ips: ['192.168.1.99'] });
    await eventually(() => check.state.get().phase === 'notSeen', 6000, 'giving up');
  });
});
