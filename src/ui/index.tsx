// The first pieces of the design system. Every screen is built from these, so colours and spacing come from one place (theme.ts).
import type { ReactNode } from 'react';
import { ActivityIndicator, I18nManager, Platform, Pressable, ScrollView, Switch, Text as RNText, TextInput, View, type TextInputProps, type TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radius, space, type, useTheme } from './theme';

export * from './theme';

/** `overlay` is drawn over the scrolling content (a toast). */
export function Screen({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.pearl }} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {overlay}
    </SafeAreaView>
  );
}

/** The top of a screen that was opened from another: its title, and the way back (a link that says Back, or Close on a sheet). */
export function Header({ title, back, onBack, sub }: { title: string; back: string; onBack: () => void; sub?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Button kind="link" label={back} onPress={onBack} testID="back" />
      <Text variant="title">{title}</Text>
      {sub ? <Text variant="small">{sub}</Text> : null}
    </View>
  );
}

/** Numbered steps. Each is a string, or anything to draw. */
export function Steps({ items, testID }: { items: ReactNode[]; testID?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.sm }} testID={testID}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.lagoonSoft, alignItems: 'center', justifyContent: 'center' }}>
            <RNText style={{ color: c.lagoonInk, fontSize: type.small, fontWeight: '700' }}>{i + 1}</RNText>
          </View>
          <View style={{ flex: 1, gap: space.xs }}>{typeof item === 'string' ? <Text>{item}</Text> : item}</View>
        </View>
      ))}
    </View>
  );
}

/** A step of a checklist: a tick when it is done, a dot while it is not. */
export function Tick({ done }: { done: boolean }) {
  const { c } = useTheme();
  return (
    <View importantForAccessibility="no" accessibilityElementsHidden
      style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
        backgroundColor: done ? c.lagoon : 'transparent', borderWidth: done ? 0 : 2, borderColor: c.line }}>
      {done ? <RNText style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '800' }}>✓</RNText>
        : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.ink2 }} />}
    </View>
  );
}

/** A row the parent picks one of (a device): pressed, it shows it is the chosen one. */
export function Pick({ title, lines, selected, onPress, testID }: { title: string; lines: string[]; selected: boolean; onPress: () => void; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} testID={testID}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md,
        borderWidth: selected ? 2 : 1, borderColor: selected ? c.lagoon : c.line, backgroundColor: selected ? c.lagoonSoft : c.surface,
        opacity: pressed ? 0.75 : 1 })}>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selected ? c.lagoon : c.ink2, alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.lagoon }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading">{title}</Text>
        {lines.filter(Boolean).map((l, i) => <Text key={i} variant="small">{l}</Text>)}
      </View>
    </Pressable>
  );
}

/** A short message at the bottom of the screen (the page's toast). */
export function Toast({ text, error }: { text: string; error?: boolean }) {
  const { c } = useTheme();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: space.xl, alignItems: 'center' }}>
      <View accessibilityLiveRegion="polite" accessibilityRole={error ? 'alert' : undefined} testID="toast"
        style={{ backgroundColor: error ? c.coral : c.night, borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.lg,
          shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}>
        <RNText style={{ color: error ? c.onCoral : '#FFFFFF', fontSize: type.body, lineHeight: 21 }}>{text}</RNText>
      </View>
    </View>
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

type Variant = 'title' | 'heading' | 'body' | 'small' | 'mono' | 'error' | 'address';
/** `ltr`: the text is an address or a number on its own, read left to right in Arabic too (it keeps the line's alignment). */
export function Text({ variant = 'body', children, selectable, testID, ltr }:
  { variant?: Variant; children: ReactNode; selectable?: boolean; testID?: string; ltr?: boolean }) {
  const { c } = useTheme();
  const styles: Record<Variant, TextStyle> = {
    title: { fontSize: type.title, fontWeight: '700', color: c.ink },
    heading: { fontSize: type.heading, fontWeight: '600', color: c.ink },
    body: { fontSize: type.body, color: c.ink, lineHeight: 21 },
    small: { fontSize: type.small, color: c.ink2, lineHeight: 18 },
    mono: { fontSize: type.mono, color: c.ink, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), lineHeight: 17,
      direction: 'ltr', writingDirection: 'ltr' },       // code reads left to right in Arabic too
    error: { fontSize: type.body, color: c.coralInk, lineHeight: 21 },
    address: { fontSize: type.address, fontWeight: '700', color: c.ink, letterSpacing: 0.5, fontVariant: ['tabular-nums'], textAlign: 'center',
      writingDirection: 'ltr' },
  };
  return <RNText style={[styles[variant], ltr ? { writingDirection: 'ltr' } : null]} selectable={selectable} testID={testID}>{children}</RNText>;
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

export function Button({ label, onPress, kind = 'primary', disabled, busy, testID, accessibilityLabel }:
  { label: string; onPress: () => void; kind?: 'primary' | 'plain' | 'link'; disabled?: boolean; busy?: boolean; testID?: string; accessibilityLabel?: string }) {
  const { c } = useTheme();
  const primary = kind === 'primary', link = kind === 'link';
  const off = disabled || busy;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} disabled={off} onPress={onPress} testID={testID}
      accessibilityLabel={accessibilityLabel}
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
          // Text starts on the right in Arabic (iOS would put it on the left); an address reads left to right in both.
          ...(ltr ? { direction: 'ltr', writingDirection: 'ltr' } : { textAlign: I18nManager.isRTL ? 'right' : 'left' }) }} />
    </View>
  );
}
