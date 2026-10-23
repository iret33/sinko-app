// Starts the development box (npm run mock: Sinko's mock Pi-hole behind mock/proxy.mts) for a test file, on free ports.
// Needs ../sinko (or SINKO_DIR) and python3, like npm run mock.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SINKO = resolve(ROOT, process.env.SINKO_DIR || '../sinko');

export interface MockBox {
  url: string;
  /** POST (with a body) or GET a dev endpoint, e.g. dev('/devices/touch', {}). */
  dev<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T>;
  stop(): Promise<void>;
}

export async function startMockBox(args: string[] = []): Promise<MockBox> {
  if (!existsSync(join(SINKO, 'tests', 'mock_pihole.py'))) {
    throw new Error(`These tests need Sinko at ${SINKO} (git clone https://github.com/iret33/sinko ../sinko) and python3.`);
  }
  const child: ChildProcess = spawn(process.execPath, [join(ROOT, 'mock', 'start.mts'), '--port', '0', ...args],
    { cwd: ROOT, env: { ...process.env, SINKO_DIR: SINKO }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr?.on('data', (d: Buffer) => { errors += d.toString(); });
  const port = await new Promise<number>((res, rej) => {
    let out = '';
    const timer = setTimeout(() => rej(new Error('the mock box did not start: ' + errors)), 60000);
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
      const m = /READY (\d+)/.exec(out);
      if (m) { clearTimeout(timer); res(Number(m[1])); }
    });
    child.once('exit', (code) => { clearTimeout(timer); rej(new Error('the mock box stopped (' + code + '): ' + errors)); });
  });
  const url = 'http://127.0.0.1:' + port;
  return {
    url,
    async dev<T>(path: string, body?: unknown) {
      const r = await fetch(url + '/__dev__' + path, body === undefined ? undefined
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return (await r.json()) as T;
    },
    stop: () => new Promise<void>((res) => {
      if (child.exitCode !== null) return res();
      child.once('exit', () => res());
      child.kill('SIGTERM');
    }),
  };
}

/** Waits until `check` is true (polling), or fails after `ms`. */
export async function eventually(check: () => Promise<boolean> | boolean, ms = 10000, what = 'the condition'): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 100));
  }
}
