// The page's #claim (Sinko web/index.html) and claim() (web/app.js line 548): the box has Sinko and no password yet, so the parent chooses
// one. The phone's password manager may keep it: the fields say "new password" to iOS (textContentType) and Android (autofill hints).
import { useState } from 'react';

import { passwordProblem } from '../core/box';
import { t } from '../i18n';
import { connection } from '../state/app';
import { ClaimTaken } from '../state/connection';
import { Button, Field, Notice, Screen, SwitchRow, Text } from '../ui';
import { Top } from './common';

export function Claim() {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [taken, setTaken] = useState(false);

  async function submit() {
    setError('');
    const problem = passwordProblem('', pw, again);
    if (problem === 'boxPwShort') { setError(t('claimShort')); return; }
    if (problem === 'boxPwMismatch') { setError(t('claimMismatch')); return; }
    setBusy(true);
    try {
      await connection.claim(pw, keep);
    } catch (e) {
      if (e instanceof ClaimTaken) setTaken(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (taken) {
    return (
      <Screen>
        <Top title={t('claimTakenTitle')} />
        <Notice kind="warn" testID="claim-taken">{t('claimTaken')}</Notice>
        <Button label={t('signIn')} onPress={() => { void connection.check(); }} testID="taken-sign-in" />
      </Screen>
    );
  }
  return (
    <Screen>
      <Top title={t('claimTitle')} sub={t('tagline')} />
      <Text>{t('appClaimLead')}</Text>
      <Notice kind="warn">{t('appClaimWhy')}</Notice>
      <Field label={t('claimPw')} value={pw} onChangeText={setPw} secureTextEntry textContentType="newPassword" autoComplete="new-password"
        passwordRules="minlength: 8;" returnKeyType="next" testID="claim-password" />
      <Field label={t('claimPw2')} value={again} onChangeText={setAgain} secureTextEntry textContentType="newPassword" autoComplete="new-password"
        passwordRules="minlength: 8;" returnKeyType="go" onSubmitEditing={() => { void submit(); }} testID="claim-password2" />
      <SwitchRow label={t('keepSignedIn')} value={keep} onChange={setKeep} note={t('keepSignedInNote')} testID="claim-keep" />
      {error ? <Notice kind="error" testID="claim-error">{error}</Notice> : null}
      <Button label={busy ? t('claimBusy') : t('claimBtn')} busy={busy} onPress={() => { void submit(); }} testID="claim" />
    </Screen>
  );
}
