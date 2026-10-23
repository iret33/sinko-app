// The router guides of src/content/routers (the format is in its README.md): what a guide file says, and whether it may be shown. Until a
// brand's guide is filled in from a real router and marked ready, the router screen shows the steps for every router instead.
import type { Lang } from '../i18n';
import { GUIDE_TEXT, SCREENSHOTS } from './routers/guides';

/** The internet providers whose home routers get a guide of their own, in the order the screen offers them. */
export const ROUTER_BRANDS = ['batelco', 'zain', 'stc'] as const;
export type RouterBrand = (typeof ROUTER_BRANDS)[number];

export type GuideBlock =
  | { kind: 'text'; text: string }
  | { kind: 'bullet'; text: string }
  /** A picture: screenshots/<brand>/<slot>.png. `alt` says what it shows, for a screen reader. */
  | { kind: 'shot'; slot: string; alt: string };
export interface GuideStep { title: string; blocks: GuideBlock[] }
export interface Guide {
  brand: string;
  /** What the brand's button says. */
  name: string;
  status: 'todo' | 'ready';
  title: string;
  /** The paragraphs before the first step. */
  intro: GuideBlock[];
  steps: GuideStep[];
  /** The notes for whoever writes the guide (lines that start with TODO): never shown. */
  todos: string[];
  /** Every picture the guide asks for. */
  slots: string[];
}

const SHOT = /^!\[([^\]]*)\]\(screenshot:([a-z0-9-]+)\)$/;

/** A guide file, read. Comments (<!-- -->) and TODO lines are left out of what is shown. */
export function parseGuide(text: string): Guide {
  const g: Guide = { brand: '', name: '', status: 'todo', title: '', intro: [], steps: [], todos: [], slots: [] };
  let body = text.replace(/\r\n?/g, '\n');
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (front) {
    body = body.slice(front[0].length);
    front[1].split('\n').forEach((line) => {
      const m = /^([a-z]+):\s*(.*)$/.exec(line.trim());
      if (!m) return;
      if (m[1] === 'brand') g.brand = m[2];
      else if (m[1] === 'name') g.name = m[2];
      else if (m[1] === 'status') g.status = m[2] === 'ready' ? 'ready' : 'todo';
    });
  }
  body = body.replace(/<!--[\s\S]*?-->/g, (c) => {
    if (/\bTODO\b/.test(c)) g.todos.push(c.replace(/^<!--|-->$/g, '').trim());
    return '';
  });
  let blocks = g.intro;
  let para: string[] = [];
  const endPara = () => { if (para.length) { blocks.push({ kind: 'text', text: para.join(' ') }); para = []; } };
  body.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line) { endPara(); return; }
    if (/^TODO\b/.test(line)) { endPara(); g.todos.push(line.replace(/^TODO:?\s*/, '')); return; }
    if (/^# /.test(line)) { endPara(); g.title = line.slice(2).trim(); return; }
    if (/^## /.test(line)) {
      endPara();
      const step: GuideStep = { title: line.slice(3).trim(), blocks: [] };
      g.steps.push(step);
      blocks = step.blocks;
      return;
    }
    const shot = SHOT.exec(line);
    if (shot) { endPara(); blocks.push({ kind: 'shot', slot: shot[2], alt: shot[1] }); g.slots.push(shot[2]); return; }
    if (/^- /.test(line)) { endPara(); blocks.push({ kind: 'bullet', text: line.slice(2).trim() }); return; }
    para.push(line);
  });
  endPara();
  return g;
}

/** The picture for a slot in this language: its own when there is one, else the one for both. */
export function screenshot(brand: string, slot: string, lang: Lang): number | null {
  const shots = SCREENSHOTS[brand] || {};
  return shots[slot + '.' + lang] || shots[slot] || null;
}

/** The guide may be shown: marked ready, with steps, no TODO left and every picture there. */
export function guideReady(g: Guide, lang: Lang): boolean {
  return g.status === 'ready' && g.steps.length > 0 && g.todos.length === 0 && g.slots.every((s) => screenshot(g.brand, s, lang) !== null);
}

/** A brand's guide in this language, or null when there is none. */
export function routerGuide(brand: string, lang: Lang): Guide | null {
  const text = (GUIDE_TEXT[brand] || {})[lang];
  return typeof text === 'string' ? parseGuide(text) : null;
}
