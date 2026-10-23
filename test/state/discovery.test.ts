// Finding the box (src/state/discovery.ts) on a made-up home network: Bonjour, the .local names, the scan of the /24 and typing an address.
// The real probe against the mock box is at the end.
import assert from 'node:assert/strict';

import { createHostGuard } from '../../src/api/hosts';
import { parseBoxInfo, type BoxInfo } from '../../src/core/box';
import type { Box } from '../../src/state/boxes';
import { SCAN, SLOW_MS, createDiscovery, probeHost, subnetAddresses, type BonjourService, type DiscoveryDeps, type Probe } from '../../src/state/discovery';
import { startMockBox, type MockBox } from '../mockBox';

const ID = '0123456789abcdef0123456789abcdef';
const info = (o: Record<string, unknown>) => parseBoxInfo({ v: 1, version: '3.2.0', api: 1, at: 5, ...o }) as BoxInfo;
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A home network: which addresses answer what. Records every probe and the most at once. */
function network(hostsAt: Record<string, Probe>, delayMs = 1) {
  const probed: string[] = [];
  let open = 0, most = 0;
  const probe = async (ip: string, port: number, timeoutMs: number): Promise<Probe> => {
    probed.push(ip + ':' + port + '/' + timeoutMs);
    open++; most = Math.max(most, open);
    await new Promise((r) => setTimeout(r, delayMs));
    open--;
    return hostsAt[ip + ':' + port] || { kind: 'none' };
  };
  return { probe, probed, most: () => most };
}

function deps(over: Partial<DiscoveryDeps> & { probe: DiscoveryDeps['probe'] }): DiscoveryDeps {
  return {
    hosts: createHostGuard({ dev: false, lookup: async (n) => (n === 'sinko.local' ? ['192.168.1.50'] : n === 'kids.local' ? ['192.168.1.60'] : []) }),
    network: async () => ({ wifi: true, ip: '192.168.1.35' }),
    saved: () => [],
    ...over,
  };
}

test('the /24 of the phone: 253 addresses, never the phone itself', () => {
  const all = subnetAddresses('192.168.1.35');
  assert.equal(all.length, 253);
  assert.ok(!all.includes('192.168.1.35') && !all.includes('192.168.1.0') && !all.includes('192.168.1.255'));
  assert.equal(all[0], '192.168.1.1');
  assert.deepEqual(subnetAddresses('100.64.3.4'), [], 'not a home network: nothing to scan');
  assert.deepEqual(subnetAddresses(''), []);
});

test('Bonjour, sinko.local and the scan run at once; one box found three ways is listed once, by its boxId', async () => {
  const net = network({ '192.168.1.50:80': { kind: 'sinko', info: info({ boxId: ID, hostname: 'sinko' }) } });
  let announce: ((s: BonjourService) => void) | null = null;
  const d = createDiscovery(deps({
    probe: net.probe,
    bonjour: { browse: (on) => { announce = on; return () => { announce = null; }; } },
  }));
  d.start();
  assert.equal(d.state.get().running, true);
  announce!({ name: 'sinko', port: 80, addresses: ['192.168.1.50', '203.0.113.9'] });
  await new Promise((r) => setTimeout(r, 400));
  const s = d.state.get();
  assert.equal(s.running, false, 'the scan is over (Bonjour goes on until stop)');
  assert.equal(s.boxes.length, 1);
  assert.deepEqual(s.boxes[0].via.slice().sort(), ['bonjour', 'local', 'scan']);
  assert.equal(s.boxes[0].key, ID);
  assert.equal(s.boxes[0].info.hostname, 'sinko');
  assert.ok(!net.probed.some((p) => p.startsWith('203.0.113.9')), 'a public address from Bonjour is not even asked');
  assert.ok(!net.probed.some((p) => p.startsWith('192.168.1.35:')), 'the phone itself is not scanned');
  assert.ok(net.most() <= SCAN.parallel + 2, 'at most 16 scan probes at a time (' + net.most() + ', with Bonjour and sinko.local)');
  assert.ok(net.probed.filter((p) => p.endsWith('/' + SCAN.timeoutMs)).length === 253, 'each scan probe waits 1.5 s at most');
  d.stop();
  assert.equal(announce, null, 'stop() stops Bonjour');
});

test('only on Wi-Fi: on mobile data there is no scan, and the screen says why', async () => {
  const net = network({});
  const d = createDiscovery(deps({ probe: net.probe, network: async () => ({ wifi: false, ip: '' }) }));
  d.start();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(d.state.get().wifi, false);
  assert.equal(d.state.get().scan, null);
  assert.deepEqual(net.probed, ['192.168.1.50:80/3000'], 'only sinko.local was asked');
  d.stop();
});

test('a box this phone knows is recognised by its boxId at a new address, and its hostname.local is tried too', async () => {
  const saved: Box[] = [{ id: 'mine', host: '192.168.1.20', name: 'kids', lastSeen: 1, boxId: ID, hostname: 'kids' }];
  const net = network({ '192.168.1.60:80': { kind: 'sinko', info: info({ boxId: ID, hostname: 'kids' }) } });
  const d = createDiscovery(deps({ probe: net.probe, saved: () => saved, network: async () => ({ wifi: false, ip: '' }) }));
  d.start();
  await new Promise((r) => setTimeout(r, 50));
  const b = d.state.get().boxes;
  assert.equal(b.length, 1);
  assert.equal(b[0].ip, '192.168.1.60');
  assert.equal(b[0].savedId, 'mine', 'the same box: its address is updated when it is chosen, not added again');
  assert.deepEqual(b[0].via, ['local']);
  d.stop();
});

test('Pi-hole without box.json is listed apart (Sinko 2.x or plain Pi-hole), and the next step shows after about 10 s', async () => {
  const timers: { f: () => void; ms: number }[] = [];
  const net = network({ '192.168.1.9:80': { kind: 'pihole' } });
  const d = createDiscovery(deps({ probe: net.probe, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {} }));
  d.start();
  assert.equal(d.state.get().slow, false);
  assert.deepEqual(timers.map((x) => x.ms), [SLOW_MS]);
  assert.equal(SLOW_MS, 10000);
  timers[0].f();
  assert.equal(d.state.get().slow, true, 'after 10 s the screen offers typing the address');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(d.state.get().old, [{ ip: '192.168.1.9', port: 80 }]);
  assert.deepEqual(d.state.get().boxes, []);
  d.stop();
});

test('typing an address or a name: checked by the host rule first, then asked like any other', async () => {
  const net = network({
    '192.168.1.50:80': { kind: 'sinko', info: info({ hostname: '' }) },
    '192.168.1.9:80': { kind: 'pihole' },
  });
  const d = createDiscovery(deps({ probe: net.probe }));
  const found = await d.manual('sinko.local');
  assert.equal(found.kind, 'found');
  assert.equal(found.kind === 'found' && found.box.ip, '192.168.1.50');
  assert.deepEqual(await d.manual('192.168.1.9'), { kind: 'old', host: '192.168.1.9' });
  assert.deepEqual(await d.manual('192.168.1.77:8080'), { kind: 'nothing', host: '192.168.1.77:8080' });
  const pub = await d.manual('8.8.8.8');
  assert.equal(pub.kind, 'refused');
  const nobody = await d.manual('nobody.local');
  assert.equal(nobody.kind === 'refused' && /nobody\.local/.test(nobody.message), true);
  assert.equal((await d.manual('not an address')).kind, 'refused');
  assert.ok(!net.probed.some((p) => p.startsWith('8.8.8.8')), 'a public address is never asked');
});

test('iOS said no to Local Network: the screen says so', async () => {
  const net = network({});
  let denied: (() => void) | null = null;
  const d = createDiscovery(deps({ probe: net.probe, access: async () => 'unknown', bonjour: { browse: (_on, onDenied) => { denied = onDenied; return () => {}; } } }));
  d.start();
  await settle();
  denied!();
  assert.equal(d.state.get().access, 'denied');
  d.stop();
  const d2 = createDiscovery(deps({ probe: net.probe, access: async () => 'denied' }));
  d2.start();
  await settle();
  assert.equal(d2.state.get().access, 'denied');
  d2.stop();
});

describe('against the mock box', () => {
  let box: MockBox;
  beforeAll(async () => { box = await startMockBox(); });
  afterAll(async () => { await box.stop(); });

  test('the real probe: box.json that passes parseBoxInfo is a Sinko box; without box.json, /api/auth says Pi-hole', async () => {
    const port = Number(new URL(box.url).port);
    const p = await probeHost('127.0.0.1', port, 3000);
    assert.equal(p.kind, 'sinko');
    await box.dev('/box-info', { boxId: ID, hostname: 'sinko', api: 1 });
    const again = await probeHost('127.0.0.1', port, 3000);
    assert.equal(again.kind === 'sinko' && again.info.boxId, ID);
    const nothing = await probeHost('127.0.0.1', 1, 1500);
    assert.deepEqual(nothing, { kind: 'none' }, 'nobody at that port');
    await box.dev('/box-info', { reset: true });
  });

  test('a development build finds the mock box by its address too', async () => {
    const port = Number(new URL(box.url).port);
    const d = createDiscovery({ network: async () => ({ wifi: false, ip: '' }), saved: () => [], devHosts: [{ ip: '127.0.0.1', port }],
      hosts: createHostGuard({ dev: true, lookup: async () => [] }) });
    d.start();
    for (let i = 0; i < 50 && d.state.get().running; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(d.state.get().boxes.length, 1);
    assert.deepEqual(d.state.get().boxes[0].via, ['dev']);
    d.stop();
  });
});

describe('against the mock box from before Sinko 3.0 (no box.json)', () => {
  let old: MockBox;
  beforeAll(async () => { old = await startMockBox(['--old-box']); });
  afterAll(async () => { await old.stop(); });

  test('it is Pi-hole, not a Sinko box', async () => {
    assert.deepEqual(await probeHost('127.0.0.1', Number(new URL(old.url).port), 3000), { kind: 'pihole' });
  });
});
