// The shared state and the learned rules, against Sinko's own fixtures (copied by `npm run sync-contract`, never edited here).
// Port of Sinko tests/state-contract.test.js (all of it) and the learned-rules test of tests/pb-core.test.js.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as C from '../../src/core';
import { FIXTURES, fixture } from '../helpers';

type StateCase = { name: string; input: unknown; expected: unknown };
type LearnedCase = { name: string; domains: unknown; expected: unknown };
const CASES = fixture<{ cases: StateCase[] }>('state-cases.json').cases;
const LEARNED = fixture<{ cases: LearnedCase[] }>('learned-rule-cases.json').cases;

test('the fixtures are exactly the files synced from Sinko (sinko-contract.json)', () => {
  const record = fixture<{ sinkoVersion: string; files: Record<string, string> }>('sinko-contract.json');
  assert.match(record.sinkoVersion, /^\d+\.\d+\.\d+$/);
  for (const [name, sha] of Object.entries(record.files)) {
    assert.equal(createHash('sha256').update(readFileSync(join(FIXTURES, name))).digest('hex'), sha, name + ' was changed by hand: run npm run sync-contract');
  }
});

describe('state-cases.json', () => {
  test('the fixture file is not empty', () => { assert.ok(CASES.length > 20); });
  test.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    assert.deepEqual(C.parseState(c.input), c.expected);
  });
});

describe('learned-rule-cases.json', () => {
  test('the fixture file is not empty', () => { assert.ok(LEARNED.length >= 5); });
  test.each(LEARNED.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    assert.deepEqual(C.learnedRules(c.domains), c.expected);
  });
  test('no rows, and the zone of a rule', () => {
    assert.deepEqual(C.learnedRules(null), []);
    assert.equal(C.regexZone('(^|\\.)tiktok-minis\\.us$'), 'tiktok-minis.us');
    assert.equal(C.regexZone('^.*$'), null);
  });
});

// ------------------------------------------------------------------ Sinko tests/state-contract.test.js
test('normalising twice changes nothing', () => {
  for (const c of CASES) {
    const once = C.parseState(c.input);
    assert.deepEqual(C.parseState(JSON.stringify(once)), once, c.name);
  }
});

test('an empty or missing description gives the default state, and every call gets its own copy', () => {
  assert.deepEqual(C.parseState(''), C.defaultState());
  assert.deepEqual(C.parseState(null), C.defaultState());
  assert.deepEqual(C.parseState(undefined), C.defaultState());
  const a = C.defaultState();
  a.schedule.days.push(9);
  a.update.auto = true;
  assert.deepEqual(C.defaultState().schedule.days, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(C.defaultState().update.auto, false);
});

test('a read-modify-write of one field keeps every other field the scheduler wrote', () => {
  const stored = JSON.stringify({
    v: 1, timer: { mode: 'block', until: 1800000500, snapshot: { services: { youtube: true, tiktok: false }, offline: true } },
    schedule: { enabled: true, start: '22:00', end: '06:30', days: [0, 1, 2, 3, 4] }, scheduleActive: true,
    update: { auto: true, request: null, checkRequest: 1800000001234, latest: '3.1.0',
      notes: 'https://github.com/iret33/sinko/releases/tag/v3.1.0', checked: 1800000000, status: 'running', from: '3.0.0', to: '3.1.0',
      at: 1800000100, error: null, rolledBack: null },
    power: { request: null, action: null }, telemetry: { on: true }, community: { online: 1234, at: 1800000000 }, setup: { done: true },
    learn: { on: true },
  });
  const st = C.parseState(stored);
  st.setup.done = false;                                   // the one thing this write edits
  const expected = JSON.parse(stored);
  expected.setup.done = false;
  assert.deepEqual(C.parseState(JSON.stringify(st)), expected);
});

test('values the scheduler would drop are dropped here too (nothing from the state is ever trusted)', () => {
  const s = C.parseState(JSON.stringify({
    update: { notes: 'https://evil.example/x', latest: '3.1.0; rm -rf /', status: 'exploded', error: 'x'.repeat(500) },
    power: { action: 'rm', request: 5 }, hello: 1,
  }));
  assert.equal(s.update.notes, null);
  assert.equal(s.update.latest, null);
  assert.equal(s.update.status, 'idle');
  assert.equal((s.update.error as string).length, 200);
  assert.deepEqual(s.power, { request: null, action: null });
  assert.equal('hello' in s, false);
});

test('characters, not UTF-16 units, are counted for markers and the error text', () => {
  const emoji = '\u{1F600}';
  assert.equal(C.parseState(JSON.stringify({ update: { request: emoji.repeat(40) } })).update.request, emoji.repeat(40), '40 characters are fine');
  assert.equal(C.parseState(JSON.stringify({ update: { request: emoji.repeat(41) } })).update.request, null, '41 are not');
  const err = C.parseState(JSON.stringify({ update: { status: 'failed', error: emoji.repeat(300) } })).update.error as string;
  assert.equal(Array.from(err).length, 200, 'cut at 200 characters');
  assert.ok(!/[\uD800-\uDBFF]$/.test(err), 'never in the middle of a character');
});

test('Python truthiness for the few flags the scheduler coerces with bool()', () => {
  const s = C.parseState(JSON.stringify({ scheduleActive: [], schedule: { enabled: {} } }));
  assert.equal(s.scheduleActive, false);
  assert.equal(s.schedule.enabled, false);
  assert.equal(C.parseState(JSON.stringify({ scheduleActive: 'x' })).scheduleActive, true);
  assert.equal(C.parseState(JSON.stringify({ scheduleActive: 1 })).scheduleActive, true);
});

test('bedtime values are validated: times in range, days unique and sorted', () => {
  const s = C.parseState(JSON.stringify({ schedule: { enabled: true, start: '25:00', end: '06:61', days: [3, 1, 1, 9, -1, 2.5, 'x', 6] } }));
  assert.equal(s.schedule.start, '21:00', 'an impossible hour keeps the default');
  assert.equal(s.schedule.end, '06:00', 'an impossible minute keeps the default');
  assert.deepEqual(s.schedule.days, [1, 3, 6]);
  assert.deepEqual(C.parseState(JSON.stringify({ schedule: { days: 'all' } })).schedule.days, [0, 1, 2, 3, 4, 5, 6], 'days that are not a list keep the default');
});

test('editState: re-reads what is stored now, changes only what the mutator touches, and never stores what the schema forbids', () => {
  const stored = JSON.stringify({ update: { auto: true, latest: '3.1.0', status: 'running', from: '3.0.0', to: '3.1.0', at: 1800000100 },
    telemetry: { on: false }, community: { online: 9, at: 1800000000 }, setup: { done: true }, hello: 'dropped' });
  const out = C.editState(stored, (st) => { st.schedule.enabled = true; st.update.request = 1800000999000; });
  const back = JSON.parse(out.json);
  assert.deepEqual(back, out.state, 'json and state agree');
  assert.equal(back.schedule.enabled, true);
  assert.equal(back.update.request, 1800000999000);
  assert.equal(back.update.auto, true);
  assert.equal(back.update.latest, '3.1.0');
  assert.equal(back.update.status, 'running');
  assert.deepEqual(back.telemetry, { on: false });
  assert.deepEqual(back.community, { online: 9, at: 1800000000 });
  assert.deepEqual(back.setup, { done: true });
  assert.equal('hello' in back, false);
  // A bug in a caller cannot put a link, a command or a bad action into the state.
  const bad = C.editState(stored, (st) => {
    st.update.notes = 'javascript:alert(1)';
    (st as unknown as { power: unknown }).power = { request: 5, action: 'format' };
    (st.update as unknown as { status: string }).status = 'hacked';
  });
  assert.equal(bad.state.update.notes, null);
  assert.deepEqual(bad.state.power, { request: null, action: null });
  assert.equal(bad.state.update.status, 'idle');
});

test('update.rolledBack: only a real boolean is kept, and a write about something else keeps what the scheduler said', () => {
  const parse = (raw: unknown) => C.parseState(JSON.stringify({ update: { status: 'failed', rolledBack: raw } })).update.rolledBack;
  for (const [raw, want] of [[true, true], [false, false], [null, null], ['true', null], ['false', null], [1, null], [0, null], [[], null], [{}, null]] as const) {
    assert.equal(parse(raw), want, JSON.stringify(raw));
  }
  assert.equal(C.parseState('{}').update.rolledBack, null, 'a state with no such key is "not known"');
  assert.equal(C.defaultState().update.rolledBack, null);
  const stored = JSON.stringify({ update: { status: 'failed', error: 'x', rolledBack: false } });
  assert.equal(C.editState(stored, (st) => { st.setup.done = true; st.update.request = 5; }).state.update.rolledBack, false, 'the page writing the state keeps it');
  assert.equal(C.editState(stored, (st) => { (st.update as unknown as { rolledBack: unknown }).rolledBack = 'yes'; }).state.update.rolledBack, null,
    'a bug in a caller cannot store a claim of recovery');
});
