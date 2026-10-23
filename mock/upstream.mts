// Talking to Sinko's mock Pi-hole (tests/mock_pihole.py) from the proxy: one raw request, and an admin session of the proxy's own,
// used to play the scheduler (it signs in like bin/sinko does, with the box's password).
import net from 'node:net';

export interface Answer { status: number; headers: Record<string, string>; body: Buffer }

/**
 * One request to the mock, over a plain socket. The mock is Python's BaseHTTPRequestHandler: HTTP/1.0, one answer per connection, closed
 * at the end, and a 204 that still carries a body ({}), which Node's own HTTP client refuses to parse. So the answer is read to the end of
 * the connection and split at the first blank line.
 */
export function request(port: number, method: string, path: string, headers: Record<string, string>, body?: Buffer): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.on('connect', () => {
      const lines = [`${method} ${path} HTTP/1.0`, 'Host: 127.0.0.1:' + port];
      for (const [k, v] of Object.entries(headers)) if (!/^(host|content-length|connection)$/i.test(k)) lines.push(`${k}: ${v}`);
      lines.push('Content-Length: ' + (body ? body.length : 0), 'Connection: close', '', '');
      socket.write(lines.join('\r\n'));
      if (body && body.length) socket.write(body);
    });
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('error', reject);
    socket.on('end', () => {
      const all = Buffer.concat(chunks);
      const split = all.indexOf('\r\n\r\n');
      if (split < 0) return reject(new Error('no answer from the mock'));
      const head = all.subarray(0, split).toString('latin1').split('\r\n');
      const status = Number((/^HTTP\/\d\.\d (\d{3})/.exec(head[0]) || [])[1] || 0);
      const out: Record<string, string> = {};
      for (const line of head.slice(1)) {
        const i = line.indexOf(':');
        if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      resolve({ status, headers: out, body: all.subarray(split + 4) });
    });
  });
}

export function json(a: Answer): unknown {
  try { return JSON.parse(a.body.toString('utf8') || '{}'); } catch { return {}; }
}

/** The proxy's own session at the mock. The password is the mock's ("test"), or the one the app set or signed in with since. */
export class Admin {
  port: number;
  password: string;
  sid = '';

  constructor(port: number, password: string) { this.port = port; this.password = password; }

  async login(): Promise<void> {
    const open = await request(this.port, 'GET', '/api/auth', { Accept: 'application/json' });
    if (open.status === 200) { this.sid = ''; return; }                 // no password set: nothing to sign in to
    const a = await request(this.port, 'POST', '/api/auth', { 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify({ password: this.password })));
    const s = (json(a) as { session?: { sid?: string } }).session;
    if (a.status !== 200 || !s || !s.sid) throw new Error('the proxy cannot sign in to the mock (status ' + a.status + ')');
    this.sid = s.sid;
  }

  async call(method: string, path: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.sid) headers.sid = this.sid;
      let payload: Buffer | undefined;
      if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = Buffer.from(JSON.stringify(body)); }
      const a = await request(this.port, method, path, headers, payload);
      if (a.status === 401 && attempt === 0) { await this.login(); continue; }
      if (a.status >= 400) throw new Error(method + ' ' + path + ': ' + a.status + ' ' + a.body.toString('utf8').slice(0, 200));
      return json(a);
    }
    throw new Error('unreachable');
  }
}
