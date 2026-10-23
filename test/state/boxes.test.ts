// The boxes list, the session ids and the kept password, with in-memory storage.
import assert from 'node:assert/strict';

import { BOXES_KEY, createBoxesStore, createSessions, newBoxId, sameHost, type KeyValueStorage } from '../../src/state';

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: async (k, v) => { data.set(k, v); },
    removeItem: async (k) => { data.delete(k); },
  };
}

test('boxes: a list of {id, host, name, lastSeen, boxId, hostname} with one selected, saved and restored', async () => {
  const storage = memory();
  let id = 0, now = 1000;
  const store = createBoxesStore(storage, { now: () => now, newId: () => 'box' + ++id });
  assert.deepEqual(await store.restore(), { boxes: [], activeId: null }, 'nothing saved yet');
  const a = await store.add(' 192.168.1.50 ', 'Home');
  assert.deepEqual(a, { id: 'box1', host: '192.168.1.50', name: 'Home', lastSeen: 0, boxId: '', hostname: '' });
  assert.equal(store.active()?.id, 'box1', 'the first box is the selected one');
  const b = await store.add('127.0.0.1:8080');
  assert.equal(store.active()?.id, 'box1', 'a second box does not take over');
  assert.equal(await store.add('HTTP://192.168.1.50/'), a, 'the same address is the same box');
  await store.select(b.id);
  await store.update(b.id, { name: 'Mock' });
  const again = createBoxesStore(storage);
  const restored = await again.restore();
  assert.deepEqual(restored.boxes.map((x) => [x.id, x.host, x.name]), [['box1', '192.168.1.50', 'Home'], ['box2', '127.0.0.1:8080', 'Mock']]);
  assert.equal(restored.activeId, 'box2');
  await store.remove('box2');
  assert.equal(store.active()?.id, 'box1', 'removing the selected box selects another');
  await store.select('nope');
  assert.equal(store.active()?.id, 'box1', 'an unknown id is not selected');
  now += 5000;
  await store.seen('box1');
  assert.equal(store.active()?.lastSeen, now);
  assert.equal(JSON.parse(storage.data.get(BOXES_KEY) as string).boxes[0].lastSeen, 0, 'seen is saved at most once a minute');
  now += 60000;
  await store.seen('box1');
  assert.equal(JSON.parse(storage.data.get(BOXES_KEY) as string).boxes[0].lastSeen, now);
});

test('boxes: a damaged saved list is an empty one, and a damaged entry is dropped', async () => {
  const storage = memory();
  storage.data.set(BOXES_KEY, '{not json');
  assert.deepEqual(await createBoxesStore(storage).restore(), { boxes: [], activeId: null });
  storage.data.set(BOXES_KEY, JSON.stringify({ boxes: [{ id: 'ok', host: 'h', name: '', lastSeen: 0 }, { id: 'bad id!', host: 'h2', name: '', lastSeen: 0 }, { host: 'x' }], activeId: 'gone' }));
  const s = await createBoxesStore(storage).restore();
  assert.deepEqual(s.boxes.map((b) => b.id), ['ok']);
  assert.equal(s.activeId, 'ok', 'a selected box that is gone falls back to the first');
});

test('boxes: a box with the same boxId is the same box at a new address; one saved before boxId existed is read as having none', async () => {
  const storage = memory();
  let id = 0;
  const store = createBoxesStore(storage, { newId: () => 'box' + ++id });
  await store.restore();
  const boxId = '0123456789abcdef0123456789abcdef';
  const a = await store.add('192.168.1.50', 'sinko', { boxId, hostname: 'sinko' });
  assert.deepEqual(a, { id: 'box1', host: '192.168.1.50', name: 'sinko', lastSeen: 0, boxId, hostname: 'sinko' });
  const moved = await store.add('192.168.1.77', 'sinko', { boxId, hostname: 'sinko' });
  assert.equal(moved.id, 'box1', 'the router gave it a new address: the same box');
  assert.equal(moved.host, '192.168.1.77');
  assert.equal(store.state.get().boxes.length, 1, 'not added twice');
  const other = await store.add('192.168.1.77', '', { boxId: 'ffffffffffffffffffffffffffffffff' });
  assert.equal(other.id, 'box1', 'another boxId at the same address: still the box saved there (the boxId says it was replaced)');
  assert.equal(other.boxId, 'ffffffffffffffffffffffffffffffff');
  const third = await store.add('192.168.1.80');
  assert.equal(third.id, 'box2');
  storage.data.set(BOXES_KEY, JSON.stringify({ boxes: [{ id: 'old', host: '192.168.1.50', name: '', lastSeen: 5 }], activeId: 'old' }));
  const restored = await createBoxesStore(storage).restore();
  assert.deepEqual(restored.boxes, [{ id: 'old', host: '192.168.1.50', name: '', lastSeen: 5, boxId: '', hostname: '' }]);
});

test('box ids are keychain-safe, and hosts compare without case, scheme or slash', () => {
  assert.match(newBoxId(), /^[0-9a-f]{16}$/);
  assert.ok(sameHost('Sinko.local', 'http://sinko.local/'));
  assert.ok(!sameHost('192.168.1.50', '192.168.1.51'));
});

test('sessions: one id per box, read at once from memory, kept in the secure storage', async () => {
  const data = new Map<string, string>();
  const secure = {
    getItemAsync: async (k: string) => data.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { assert.match(k, /^[A-Za-z0-9._-]+$/, 'a key SecureStore accepts'); data.set(k, v); },
    deleteItemAsync: async (k: string) => { data.delete(k); },
  };
  const s = createSessions(secure);
  assert.equal(s.sid('a'), '');
  await s.set('a', 'sid1');
  assert.equal(s.sid('a'), 'sid1');
  assert.equal(s.sid('b'), '', 'another box has its own');
  const later = createSessions(secure);
  assert.equal(later.sid('a'), '', 'nothing until restored');
  assert.equal(await later.restore('a'), 'sid1');
  await later.clear('a');
  assert.equal(later.sid('a'), '');
  assert.equal(data.size, 0);
});

test('Keep me signed in: the password is kept this-device-only, off until asked, and forgotten on request', async () => {
  const data = new Map<string, string>();
  const used: (number | undefined)[] = [];
  const secure = {
    getItemAsync: async (k: string, o?: { keychainAccessible?: number }) => { used.push(o?.keychainAccessible); return data.get(k) ?? null; },
    setItemAsync: async (k: string, v: string, o?: { keychainAccessible?: number }) => { used.push(o?.keychainAccessible); data.set(k, v); },
    deleteItemAsync: async (k: string, o?: { keychainAccessible?: number }) => { used.push(o?.keychainAccessible); data.delete(k); },
  };
  const THIS_DEVICE_ONLY = 77;          // expo-secure-store's AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY in the app
  const s = createSessions(secure, THIS_DEVICE_ONLY);
  await s.restore('a');
  assert.equal(s.kept.get().a, false, 'off by default');
  assert.equal(await s.password('a'), '');
  await s.set('a', 'sid1');
  await s.keep('a', 'hunter22');
  assert.equal(s.kept.get().a, true);
  assert.equal(data.get('sinko.pw.a'), 'hunter22');
  const later = createSessions(secure, THIS_DEVICE_ONLY);
  await later.restore('a');
  assert.equal(later.kept.get().a, true, 'it survives a restart of the app');
  assert.equal(await later.password('a'), 'hunter22');
  await later.keep('a', null);
  assert.equal(later.kept.get().a, false);
  assert.ok(!data.has('sinko.pw.a'));
  assert.ok(used.length > 0 && used.every((o) => o === THIS_DEVICE_ONLY), 'every read and write says: this device only, never synced');
});
