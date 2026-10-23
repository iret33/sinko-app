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

  // ---- the guided setup (the page's setup list, which points to "Setup help at the bottom of this page")
  setupLead: 'A few steps, and the rules work on your children’s devices. This list stays on the main screen until every step is done.',
  setupRouterHowApp: 'No other device at home has used the box yet: the router does not send devices to it.',
  setupRouterOpen: 'Show me how',
  setupByHandOpen: 'Cannot change the router?',
  setupLater: 'Finish later',
  routerWaiting: 'Waiting for the first device to use the box…',
  routerSeen: 'A device at home uses the box: the router points to it.',
  routerChecked: 'Checked at {t}.',

  // ---- telling the router to use Sinko (docs/install.md, "The last step: point your home at the box")
  routerTitle: 'Tell your router to use Sinko',
  routerLead: 'For the rules to work, your router must send every device at home to the box for DNS. You set this once, in the router’s settings, and every device at home follows.',
  routerAddressNote: 'Type this number in your router’s settings: always the number, never a name.',
  routerWhich: 'Which router do you have?',
  routerOther: 'Another router',
  routerNoGuide: 'The app has no guide for {brand} routers yet. These steps work on every router.',
  routerSteps: 'On every router',
  routerTheAddress: 'the box’s address',
  routerStep1: 'Open your router’s settings. On most routers you open its address in a browser on a phone or computer at home and sign in; the address and the password are often on a label on the router.',
  routerStep2: 'Find the DNS server, in the LAN or DHCP settings. Set it to {ip}, and only that address: with a second DNS server there, devices can go around the box.',
  routerStep3: 'Reserve that address for the box (DHCP reservation, or static lease), so the router never gives it another one.',
  routerStep4: 'If the router also hands out IPv6 DNS servers, turn that off, or set it to the box too. Otherwise devices can skip Sinko over IPv6.',
  routerStep5: 'Save. Then on each child’s device turn Wi‑Fi off and on again, so it picks up the new setting.',
  routerCheckTitle: 'Check it worked',
  routerCheckLead: 'As soon as a device at home other than this phone asks the box something, the router points to it. This updates by itself.',
  routerCantChange: 'Your router does not let you change the DNS server, or you want Sinko on one device only?',
  byHandOpen: 'Set Sinko on one device',

  // ---- setting Sinko on one device by hand
  byHandTitle: 'Set Sinko on one device',
  byHandAddress: 'The box’s address',
  byHandAddressNote: 'Type this number as the device’s DNS server: always the number, never a name.',
  byHandLead: 'When the router cannot be changed, or for one device only, set the box as the DNS server on the device itself.',
  byHandCaveat: 'This is easier for a child to undo than the router setting, and it never covers mobile data: on mobile data the device does not use the box.',
  byHandCard: 'Sinko does not make the internet safe by itself: a phone on mobile data or a VPN does not use it. Use it together with Screen Time (iPhone) or Family Link (Android).',
  byHandIos: 'iPhone and iPad',
  byHandIos1: 'Open Settings › Wi‑Fi and tap ⓘ next to your home network.',
  byHandIos2: 'Tap Configure DNS, then Manual.',
  byHandIos3: 'Delete the servers that are already in the list.',
  byHandIos4: 'Tap Add Server and type {ip}. Then tap Save.',
  byHandIosNote: 'It applies to this Wi‑Fi network only.',
  byHandAndroid: 'Android',
  byHandAndroidNote: 'The names of the menus differ from one maker to another.',
  byHandAndroid1: 'Open Settings › Wi‑Fi, then your home network, then Edit or Advanced.',
  byHandAndroid2: 'Set IP settings to Static. Keep the phone’s own address as it is, and the gateway: that is the router.',
  byHandAndroid3: 'Set DNS 1 and DNS 2 both to {ip}, then save.',
  byHandAndroid4: 'Set Private DNS (in Settings, under Network or Connections) to Off or Automatic: with a named Private DNS provider the phone skips Sinko.',
  byHandOther: 'Computers, consoles and TVs',
  byHandOther1: 'In the network settings, find DNS, choose Manual, and type {ip}.',

  // ---- "Check this device"
  checkTitle: 'Check this device',
  checkWhich: 'Which device?',
  checkTypeLabel: 'Or type its address',
  checkTypeNote: 'The device shows its address on the same page as its DNS setting, as IP Address.',
  checkHowOther: 'Open any app on that device and use it for a moment. Then tap Check.',
  checkHowPhone: 'Tap Check, then open any other app for a moment and come back here.',
  checkBtn: 'Check',
  checkPick: 'Pick a device, or type its address.',
  checkBadAddr: 'Type the address as four numbers separated by dots, like 192.168.1.20.',
  checkWatching: 'Waiting for {n} to ask the box something…',
  checkSlow: 'Nothing yet. Still looking: the box can take a minute to note a device.',
  checkPassed: '{n} uses Sinko.',
  checkNotSeen: 'The box has not heard from {n}. Check that its DNS is {ip} and nothing else, that Private DNS is off on Android, and that it is on your home Wi‑Fi. Then check again.',
  checkFailed: 'The box did not say which address this phone has. Try again.',
} as const;

export type AppKey = keyof typeof appEn;

export const en: Record<string, unknown> = { ...(sinko.en as Record<string, unknown>), ...appEn };
