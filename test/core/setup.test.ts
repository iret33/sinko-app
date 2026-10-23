// The setup list and the add sheet, ported from Sinko web/app.js (routerPointsHere, renderSetup, renderHelp, renderPicker, submitDevice), with
// the cases of Sinko's tests/box_smoke.py ("the setup list") and tests/test_page_scheduler.py (the counter question).
import assert from 'node:assert/strict';

import {
  G, defaultState, deviceRequest, kidGroupIds, parseBoxInfo, pickerDevices, pickerEntries, routerAddress, routerPointsHere, setupList,
  type BoxInfo, type ClientRow, type Device, type Group, type GroupsByName,
} from '../../src/core';

const NOW = 1800000000;                                   // the box's clock (s)
const DAY = 86400;
const dev = (id: number, hwaddr: string, ip: string, ago: number, name: string | null = null, macVendor = ''): Device =>
  ({ id, hwaddr, macVendor, lastQuery: ago < 0 ? 0 : NOW - ago, numQueries: 1, ips: ip ? [{ ip, name }] : [] });
const info = (counter: boolean): BoxInfo => parseBoxInfo({ v: 1, version: '3.1.0', ip: '192.168.1.50', counter, at: NOW }) as BoxInfo;

const groups: GroupsByName = {};
[[0, 'Default'], [1, G.kids], [2, G.guard], [3, G.offline], [4, G.paused], [5, G.state], [10, 'pb-svc-youtube'], [11, 'pb-svc-tiktok']]
  .forEach(([id, name]) => { groups[name as string] = { id: id as number, name: name as string, enabled: false, comment: null }; });
const services: { group: Group }[] = [{ group: groups['pb-svc-youtube'] }, { group: groups['pb-svc-tiktok'] }];
const KID = kidGroupIds({ groups, services });

describe('routerPointsHere (app.js line 1016)', () => {
  const phone = dev(1, 'aa:bb:cc:00:00:01', '192.168.1.21', 30);                // the parent's own phone
  const m = (devices: Device[], myIp = '192.168.1.21') => ({ devices, myIp });

  test('only the parent\'s own phone has asked the box so far: not yet', () => {
    assert.equal(routerPointsHere(m([phone]), NOW, '192.168.1.50'), false);
  });

  test('the parent\'s phone or the box itself never ticks it (box_smoke.py: 127.0.0.1 asks the box)', () => {
    const box = dev(8, 'ip-127.0.0.1', '127.0.0.1', 5, 'box');
    assert.equal(routerPointsHere(m([phone, box]), NOW, '192.168.1.50'), false);
    assert.equal(routerPointsHere(m([phone, dev(9, 'ip-::1', '::1', 5)]), NOW, '192.168.1.50'), false, '::1');
    assert.equal(routerPointsHere(m([phone, dev(9, 'ip-192.168.1.50', '192.168.1.50', 5)]), NOW, '192.168.1.50'), false,
      'the address the app talks to the box at (the page\'s location.hostname)');
    assert.equal(routerPointsHere(m([phone, dev(9, 'ip-192.168.1.50', '192.168.1.50', 5)]), NOW, '127.0.0.1'), true,
      'the box\'s own LAN address counts when the app reaches the box at another one, as on the page');
  });

  test('another device that asked within 7 days on the box\'s clock: the router points here', () => {
    assert.equal(routerPointsHere(m([phone, dev(2, 'aa:bb:cc:00:00:02', '192.168.1.22', 400)]), NOW, '192.168.1.50'), true);
    assert.equal(routerPointsHere(m([phone, dev(2, 'aa:bb:cc:00:00:02', '192.168.1.22', 7 * DAY)]), NOW, '192.168.1.50'), true, '7 days exactly');
    assert.equal(routerPointsHere(m([phone, dev(2, 'aa:bb:cc:00:00:02', '192.168.1.22', 7 * DAY + 1)]), NOW, '192.168.1.50'), false, 'older');
    assert.equal(routerPointsHere(m([phone, dev(2, 'aa:bb:cc:00:00:02', '192.168.1.22', -1)]), NOW, '192.168.1.50'), false, 'never asked');
    assert.equal(routerPointsHere(m([dev(2, 'aa:bb:cc:00:00:02', '192.168.1.22', 400)]), NOW + 8 * DAY, '192.168.1.50'), false,
      'judged on the box\'s clock: the same device is old a week later');
  });

  test('without /api/info/client (myIp \'\'), the parent\'s phone counts like any other device', () => {
    assert.equal(routerPointsHere(m([phone], ''), NOW, '192.168.1.50'), true);
  });
});

describe('the setup list (app.js renderSetup, line 1027)', () => {
  const quiet = [dev(1, 'aa:bb:cc:00:00:01', '192.168.1.21', 30)];
  const base = { devices: quiet, myIp: '192.168.1.21', kids: [] as unknown[], state: defaultState() };

  test('four steps with a counter address, the password done (box_smoke.py)', () => {
    const l = setupList(base, info(true), NOW, '192.168.1.50');
    assert.deepEqual(l.items, [{ id: 'pw', done: true }, { id: 'router', done: false }, { id: 'child', done: false }, { id: 'counter', done: false }]);
    assert.deepEqual([l.doneCount, l.all, l.save, l.hide], [1, false, false, false]);
  });

  test('three steps when box.json says no counter address is set, or on an older box with no box.json', () => {
    for (const bi of [info(false), null]) {
      const l = setupList(base, bi, NOW, '192.168.1.50');
      assert.deepEqual(l.items.map((i) => i.id), ['pw', 'router', 'child']);
      assert.equal(l.doneCount, 1);
    }
  });

  test('the counter is done once answered, yes or not now (telemetry.on is not null)', () => {
    for (const on of [true, false]) {
      const state = defaultState(); state.telemetry = { on };
      assert.equal(setupList({ ...base, state }, info(true), NOW, '').items[3].done, true, String(on));
    }
  });

  test('everything done: the page writes setup.done and hides the list; once written it stays hidden', () => {
    const state = defaultState(); state.telemetry = { on: false };
    const all = { devices: [...quiet, dev(9, 'aa:bb:cc:00:00:05', '192.168.1.33', 20, 'TV')], myIp: '192.168.1.21', kids: [{}], state };
    const l = setupList(all, info(true), NOW, '192.168.1.50');
    assert.deepEqual([l.doneCount, l.all, l.save, l.hide], [4, true, true, true]);
    state.setup = { done: true };
    assert.deepEqual([setupList(all, info(true), NOW, '').save, setupList(all, info(true), NOW, '').hide], [false, true]);
  });

  test('dismissed (setup.done) with steps left: hidden, and nothing to write', () => {
    const state = defaultState(); state.setup = { done: true };
    const l = setupList({ ...base, state }, info(true), NOW, '');
    assert.deepEqual([l.all, l.save, l.hide], [false, false, true]);
  });
});

test('the router\'s number (app.js renderHelp, line 485): box.json\'s address, else the address the app reached it at, never a name', () => {
  assert.equal(routerAddress(info(true), '127.0.0.1'), '192.168.1.50');
  assert.equal(routerAddress(null, '192.168.1.60'), '192.168.1.60');
  assert.equal(routerAddress(parseBoxInfo({ v: 1, ip: 'sinko.local' }), '192.168.1.60'), '192.168.1.60', 'box.json\'s ip is only an IPv4');
  assert.equal(routerAddress(null, 'sinko.local'), '');
  assert.equal(routerAddress(null, '127.0.0.1'), '', 'not loopback (the mock box in development)');
  assert.equal(routerAddress(null, ''), '');
});

describe('the picker (app.js renderPicker, line 919)', () => {
  const kidRow: ClientRow = { id: 1, client: 'AA:BB:CC:00:00:01', comment: 'Sara', groups: KID };
  const ipKid: ClientRow = { id: 2, client: '192.168.1.40', comment: '', groups: KID };
  const notKid: ClientRow = { id: 3, client: 'aa:bb:cc:00:00:03', comment: 'mine', groups: [0] };
  const devices = [
    dev(1, 'aa:bb:cc:00:00:01', '192.168.1.21', 30, 'Sara-iPad', 'Apple, Inc.'),        // a child's device by MAC (any case)
    dev(2, 'aa:bb:cc:00:00:02', '192.168.1.22', 400, 'ali-galaxy', 'Samsung'),
    dev(3, 'aa:bb:cc:00:00:03', '192.168.1.23', 50, null, 'Lenovo'),                   // a client row, but not a child's: offered
    dev(4, 'aa:bb:cc:00:00:04', '192.168.1.40', 10, 'tv'),                             // its IP is a child's row
    dev(5, 'ip-192.168.1.30', '192.168.1.30', 5000),                                    // no MAC: added by its IPv4
    { id: 6, hwaddr: 'ip-fe80::1', macVendor: '', lastQuery: NOW - 20, ips: [{ ip: 'fe80::1', name: 'v6-only' }] },     // IPv6 only: nothing to add it by
    dev(7, 'aa:bb:cc:00:00:07', '192.168.1.27', 31 * DAY, 'old'),                       // asked more than 30 days ago
    dev(8, 'aa:bb:cc:00:00:08', '192.168.1.28', -1, 'never'),                           // never asked
  ];
  const model = { clients: [kidRow, ipKid, notKid], groups, devices, myIp: '192.168.1.23' };

  test('devices that are not a child\'s yet, asked within 30 days on the box\'s clock, newest first', () => {
    assert.deepEqual(pickerDevices(model, NOW).map((d) => d.id), [3, 2, 5]);
  });

  test('at most 25', () => {
    const many = Array.from({ length: 30 }, (_, i) => dev(100 + i, 'aa:bb:cc:00:01:' + String(i).padStart(2, '0'), '192.168.2.' + i, i + 1));
    const list = pickerDevices({ clients: [], groups, devices: many }, NOW);
    assert.equal(list.length, 25);
    assert.equal(list[0].id, 100, 'the newest first');
  });

  test('what each button says: the host name, else the maker, else the address; "This device" for the parent\'s phone', () => {
    const e = pickerEntries(model, NOW);
    assert.deepEqual(e.map((x) => [x.addr, x.label, x.name, x.mine, x.ip, x.vendor]), [
      ['AA:BB:CC:00:00:03', 'Lenovo', '', true, '192.168.1.23', 'Lenovo'],
      ['AA:BB:CC:00:00:02', 'ali-galaxy', 'ali-galaxy', false, '192.168.1.22', 'Samsung'],
      ['192.168.1.30', '192.168.1.30', '', false, '192.168.1.30', ''],
    ]);
  });
});

describe('the request of app.js submitDevice (line 969)', () => {
  const model = (clients: ClientRow[]) => ({ clients, groups, services });

  test('a new row: POST with every group a child\'s device needs, and the name', () => {
    assert.deepEqual(KID, [0, 1, 2, 3, 10, 11], 'Default, pb-kids, pb-guard, pb-offline and every app\'s group');
    assert.deepEqual(deviceRequest(model([]), 'AA:BB:CC:00:00:77', '  Tablet '),
      { method: 'POST', path: '/api/clients', body: { client: 'AA:BB:CC:00:00:77', comment: 'Tablet', groups: KID } });
    assert.deepEqual(deviceRequest(model([]), '192.168.1.30', ''), { method: 'POST', path: '/api/clients', body: { client: '192.168.1.30', comment: '', groups: KID } });
  });

  test('an existing row (any case): PUT, its own groups kept first, the child\'s added once, its name kept when none is typed', () => {
    const row: ClientRow = { id: 4, client: 'aa:bb:cc:00:00:03', comment: 'Lenovo tab', groups: [0, 7, 3] };
    assert.deepEqual(deviceRequest(model([row]), 'AA:BB:CC:00:00:03', ''),
      { method: 'PUT', path: '/api/clients/aa%3Abb%3Acc%3A00%3A00%3A03', body: { comment: 'Lenovo tab', groups: [0, 7, 3, 1, 2, 10, 11] } });
    assert.deepEqual(deviceRequest(model([row]), 'AA:BB:CC:00:00:03', 'Omar').body.comment, 'Omar');
    assert.deepEqual(deviceRequest(model([{ ...row, comment: null }]), 'aa:bb:cc:00:00:03', '').body, { comment: '', groups: [0, 7, 3, 1, 2, 10, 11] });
  });
});
