// The page's add sheet (Sinko web/index.html #addDialog; app.js openAdd line 912, renderPicker line 919, pick line 951, addDevice line 958):
// pick one of the devices the box has seen, or type its address, give it a name, and add it (src/state/setup.ts addDevice). Opened from the
// setup list and from Home. Unlike the page, it reads the box again when it opens, and on "Look again", so a device that joined the Wi-Fi
// a moment ago is in the list.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { serverNowSec } from '../api';
import { MAC_RE, normalizeAddr, pickerEntries } from '../core';
import { t } from '../i18n';
import { fmtAgo, isolate, ltr } from '../i18n/format';
import { Busy, Button, Field, Header, Notice, Pick, Screen, Text, space } from '../ui';
import { SessionToast, useSetup } from './setupParts';

/** app.js devName maxlength (index.html line 323). */
export const NAME_MAX = 40;

export function AddDevice() {
  const { setup, view } = useSetup();
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(true);
  const session = setup ? setup.session : null;

  const nowSec = serverNowSec();
  const entries = view.model ? pickerEntries(view.model, nowSec) : [];

  /** Reads the box again; openAdd: the address field is open when the list is empty. */
  function reload(): Promise<void> {
    if (!session) return Promise.resolve();
    return session.load().catch(() => null).then((m) => {
      setLoading(false);
      if (m && !pickerEntries(m, serverNowSec()).length) setManual(true);
    });
  }
  useEffect(() => { void reload(); }, [session]);   // eslint-disable-line react-hooks/exhaustive-deps
  function lookAgain() { setLoading(true); void reload(); }

  function close() { if (router.canGoBack()) router.back(); else router.replace('/'); }

  function submit(addr: string) {
    close();                                    // the page closes the sheet first; the message comes on the screen below
    if (setup) void setup.addDevice(addr, name);
  }

  /** app.js addDevice (line 958). */
  function add() {
    const v = typed.trim();
    const addr = v ? normalizeAddr(v) : picked;
    if (v && !addr) { setError(t('badAddr')); return; }
    if (!addr) { setError(t('pickOrType')); return; }
    if (v && addr.indexOf(':') >= 0 && !MAC_RE.test(addr)) {           // an IPv6 address typed by hand
      Alert.alert('', t('ipv6Warn'), [{ text: t('cancel'), style: 'cancel' }, { text: t('add'), onPress: () => submit(addr) }]);
      return;
    }
    submit(addr);
  }

  return (
    <Screen overlay={<SessionToast />}>
      <Header title={t('addDevice')} back={t('close')} onBack={close} />
      <Text variant="small">{t('addHint')}</Text>

      {loading && !entries.length ? <Busy label={t('lvLoading')} testID="picker-loading" /> : null}
      {!loading && !entries.length ? <Notice testID="picker-empty">{t('noPicker')}</Notice> : null}
      <View style={{ gap: space.sm }}>
        {entries.map((e) => (
          <Pick key={e.addr} title={isolate(e.label)} selected={picked === e.addr} testID={'pick-' + e.addr}
            lines={[[e.mine ? t('thisDevice') : '', e.ip ? ltr(e.ip) : '', isolate(e.vendor)].filter(Boolean).join('  '), fmtAgo(e.lastQuery, nowSec)]}
            onPress={() => {
              setPicked(e.addr);
              if (!name) setName(e.name);              // app.js pick: the name field is filled only when it is empty
              setError('');
            }} />
        ))}
      </View>
      <Button kind="plain" label={t('findAgain')} busy={loading} onPress={lookAgain} testID="picker-again" />

      <Button kind="link" label={t('manual')} onPress={() => setManual(!manual)} testID="manual-toggle" />
      {manual ? (
        <Field label={t('addrLabel')} value={typed} onChangeText={(v) => { setTyped(v); setError(''); }} autoCapitalize="characters"
          placeholder="A4:83:E7:12:34:56" ltr testID="manual-address" />
      ) : null}
      <Field label={t('nameLabel')} value={name} onChangeText={setName} maxLength={NAME_MAX} autoCapitalize="words" testID="device-name" />
      {error ? <Notice kind="error" testID="add-error">{error}</Notice> : null}
      <Button label={t('add')} disabled={view.busy || !view.model} onPress={add} testID="add" />
      <Text variant="small">{t('macTip')}</Text>
    </Screen>
  );
}
