// What the setup screens and Home share: the session's messages (the page's toast), the box's address with a Copy button, the live router
// check, and the setup list (the page's #setup card, drawn by renderSetup, Sinko web/app.js line 1027).
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { routerAddress, type SetupItem, type SetupList } from '../core';
import { t } from '../i18n';
import { clockTime } from '../i18n/format';
import { connection, currentSetup } from '../state/app';
import { useStore } from '../state/hooks';
import type { BoxView } from '../state/model';
import type { Setup } from '../state/setup';
import { createStore } from '../state/store';
import { Busy, Button, Card, Notice, Text, Tick, Toast, space } from '../ui';

export const EMPTY_VIEW = createStore<BoxView>({ model: null, banner: '', busy: false, catalog: null, domainMap: null, boxInfo: null, notice: null, loadedAt: 0 });

/** The setup of the selected box, and its model, kept current. */
export function useSetup(): { setup: Setup | null; view: BoxView } {
  const current = useStore(connection.current);
  const view = useStore(current.session ? current.session.view : EMPTY_VIEW);
  return { setup: current.session ? currentSetup() : null, view };
}

/** The selected box's latest message, while the view has it (the model clears it after the page's toast time). */
export function SessionToast() {
  const { view } = useSetup();
  const n = view.notice;
  return n ? <Toast text={n.text} error={n.error} /> : null;
}

/** The number the router (or a device) is given: box.json's address, else the address the app talks to the box at. Never a name. */
export function useBoxIp(setup: Setup | null, view: BoxView): string {
  const host = useStore(setup ? setup.host : EMPTY_HOST);
  return routerAddress(view.boxInfo, host);
}
const EMPTY_HOST = createStore('');

/**
 * The box's address, big, with Copy (pb-box.js's copy button: boxCopy, boxCopied, boxCopyFail). Without one, the page's words for that.
 * `device`: it is for one device's DNS setting, not the router's.
 */
export function BoxAddress({ ip, setup, device }: { ip: string; setup: Setup | null; device?: boolean }) {
  if (!ip) return <Notice kind="warn" testID="box-ip-none">{t('helpBodyNoIp')}</Notice>;
  async function copy() {
    try {
      await Clipboard.setStringAsync(ip);
      if (setup) setup.session.toast(t('boxCopied'));
    } catch {
      if (setup) setup.session.toast(t('boxCopyFail'), true);
    }
  }
  return (
    <Card>
      <Text variant="small">{device ? t('byHandAddress') : t('boxNetIp')}</Text>
      <Text variant="address" selectable testID="box-ip">{ip}</Text>
      <Button kind="plain" label={t('boxCopy')} accessibilityLabel={t('boxCopyAria', { what: device ? t('byHandAddress') : t('boxNetIp') })}
        onPress={() => { void copy(); }} testID="copy-ip" />
      <Text variant="small">{device ? t('byHandAddressNote') : t('routerAddressNote')}</Text>
    </Card>
  );
}

/** The live router check (every 5 s while shown): waiting for the first device, or done. */
export function RouterLive({ setup, done }: { setup: Setup; done: boolean }) {
  const live = useStore(setup.router);
  useEffect(() => (done ? undefined : setup.followRouter()), [setup, done]);
  if (done || live.pointsHere) {
    return (
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }} testID="router-seen">
        <Tick done />
        <View style={{ flex: 1 }}><Text>{t('routerSeen')}</Text></View>
      </View>
    );
  }
  return (
    <View style={{ gap: space.xs }} testID="router-waiting">
      <Busy label={t('routerWaiting')} />
      {live.checkedAt ? <Text variant="small">{t('routerChecked', { t: clockTime(live.checkedAt) })}</Text> : null}
    </View>
  );
}

function SetupRow({ item, setup, busy }: { item: SetupItem; setup: Setup; busy: boolean }) {
  const title = item.id === 'pw' ? t('setupPw') : item.id === 'router' ? t('setupRouter') : item.id === 'child' ? t('setupChild')
    : item.done ? t('setupCounterDone') : t('setupCounterQ');
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }} testID={'setup-' + item.id}>
      <Tick done={item.done} />
      <View style={{ flex: 1, gap: space.sm }}>
        <View accessible accessibilityLabel={title + ' (' + (item.done ? t('setupDone') : t('setupTodo')) + ')'}>
          <Text variant="heading">{title}</Text>
        </View>
        {!item.done && item.id === 'router' ? (
          <>
            <Text variant="small">{t('setupRouterHowApp')}</Text>
            <RouterLive setup={setup} done={item.done} />
            <Button kind="plain" label={t('setupRouterOpen')} onPress={() => router.push('/setup/router')} testID="setup-router-open" />
            <Button kind="link" label={t('setupByHandOpen')} onPress={() => router.push('/setup/by-hand')} testID="setup-by-hand-open" />
          </>
        ) : null}
        {!item.done && item.id === 'child' ? (
          <>
            <Text variant="small">{t('setupChildHow')}</Text>
            <Button kind="plain" label={t('addDevice')} onPress={() => router.push('/add-device')} testID="setup-add-device" />
          </>
        ) : null}
        {!item.done && item.id === 'counter' ? (
          <>
            <Text variant="small">{t('setupCounterText')}</Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button label={t('setupYes')} disabled={busy} onPress={() => { void setup.answerCounter(true); }} testID="counter-yes" />
              </View>
              <View style={{ flex: 1 }}>
                <Button kind="plain" label={t('setupNotNow')} disabled={busy} onPress={() => { void setup.answerCounter(false); }} testID="counter-no" />
              </View>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

/** The page's setup card: "{n} of {t} done", the steps, and Hide this list. */
export function SetupChecklist({ setup, list, busy, title, onHide }:
  { setup: Setup; list: SetupList; busy: boolean; title?: string; onHide?: () => void }) {
  return (
    <Card title={title}>
      <Text variant="small" testID="setup-progress">{t('setupProgress', { n: list.doneCount, t: list.items.length })}</Text>
      <View style={{ gap: space.lg, paddingVertical: space.sm }}>
        {list.items.map((i) => <SetupRow key={i.id} item={i} setup={setup} busy={busy} />)}
      </View>
      <Button kind="link" label={t('setupHide')} disabled={busy} onPress={() => { void setup.hide(); if (onHide) onHide(); }}
        testID="setup-hide" />
    </Card>
  );
}
