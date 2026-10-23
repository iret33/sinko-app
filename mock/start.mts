// npm run mock [-- --open] [-- --live] [-- --port 8080] [-- --host 0.0.0.0] [-- --update 3.2.0] [-- --old-box]
//
// Starts Sinko's own mock Pi-hole (../sinko/tests/mock_pihole.py, unchanged) with --setup --web, and the proxy of mock/proxy.mts in front
// of it. The app talks to the proxy: http://127.0.0.1:8080 from the iOS Simulator, http://10.0.2.2:8080 from the Android emulator.
//   --open      no password set, like a fresh box (the claim screen); otherwise the password is "test"
//   --live      the mock's demo traffic: a day of history and new queries every second
//   --old-box   no /pb/box.json, like a box from before Sinko 3.0
//   --update V  a newer version V is on offer (the dev menu can change it)
//   --host H    where the proxy listens (127.0.0.1; 0.0.0.0 lets a real phone on the Wi-Fi in)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startProxy } from './proxy.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sinko = resolve(root, process.env.SINKO_DIR || '../sinko');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };

const script = join(sinko, 'tests', 'mock_pihole.py');
if (!existsSync(script)) {
  console.error(`Sinko is not at ${sinko}. Clone https://github.com/iret33/sinko there (or set SINKO_DIR).`);
  process.exit(1);
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); });
  });
}

const port = Number(value('--port', '8080'));
const host = value('--host', '127.0.0.1');
const open = flag('--open');
const latest = args.includes('--update') ? value('--update', '') : null;
const mockPort = Number(value('--mock-port', '0')) || await freePort();

const mockArgs = ['-u', '-B', script, '--port', String(mockPort), '--setup', '--web', join(sinko, 'web')];
for (const f of ['--open', '--live', '--old-box']) if (flag(f)) mockArgs.push(f);
// -B and PYTHONDONTWRITEBYTECODE: nothing is written into ../sinko (the mock loads bin/sinko as a module).
const mock = spawn('python3', mockArgs, { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
mock.stderr.on('data', (d: Buffer) => process.stderr.write('[mock_pihole] ' + d.toString()));

await new Promise<void>((resolveReady, reject) => {
  let out = '';
  const timer = setTimeout(() => reject(new Error('the mock Pi-hole did not start within 60 s')), 60000);
  mock.stdout.on('data', (d: Buffer) => {
    out += d.toString();
    if (/mock Pi-hole on/.test(out)) { clearTimeout(timer); resolveReady(); }
  });
  mock.once('exit', (code) => { clearTimeout(timer); reject(new Error('the mock Pi-hole stopped (exit ' + code + ')')); });
}).catch((e: Error) => { console.error(e.message); mock.kill(); process.exit(1); });

const proxy = await startProxy({ upstreamPort: mockPort, port, host, open, latest });
const shown = host === '0.0.0.0' ? '127.0.0.1' : host;
console.log(`Sinko mock box on http://${shown}:${proxy.port}  (${open ? 'no password set' : 'password: test'})`);
console.log(`  iOS Simulator:     http://127.0.0.1:${proxy.port}`);
console.log(`  Android emulator:  http://10.0.2.2:${proxy.port}`);
console.log(`  Dev menu:          http://${shown}:${proxy.port}/__dev__/`);
console.log(`READY ${proxy.port}`);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  mock.kill();
  void proxy.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
mock.on('exit', () => { if (!stopping) { console.error('the mock Pi-hole stopped'); stop(); } });
