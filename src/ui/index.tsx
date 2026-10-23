// The first pieces of the design system. Every screen is built from these, so colours and spacing come from one place (theme.ts).
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text as RNText, TextInput, View, type TextInputProps, type TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radius, space, type, useTheme } from './theme';

export * from './theme';

export function Screen({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.pearl }} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.sm }}>
      {title ? <Text variant="heading">{title}</Text> : null}
      {children}
    </View>
  );
}

type Variant = 'title' | 'heading' | 'body' | 'small' | 'mono' | 'error';
export function Text({ variant = 'body', children, selectable, testID }: { variant?: Variant; children: ReactNode; selectable?: boolean; testID?: string }) {
  const { c } = useTheme();
  const styles: Record<Variant, TextStyle> = {
    title: { fontSize: type.title, fontWeight: '700', color: c.ink },
    heading: { fontSize: type.heading, fontWeight: '600', color: c.ink },
    body: { fontSize: type.body, color: c.ink, lineHeight: 21 },
    small: { fontSize: type.small, color: c.ink2, lineHeight: 18 },
    mono: { fontSize: type.mono, color: c.ink, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), lineHeight: 17,
      direction: 'ltr', writingDirection: 'ltr' },       // code reads left to right in Arabic too
    error: { fontSize: type.body, color: c.coralInk, lineHeight: 21 },
  };
  return <RNText style={styles[variant]} selectable={selectable} testID={testID}>{children}</RNText>;
}

/** A label and its value on one line. */
export function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
      <Text variant="small">{label}</Text>
      <View style={{ flexShrink: 1 }}><Text testID={testID} selectable>{value}</Text></View>
    </View>
  );
}

export function Button({ label, onPress, kind = 'primary', disabled, busy, testID }:
  { label: string; onPress: () => void; kind?: 'primary' | 'plain' | 'link'; disabled?: boolean; busy?: boolean; testID?: string }) {
  const { c } = useTheme();
  const primary = kind === 'primary', link = kind === 'link';
  const off = disabled || busy;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} disabled={off} onPress={onPress} testID={testID}
      hitSlop={link ? 8 : undefined}
      style={({ pressed }) => ({
        backgroundColor: link ? 'transparent' : primary ? c.primary : c.surface, borderColor: link ? 'transparent' : primary ? c.primary : c.line,
        borderWidth: link ? 0 : 1, borderRadius: radius.md, paddingVertical: link ? space.xs : space.md, paddingHorizontal: link ? 0 : space.lg,
        alignItems: link ? 'flex-start' : 'center', flexDirection: 'row', justifyContent: link ? 'flex-start' : 'center', gap: space.sm,
        opacity: off ? 0.5 : pressed ? 0.7 : 1,
      })}>
      {busy ? <ActivityIndicator color={primary ? '#FFFFFF' : c.ink2} size="small" /> : null}
      <RNText style={{ color: primary ? '#FFFFFF' : link ? c.lagoonInk : c.ink, fontSize: type.body, fontWeight: '600' }}>{label}</RNText>
    </Pressable>
  );
}

/** A switch with its label, and a note under it. */
export function SwitchRow({ label, value, onChange, note, disabled, testID }:
  { label: string; value: boolean; onChange: (v: boolean) => void; note?: string; disabled?: boolean; testID?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <View style={{ flexShrink: 1 }}><Text>{label}</Text></View>
        <Switch value={value} onValueChange={onChange} disabled={disabled} testID={testID} accessibilityLabel={label}
          trackColor={{ true: c.lagoon, false: c.line }} />
      </View>
      {note ? <Text variant="small">{note}</Text> : null}
    </View>
  );
}

/** A calm box of text: information, a warning, or something that went wrong. */
export function Notice({ kind = 'info', title, children, testID }: { kind?: 'info' | 'warn' | 'error'; title?: string; children: ReactNode; testID?: string }) {
  const { c } = useTheme();
  const bg = kind === 'error' ? c.coralSoft : kind === 'warn' ? c.dune : c.lagoonSoft;
  const ink = kind === 'error' ? c.coralInk : kind === 'warn' ? c.duneInk : c.lagoonInk;
  return (
    <View testID={testID} accessibilityRole={kind === 'error' ? 'alert' : undefined}
      style={{ backgroundColor: bg, borderRadius: radius.md, padding: space.md, gap: space.xs }}>
      {title ? <RNText style={{ color: ink, fontSize: type.body, fontWeight: '700' }}>{title}</RNText> : null}
      {typeof children === 'string' ? <RNText style={{ color: ink, fontSize: type.body, lineHeight: 21 }}>{children}</RNText> : children}
    </View>
  );
}

/** Something is going on: a spinner and what it is. */
export function Busy({ label, testID }: { label: string; testID?: string }) {
  const { c } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <ActivityIndicator color={c.lagoon} />
      <Text variant="small">{label}</Text>
    </View>
  );
}

/** Sinko's name and tagline at the top of the first screens, with the page's language switch (it names the other language). */
export function Brand({ title, sub, onLanguage, languageLabel }: { title: string; sub?: string; onLanguage?: () => void; languageLabel?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.xs, paddingTop: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.lagoon, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '800' }}>S</RNText>
        </View>
        {onLanguage && languageLabel ? <Button kind="link" label={languageLabel} onPress={onLanguage} testID="language" /> : null}
      </View>
      <Text variant="title">{title}</Text>
      {sub ? <Text variant="small">{sub}</Text> : null}
    </View>
  );
}

/** A tappable card: a box that was found. */
export function Choice({ title, lines, badge, onPress, testID }: { title: string; lines: string[]; badge?: string; onPress: () => void; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID}
      style={({ pressed }) => ({ backgroundColor: c.surface, borderColor: c.lagoon, borderWidth: 1, borderRadius: radius.lg, padding: space.lg,
        gap: space.xs, opacity: pressed ? 0.75 : 1 })}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
        <Text variant="heading">{title}</Text>
        {badge ? <RNText style={{ color: c.lagoonInk, backgroundColor: c.lagoonSoft, fontSize: type.small, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden' }}>{badge}</RNText> : null}
      </View>
      {lines.map((l, i) => <Text key={i} variant="small">{l}</Text>)}
    </Pressable>
  );
}

export function Field({ label, ltr, ...props }: TextInputProps & { label: string; ltr?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="small">{label}</Text>
      <TextInput placeholderTextColor={c.ink2} autoCapitalize="none" autoCorrect={false} accessibilityLabel={label} {...props}
        style={{ borderColor: c.line, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm + 2,
          fontSize: type.body, color: c.ink, backgroundColor: c.surface,
          ...(ltr ? { direction: 'ltr', writingDirection: 'ltr' } : null) }} />
    </View>
  );
}
