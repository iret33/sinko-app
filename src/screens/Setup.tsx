// The guided setup: opens once right after the parent chose the box's password (Home opens it), and shows the page's setup list with room
// for each step. The same list stays on Home as a card until every step is done or the parent hides it.
import { router } from 'expo-router';

import { t } from '../i18n';
import { Button, Header, Notice, Screen, Text } from '../ui';
import { SessionToast, SetupChecklist, useSetup } from './setupParts';

export function Setup() {
  const { setup, view } = useSetup();
  const list = setup ? setup.list(view) : null;
  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  return (
    <Screen overlay={<SessionToast />}>
      <Header title={t('setupTitle')} back={t('lvBack')} onBack={back} />
      <Text>{t('setupLead')}</Text>
      {setup && list && !list.hide ? <SetupChecklist setup={setup} list={list} busy={view.busy} onHide={back} /> : null}
      {list && list.all ? <Notice testID="setup-finished">{t('setupDoneToast')}</Notice> : null}
      <Button kind={list && list.hide ? 'primary' : 'plain'} label={list && list.hide ? t('done') : t('setupLater')} onPress={back}
        testID="setup-close" />
    </Screen>
  );
}
