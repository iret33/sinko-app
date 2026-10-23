// "Check this device" (src/state/deviceCheck.ts) on a fake box whose clock is three hours ahead of the phone's: the check follows the query
// log from the tap on the BOX's clock, passes on the first query from the device, and only after a minute also takes lastQuery.
import assert from 'node:assert/strict';

import { BoxClock } from '../../src/api/client';
import { DEVICE_CHECK, createDeviceCheck, type DeviceCheckState } from '../../src/state/deviceCheck';

const PHONE = 1700000000000;                 // the phone's clock at the tap (ms)
const SKEW = 3 * 3600;                       // the box is three hours ahead (s)
const TAP = Math.floor(PHONE / 1000) + SKEW; // the tap on the box's clock (s)

type Row = { id: number; time: number; status: string; domain: string; client: { ip: string; name: null } };

/** A box: its query log and network table (times on its own clock), the requests it was sent, and the phone's clock and timers. */
function fakeBox() {
  let phone = PHONE;
  const clock = new BoxClock(() => phone);
  clock.note(SKEW * 1000);
  const log: Row[] = [];
  const devices: { hwaddr: string; lastQuery: number; ips: { ip: string; name: null }[]; macVendor: string; id: number }[] = [];
  const asked: string[] = [];
  const timers: { at: number; f: () => void }[] = [];
  let remote = '192.168.1.9';
  let id = 0;
  const call = async <T,>(method: string, path: string): Promise<T> => {
    asked.push(method + ' ' + path);
    const url = new URL(path, 'http://box');
    if (url.pathname === '/api/queries') {
      const from = Number(url.searchParams.get('from'));
      return { queries: log.filter((q) => q.time >= from).sort((a, b) => b.id - a.id).slice(0, Number(url.searchParams.get('length'))), cursor: id } as T;
    }
    if (url.pathname === '/api/network/devices') return { devices } as T;
    if (url.pathname === '/api/info/client') return { remote_addr: remote } as T;
    throw new Error('not asked for: ' + path);
  };
  return {
    clock, log, devices, asked, timers,
    setRemote: (ip: string) => { remote = ip; },
    query: (ip: string, boxSec: number) => { log.push({ id: ++id, time: boxSec, status: 'FORWARDED', domain: 'example.com', client: { ip, name: null } }); },
    /** The phone's clock moves on by `ms`, and the timers that are due run (each look waits for its answers). */
    async advance(ms: number) {
      const end = phone + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        phone = next.at;
        next.f();
        await this.flush();
      }
      phone = end;
    },
    /** Lets a look that was started finish (its answers are promises). */
    async flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); },
    check: () => createDeviceCheck({ call, clock, now: () => phone, setTimeout: (f, ms) => { timers.push({ at: phone + ms, f }); return timers.length; },
      clearTimeout: () => { timers.length = 0; } }),
  };
}
const phase = (s: DeviceCheckState) => s.phase;

test('the log is followed from the tap on the box\'s clock, not the phone\'s', async () => {
  const box = fakeBox();
  const c = box.check();
  await c.start({ kind: 'device', ips: ['192.168.1.22'] });
  assert.deepEqual(c.state.get(), { phase: 'watching', since: TAP, ips: ['192.168.1.22'], slow: false });
  assert.equal(box.asked[0], 'GET /api/queries?from=' + TAP + '&length=200', 'from = the tap, on the box\'s clock (three hours ahead of the phone)');
  c.stop();
});

test('a query from the device after the tap passes at once; one from before the tap, or from another device, does not', async () => {
  const box = fakeBox();
  box.query('192.168.1.22', TAP - 5);                                 // before the tap
  box.query('192.168.1.22', TAP - SKEW + 30);                         // "after the tap" only on the phone's clock
  box.query('192.168.1.40', TAP + 1);                                 // another device
  const c = box.check();
  await c.start({ kind: 'device', ips: ['192.168.1.22', 'fe80::22'] });
  assert.equal(phase(c.state.get()), 'watching');
  await box.advance(DEVICE_CHECK.every);
  assert.equal(phase(c.state.get()), 'watching');
  box.query('fe80::22', TAP + 3.25);                                  // any of the device's addresses
  await box.advance(DEVICE_CHECK.every);
  assert.deepEqual(c.state.get(), { phase: 'passed', via: 'query', ip: 'fe80::22', at: TAP + 3.25 });
  assert.ok(!box.asked.some((a) => a.startsWith('GET /api/network/devices')), 'lastQuery was not needed');
  assert.equal(box.timers.length, 0, 'nothing more is asked');
});

test('lastQuery is taken only after a minute (FTL writes it late), and only from after the tap', async () => {
  const box = fakeBox();
  box.devices.push({ id: 2, hwaddr: 'aa:bb:cc:00:00:02', macVendor: '', lastQuery: TAP + 2, ips: [{ ip: '192.168.1.22', name: null }] });
  const c = box.check();
  await c.start({ kind: 'device', ips: ['192.168.1.22'] });
  await box.advance(DEVICE_CHECK.lastQueryAfter - DEVICE_CHECK.every);
  assert.equal(phase(c.state.get()), 'watching', 'the query log is the way for the first minute');
  assert.ok(!box.asked.some((a) => a.startsWith('GET /api/network/devices')));
  await box.advance(DEVICE_CHECK.every);
  assert.deepEqual(c.state.get(), { phase: 'passed', via: 'lastQuery', ip: '192.168.1.22', at: TAP + 2 });
});

test('a lastQuery from before the tap never passes; after three minutes the box has not heard from the device', async () => {
  const box = fakeBox();
  box.devices.push({ id: 2, hwaddr: 'aa:bb:cc:00:00:02', macVendor: '', lastQuery: TAP - 1, ips: [{ ip: '192.168.1.22', name: null }] });
  const c = box.check();
  await c.start({ kind: 'device', ips: ['192.168.1.22'] });
  await box.advance(DEVICE_CHECK.lastQueryAfter);
  assert.deepEqual(c.state.get(), { phase: 'watching', since: TAP, ips: ['192.168.1.22'], slow: true }, 'still looking, and says so');
  await box.advance(DEVICE_CHECK.giveUpAfter - DEVICE_CHECK.lastQueryAfter);
  assert.deepEqual(c.state.get(), { phase: 'notSeen', ips: ['192.168.1.22'] });
  assert.equal(box.timers.length, 0);
});

test('the phone that runs the app is the address the box sees it at (/api/info/client)', async () => {
  const box = fakeBox();
  box.setRemote('192.168.1.9');
  const c = box.check();
  await c.start({ kind: 'thisPhone' });
  assert.equal(box.asked[0], 'GET /api/info/client');
  box.query('192.168.1.9', TAP + 1);
  await box.advance(DEVICE_CHECK.every);
  assert.deepEqual(c.state.get(), { phase: 'passed', via: 'query', ip: '192.168.1.9', at: TAP + 1 });
  box.setRemote('');
  await c.start({ kind: 'thisPhone' });
  assert.deepEqual(c.state.get(), { phase: 'failed' }, 'no address: the check cannot start');
});

test('the app comes back after a while: what happened meanwhile is read before the time is judged', async () => {
  const box = fakeBox();
  const c = box.check();
  await c.start({ kind: 'device', ips: ['192.168.1.22'] });
  const pending = box.timers.splice(0);                       // the app is in the background: its timer does not run
  box.query('192.168.1.22', TAP + 100);
  await box.advance(DEVICE_CHECK.giveUpAfter + 60000);       // four minutes later the app is back, and the timer runs
  pending[0].f();
  await box.flush();
  assert.deepEqual(c.state.get(), { phase: 'passed', via: 'query', ip: '192.168.1.22', at: TAP + 100 }, 'not "has not heard from it"');
});

test('stop() ends the check: a late answer changes nothing', async () => {
  const box = fakeBox();
  const c = box.check();
  await c.start({ kind: 'device', ips: ['192.168.1.22'] });
  c.stop();
  box.query('192.168.1.22', TAP + 1);
  await box.advance(DEVICE_CHECK.every * 3);
  assert.equal(phase(c.state.get()), 'watching');
});
