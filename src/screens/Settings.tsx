// The settings: the language (the phone's by default), "Keep me signed in", the box, and signing out.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { getLang, t, type Lang } from '../i18n';
import { connection, language, sessions } from '../state/app';
import { PROBLEM_TEXT } from '../state/auth';
import { useLang, useStore } from '../state/hooks';
import { Button, Card, Field, Notice, Row, Screen, SwitchRow, Text, space } from '../ui';

export function Settings() {
  useLang();
  const current = useStore(connection.current);
  const kept = useStore(sessions.kept);
  const box = current.box;
  const isKept = !!(box && kept[box.id]);
  const totp = connection.totp();
  const [asking, setAsking] = useState(false);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function pick(lang: Lang) { if (lang !== getLang()) void language.choose(lang); }

  async function keepNow() {
    setError(''); setBusy(true);
    try {
      const r = await connection.keepSignedIn(pw);
      if (r.ok) { setAsking(false); setPw(''); return; }
      setError(r.problem === 'needCode' && totp ? t('keepSignedInTotp') : t(PROBLEM_TEXT[r.problem], { e: r.message }));
    } finally { setBusy(false); }
  }

  function onKeep(on: boolean) {
    setError('');
    if (on) { setAsking(true); return; }
    setAsking(false);
    void connection.forgetPassword();
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="title">{t('settingsTitle')}</Text>
        <Button kind="link" label={t('done')} onPress={() => router.back()} testID="settings-done" />
      </View>

      <Card title={t('language')}>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {(['en', 'ar'] as const).map((l) => (
            <View key={l} style={{ flex: 1 }}>
              <Button label={l === 'en' ? t('langEnglish') : t('langArabic')} kind={getLang() === l ? 'primary' : 'plain'} onPress={() => pick(l)}
                testID={'lang-' + l} />
            </View>
          ))}
        </View>
        <Text variant="small">{t('langRestart')}</Text>
      </Card>

      {box ? (
        <Card title={t('signInSection')}>
          <SwitchRow label={t('keepSignedIn')} value={isKept || asking} onChange={onKeep} disabled={totp && !isKept}
            note={totp ? t('keepSignedInTotp') : t('keepSignedInNote')} testID="settings-keep" />
          {asking && !isKept ? (
            <>
              <Text variant="small">{t('keepSignedInAsk')}</Text>
              <Field label={t('password')} value={pw} onChangeText={setPw} secureTextEntry textContentType="password" autoComplete="current-password"
                onSubmitEditing={() => { void keepNow(); }} testID="settings-password" />
              <Button label={t('keepSignedInSave')} busy={busy} disabled={!pw} onPress={() => { void keepNow(); }} testID="settings-keep-save" />
            </>
          ) : null}
          {error ? <Notice kind="error">{error}</Notice> : null}
        </Card>
      ) : null}

      {box ? (
        <Card title={t('boxSection')}>
          <Row label={t('boxName')} value={box.name || t('appName')} />
          <Row label={t('boxAddress')} value={box.host} />
          <Button kind="plain" label={t('otherBox')} onPress={() => { router.back(); connection.findAgain(); }} testID="settings-other-box" />
          <Button kind="plain" label={t('signOut')} onPress={() => { router.back(); void connection.signOut(); }} testID="settings-sign-out" />
        </Card>
      ) : null}
    </Screen>
  );
}
