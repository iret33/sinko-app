// The development box: a small proxy in front of Sinko's own mock Pi-hole (tests/mock_pihole.py, run unchanged) that adds what the app
// needs and the mock does not do. Everything it adds is listed in MOCK-GAPS.md, with what is still missing.
//
//   cookies       Set-Cookie: sid=... on signed-in answers, like Pi-hole, and a cookie without a sid header counts as a cookie sign-in
//                 (reads work, writes need a CSRF token), so "the app never sends a cookie" can be tested. Every cookie seen is logged.
//   two-factor    400 "No 2FA token found in JSON payload" when the code is missing, 401 with only {error:{message:"Invalid 2FA token"}}
//                 when it is wrong and "Reused 2FA token" when it was accepted once already, as FTL answers (src/api/auth.c).
//   sign-in 429s  "API seats exceeded" (every session taken) and "Rate-limiting login attempts" (too many wrong tries), each a switch.
//   box.json      api, boxId and hostname (Sinko 3.2) can be set or taken away, and the Sinko groups hidden (setup not finished).
//   devices       a device's lastQuery can be moved forward (and devices added), so the router and device checks can pass.
//   scheduler     timers end and bedtime switches like bin/sinko Controller.tick, and update, check, restart and shut-down requests get the
//                 outcome picked in the dev menu (mock/scheduler.mts).
//   /api/info/client  can answer an address that is not a child's device.
//   the clock     the Date header (and box.json) can be skewed, box.json's heartbeat made late, and the box made to stop answering.
//
// Dev endpoints under /__dev__/ (JSON), and a dev menu for people at /__dev__/.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, Scheduler, type SchedulerConfig } from './scheduler.mts';
import { Admin, json, request } from './upstream.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PASSWORD = 'test';                      // tests/mock_pihole.py PASSWORD
const COOKIE_AGE = 1800;                      // Pi-hole's default webserver.session.timeout

type Dict = Record<string, unknown>;
type Device = { hwaddr: string; macVendor?: string; lastQuery: number; ips: { ip: string; name: string | null }[]; [k: string]: unknown };

export interface ProxyOptions {
  /** The port of the mock Pi-hole. */
  upstreamPort: number;
  port: number;
  host: string;
  /** The mock was started with --open (no password). */
  open?: boolean;
  /** --update X.Y.Z: a newer version is on offer. */
  latest?: string | null;
}

export interface Settings {
  totpCode: string | null;
  /** The last code that was accepted: FTL refuses it again ("Reused 2FA token"). */
  totpUsed: string | null;
  seatsFull: boolean;
  /** Every sign-in answers 429 rate_limiting, as FTL does after too many wrong tries. */
  rateLimited: boolean;
  /** Fields put into /pb/box.json as the box serves it (null: the field is taken out). */
  boxInfo: Record<string, unknown>;
  /** false: GET /api/groups shows no pb-* group, like a box whose setup has not finished. */
  installed: boolean;
  clientIp: string | null;
  skewSec: number;
  heartbeatAgeSec: number;
}

export interface Proxy {
  port: number;
  url: string;
  settings: Settings;
  scheduler: Scheduler;
  close(): Promise<void>;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const ftlError = (key: string, message: string) => ({ error: { key, message, hint: null }, took: 0.0001 });

export async function startProxy(options: ProxyOptions): Promise<Proxy> {
  const up = options.upstreamPort;
  const admin = new Admin(up, PASSWORD);
  const settings: Settings = { totpCode: null, totpUsed: null, seatsFull: false, rateLimited: false, boxInfo: {}, installed: true, clientIp: null,
    skewSec: 0, heartbeatAgeSec: 0 };
  // What the box says about itself, read once from the mock.
  const info = json(await request(up, 'GET', '/pb/box.json', { Accept: 'application/json' })) as Dict;
  const offsetText = typeof info.utcOffset === 'string' ? info.utcOffset : '';
  const offMatch = /^([+-])(\d\d):(\d\d)$/.exec(offsetText);
  const utcOffsetMin = offMatch ? (offMatch[1] === '-' ? -1 : 1) * (+offMatch[2] * 60 + +offMatch[3]) : null;
  const versionText = (await request(up, 'GET', '/pb/version.txt', {})).body.toString('utf8').trim();
  const catalog = json(await request(up, 'GET', '/pb/services.json', { Accept: 'application/json' })) as { services?: { id: string }[] };

  const seenSids = new Set<string>();
  const endedSids = new Set<string>();
  const deviceTimes = new Map<string, number>();      // hwaddr or ip (lower case) -> lastQuery on the box's clock
  const extraDevices: Device[] = [];
  const cookieLog: { at: number; method: string; path: string; cookie: string }[] = [];
  let cookieRequests = 0, boxFileRequests = 0, boxFileFresh = 0;

  const box = {
    now: () => Date.now() / 1000 + settings.skewSec,
    utcOffsetMin: () => utcOffsetMin,
    version: /^\d+\.\d+\.\d+$/.test(versionText) ? versionText : '0.0.0',
    outageUntil: 0,
    endSessions: () => { for (const s of seenSids) endedSids.add(s); },
  };
  const config: SchedulerConfig = defaultConfig();
  if (options.latest) {
    config.latest = options.latest;
    config.notes = 'https://github.com/iret33/sinko/releases/tag/v' + options.latest;
  }
  const scheduler = new Scheduler(admin, box, config);
  if (!options.open) await admin.login();
  if (options.latest) {
    // Like the mock's --update: the box has already checked and found the newer version.
    const latest = config.latest, notes = config.notes, checked = Math.floor(box.now()) - 3 * 3600;
    const j = (await admin.call('GET', '/api/groups/pb-state')) as { groups?: { comment: string | null }[] };
    const st = JSON.parse((j.groups && j.groups[0] && j.groups[0].comment) || '{}') as Dict;
    st.update = Object.assign((st.update as Dict) || {}, { latest, notes, checked });
    await admin.call('PUT', '/api/groups/pb-state', { name: 'pb-state', comment: JSON.stringify(st), enabled: false });
  }
  scheduler.start((catalog.services || []).map((s) => s.id));

  function cookieHeader(sid: string): string { return `sid=${sid}; SameSite=Strict; Path=/; Max-Age=${COOKIE_AGE}; HttpOnly`; }

  async function devices(body: Buffer): Promise<Buffer> {
    const j = JSON.parse(body.toString('utf8') || '{}') as { devices?: Device[] };
    const list = (j.devices || []).concat(extraDevices.map((d) => ({ ...d })));
    for (const d of list) {
      const keys = [d.hwaddr.toLowerCase(), ...(d.ips || []).map((i) => i.ip.toLowerCase())];
      for (const k of keys) if (deviceTimes.has(k)) d.lastQuery = deviceTimes.get(k) as number;
    }
    return Buffer.from(JSON.stringify({ ...j, devices: list }));
  }

  async function dev(req: http.IncomingMessage, res: http.ServerResponse, path: string, body: Buffer): Promise<void> {
    const send = (code: number, payload: unknown) => {
      const data = Buffer.from(JSON.stringify(payload, null, 1));
      res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
      res.end(data);
    };
    let b: Dict = {};
    try { b = body.length ? (JSON.parse(body.toString('utf8')) as Dict) : {}; } catch { return send(400, { error: 'not JSON' }); }
    const method = req.method || 'GET';
    if (method === 'GET' && (path === '/__dev__' || path === '/__dev__/')) {
      const html = readFileSync(join(HERE, 'devmenu.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length, 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    if (method === 'GET' && path === '/__dev__/status') {
      return send(200, {
        settings, scheduler: config, version: box.version, boxNow: Math.round(box.now()),
        down: Date.now() < box.outageUntil ? (box.outageUntil === Infinity ? 'switched off' : Math.ceil((box.outageUntil - Date.now()) / 1000) + ' s') : null,
        log: scheduler.log.slice(-30), cookies: { requestsWithCookie: cookieRequests, recent: cookieLog.slice(-20) },
        boxFiles: { requests: boxFileRequests, askedFresh: boxFileFresh }, sessionsSeen: seenSids.size, sessionsEnded: endedSids.size,
        devices: { times: Object.fromEntries(deviceTimes), added: extraDevices },
      });
    }
    // The app's own proof that it stores no cookie: a request WITH credentials would carry one if it had been stored.
    if (method === 'GET' && path === '/__dev__/cookie-probe') {
      return send(200, { cookie: req.headers.cookie || null, requestsWithCookie: cookieRequests });
    }
    if (method !== 'POST') return send(404, { error: 'unknown dev endpoint' });
    switch (path) {
      case '/__dev__/devices/touch': {
        // Moves a device's lastQuery to now (or `ago` seconds before now) on the box's clock. No hwaddr or ip: every device.
        const at = Math.floor(box.now() - (Number(b.ago) || 0));
        const keys: string[] = [];
        if (typeof b.hwaddr === 'string') keys.push(b.hwaddr.toLowerCase());
        if (typeof b.ip === 'string') keys.push(b.ip.toLowerCase());
        if (!keys.length) {
          const j = (await admin.call('GET', '/api/network/devices?max_devices=200&max_addresses=50')) as { devices?: Device[] };
          for (const d of (j.devices || []).concat(extraDevices)) keys.push(d.hwaddr.toLowerCase());
        }
        for (const k of keys) deviceTimes.set(k, at);
        return send(200, { ok: true, lastQuery: at, devices: keys });
      }
      case '/__dev__/devices/add': {
        if (typeof b.hwaddr !== 'string' || typeof b.ip !== 'string') return send(400, { error: 'hwaddr and ip are needed' });
        const d: Device = { id: 1000 + extraDevices.length, hwaddr: b.hwaddr.toLowerCase(), macVendor: typeof b.macVendor === 'string' ? b.macVendor : '',
          lastQuery: Math.floor(box.now() - (Number(b.ago) || 0)), numQueries: 1, ips: [{ ip: b.ip, name: typeof b.name === 'string' ? b.name : null }] };
        extraDevices.push(d);
        return send(200, { ok: true, device: d });
      }
      case '/__dev__/client':
        settings.clientIp = typeof b.ip === 'string' && b.ip ? b.ip : null;
        return send(200, { ok: true, clientIp: settings.clientIp });
      case '/__dev__/totp':
        settings.totpCode = typeof b.code === 'string' && /^\d{6}$/.test(b.code) ? b.code : null;
        settings.totpUsed = null;
        return send(200, { ok: true, totpCode: settings.totpCode });
      case '/__dev__/seats':
        settings.seatsFull = b.full === true;
        return send(200, { ok: true, seatsFull: settings.seatsFull });
      case '/__dev__/rate-limit':
        settings.rateLimited = b.on === true;
        return send(200, { ok: true, rateLimited: settings.rateLimited });
      case '/__dev__/box-info':
        // { boxId, hostname, api, version, ...: a value to serve, or null to leave the field out }; { reset: true } serves the mock's own.
        if (b.reset === true) settings.boxInfo = {};
        for (const [k, v] of Object.entries(b)) if (k !== 'reset') settings.boxInfo[k] = v;
        return send(200, { ok: true, boxInfo: settings.boxInfo });
      case '/__dev__/installed':
        settings.installed = b.done !== false;
        return send(200, { ok: true, installed: settings.installed });
      case '/__dev__/clock':
        settings.skewSec = Number(b.skewSec) || 0;
        return send(200, { ok: true, skewSec: settings.skewSec });
      case '/__dev__/heartbeat':
        settings.heartbeatAgeSec = Number(b.ageSec) || 0;
        return send(200, { ok: true, heartbeatAgeSec: settings.heartbeatAgeSec });
      case '/__dev__/outage':
        box.outageUntil = Number(b.seconds) > 0 ? Date.now() + Number(b.seconds) * 1000 : 0;
        return send(200, { ok: true });
      case '/__dev__/power/plug-in':
        box.outageUntil = 0;
        if (config.power.endSessions) box.endSessions();
        scheduler.note('plugged back in');
        return send(200, { ok: true });
      case '/__dev__/scheduler': {
        // A partial SchedulerConfig: { latest, notes, update: { outcome, ... }, check: { offline }, power: { outcome, ... }, ... }
        for (const k of ['pickupSeconds', 'tickSeconds'] as const) if (typeof b[k] === 'number') config[k] = b[k] as number;
        if ('latest' in b) {
          config.latest = typeof b.latest === 'string' && /^\d+\.\d+\.\d+$/.test(b.latest) ? b.latest : null;
          config.notes = config.latest ? 'https://github.com/iret33/sinko/releases/tag/v' + config.latest : null;
        }
        for (const k of ['update', 'check', 'power'] as const) if (b[k] && typeof b[k] === 'object') Object.assign(config[k], b[k]);
        if (typeof b.tickSeconds === 'number') scheduler.restartTicker();
        return send(200, { ok: true, scheduler: config });
      }
      case '/__dev__/tick':
        await scheduler.tick();
        return send(200, { ok: true, log: scheduler.log.slice(-5) });
      case '/__dev__/reset-counters':
        cookieRequests = 0; cookieLog.length = 0; boxFileRequests = 0; boxFileFresh = 0;
        return send(200, { ok: true });
      default:
        return send(404, { error: 'unknown dev endpoint' });
    }
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://box');
    const path = url.pathname, method = req.method || 'GET';
    const body = await readBody(req);
    if (path === '/__dev__' || path.startsWith('/__dev__/')) return dev(req, res, path, body);
    if (Date.now() < box.outageUntil) { req.socket.destroy(); return; }      // the box is restarting or switched off: no answer at all

    const reply = (status: number, payload: unknown, extra?: Record<string, string>) => {
      const data = Buffer.from(JSON.stringify(payload));
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': data.length, Date: new Date(box.now() * 1000).toUTCString(), ...extra });
      res.end(data);
    };

    // ---- cookies, as FTL treats them
    const cookies = parseCookies(req.headers.cookie);
    if (req.headers.cookie) {
      cookieRequests++;
      cookieLog.push({ at: Math.round(box.now()), method, path, cookie: req.headers.cookie });
      if (cookieLog.length > 100) cookieLog.shift();
    }
    let sid = typeof req.headers.sid === 'string' ? req.headers.sid : '';
    if (!sid && cookies.sid && path.startsWith('/api/')) {
      // A cookie sign-in: fine for a read, but anything else needs the session's CSRF token (and the mock's sessions have none).
      if (method !== 'GET' && method !== 'HEAD') return reply(401, ftlError('unauthorized', 'Unauthorized'));
      sid = cookies.sid;
    }
    if (sid && endedSids.has(sid)) sid = '';                // a restart that did not restore the session
    if (sid) seenSids.add(sid);

    const headers: Record<string, string> = {};
    for (const h of ['accept', 'content-type', 'x-csrf-token'] as const) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = v;
    }
    if (sid) headers.sid = sid;
    const isBoxFile = !path.startsWith('/api/');
    if (isBoxFile) {
      boxFileRequests++;
      if (/no-cache|no-store|max-age=0/.test(String(req.headers['cache-control'] || '') + String(req.headers.pragma || ''))) boxFileFresh++;
    }

    // ---- signing in: two-factor and full seats as FTL answers them
    if (path === '/api/auth' && method === 'POST' && settings.rateLimited) return reply(429, ftlError('rate_limiting', 'Rate-limiting login attempts'));
    if (path === '/api/auth' && method === 'POST' && (settings.totpCode || settings.seatsFull)) {
      const a = await request(up, 'POST', '/api/auth', headers, body);
      const s = (json(a) as { session?: { valid?: boolean; sid?: string } }).session;
      if (a.status !== 200 || !s || !s.valid || !s.sid) {                    // a wrong password: the mock's answer, saying a code is needed
        const j = json(a) as { session?: Dict };
        if (j.session && settings.totpCode) j.session.totp = true;
        return reply(a.status, j);
      }
      let totp: unknown;
      try { totp = (JSON.parse(body.toString('utf8') || '{}') as Dict).totp; } catch { totp = undefined; }
      const drop = () => request(up, 'DELETE', '/api/auth', { sid: s.sid as string }).catch(() => undefined);   // FTL never opened it
      if (settings.totpCode && (totp === undefined || totp === null)) { await drop(); return reply(400, ftlError('bad_request', 'No 2FA token found in JSON payload')); }
      if (settings.totpCode && String(totp) === settings.totpUsed) {
        await drop(); return reply(401, { error: { key: 'unauthorized', message: 'Reused 2FA token', hint: 'wait for new token' }, took: 0.0001 });
      }
      if (settings.totpCode && String(totp) !== settings.totpCode) { await drop(); return reply(401, ftlError('unauthorized', 'Invalid 2FA token')); }
      if (settings.seatsFull) { await drop(); return reply(429, { error: { key: 'api_seats_exceeded', message: 'API seats exceeded', hint: 'increase webserver.api.max_sessions' }, took: 0.0001 }); }
      if (settings.totpCode) settings.totpUsed = String(totp);
      admin.password = (JSON.parse(body.toString('utf8')) as { password: string }).password;
      seenSids.add(s.sid);
      const ok = json(a) as { session: Dict };
      if (settings.totpCode) ok.session.totp = true;                         // FTL's session object says two-factor is on
      return reply(200, ok, { 'Set-Cookie': cookieHeader(s.sid) });
    }

    // ---- the box
    let a;
    try { a = await request(up, method, url.pathname + url.search, headers, body); } catch { req.socket.destroy(); return; }
    let data = a.body;
    const out: Record<string, string | string[]> = {};
    const type = a.headers['content-type'];
    if (type) out['Content-Type'] = type;
    if (a.headers['content-disposition']) out['Content-Disposition'] = String(a.headers['content-disposition']);
    out.Date = new Date(box.now() * 1000).toUTCString();

    if (a.status === 200 && method === 'GET') {
      if (path === '/api/network/devices') data = await devices(data);
      else if (path === '/api/info/client' && settings.clientIp) data = Buffer.from(JSON.stringify({ ...(json(a) as Dict), remote_addr: settings.clientIp }));
      else if (path === '/pb/box.json') {
        const j = json(a) as Dict;
        if (typeof j.at === 'number') j.at = Math.floor(j.at + settings.skewSec - settings.heartbeatAgeSec);
        if (typeof j.version === 'string') j.version = box.version;
        for (const [k, v] of Object.entries(settings.boxInfo)) { if (v === null) delete j[k]; else j[k] = v; }
        data = Buffer.from(JSON.stringify(j));
      } else if (path === '/api/groups' && !settings.installed) {
        const j = json(a) as { groups?: { name?: string }[] };
        data = Buffer.from(JSON.stringify({ ...j, groups: (j.groups || []).filter((g) => !(g.name || '').startsWith('pb-')) }));
      } else if (path === '/pb/version.txt') data = Buffer.from(box.version + '\n');
    }
    if (path === '/api/auth' && method === 'GET' && settings.totpCode) {
      const j = json(a) as { session?: Dict };
      if (j.session) j.session.totp = true;
      data = Buffer.from(JSON.stringify(j));
    }
    if (isBoxFile && a.status === 200) out['Cache-Control'] = 'max-age=3600';        // what Pi-hole's web server (civetweb) says
    // FTL renews the cookie on every signed-in answer, sets it at sign-in and deletes it at sign-out.
    if (path.startsWith('/api/')) {
      if (path === '/api/auth' && method === 'POST' && a.status === 200) {
        const s = (json(a) as { session?: { sid?: string } }).session;
        if (s && s.sid) { seenSids.add(s.sid); out['Set-Cookie'] = cookieHeader(s.sid); }
        try { admin.password = (JSON.parse(body.toString('utf8')) as { password: string }).password || admin.password; } catch { /* not JSON */ }
      } else if (path === '/api/auth' && method === 'DELETE') {
        out['Set-Cookie'] = 'sid=deleted; SameSite=Strict; Path=/; Max-Age=-1';
      } else if (sid && a.status !== 401) {
        out['Set-Cookie'] = cookieHeader(sid);
      }
    }
    // A new password (the claim screen, or My box): the proxy keeps signing in with it to play the scheduler.
    if (path === '/api/config' && method === 'PATCH' && a.status === 200) {
      try {
        const pw = (JSON.parse(body.toString('utf8')) as { config?: { webserver?: { api?: { password?: unknown } } } }).config?.webserver?.api?.password;
        if (typeof pw === 'string') { admin.password = pw; admin.sid = ''; }
      } catch { /* not JSON */ }
    }
    out['Content-Length'] = String(data.length);
    res.writeHead(a.status, out);
    res.end(data);
    if (path === '/api/groups/pb-state' && method === 'PUT' && a.status === 200) scheduler.stateWritten();
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      console.error('mock box:', e);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(ftlError('internal_error', String(e)))); }
      else res.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port, url: `http://${options.host}:${port}`, settings, scheduler,
    close: () => new Promise<void>((resolve) => { scheduler.stop(); server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
