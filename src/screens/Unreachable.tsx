// The selected box does not answer: try again, or look for it (the router may have given it a new address; the search knows it again
// by its boxId and updates the address).
import { t } from '../i18n';
import { connection } from '../state/app';
import { Button, Notice, Screen, Text } from '../ui';
import { Top } from './common';

export function Unreachable({ message }: { message: string }) {
  return (
    <Screen>
      <Top title={t('unreachableTitle')} />
      <Notice kind="error" testID="unreachable">{message || t('noConnection')}</Notice>
      <Text variant="small">{t('unreachableHint')}</Text>
      <Button label={t('tryAgain')} onPress={() => { void connection.check(); }} testID="try-again" />
      <Button kind="plain" label={t('lookForBox')} onPress={() => connection.findAgain()} testID="look-for-box" />
    </Screen>
  );
}
