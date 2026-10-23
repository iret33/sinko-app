// The design tokens, from Sinko's page (web/style.css :root and its dark scheme), so the app and the page look like one product.
import { useColorScheme } from 'react-native';

export interface Palette {
  pearl: string; surface: string; ink: string; ink2: string; line: string;
  lagoon: string; lagoonInk: string; lagoonSoft: string;
  night: string; coral: string; coralSoft: string; coralInk: string; onCoral: string; primary: string;
  dune: string; duneInk: string; focus: string; warn: string;
}

export const light: Palette = {
  pearl: '#F1F4F2', surface: '#FFFFFF', ink: '#17302E', ink2: '#4D625F', line: '#D9E2DF',
  lagoon: '#0F766E', lagoonInk: '#0B5A54', lagoonSoft: '#E1F1EE',
  night: '#1E2547', coral: '#C7432F', coralSoft: '#FBE9E5', coralInk: '#A8341F', onCoral: '#FFFFFF', primary: '#0F766E',
  dune: '#F3E6C9', duneInk: '#6B4E12', focus: '#2563EB', warn: '#B7791F',
};

export const dark: Palette = {
  pearl: '#0E1615', surface: '#15201E', ink: '#E3ECE9', ink2: '#9DB0AC', line: '#26332F',
  lagoon: '#2BA597', lagoonInk: '#7FD3C8', lagoonSoft: '#12302C',
  night: '#1A2040', coral: '#F0735E', coralSoft: '#3A1E19', coralInk: '#F0735E', onCoral: '#0E1615', primary: '#12726A',
  dune: '#3A3120', duneInk: '#EBD29C', focus: '#7AA7FF', warn: '#E3B04B',
};

/** web/style.css --radius-xl, -lg, (default) and -sm. */
export const radius = { xl: 26, lg: 22, md: 14, sm: 10 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const type = { title: 24, heading: 17, body: 15, small: 13, mono: 12 };

export function useTheme(): { c: Palette; scheme: 'light' | 'dark' } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { c: scheme === 'dark' ? dark : light, scheme };
}
