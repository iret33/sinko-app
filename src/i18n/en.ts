// The app's words in English. First the page's own (sinko-strings.json, copied from Sinko by `npm run sync-strings`: STR, LIVE_STR,
// FIRST_STR and BOX_STR), which every screen uses wherever it means the same thing. Then the app's own, below: for what the page has
// no words for (finding the box, the phone's settings, staying signed in), and where the page's words speak of the page itself ("reload
// this page", "sign in on this page"). An app word never replaces a page word of the same name (test/i18n.test.ts), and ar.ts has
// exactly the same keys.
import sinko from './sinko-strings.json';

export const appEn = {
  noBoxSelected: 'No box is chosen yet.',
  hostNotPrivate: '{host} is not on a home network. The app talks only to boxes on your home network.',
  hostNotFound: 'Nothing on this network answers to {host}.',
  hostInvalid: '“{host}” is not an address. Type four numbers separated by dots, like 192.168.1.50, or a name, like sinko.local.',

  // ---- finding the box
  findTitle: 'Find your Sinko box',
  findLead: 'Keep this phone on your home Wi‑Fi. The app looks for the box there.',
  findSearching: 'Looking for your box…',
  findScanned: 'Addresses checked: {n} of {t}',
  findFinished: 'Finished looking.',
  findNone: 'No Sinko box answered on this Wi‑Fi.',
  findFound: 'Found on this Wi‑Fi',
  findUse: 'Use this box',
  findKnown: 'Known to this phone',
  findAgain: 'Look again',
  manualTitle: 'Not found? Type its address',
  manualLabel: 'Address or name of the box',
  manualPlaceholder: '192.168.1.50 or sinko.local',
  manualConnect: 'Connect',
  manualRouter: 'Where to find it: your router’s list of connected devices shows the box with its address (four numbers separated by dots). Its name usually starts with sinko or the board’s name.',
  manualCard: 'The card that came with the box gives its name: sinko.local, unless whoever sold it chose another.',
  manualChecking: 'Checking {host}…',
  manualNothing: 'No Sinko box answered at {host}. Check the address, and that this phone is on the same Wi‑Fi as the box.',
  oldBoxTitle: 'This box needs Sinko 3',
  oldBox: '{host} answers like Pi-hole, but not like Sinko 3.0 or later, which this app needs. It is Pi-hole without Sinko, or Sinko from before 3.0. Open http://{host}/ in the phone’s browser: if the page has My box, choose My box, then Update now. If it has no My box, Sinko on it is older than 3.0 and its page cannot update it: whoever set up the box updates it on the box, with the install command from the Sinko website.',
  notWifiTitle: 'Join your home Wi‑Fi',
  notWifi: 'Setting up needs this phone on the same Wi‑Fi as the box: on mobile data the app cannot see it. Turn on Wi‑Fi, join your home network, then look again.',
  localDeniedTitle: 'Let Sinko use your home network',
  localDeniedIos: 'To find the box and talk to it, Sinko needs Local Network access. Open Settings, choose Sinko and switch on Local Network, then come back.',
  localDeniedAndroid: 'To find the box and talk to it, Sinko needs access to devices on your home network. Open Settings, choose Permissions and allow it, then come back.',
  openSettings: 'Open Settings',

  // ---- the selected box does not answer
  unreachableTitle: 'The box does not answer',
  unreachableHint: 'If the router gave the box a new address, Look for the box finds it again.',
  tryAgain: 'Try again',
  lookForBox: 'Look for the box',
  otherBox: 'Use another box',

  // ---- Sinko's groups are not there yet (the page's notInstalled, for an app that checks again by itself)
  waitTitle: 'The box is getting ready',
  waitBody: 'Setup is not finished on this box. Wait a few minutes: the app checks again by itself every 30 seconds. If it stays like this, ask whoever set up the box.',
  waitChecked: 'Last checked at {t}.',
  waitGuide: 'Still like this after ten minutes? The install guide says how to finish setting up Sinko on the box.',
  waitGuideLink: 'Open the install guide',
  checkNow: 'Check now',

  // ---- choosing the parent password (the page's claim screen, which speaks of "this page")
  appClaimLead: 'Choose a parent password for this box. You will use it to sign in, in this app and on the box’s page.',
  appClaimWhy: 'Until you do, anyone on your Wi‑Fi can open the box’s page and change the rules.',
  claimTakenTitle: 'This box already has a password',
  claimTaken: 'Someone chose the parent password before you. If it was not you, someone else on your home network got there first: re-flash the card in the box, or ask whoever sold you the box for help. If you chose it yourself, sign in with it.',

  // ---- signing in
  codeWrong: 'That code is not right. Enter the 6-digit code your authenticator app shows now.',
  codeReused: 'That code was just used. Wait for the next code, then enter it.',
  tooManyTries: 'Too many wrong tries. Wait a little, then try again.',
  signingIn: 'Signing in…',
  keepSignedIn: 'Keep me signed in',
  keepSignedInNote: 'The password stays in this phone’s secure storage, on this phone only, so the app can sign in again by itself.',
  keepSignedInTotp: 'Not possible while signing in needs a 6-digit code: the app cannot enter the code by itself.',
  keepSignedInAsk: 'Type the parent password once more to keep it on this phone.',
  keepSignedInSave: 'Keep it',

  // ---- signed in
  homeSignedIn: 'Signed in to {name}.',
  appUpdateNeeded: 'Please update the app. This box runs a newer Sinko than this app knows, so the app shows what is set but does not change timers, bedtime or the box’s settings until it is updated.',
  settingsTitle: 'Settings',
  language: 'Language',
  langEnglish: 'English',
  langArabic: 'العربية',
  langRestart: 'The app starts again in the language you choose.',
  boxSection: 'Your box',
  boxName: 'Name',
  boxAddress: 'Address',
  boxVersion: 'Version',
  signInSection: 'Signing in',
  done: 'Done',
  devState: 'Shared state (development build)',
} as const;

export type AppKey = keyof typeof appEn;

export const en: Record<string, unknown> = { ...(sinko.en as Record<string, unknown>), ...appEn };
