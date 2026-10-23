// The boxes this phone knows, and which one is selected. Version 1 shows one box, but they are kept as a list from the start so a second
// box (grandparents' house, a second router) needs no migration.
import { createStore, type Store } from './store';

export interface Box {
  id: string;
  /** Where the app reaches the box: the address it was found at ("192.168.1.50", "127.0.0.1:8080"), or what the parent typed. */
  host: string;
  /** box.json's hostname, '' when the box has none: what the app shows (Sinko when there is none). */
  name: string;
  /** Phone time (ms) the box last answered a load, 0 = never. */
  lastSeen: number;
  /** box.json's boxId (Sinko 3.2 and later), '' on an older box: how the app knows the box again at another address. */
  boxId: string;
  /** box.json's hostname: the box also answers to <hostname>.local, which the app tries when it looks for the box. */
  hostname: string;
}

/** What box.json says about a box, for add(). */
export interface BoxIdentity { boxId?: string; hostname?: string }
export interface BoxesState { boxes: Box[]; activeId: string | null }

/** What the list is saved in (AsyncStorage in the app, a Map in the tests). */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const BOXES_KEY = 'sinko.boxes';
/** lastSeen is written at most this often (every load updates it, and the poller loads every 30 s). */
const SEEN_WRITE_MS = 60000;

export interface BoxesStore {
  state: Store<BoxesState>;
  /** Reads the saved list (once, at start). A damaged list is an empty one. */
  restore(): Promise<BoxesState>;
  active(): Box | null;
  /**
   * Adds a box, or returns the one it already is: the one with the same boxId (whose address is then updated: the router gave the box a
   * new one), else the one with the same host. The first box becomes the selected one.
   */
  add(host: string, name?: string, identity?: BoxIdentity): Promise<Box>;
  update(id: string, change: Partial<Pick<Box, 'host' | 'name' | 'boxId' | 'hostname'>>): Promise<void>;
  remove(id: string): Promise<void>;
  select(id: string | null): Promise<void>;
  /** The box answered: remember when (saved at most once a minute). */
  seen(id: string): Promise<void>;
}

export function sameHost(a: string, b: string): boolean {
  const norm = (h: string) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return norm(a) === norm(b);
}

function isBox(x: unknown): x is Box {
  const b = x as Box;
  return !!b && typeof b === 'object' && typeof b.id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(b.id) && typeof b.host === 'string' && b.host.trim() !== ''
    && typeof b.name === 'string' && typeof b.lastSeen === 'number' && isFinite(b.lastSeen);
}
/** A saved box, with the fields of later versions filled in ('' for a box saved before the app knew boxId and hostname). */
function normalBox(b: Box): Box {
  const boxId = typeof b.boxId === 'string' && /^[0-9a-f]{32}$/.test(b.boxId) ? b.boxId : '';
  const hostname = typeof b.hostname === 'string' ? b.hostname : '';
  return { id: b.id, host: b.host, name: b.name, lastSeen: b.lastSeen, boxId, hostname };
}

/** A random id made of the characters SecureStore allows in a key. */
export function newBoxId(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(random() * 16).toString(16);
  return s;
}

export function createBoxesStore(storage: KeyValueStorage, options?: { now?: () => number; newId?: () => string }): BoxesStore {
  const now = (options && options.now) || Date.now;
  const newId = (options && options.newId) || (() => newBoxId());
  const state = createStore<BoxesState>({ boxes: [], activeId: null });
  let lastWrite = 0;

  async function save(next: BoxesState): Promise<void> {
    state.set(next);
    lastWrite = now();
    await storage.setItem(BOXES_KEY, JSON.stringify(next));
  }

  return {
    state,
    async restore() {
      let parsed: unknown = null;
      try { parsed = JSON.parse((await storage.getItem(BOXES_KEY)) || 'null'); } catch { parsed = null; }
      const p = parsed as Partial<BoxesState> | null;
      const boxes = p && Array.isArray(p.boxes) ? p.boxes.filter(isBox).map(normalBox) : [];
      const activeId = p && typeof p.activeId === 'string' && boxes.some((b) => b.id === p.activeId) ? p.activeId : (boxes[0] ? boxes[0].id : null);
      state.set({ boxes, activeId });
      return state.get();
    },
    active() {
      const s = state.get();
      return s.boxes.find((b) => b.id === s.activeId) || null;
    },
    async add(host, name, identity) {
      const s = state.get();
      const boxId = (identity && identity.boxId) || '', hostname = (identity && identity.hostname) || '';
      const same = (boxId && s.boxes.find((b) => b.boxId === boxId)) || s.boxes.find((b) => sameHost(b.host, host));
      if (same) {
        const next: Box = { ...same, host: boxId && same.boxId === boxId ? host.trim() : same.host, boxId: boxId || same.boxId,
          hostname: hostname || same.hostname, name: name !== undefined && name.trim() ? name.trim() : same.name };
        if (JSON.stringify(next) === JSON.stringify(same)) return same;
        await save({ ...s, boxes: s.boxes.map((b) => (b.id === same.id ? next : b)) });
        return next;
      }
      const box: Box = { id: newId(), host: host.trim(), name: (name || '').trim(), lastSeen: 0, boxId, hostname };
      await save({ boxes: [...s.boxes, box], activeId: s.activeId || box.id });
      return box;
    },
    async update(id, change) {
      const s = state.get();
      await save({ ...s, boxes: s.boxes.map((b) => (b.id === id ? { ...b, ...change } : b)) });
    },
    async remove(id) {
      const s = state.get();
      const boxes = s.boxes.filter((b) => b.id !== id);
      await save({ boxes, activeId: s.activeId === id ? (boxes[0] ? boxes[0].id : null) : s.activeId });
    },
    async select(id) {
      const s = state.get();
      if (id !== null && !s.boxes.some((b) => b.id === id)) return;
      await save({ ...s, activeId: id });
    },
    async seen(id) {
      const s = state.get(), t = now();
      const boxes = s.boxes.map((b) => (b.id === id ? { ...b, lastSeen: t } : b));
      if (t - lastWrite >= SEEN_WRITE_MS) await save({ ...s, boxes });
      else state.set({ ...s, boxes });
    },
  };
}
