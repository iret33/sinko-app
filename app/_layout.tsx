import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { boot, connection } from '../src/state/app';
import { useLang } from '../src/state/hooks';

export default function RootLayout() {
  useLang();
  useEffect(() => {
    boot().catch((e: unknown) => connection.gate.set({ phase: 'unreachable', message: e instanceof Error ? e.message : String(e) }));
  }, []);
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}
