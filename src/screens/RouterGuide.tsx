// "Tell your router to use Sinko": the last step of Sinko's docs/install.md ("point your home at the box") with the box's address big, the
// steps for every router, a guide of its own for the routers of Batelco, Zain and stc once one is written (src/content/routers), and the
// live check that the router sends devices to the box.
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, View } from 'react-native';

import { ROUTER_BRANDS, guideReady, routerGuide, screenshot, type Guide, type GuideBlock } from '../content/guide';
import { getLang, t } from '../i18n';
import { ltr } from '../i18n/format';
import { Button, Card, Header, Notice, Screen, Steps, Text, space } from '../ui';
import { BoxAddress, RouterLive, SessionToast, useBoxIp, useSetup } from './setupParts';

type Choice = (typeof ROUTER_BRANDS)[number] | 'other' | null;

export function goBack(): void {
  if (router.canGoBack()) router.back(); else router.replace('/');
}

/** The steps that work on every router (docs/install.md), with the box's address in them. */
function genericSteps(ip: string): string[] {
  const a = ip ? ltr(ip) : t('routerTheAddress');
  return [t('routerStep1'), t('routerStep2', { ip: a }), t('routerStep3'), t('routerStep4'), t('routerStep5')];
}

function Blocks({ blocks, guide, ip }: { blocks: GuideBlock[]; guide: Guide; ip: string }) {
  const lang = getLang();
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'shot') {
          const src = screenshot(guide.brand, b.slot, lang);
          if (src === null) return null;
          const size = Image.resolveAssetSource(src);
          return <Image key={i} source={src} accessibilityLabel={b.alt} resizeMode="contain"
            style={{ width: '100%', aspectRatio: size && size.width && size.height ? size.width / size.height : 4 / 3, borderRadius: 10 }} />;
        }
        const text = b.text.split('{ip}').join(ltr(ip));
        return <Text key={i}>{b.kind === 'bullet' ? '• ' + text : text}</Text>;
      })}
    </>
  );
}

export function RouterGuide() {
  const { setup, view } = useSetup();
  const ip = useBoxIp(setup, view);
  const [choice, setChoice] = useState<Choice>(null);
  const lang = getLang();
  const guide = choice && choice !== 'other' ? routerGuide(choice, lang) : null;
  const ready = !!guide && guideReady(guide, lang);
  const list = setup ? setup.list(view) : null;
  const routerDone = !!(list && list.items.some((i) => i.id === 'router' && i.done));

  return (
    <Screen overlay={<SessionToast />}>
      <Header title={t('routerTitle')} back={t('lvBack')} onBack={goBack} />
      <Text>{t('routerLead')}</Text>
      <BoxAddress ip={ip} setup={setup} />

      <Card title={t('routerWhich')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {[...ROUTER_BRANDS, 'other' as const].map((b) => {
            const g = b === 'other' ? null : routerGuide(b, lang);
            const label = b === 'other' ? t('routerOther') : (g && g.name) || b;
            return (
              <View key={b} style={{ flexGrow: 1, flexBasis: '40%' }}>
                <Button kind={choice === b ? 'primary' : 'plain'} label={label} onPress={() => setChoice(b)} testID={'brand-' + b} />
              </View>
            );
          })}
        </View>
      </Card>

      {guide && ready ? (
        <Card title={guide.title || guide.name}>
          <Blocks blocks={guide.intro} guide={guide} ip={ip} />
          <Steps testID="brand-steps" items={guide.steps.map((s, i) => (
            <View key={i} style={{ gap: space.xs }}>
              <Text variant="heading">{s.title}</Text>
              <Blocks blocks={s.blocks} guide={guide} ip={ip} />
            </View>
          ))} />
        </Card>
      ) : (
        <Card title={t('routerSteps')}>
          {guide && !ready ? <Notice testID="brand-not-ready">{t('routerNoGuide', { brand: guide.name || String(choice) })}</Notice> : null}
          <Steps testID="generic-steps" items={genericSteps(ip)} />
        </Card>
      )}

      <Card title={t('routerCheckTitle')}>
        <Text variant="small">{t('routerCheckLead')}</Text>
        {setup ? <RouterLive setup={setup} done={routerDone} /> : null}
      </Card>

      <Card>
        <Text>{t('routerCantChange')}</Text>
        <Button kind="plain" label={t('byHandOpen')} onPress={() => router.push('/setup/by-hand')} testID="open-by-hand" />
      </Card>
    </Screen>
  );
}
