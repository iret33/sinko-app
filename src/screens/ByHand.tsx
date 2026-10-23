// "Set Sinko on one device": the box as the DNS server of one device, for a router that cannot be changed or for one device only, said
// plainly to be easier to undo than the router and never on mobile data (Screen Time and Family Link, as the quick-start card says). Then
// "Check this device" (src/state/deviceCheck.ts): has the box heard from that device since the parent tapped Check?
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { serverNowSec } from '../api';
import { IPV4_RE, deviceIps, deviceLabel } from '../core';
import { t } from '../i18n';
import { fmtAgo, isolate, ltr } from '../i18n/format';
import { newDeviceCheck } from '../state/app';
import type { DeviceCheckState, DeviceTarget } from '../state/deviceCheck';
import { useStore } from '../state/hooks';
import { createStore } from '../state/store';
import { Busy, Button, Card, Field, Header, Notice, Pick, Screen, Steps, Text, space } from '../ui';
import { goBack } from './RouterGuide';
import { BoxAddress, SessionToast, useBoxIp, useSetup } from './setupParts';

interface Option { key: string; name: string; lines: string[]; target: DeviceTarget }

const IDLE = createStore<DeviceCheckState>({ phase: 'idle' });
const NO_HOST = createStore('');
/** Devices offered for the check: at most this many, the ones that asked the box last first. */
const MAX_OFFERED = 25;

export function ByHand() {
  const { setup, view } = useSetup();
  const ip = useBoxIp(setup, view);
  const host = useStore(setup ? setup.host : NO_HOST);
  const [check] = useState(newDeviceCheck);
  const state = useStore(check ? check.state : IDLE);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState('');          // the name of the device being checked, as it was when Check was tapped
  useEffect(() => () => { if (check) check.stop(); }, [check]);

  const a = ip ? ltr(ip) : t('routerTheAddress');
  const m = view.model;
  const nowSec = serverNowSec();
  const options: Option[] = [{ key: 'phone', name: t('thisDevice'), lines: [m && m.myIp ? ltr(m.myIp) : ''], target: { kind: 'thisPhone' } }];
  if (m) {
    const self = ['127.0.0.1', '::1', host, view.boxInfo ? view.boxInfo.ip : ''].filter(Boolean);
    m.devices.filter((d) => {
      const ips = deviceIps(d);
      return ips.length > 0 && !(m.myIp && ips.indexOf(m.myIp) >= 0) && !ips.some((x) => self.indexOf(x) >= 0);
    }).sort((x, y) => y.lastQuery - x.lastQuery).slice(0, MAX_OFFERED).forEach((d) => {
      const ips = deviceIps(d);
      const kid = m.kids.find((k) => k.dev === d);
      const label = (kid && kid.name) || deviceLabel(d) || d.macVendor || ips[0];
      options.push({ key: 'dev:' + d.hwaddr, name: label === ips[0] ? ltr(label) : isolate(label), lines: [label === ips[0] ? '' : ltr(ips[0]), fmtAgo(d.lastQuery, nowSec)],
        target: { kind: 'device', ips } });
    });
  }

  const chosen = typed.trim() ? null : options.find((o) => o.key === picked) || null;
  const name = typed.trim() ? ltr(typed.trim()) : chosen ? chosen.name : '';
  const thisPhone = !typed.trim() && !!chosen && chosen.target.kind === 'thisPhone';

  function start() {
    setError('');
    const v = typed.trim();
    let target: DeviceTarget | null = null;
    if (v) {
      if (!IPV4_RE.test(v)) { setError(t('checkBadAddr')); return; }
      target = { kind: 'device', ips: [v] };
    } else if (chosen) target = chosen.target;
    if (!target) { setError(t('checkPick')); return; }
    setChecking(name);
    if (check) void check.start(target);
  }

  const watching = state.phase === 'watching';
  return (
    <Screen overlay={<SessionToast />}>
      <Header title={t('byHandTitle')} back={t('lvBack')} onBack={goBack} />
      <Text>{t('byHandLead')}</Text>
      <Notice kind="warn" testID="by-hand-caveat">
        <View style={{ gap: space.sm }}>
          <Text>{t('byHandCaveat')}</Text>
          <Text variant="small">{t('byHandCard')}</Text>
        </View>
      </Notice>
      <BoxAddress ip={ip} setup={setup} device />

      <Card title={t('byHandIos')}>
        <Steps items={[t('byHandIos1'), t('byHandIos2'), t('byHandIos3'), t('byHandIos4', { ip: a })]} testID="steps-ios" />
        <Text variant="small">{t('byHandIosNote')}</Text>
      </Card>
      <Card title={t('byHandAndroid')}>
        <Text variant="small">{t('byHandAndroidNote')}</Text>
        <Steps items={[t('byHandAndroid1'), t('byHandAndroid2'), t('byHandAndroid3', { ip: a }), t('byHandAndroid4')]} testID="steps-android" />
      </Card>
      <Card title={t('byHandOther')}>
        <Text>{t('byHandOther1', { ip: a })}</Text>
      </Card>

      <Card title={t('checkTitle')}>
        <Text variant="small">{t('checkWhich')}</Text>
        <View style={{ gap: space.sm }}>
          {options.map((o) => (
            <Pick key={o.key} title={o.name} lines={o.lines} selected={!typed.trim() && picked === o.key} testID={'check-' + o.key}
              onPress={() => { setPicked(o.key); setTyped(''); setError(''); }} />
          ))}
        </View>
        <Field label={t('checkTypeLabel')} value={typed} onChangeText={(v) => { setTyped(v); setError(''); }} placeholder="192.168.1.20" ltr
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'url'} testID="check-address" />
        <Text variant="small">{t('checkTypeNote')}</Text>
        <Text>{thisPhone ? t('checkHowPhone') : t('checkHowOther')}</Text>
        {error ? <Notice kind="error" testID="check-error">{error}</Notice> : null}
        <Button label={state.phase === 'idle' || watching ? t('checkBtn') : t('boxCheckAgain')} busy={watching} onPress={start} testID="check" />
        {watching ? (
          <View style={{ gap: space.xs }} testID="check-watching">
            <Busy label={t('checkWatching', { n: checking })} />
            {state.slow ? <Text variant="small">{t('checkSlow')}</Text> : null}
          </View>
        ) : null}
        {state.phase === 'passed' ? <Notice testID="check-passed">{'✓ ' + t('checkPassed', { n: checking })}</Notice> : null}
        {state.phase === 'notSeen' ? <Notice kind="warn" testID="check-not-seen">{t('checkNotSeen', { n: checking, ip: a })}</Notice> : null}
        {state.phase === 'failed' ? <Notice kind="error" testID="check-failed">{t('checkFailed')}</Notice> : null}
      </Card>
    </Screen>
  );
}
