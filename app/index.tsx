// A placeholder until the real screens: pointed at a box (the mock box by default), it signs in and shows the shared state (pb-state, as
// parseState reads it) and the box's clock as the app has learned it from the Date header. Development scaffolding, not a feature screen.
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, View } from 'react-native';

import { ApiError, baseUrlFor } from '../src/api';
import { Poller, appStateVisible, boxWallTime, wakeOnActive } from '../src/core';
import { locale, t } from '../src/i18n';
import type { BoxView } from '../src/state';
import { connection, sessions } from '../src/state/app';
import { useStore } from '../src/state/hooks';
import { createStore } from '../src/state/store';
import { Button, Card, Field, Row, Screen, Text, space } from '../src/ui';

/** app.js POLL_MS (line 16). */
const POLL_MS = 30000;
/** The mock box (npm run mock) as each simulator reaches this computer. */
const MOCK_HOST = Platform.OS === 'android' ? '10.0.2.2:8080' : '127.0.0.1:8080';

/** What a screen reads before a box is selected. */
const EMPTY_VIEW = createStore<BoxView>({ model: null, banner: '', busy: false, catalog: null, domainMap: null, boxInfo: null, notice: null, loadedAt: 0 });

type Phase = 'starting' | 'noBox' | 'checking' | 'signIn' | 'ready' | 'error';

function fmtOffset(ms: number): string {
  const sign = ms < 0 ? '−' : '+', a = Math.abs(ms) / 1000;
  if (a < 60) return sign + a.toFixed(1) + ' s';
  const h = Math.floor(a / 3600), m = Math.floor((a % 3600) / 60), s = Math.round(a % 60);
  return sign + [h ? h + ' h' : '', m ? m + ' min' : '', s + ' s'].filter(Boolean).join(' ');
}

export default function Placeholder() {
  const current = useStore(connection.current);
  const sids = useStore(sessions.state);
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState('');
  const [host, setHost] = useState(MOCK_HOST);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [open, setOpen] = useState(false);
  const [probe, setProbe] = useState<string>('');
  const [now, setNow] = useState(() => Date.now());          // the phone's clock, once a second while the box is shown
  const session = current.session;
  const view = useStore(session ? session.view : EMPTY_VIEW);

  const check = useCallback(async () => {
    setPhase('checking'); setError('');
    try {
      const auth = await connection.authState();
      setOpen(auth.open);
      setNeedCode(auth.totp);
      if (!auth.open && !auth.valid) { setPhase('signIn'); return; }
      await connection.current.get().session!.load();
      setPhase('ready');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? t('noConnection') : String((e as Error).message || e));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    connection.start().then(() => (connection.current.get().box ? check() : setPhase('noBox')), (e: Error) => { setError(String(e.message)); setPhase('error'); });
  }, [check]);

  // A 401 anywhere signs out (the client clears the session id): back to the sign-in form.
  const sid = current.box ? sids[current.box.id] || '' : '';
  const shown: Phase = phase === 'ready' && !open && !sid ? 'signIn' : phase;

  // Load every 30 s while the app is in front, at once when it comes back (Sinko's Poller, with AppState for "the page is hidden").
  useEffect(() => {
    if (shown !== 'ready' || !session) return;
    const poller = new Poller({ tasks: [{ name: 'model', every: POLL_MS, run: () => session.load() }], visible: appStateVisible(AppState) });
    poller.start();
    const stop = wakeOnActive(poller, AppState);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { poller.stop(); stop(); clearInterval(clock); };
  }, [shown, session]);

  // Development only: the mock box answers with the cookies a request carried. This one goes WITH credentials, so it would carry a sid
  // cookie if the phone had stored one from the box's answers; the app's own requests never do (credentials: 'omit').
  useEffect(() => {
    if (!__DEV__ || shown !== 'ready' || !current.box) return;
    fetch(baseUrlFor(current.box.host) + '/__dev__/cookie-probe', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { cookie: string | null; requestsWithCookie: number } | null) => {
        setProbe(j ? (j.cookie ? 'STORED: ' + j.cookie : 'none stored') + ' · requests with a cookie so far: ' + j.requestsWithCookie : '');
      }, () => setProbe(''));
  }, [shown, current.box, view.loadedAt]);

  async function chooseBox() {
    setError('');
    await connection.addBox(host);
    await check();
  }
  async function signIn() {
    setError('');
    const r = await connection.signIn(password, needCode && code ? Number(code) : undefined);
    if (r.ok) { setPassword(''); setCode(''); await check(); return; }
    // The page's reading of a failed sign-in (app.js login, line 600).
    const body = r.body as { session?: { totp?: boolean }; error?: { message?: string } } | null;
    if (r.status === 0) setError(t('noConnection'));
    else if (r.status === 429) setError(t('tooMany'));
    else if ((body && body.session && body.session.totp) || /totp|2fa/i.test(r.message || (body && body.error && body.error.message) || '')) { setNeedCode(true); setError(t('wrongTotp')); }
    else setError(t('wrongPassword'));
  }
  async function forget() {
    if (current.box) { await connection.signOut().catch(() => {}); }
    setPhase('noBox');
  }

  const m = view.model;
  const clock = current.client ? current.client.clock : null;
  const nowSec = (now + (clock ? clock.offsetMs : 0)) / 1000;      // BoxClock.nowSec() at the time of this render
  return (
    <Screen>
      <Text variant="title">Sinko</Text>
      <Text variant="small">Development placeholder: the shared state and the box’s clock.</Text>

      {shown === 'starting' || shown === 'checking' ? <Text variant="small">…</Text> : null}

      {shown === 'noBox' ? (
        <Card title="Box">
          <Field label="Box address" value={host} onChangeText={setHost} keyboardType="url" testID="host" />
          <Text variant="small">The mock box (npm run mock) is {MOCK_HOST} from this {Platform.OS === 'android' ? 'emulator' : 'simulator'}.</Text>
          <Button label="Use this box" onPress={() => { void chooseBox(); }} testID="use-box" />
        </Card>
      ) : null}

      {shown === 'signIn' ? (
        <Card title={current.box ? current.box.host : 'Box'}>
          <Text variant="small">{t('loginHint')}</Text>
          <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry testID="password" onSubmitEditing={() => { void signIn(); }} />
          {needCode ? <Field label={t('totp')} value={code} onChangeText={setCode} keyboardType="number-pad" testID="totp" /> : null}
          <Button label={t('signIn')} onPress={() => { void signIn(); }} disabled={!password} testID="sign-in" />
          <Button label="Another box" kind="plain" onPress={() => setPhase('noBox')} />
        </Card>
      ) : null}

      {error ? <Text variant="error" testID="error">{error}</Text> : null}
      {shown === 'error' ? <Button label="Try again" onPress={() => { void check(); }} /> : null}
      {shown === 'error' ? <Button label="Another box" kind="plain" onPress={() => setPhase('noBox')} /> : null}

      {shown === 'ready' && current.box ? (
        <>
          <Card title="Box clock">
            <Row label="Offset (box − phone)" value={clock && clock.known ? fmtOffset(clock.offsetMs) : 'not known yet'} testID="clock-offset" />
            <Row label="Box time (UTC)" value={new Date(nowSec * 1000).toISOString().replace('T', ' ').slice(0, 19)} />
            <Row label="Box wall clock" value={boxWallTime(view.boxInfo, nowSec, locale()) || 'box.json has no offset'} />
            <Row label="Phone time (UTC)" value={new Date(now).toISOString().replace('T', ' ').slice(0, 19)} />
            {clock && now < clock.stepHoldUntil ? <Text variant="small">The box’s clock jumped a moment ago.</Text> : null}
          </Card>
          <Card title="The box">
            <Row label="Address" value={current.box.host} />
            <Row label="Sinko" value={view.boxInfo ? view.boxInfo.version || '?' : 'no box.json'} />
            <Row label="Signed in" value={open ? 'no password set' : 'yes'} />
            {view.banner ? <Text variant="error">{view.banner}</Text> : null}
            {m ? <Row label="Apps · children · learned" value={m.services.length + ' · ' + m.kids.length + ' · ' + m.learned.length} /> : null}
            {m ? <Row label="Internet for children" value={m.offline ? 'off' : 'on'} /> : null}
            {probe ? <Row label="Cookies (dev)" value={probe} testID="cookie-probe" /> : null}
          </Card>
          {m ? (
            <Card title="pb-state">
              <Text variant="mono" selectable testID="state-json">{JSON.stringify(m.state, null, 2)}</Text>
            </Card>
          ) : null}
          <View style={{ gap: space.sm }}>
            <Button label="Load again" onPress={() => { void session?.load().catch((e: Error) => setError(e.message)); }} testID="reload" />
            {open ? null : <Button label={t('signOut')} kind="plain" onPress={() => { void connection.signOut().then(() => setPhase('signIn')); }} />}
            <Button label="Another box" kind="plain" onPress={() => { void forget(); }} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
