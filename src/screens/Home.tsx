// Signed in. Until the feature screens come, this shows the setup list (the page's #setup card) until it is done, the children's devices
// with Add device, the box, Setup help (the page's #help: the router guide and the guide for one device) and, in a development build,
// the shared state as parseState reads it. It loads the box every 30 s while the app is in front (Sinko's Poller, with AppState for "the
// page is hidden"), and right after the parent chose the box's password it opens the guided setup once.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';

import { serverNowSec } from '../api';
import { Poller, appStateVisible, wakeOnActive } from '../core';
import { t } from '../i18n';
import { fmtAgo, isolate, ltr } from '../i18n/format';
import { connection } from '../state/app';
import { appTooOld } from '../state/compat';
import { Button, Card, Notice, Row, Screen, Text, space } from '../ui';
import { Top } from './common';
import { SessionToast, SetupChecklist, useSetup } from './setupParts';

/** app.js POLL_MS (line 16). */
const POLL_MS = 30000;

export function Home() {
  const { setup, view } = useSetup();
  const current = connection.current.get();
  const session = current.session;
  const box = current.box;
  const name = (box && box.name) || t('appName');
  const m = view.model;

  useEffect(() => {
    if (!session) return;
    const poller = new Poller({ tasks: [{ name: 'model', every: POLL_MS, run: () => session.load() }], visible: appStateVisible(AppState) });
    poller.start();
    const stop = wakeOnActive(poller, AppState);
    return () => { poller.stop(); stop(); };
  }, [session]);

  useEffect(() => (setup ? setup.watch() : undefined), [setup]);

  // The first model after the parent chose the password: the guided setup, unless the box says setup is done already.
  useEffect(() => {
    if (m && box && connection.takeFreshClaim(box.id) && !m.state.setup.done) router.push('/setup');
  }, [m, box]);

  const info = view.boxInfo;
  const list = setup ? setup.list(view) : null;
  const nowSec = serverNowSec();
  return (
    <Screen overlay={<SessionToast />}>
      <Top title={name} sub={t('homeSignedIn', { name })} />
      {appTooOld(info) ? <Notice kind="warn" testID="app-too-old">{t('appUpdateNeeded')}</Notice> : null}
      {view.banner ? <Notice kind="warn">{view.banner}</Notice> : null}

      {setup && list && !list.hide ? <SetupChecklist setup={setup} list={list} busy={view.busy} title={t('setupTitle')} /> : null}

      {m ? (
        <Card title={t('devices')}>
          {m.kids.length ? m.kids.map((k) => (
            <View key={k.row.client} style={{ gap: 2 }} testID={'kid-' + k.row.client}>
              <Text variant="heading">{isolate(k.name)}</Text>
              <Text variant="small">{[ltr(k.row.client), fmtAgo(k.dev && k.dev.lastQuery, nowSec)].join('  ')}</Text>
              {k.shadow.length ? <Text variant="error">{t('shadowed', { r: k.shadow.map((x) => ltr(x.client)).join(', ') })}</Text> : null}
            </View>
          )) : <Text variant="small">{t('noDevices')}</Text>}
          <Button kind="plain" label={t('addDevice')} disabled={view.busy} onPress={() => router.push('/add-device')} testID="home-add-device" />
        </Card>
      ) : null}

      <Card title={t('boxSection')}>
        <Row label={t('boxName')} value={name} />
        <Row label={t('boxAddress')} value={box ? ltr(box.host) : ''} testID="home-address" />
        <Row label={t('boxVersion')} value={info && info.version ? t('boxAboutVersion', { v: info.version }) : '…'} />
      </Card>

      <Card title={t('helpTitle')}>
        <Button kind="plain" label={t('routerTitle')} onPress={() => router.push('/setup/router')} testID="help-router" />
        <Button kind="plain" label={t('byHandTitle')} onPress={() => router.push('/setup/by-hand')} testID="help-by-hand" />
      </Card>

      {__DEV__ && m ? (
        <Card title={t('devState')}>
          <Text variant="mono" selectable testID="state-json">{JSON.stringify(m.state, null, 2)}</Text>
        </Card>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Button label={t('settingsTitle')} kind="plain" onPress={() => router.push('/settings')} testID="open-settings-screen" />
        <Button label={t('signOut')} kind="plain" onPress={() => { void connection.signOut(); }} testID="sign-out" />
      </View>
    </Screen>
  );
}
