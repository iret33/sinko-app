// The host rule (src/api/hosts.ts): the client talks only to a private IPv4 address, judges a name by the address it resolves to, and
// talks to that address. With a fake lookup and a fake fetch: nothing here reaches the network.
import assert from 'node:assert/strict';

import { ApiError, createClient } from '../../src/api/client';
import { HostRefused, addressAllowed, createHostGuard, isPrivateIpv4, parseHost } from '../../src/api/hosts';

test('private IPv4 is 10/8, 172.16/12 and 192.168/16, and nothing else', () => {
  for (const ok of ['10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.168.1.50', '192.168.255.255']) {
    assert.equal(isPrivateIpv4(ok), true, ok);
  }
  for (const bad of ['172.15.255.255', '172.32.0.1', '192.167.1.1', '192.169.1.1', '11.0.0.1', '8.8.8.8', '100.64.0.1', '169.254.1.1', '127.0.0.1',
    '0.0.0.0', '255.255.255.255', '224.0.0.251', '10.0.0', '10.0.0.256', '010.0.0.1x', ' 10.0.0.1', '::1', 'fe80::1', 'fd00::1', 'sinko.local', '']) {
    assert.equal(isPrivateIpv4(bad), false, JSON.stringify(bad));
  }
  assert.equal(addressAllowed('127.0.0.1', false), false, 'the mock box only in a development build');
  assert.equal(addressAllowed('127.0.0.1', true), true);
  assert.equal(addressAllowed('10.0.2.2', true), true, 'the Android emulator\'s way to this computer');
  assert.equal(addressAllowed('127.0.0.2', true), false, 'exactly the two addresses');
  assert.equal(addressAllowed('8.8.8.8', true), false);
});

test('what the parent types: an address or a name, with a port, with or without http://', () => {
  assert.deepEqual(parseHost('192.168.1.50'), { scheme: 'http', host: '192.168.1.50', port: null });
  assert.deepEqual(parseHost(' http://Sinko.Local/ '), { scheme: 'http', host: 'sinko.local', port: null });
  assert.deepEqual(parseHost('kids.home:8080'), { scheme: 'http', host: 'kids.home', port: 8080 });
  assert.deepEqual(parseHost('sinko.local.'), { scheme: 'http', host: 'sinko.local', port: null }, 'a trailing dot is the same name');
  for (const bad of ['', 'http://', '192.168.1.50/admin', 'a b', 'sinko_box', 'x:99999', 'x:0', 'user@host', '-bad.local', 'http://[fe80::1]/']) {
    assert.equal(parseHost(bad), null, JSON.stringify(bad));
  }
});

test('a name is judged by the address it resolves to, not by its ending', async () => {
  const names: Record<string, string[]> = {
    'sinko.local': ['192.168.1.50'],
    'kids.home': ['10.1.2.3'],                              // a local name that does not end in .local
    'evil.local': ['203.0.113.7'],                          // ends in .local, answered from the internet
    'mixed.example': ['198.51.100.1', '192.168.1.60'],      // a public and a private address: the private one
    'nobody.local': [],
  };
  const asked: string[] = [];
  const guard = createHostGuard({ dev: false, lookup: async (n) => { asked.push(n); return names[n] || []; } });
  assert.equal(await guard.address('sinko.local'), '192.168.1.50');
  assert.equal(await guard.address('kids.home'), '10.1.2.3');
  assert.equal(await guard.address('mixed.example'), '192.168.1.60');
  await assert.rejects(guard.address('evil.local'), (e: HostRefused) => e instanceof HostRefused && e.reason === 'notPrivate' && e.status === 0);
  await assert.rejects(guard.address('nobody.local'), (e: HostRefused) => e.reason === 'notFound');
  await assert.rejects(guard.address('8.8.8.8'), (e: HostRefused) => e.reason === 'notPrivate');
  await assert.rejects(guard.address('127.0.0.1'), (e: HostRefused) => e.reason === 'notPrivate', 'not in a release build');
  await assert.rejects(guard.address('not a host'), (e: HostRefused) => e.reason === 'invalid');
  assert.equal(await guard.origin('http://sinko.local:8080'), 'http://192.168.1.50:8080');
  assert.equal(asked.filter((n) => n === 'sinko.local').length, 1, 'a name\'s address is kept for a while');
  assert.ok(!asked.includes('8.8.8.8'), 'an address is never looked up');
});

test('a lookup that hangs (a .local name nobody answers for) counts as not found', async () => {
  const guard = createHostGuard({ dev: false, lookupTimeoutMs: 30, lookup: () => new Promise<string[]>(() => {}) });
  await assert.rejects(guard.address('quiet.local'), (e: HostRefused) => e.reason === 'notFound');
});

test('the client sends nothing to a host the rule refuses, and talks to the address, not the name', async () => {
  const urls: string[] = [];
  const fakeFetch = (async (input: RequestInfo) => { urls.push(String(input)); return new Response('{}', { status: 200 }); }) as typeof fetch;
  const hosts = createHostGuard({ dev: false, lookup: async (n) => (n === 'sinko.local' ? ['192.168.1.50'] : n === 'public.example' ? ['93.184.216.34'] : []) });
  const to = (base: string) => createClient({ baseUrl: () => base, sid: () => 'secret-sid', hosts, fetch: fakeFetch });
  await to('http://sinko.local').call('GET', '/api/groups');
  await to('http://192.168.1.50:8080').call('GET', '/api/groups');
  assert.deepEqual(urls, ['http://192.168.1.50/api/groups', 'http://192.168.1.50:8080/api/groups']);
  for (const base of ['http://public.example', 'http://93.184.216.34', 'http://127.0.0.1:8080', 'http://unknown.local']) {
    await assert.rejects(to(base).call('POST', '/api/auth', { body: { password: 'secret' } }), (e: ApiError) => e instanceof HostRefused && e.status === 0, base);
  }
  assert.equal(urls.length, 2, 'not one request to a refused host: the password never left');
});

test('the default rule, with no lookup, allows private addresses (and, in a development build, the mock box) but no names', async () => {
  const hosts = createHostGuard();                // the tests run as a development build (jest.config.js: __DEV__)
  assert.equal(await hosts.origin('http://10.0.2.2:8080'), 'http://10.0.2.2:8080');
  assert.equal(await hosts.origin('192.168.1.50'), 'http://192.168.1.50');
  await assert.rejects(hosts.origin('http://sinko.local'), (e: HostRefused) => e.reason === 'notFound');
});
