// No password and no Sinko groups yet: a ready-made box makes them during its first start, so the app waits and looks again every 30 s
// (the connection does). Only after ten minutes does it point to the install guide.
import { Linking } from 'react-native';

import { locale, t } from '../i18n';
import { connection } from '../state/app';
import { Button, Notice, Screen, Text } from '../ui';
import { Top } from './common';

const GUIDE_AFTER_MS = 10 * 60000;
export const INSTALL_GUIDE = 'https://github.com/iret33/sinko/blob/master/docs/install.md';

export function Waiting({ since, checkedAt }: { since: number; checkedAt: number }) {
  const time = new Date(checkedAt).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return (
    <Screen>
      <Top title={t('waitTitle')} sub={t('tagline')} />
      <Notice testID="not-installed">{t('waitBody')}</Notice>
      <Text variant="small">{t('waitChecked', { t: time })}</Text>
      <Button kind="plain" label={t('checkNow')} onPress={() => { void connection.check(); }} testID="check-now" />
      {checkedAt - since >= GUIDE_AFTER_MS ? (
        <>
          <Text>{t('waitGuide')}</Text>
          <Button kind="link" label={t('waitGuideLink')} onPress={() => { void Linking.openURL(INSTALL_GUIDE); }} testID="install-guide" />
        </>
      ) : null}
    </Screen>
  );
}
