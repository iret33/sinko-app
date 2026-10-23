// The address helpers and group rules ported from Sinko web/app.js. They are private inside the page, so Sinko has no unit tests of
// its own for them: these cases follow the comments in app.js and the Python twins in bin/sinko (shadowing_rows, parse_ip, parse_net,
// device_ips; Sinko tests/test_diagnostics.py MatchingHelpers), with the shapes of /api/clients and /api/network/devices.
import assert from 'node:assert/strict';

import * as C from '../../src/core';
import type { CatalogService, ClientRow, Device, Group } from '../../src/core';

const group = (id: number, name: string): Group => ({ id, name, enabled: true, comment: null });
const byName: Record<string, Group> = {};
[group(0, 'Default'), group(1, 'pb-kids'), group(2, 'pb-guard'), group(3, 'pb-offline'), group(4, 'pb-paused'), group(5, 'pb-state'),
  group(6, 'pb-svc-youtube'), group(7, 'pb-svc-tiktok')].forEach((g) => { byName[g.name] = g; });
const services = [{ id: 'youtube' }, { id: 'tiktok' }, { id: 'roblox' }] as CatalogService[];      // roblox has no group on this box
const row = (id: number, client: string, groups: number[], comment: string | null = null): ClientRow => ({ id, client, comment, groups });
const device = (hwaddr: string, ips: string[], name: string | null = null): Device =>
  ({ id: 1, hwaddr, macVendor: '', lastQuery: 0, ips: ips.map((ip) => ({ ip, name })) });

test('MAC and IPv4 patterns (app.js MAC_RE, IPV4_RE)', () => {
  assert.ok(C.MAC_RE.test('aa:bb:cc:00:00:01') && C.MAC_RE.test('AA-BB-CC-00-00-01'));
  assert.ok(!C.MAC_RE.test('192.168.1.1') && !C.MAC_RE.test('sara-ipad') && !C.MAC_RE.test('aa:bb:cc:00:00'));
  assert.ok(C.IPV4_RE.test('192.168.1.20') && !C.IPV4_RE.test('192.168.1.256') && !C.IPV4_RE.test('1.2.3'));
});

test('parsing addresses: IPv4, IPv6 with :: and a zone, an IPv4 tail, and nothing else', () => {
  assert.deepEqual(C.parseIpv4('192.168.1.9'), [192, 168, 1, 9]);
  assert.equal(C.parseIpv4('192.168.1.300'), null);
  assert.equal(C.parseIpv4('192.168.1'), null);
  assert.deepEqual(C.parseIp('fe80::1%eth0'), [0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 'the zone is ignored');
  assert.deepEqual(C.parseIp('::ffff:192.168.1.9'), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 192, 168, 1, 9], 'an IPv4 tail');
  assert.deepEqual(C.parseIp('2001:db8:0:0:0:0:0:23'), C.parseIp('2001:db8::23'));
  for (const bad of ['', null, 'sara-ipad', 'AA:BB:CC:00:00:01', '1::2::3', '2001:db8::12345', ':eth0', '1.2.3.4.5']) assert.equal(C.parseIp(bad), null, String(bad));
});

test('subnets: a row that is an address or a CIDR range; MAC, name and interface rows are not', () => {
  assert.deepEqual(C.parseNet('192.168.1.9/24'), { bytes: [192, 168, 1, 9], bits: 24 });
  assert.equal(C.parseNet('192.168.1.9')?.bits, 32);
  assert.equal(C.parseNet('fd00::/8')?.bits, 8);
  for (const bad of ['AA:BB:CC:00:00:01', 'sara-ipad', ':eth0', '192.168.1.9/33', '192.168.1.9/x', '1.2.3.4/8/8']) assert.equal(C.parseNet(bad), null, bad);
  const net = C.parseNet('192.168.1.0/25') as C.Net;
  assert.ok(C.inNet([192, 168, 1, 127], net));
  assert.ok(!C.inNet([192, 168, 1, 128], net));
  assert.ok(!C.inNet(C.parseIp('fd00::1') as number[], net), 'an IPv6 address is never in an IPv4 range');
  assert.ok(C.inNet([10, 1, 2, 3], C.parseNet('0.0.0.0/0') as C.Net));
});

test('the row FTL uses for an address: the longest prefix, then the highest id', () => {
  const clients = [row(10, '192.168.1.0/24', [0]), row(11, '192.168.0.0/16', [0]), row(12, 'AA:BB:CC:00:00:01', [0, 1]), row(13, '192.168.1.0/24', [0])];
  assert.equal(C.winningRow([192, 168, 1, 21], clients)?.id, 13, 'two /24 rows: the newer one');
  assert.equal(C.winningRow([192, 168, 2, 21], clients)?.id, 11);
  assert.equal(C.winningRow([10, 0, 0, 1], clients), null);
  assert.equal(C.winningRow([192, 168, 1, 21], [...clients, row(14, '192.168.1.21', [0])])?.id, 14, 'an exact address beats a range');
});

test('a device\'s addresses include the one in an "ip-" hardware address', () => {
  assert.deepEqual(C.deviceIps({ hwaddr: 'ip-fd00::9', ips: [] }), ['fd00::9']);
  assert.deepEqual(C.deviceIps({ hwaddr: 'ip-192.168.1.30', ips: [{ ip: '192.168.1.30', name: '' }] }), ['192.168.1.30'], 'not twice');
  assert.deepEqual(C.deviceIps({ hwaddr: 'aa:bb:cc:00:00:01', ips: [{ ip: '192.168.1.21', name: null }, { ip: '', name: null }] }), ['192.168.1.21']);
});

test('the pb groups a child\'s row must have, and the ones a new child gets', () => {
  assert.deepEqual(C.neededGroupIds(byName, false, services), [1, 2, 3, 6, 7], 'kids, guard, offline and the groups of the apps on this box');
  assert.deepEqual(C.neededGroupIds(byName, true, services), [1, 2, 3, 4, 6, 7], 'a paused child also needs pb-paused');
  const model = { groups: byName, services: [{ group: byName['pb-svc-youtube'] }, { group: byName['pb-svc-tiktok'] }] };
  assert.deepEqual(C.kidGroupIds(model), [0, 1, 2, 3, 6, 7], 'Default first, never pb-paused or pb-state');
  const noGuard = { ...byName }; delete noGuard['pb-guard'];
  assert.deepEqual(C.kidGroupIds({ groups: noGuard, services: [] }), [0, 1, 3], 'a group the box does not have is left out');
});

test('shadow rows: an IP or subnet row without the child\'s groups overrides its MAC row', () => {
  const mac = 'AA:BB:CC:00:00:01';
  const devices = [device('aa:bb:cc:00:00:01', ['192.168.1.21', 'fd00::21'], 'Sara-iPad')];
  const full = [0, 1, 2, 3, 6, 7];
  assert.deepEqual(C.shadowRowsFor(mac, devices, [row(1, mac, full)], byName, false, services), [], 'only its own row: protected');
  const lan = row(2, '192.168.1.0/24', [0]);
  assert.deepEqual(C.shadowRowsFor(mac, devices, [row(1, mac, full), lan], byName, false, services), [lan], 'a /24 row of the owner overrides it');
  assert.deepEqual(C.shadowRowsFor(mac.toLowerCase(), devices, [lan], byName, false, services), [lan], 'the MAC is matched without case');
  const good = row(3, '192.168.1.21', full);
  assert.deepEqual(C.shadowRowsFor(mac, devices, [row(1, mac, full), lan, good], byName, false, services), [], 'a duplicate row that carries every group filters correctly');
  assert.deepEqual(C.shadowRowsFor(mac, devices, [row(1, mac, full), lan, good], byName, true, services), [good], 'but not once the child is paused');
  const v6 = row(4, 'fd00::/64', [0]);
  assert.deepEqual(C.shadowRowsFor(mac, devices, [lan, v6], byName, false, services), [lan, v6], 'each overriding row once, in address order');
  assert.deepEqual(C.shadowRowsFor('192.168.1.21', devices, [lan], byName, false, services), [], 'a child registered by IP is not a MAC row');
  assert.deepEqual(C.shadowRowsFor('AA:BB:CC:00:00:99', devices, [lan], byName, false, services), [], 'a device the box has not seen');
});

test('a device\'s label is the first name FTL knows', () => {
  assert.equal(C.deviceLabel(device('aa:bb:cc:00:00:01', ['192.168.1.21', '192.168.1.22'], 'Sara-iPad')), 'Sara-iPad');
  assert.equal(C.deviceLabel({ ips: [{ ip: '1.1.1.1', name: '' }, { ip: '1.1.1.2', name: 'second' }] }), 'second');
  assert.equal(C.deviceLabel({ ips: [] }), '');
  assert.equal(C.deviceLabel(null), '');
});

test('a typed address is tidied: a MAC with colons in capitals, an IPv4 as it is, an IPv6 in small letters, anything else refused', () => {
  assert.equal(C.normalizeAddr(' a4-83-e7-12-34-56 '), 'A4:83:E7:12:34:56');
  assert.equal(C.normalizeAddr('192.168.1.20'), '192.168.1.20');
  assert.equal(C.normalizeAddr('FD00::21'), 'fd00::21');
  for (const bad of ['', null, undefined, 'sara', '192.168.1.256', '::', 'g::1', '1.2.3']) assert.equal(C.normalizeAddr(bad), null, String(bad));
});

test('the address to register a device by: its MAC, else its IPv4, never an IPv6 that a phone will rotate', () => {
  assert.equal(C.deviceAddr(device('aa:bb:cc:00:00:01', ['192.168.1.21'])), 'AA:BB:CC:00:00:01');
  assert.equal(C.deviceAddr(device('ip-192.168.1.30', ['192.168.1.30'])), '192.168.1.30');
  assert.equal(C.deviceAddr(device('ip-fd00::9', ['fd00::9', '192.168.1.31'])), '192.168.1.31', 'an IPv6 entry with an IPv4 address');
  assert.equal(C.deviceAddr(device('ip-fd00::9', ['fd00::9'])), '', 'IPv6 only: nothing to offer');
});
