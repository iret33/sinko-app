// The page's #login (Sinko web/index.html) and login() (web/app.js line 582). The code field shows only when the box asks for one
// (session.totp) or the answer is about a code; "Keep me signed in" cannot be on then, because the app cannot type the code itself.
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { t } from '../i18n';
import { connection, sessions } from '../state/app';
import { PROBLEM_TEXT, problemNeedsCode } from '../state/auth';
import { useStore } from '../state/hooks';
import { Button, Field, Notice, Screen, SwitchRow, Text, space } from '../ui';
import { Top } from './common';

export function SignIn({ note, totp }: { note: string; totp: boolean }) {
  const current = useStore(connection.current);
  const kept = useStore(sessions.kept);
  const box = current.box;
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(totp);
  const [keep, setKeep] = useState(!!(box && kept[box.id]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!pw) return;
    setBusy(true);
    try {
      const c = code.trim();
      const r = await connection.signIn(pw, needCode && /^\d{6}$/.test(c) ? Number(c) : undefined, keep && !needCode);
      if (r.ok) return;
      if (problemNeedsCode(r.problem) || connection.totp()) { setNeedCode(true); setKeep(false); }
      setError(t(PROBLEM_TEXT[r.problem], { e: r.message }));
      if (r.problem === 'reusedCode' || r.problem === 'wrongCode') setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Top title={t('appName')} sub={t('tagline')} />
      {note ? <Notice testID="sign-in-note">{note}</Notice> : null}
      <Text>{t('loginHint')}</Text>
      {box ? <Text variant="small" testID="sign-in-box">{(box.name || t('appName')) + ' · ' + box.host}</Text> : null}
      <Field label={t('password')} value={pw} onChangeText={setPw} secureTextEntry textContentType="password" autoComplete="current-password"
        returnKeyType="go" onSubmitEditing={() => { void submit(); }} testID="password" />
      {needCode ? (
        <Field label={t('totp')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6}
          textContentType="oneTimeCode" autoComplete={Platform.OS === 'android' ? '2fa-app-otp' : 'one-time-code'} ltr testID="code" />
      ) : null}
      <SwitchRow label={t('keepSignedIn')} value={keep && !needCode} onChange={setKeep} disabled={needCode}
        note={needCode ? t('keepSignedInTotp') : t('keepSignedInNote')} testID="keep" />
      {error ? <Notice kind="error" testID="sign-in-error">{error}</Notice> : null}
      <View style={{ gap: space.sm }}>
        <Button label={busy ? t('signingIn') : t('signIn')} busy={busy} disabled={!pw} onPress={() => { void submit(); }} testID="sign-in" />
        <Button kind="link" label={t('otherBox')} onPress={() => connection.findAgain()} testID="other-box" />
      </View>
    </Screen>
  );
}
