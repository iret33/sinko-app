// Claimed or not, the claim and what a failed sign-in means (src/state/auth.ts), against a fake box that answers as Pi-hole's FTL does
// (src/api/auth.c: get_session_object and api_auth). The same flows against the mock box are test/state/signin.test.ts.
import assert from 'node:assert/strict';

import { createClient, type Client } from '../../src/api/client';
import { CLAIM_RETRY, boxAccess, claimBox, noPasswordSet, signInProblem } from '../../src/state/auth';

type Answer = { status: number; body?: unknown } | 'no answer';
/** A box that gives these answers in turn, and records what it was asked. */
function fakeBox(answers: Answer[]): { client: Client; asked: string[] } {
  const asked: string[] = [];
  const f = (async (input: RequestInfo, init?: RequestInit) => {
    asked.push((init?.method || 'GET') + ' ' + String(input).replace('http://192.168.1.50', '') + ((init?.headers as Record<string, string>)?.sid ? ' +sid' : ''));
    const a = answers.shift();
    if (!a || a === 'no answer') throw new TypeError('Network request failed');
    return new Response(a.body === undefined ? '' : JSON.stringify(a.body), { status: a.status });
  }) as typeof fetch;
  return { client: createClient({ baseUrl: () => 'http://192.168.1.50', sid: () => 'stored', fetch: f }), asked };
}

// What FTL answers (get_session_object).
const OPEN = { session: { valid: true, totp: false, sid: null, validity: -1, message: 'no password set' } };
const NO_SESSION = { session: { valid: false, totp: false, sid: null, validity: -1, message: 'no SID provided' } };
const NO_SESSION_TOTP = { session: { valid: false, totp: true, sid: null, validity: -1, message: 'no SID provided' } };
const SIGNED_IN = { session: { valid: true, totp: false, sid: 'abcd1234abcd1234abcd12==', csrf: 'x', validity: 1800, message: 'password correct' } };
const ftlError = (key: string, message: string, hint: string | null = null) => ({ error: { key, message, hint }, took: 0.0001 });

test('no password only when valid, sid null AND validity -1: a session that came along (a stray cookie) cannot fake it', () => {
  assert.equal(noPasswordSet(OPEN), true);
  // A request that carried a session cookie: FTL answers valid, with the session's id and the seconds it has left.
  assert.equal(noPasswordSet(SIGNED_IN), false, 'the cookie case');
  assert.equal(noPasswordSet({ session: { valid: true, sid: null, validity: 1795 } }), false, 'valid with time left is a session, not an open box');
  assert.equal(noPasswordSet({ session: { valid: true, sid: 'x', validity: -1 } }), false);
  assert.equal(noPasswordSet({ session: { valid: true } }), false, 'the page\'s r.ok && valid would say open here; the app does not');
  assert.equal(noPasswordSet({ session: { valid: 'true', sid: null, validity: -1 } }), false);
  assert.equal(noPasswordSet({ session: { valid: true, sid: null, validity: '-1' } }), false);
  for (const none of [NO_SESSION, NO_SESSION_TOTP, {}, null, undefined, 'x', [], { session: null }]) assert.equal(noPasswordSet(none), false, JSON.stringify(none));
});

test('claimed or not: GET /api/auth without a session, and for an open box GET /api/groups for pb-state', async () => {
  let box = fakeBox([{ status: 200, body: OPEN }, { status: 200, body: { groups: [{ name: 'Default' }, { name: 'pb-kids' }, { name: 'pb-state' }] } }]);
  assert.deepEqual(await boxAccess(box.client), { kind: 'open' });
  assert.deepEqual(box.asked, ['GET /api/auth', 'GET /api/groups'], 'neither request carries the stored session');

  box = fakeBox([{ status: 200, body: OPEN }, { status: 200, body: { groups: [{ name: 'Default' }] } }]);
  assert.deepEqual(await boxAccess(box.client), { kind: 'notInstalled' }, 'no password and no pb-state: setup is not finished');

  box = fakeBox([{ status: 401, body: NO_SESSION }]);
  assert.deepEqual(await boxAccess(box.client), { kind: 'claimed', totp: false });
  assert.deepEqual(box.asked, ['GET /api/auth'], 'a claimed box is not asked for its groups without a session');

  box = fakeBox([{ status: 401, body: NO_SESSION_TOTP }]);
  assert.deepEqual(await boxAccess(box.client), { kind: 'claimed', totp: true }, 'and it says when a 6-digit code is needed');

  box = fakeBox([{ status: 200, body: SIGNED_IN }]);
  assert.deepEqual(await boxAccess(box.client), { kind: 'claimed', totp: false }, 'a stray session in the answer is a claimed box');

  box = fakeBox(['no answer']);
  await assert.rejects(boxAccess(box.client), (e: { status: number }) => e.status === 0, 'no answer: nothing is known');
});

test('the claim: PATCH /api/config without a session, then POST /api/auth tried up to 4 times, 1.2 s apart, on no answer or 5xx', async () => {
  const slept: number[] = [];
  const sleep = async (ms: number) => { slept.push(ms); };
  let box = fakeBox([{ status: 200, body: { config: {} } }, 'no answer', { status: 503, body: {} }, { status: 200, body: SIGNED_IN }]);
  assert.deepEqual(await claimBox(box.client, 'new-password', sleep), { kind: 'signedIn', sid: SIGNED_IN.session.sid, totp: false });
  assert.deepEqual(box.asked, ['PATCH /api/config', 'POST /api/auth', 'POST /api/auth', 'POST /api/auth'], 'no request carries a session');
  assert.deepEqual(slept, [CLAIM_RETRY.delayMs, CLAIM_RETRY.delayMs]);
  assert.deepEqual(CLAIM_RETRY, { tries: 4, delayMs: 1200 });

  slept.length = 0;
  box = fakeBox([{ status: 200, body: {} }, 'no answer', 'no answer', { status: 500, body: {} }, 'no answer', { status: 200, body: SIGNED_IN }]);
  assert.deepEqual(await claimBox(box.client, 'new-password', sleep), { kind: 'savedOnly' }, 'after four tries: saved, but sign in by hand');
  assert.equal(box.asked.filter((a) => a === 'POST /api/auth').length, 4);
  assert.equal(slept.length, 3);

  slept.length = 0;
  box = fakeBox([{ status: 200, body: {} }, { status: 401, body: { session: { valid: false, totp: false, sid: null, validity: -1 } } }]);
  assert.deepEqual(await claimBox(box.client, 'new-password', sleep), { kind: 'savedOnly' }, 'a 401 is an answer: not tried again');
  assert.deepEqual(slept, []);

  box = fakeBox([{ status: 401, body: ftlError('unauthorized', 'Unauthorized') }]);
  assert.deepEqual(await claimBox(box.client, 'new-password', sleep), { kind: 'taken' }, 'PATCH 401: someone chose a password first');
  assert.deepEqual(box.asked, ['PATCH /api/config'], 'and nothing else is tried');

  box = fakeBox([{ status: 500, body: ftlError('internal_error', 'Internal server error') }]);
  const failed = await claimBox(box.client, 'new-password', sleep);
  assert.deepEqual(failed, { kind: 'failed', status: 500, message: 'Internal server error' }, 'not saved: the page\'s claimFail');

  const sent: unknown[] = [];
  const f = (async (_: RequestInfo, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify(SIGNED_IN), { status: 200 }); }) as typeof fetch;
  await claimBox(createClient({ baseUrl: () => 'http://192.168.1.50', sid: () => '', fetch: f }), 'pw-12345678', sleep);
  assert.deepEqual(sent, [{ config: { webserver: { api: { password: 'pw-12345678' } } } }, { password: 'pw-12345678' }], 'app.js claim\'s two bodies');
});

test('a failed sign-in, read as FTL means it: missing and wrong codes, the two kinds of 429, a wrong password', () => {
  // The password is checked first: a wrong one is the 401 that has a session object (with totp telling whether a code is on).
  assert.equal(signInProblem(401, { session: { valid: false, totp: false, sid: null, validity: -1, message: 'password incorrect' } }), 'wrongPassword');
  assert.equal(signInProblem(401, { session: { valid: false, totp: true, sid: null, validity: -1, message: 'password incorrect' } }), 'wrongPassword');
  // Then the code: problems are an error object without a session.
  assert.equal(signInProblem(400, ftlError('bad_request', 'No 2FA token found in JSON payload')), 'needCode');
  assert.equal(signInProblem(401, ftlError('unauthorized', 'Invalid 2FA token')), 'wrongCode');
  assert.equal(signInProblem(401, ftlError('unauthorized', 'Reused 2FA token', 'wait for new token')), 'reusedCode');
  // 429: every session is taken, or the box is slowing down wrong tries (of passwords, or of codes).
  assert.equal(signInProblem(429, ftlError('api_seats_exceeded', 'API seats exceeded', 'increase webserver.api.max_sessions')), 'seatsFull');
  assert.equal(signInProblem(429, ftlError('rate_limiting', 'Rate-limiting login attempts')), 'tooManyTries');
  assert.equal(signInProblem(429, ftlError('rate_limiting', 'Rate-limiting 2FA token requests, try again later')), 'tooManyTries');
  assert.equal(signInProblem(429, {}), 'seatsFull', 'a 429 that says nothing: what the page says for any 429');
  // Other answers.
  assert.equal(signInProblem(0, {}), 'noConnection');
  assert.equal(signInProblem(200, { session: { valid: false } }), 'wrongPassword', 'an answer without a valid session');
  assert.equal(signInProblem(400, ftlError('bad_request', 'No password found in JSON payload')), 'other');
  assert.equal(signInProblem(500, ftlError('internal_error', 'Internal server error')), 'other');
  assert.equal(signInProblem(401, ftlError('unauthorized', 'Unauthorized')), 'wrongPassword');
});
