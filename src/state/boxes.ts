// The boxes this phone knows, and which one is selected. Version 1 shows one box, but they are kept as a list from the start so a second
// box (grandparents' house, a second router) needs no migration.
import { createStore, type Store } from './store';

export interface Box {
  id: string;
  /** What the parent typed or the app found: "192.168.1.50", "sinko.local", "127.0.0.1:8080". */
  host: string;
  name: string;
  /** Phone time (ms) the box last answered a load, 0 = never. */
  lastSeen: number;
}
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
  /** Adds a box, or returns the one with the same host. The first box becomes the selected one. */
  add(host: string, name?: string): Promise<Box>;
  update(id: string, change: Partial<Pick<Box, 'host' | 'name'>>): Promise<void>;
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
      const boxes = p && Array.isArray(p.boxes) ? p.boxes.filter(isBox) : [];
      const activeId = p && typeof p.activeId === 'string' && boxes.some((b) => b.id === p.activeId) ? p.activeId : (boxes[0] ? boxes[0].id : null);
      state.set({ boxes, activeId });
      return state.get();
    },
    active() {
      const s = state.get();
      return s.boxes.find((b) => b.id === s.activeId) || null;
    },
    async add(host, name) {
      const s = state.get();
      const existing = s.boxes.find((b) => sameHost(b.host, host));
      if (existing) return existing;
      const box: Box = { id: newId(), host: host.trim(), name: (name || '').trim(), lastSeen: 0 };
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
