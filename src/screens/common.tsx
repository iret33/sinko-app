// What the first screens share: the brand at the top with the page's language switch, and the short in-between screens.
import { View } from 'react-native';

import { getLang, t } from '../i18n';
import { language } from '../state/app';
import { Brand, Busy, Screen, space } from '../ui';

/** The page's language button: it names the other language (STR langSwitch) and switches to it. */
export function switchLanguage(): void {
  void language.choose(getLang() === 'ar' ? 'en' : 'ar');
}

export function Top({ title, sub }: { title: string; sub?: string }) {
  return <Brand title={title} sub={sub} onLanguage={switchLanguage} languageLabel={t('langSwitch')} />;
}

/** Before the boxes list has been read. */
export function Starting() {
  return <Screen><View /></Screen>;
}

export function Checking() {
  return (
    <Screen>
      <Top title={t('appName')} sub={t('tagline')} />
      <View style={{ paddingTop: space.xl }}><Busy label={t('lvLoading')} testID="checking" /></View>
    </Screen>
  );
}
