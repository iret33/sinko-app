// Signed in. Until the feature screens come, this shows which box the app is signed in to and, in a development build, the shared state
// as parseState reads it. It loads the box every 30 s while the app is in front (Sinko's Poller, with AppState for "the page is hidden").
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';

import { Poller, appStateVisible, wakeOnActive } from '../core';
import { t } from '../i18n';
import { connection } from '../state/app';
import { appTooOld } from '../state/compat';
import { useStore } from '../state/hooks';
import { createStore } from '../state/store';
import type { BoxView } from '../state/model';
import { Button, Card, Notice, Row, Screen, Text, space } from '../ui';
import { Top } from './common';

/** app.js POLL_MS (line 16). */
const POLL_MS = 30000;
const EMPTY_VIEW = createStore<BoxView>({ model: null, banner: '', busy: false, catalog: null, domainMap: null, boxInfo: null, notice: null, loadedAt: 0 });

export function Home() {
  const current = useStore(connection.current);
  const session = current.session;
  const view = useStore(session ? session.view : EMPTY_VIEW);
  const box = current.box;
  const name = (box && box.name) || t('appName');

  useEffect(() => {
    if (!session) return;
    const poller = new Poller({ tasks: [{ name: 'model', every: POLL_MS, run: () => session.load() }], visible: appStateVisible(AppState) });
    poller.start();
    const stop = wakeOnActive(poller, AppState);
    return () => { poller.stop(); stop(); };
  }, [session]);

  const info = view.boxInfo;
  return (
    <Screen>
      <Top title={name} sub={t('homeSignedIn', { name })} />
      {appTooOld(info) ? <Notice kind="warn" testID="app-too-old">{t('appUpdateNeeded')}</Notice> : null}
      {view.banner ? <Notice kind="warn">{view.banner}</Notice> : null}
      <Card title={t('boxSection')}>
        <Row label={t('boxName')} value={name} />
        <Row label={t('boxAddress')} value={box ? box.host : ''} testID="home-address" />
        <Row label={t('boxVersion')} value={info && info.version ? t('boxAboutVersion', { v: info.version }) : '…'} />
      </Card>
      {__DEV__ && view.model ? (
        <Card title={t('devState')}>
          <Text variant="mono" selectable testID="state-json">{JSON.stringify(view.model.state, null, 2)}</Text>
        </Card>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Button label={t('settingsTitle')} kind="plain" onPress={() => router.push('/settings')} testID="open-settings-screen" />
        <Button label={t('signOut')} kind="plain" onPress={() => { void connection.signOut(); }} testID="sign-out" />
      </View>
    </Screen>
  );
}
