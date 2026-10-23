// The first pieces of the design system. Every screen is built from these, so colours and spacing come from one place (theme.ts).
import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text as RNText, TextInput, View, type TextInputProps, type TextStyle } from 'react-native';
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
    mono: { fontSize: type.mono, color: c.ink, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), lineHeight: 17 },
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

export function Button({ label, onPress, kind = 'primary', disabled, testID }:
  { label: string; onPress: () => void; kind?: 'primary' | 'plain'; disabled?: boolean; testID?: string }) {
  const { c } = useTheme();
  const primary = kind === 'primary';
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} testID={testID}
      style={({ pressed }) => ({
        backgroundColor: primary ? c.primary : c.surface, borderColor: primary ? c.primary : c.line, borderWidth: 1,
        borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.lg, alignItems: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}>
      <RNText style={{ color: primary ? '#FFFFFF' : c.ink, fontSize: type.body, fontWeight: '600' }}>{label}</RNText>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="small">{label}</Text>
      <TextInput placeholderTextColor={c.ink2} autoCapitalize="none" autoCorrect={false} {...props}
        style={{ borderColor: c.line, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm + 2,
          fontSize: type.body, color: c.ink, backgroundColor: c.surface }} />
    </View>
  );
}
