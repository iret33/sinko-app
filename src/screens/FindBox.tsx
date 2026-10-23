// Finding the box (src/state/discovery.ts): Bonjour, sinko.local and the scan of this Wi-Fi start together, each box is listed as soon
// as it answers, and after about ten seconds the screen also offers typing the address, with where to find it.
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, View } from 'react-native';

import { t } from '../i18n';
import { boxes, connection, newDiscovery } from '../state/app';
import { hostOf, type FoundBox } from '../state/discovery';
import { useStore } from '../state/hooks';
import { Busy, Button, Card, Choice, Field, Notice, Screen, Text, space } from '../ui';
import { Top } from './common';

export function FindBox() {
  const [search] = useState(newDiscovery);
  const s = useStore(search.state);
  const saved = useStore(boxes.state);
  const [address, setAddress] = useState('');
  const [manual, setManual] = useState<{ kind: 'info' | 'warn' | 'error'; title?: string; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [choosing, setChoosing] = useState('');

  useEffect(() => {
    search.start();
    // Back from the phone's settings (Local Network switched on, Wi-Fi joined): look again.
    const sub = AppState.addEventListener('change', (st) => {
      const now = search.state.get();
      if (st === 'active' && (now.access === 'denied' || now.wifi === false)) search.start();
    });
    return () => { sub.remove(); search.stop(); };
  }, [search]);

  async function choose(b: FoundBox) {
    setChoosing(b.key);
    search.stop();
    try { await connection.chooseBox(hostOf(b.ip, b.port), b.info); } finally { setChoosing(''); }
  }

  async function connectTyped() {
    const text = address.trim();
    if (!text) return;
    setManual({ kind: 'info', text: t('manualChecking', { host: text }) });
    setChecking(true);
    try {
      const r = await search.manual(text);
      if (r.kind === 'found') { setManual(null); await choose(r.box); return; }
      if (r.kind === 'old') setManual({ kind: 'warn', title: t('oldBoxTitle'), text: t('oldBox', { host: r.host }) });
      else if (r.kind === 'nothing') setManual({ kind: 'error', text: t('manualNothing', { host: r.host }) });
      else setManual({ kind: 'error', text: r.message });
    } finally {
      setChecking(false);
    }
  }

  const scanLine = s.scan && s.running ? t('findScanned', { n: s.scan.checked, t: s.scan.total }) : '';
  return (
    <Screen>
      <Top title={t('findTitle')} sub={t('findLead')} />

      {s.access === 'denied' ? (
        <Notice kind="warn" title={t('localDeniedTitle')} testID="local-denied">
          <View style={{ gap: space.sm }}>
            <Text>{t(Platform.OS === 'ios' ? 'localDeniedIos' : 'localDeniedAndroid')}</Text>
            <Button kind="plain" label={t('openSettings')} onPress={() => { void Linking.openSettings(); }} testID="open-settings" />
          </View>
        </Notice>
      ) : null}
      {s.wifi === false ? <Notice kind="warn" title={t('notWifiTitle')} testID="not-wifi">{t('notWifi')}</Notice> : null}

      {s.running ? (
        <View style={{ gap: space.xs }}>
          <Busy label={t('findSearching')} testID="searching" />
          {scanLine ? <Text variant="small">{scanLine}</Text> : null}
        </View>
      ) : (
        <Text variant="small" testID="search-over">{s.boxes.length ? t('findFinished') : t('findNone')}</Text>
      )}

      {s.boxes.length ? (
        <View style={{ gap: space.sm }}>
          <Text variant="heading">{t('findFound')}</Text>
          {s.boxes.map((b) => (
            <Choice key={b.key} testID={'found-' + b.ip}
              title={b.info.hostname || t('appName')}
              lines={[hostOf(b.ip, b.port), b.info.version ? t('boxAboutVersion', { v: b.info.version }) : '', choosing === b.key ? t('lvLoading') : '']
                .filter(Boolean)}
              badge={b.savedId ? t('findKnown') : undefined}
              onPress={() => { if (!choosing) void choose(b); }} />
          ))}
        </View>
      ) : null}

      {s.old.map((o) => (
        <Notice key={o.ip + ':' + o.port} kind="warn" title={t('oldBoxTitle')} testID={'old-' + o.ip}>{t('oldBox', { host: hostOf(o.ip, o.port) })}</Notice>
      ))}

      {s.slow || !s.running ? (
        <Card title={t('manualTitle')}>
          <Field label={t('manualLabel')} value={address} onChangeText={setAddress} placeholder={t('manualPlaceholder')} keyboardType="url" ltr
            returnKeyType="go" onSubmitEditing={() => { void connectTyped(); }} testID="address" />
          <Button label={t('manualConnect')} onPress={() => { void connectTyped(); }} disabled={!address.trim()} busy={checking} testID="connect" />
          {manual ? <Notice kind={manual.kind} title={manual.title} testID="manual-result">{manual.text}</Notice> : null}
          <Text variant="small">{t('manualRouter')}</Text>
          <Text variant="small">{t('manualCard')}</Text>
        </Card>
      ) : null}

      {!s.running ? <Button kind="plain" label={t('findAgain')} onPress={() => search.start()} testID="look-again" /> : null}
      {saved.activeId ? <Button kind="link" label={t('cancel')} onPress={() => { void connection.check(); }} testID="back-to-box" /> : null}
    </Screen>
  );
}
