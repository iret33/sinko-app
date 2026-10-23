# Sinko for iPhone and Android

A free app for parents that controls a [Sinko](https://github.com/iret33/sinko) box: the parental-controls page and scheduler on top
of Pi-hole v6. This repository holds the app; Sinko itself is the source of truth for how a box behaves.

So far it has the way in and the groundwork, and no feature screens yet. The way in goes from "the app is opened for the first time" to
"signed in": it finds the box on the home Wi-Fi (Bonjour, `sinko.local`, a scan of the Wi-Fi, or an address typed by hand), lets the
parent choose the password of a new box or sign in, keeps the session (and, when asked, the password) on the phone, and speaks English
and Arabic. Under it: the logic ported from Sinko's page (`src/core`), the API client and its host rule (`src/api`), the data model and
the sign-in (`src/state`), the strings (`src/i18n`), the design system (`src/ui`), the screens (`src/screens`) and a development box
(`mock/`). Once signed in, a placeholder shows the box and, in a development build, its shared state.

## What you need

- Node 22.18 or newer (the mock box and the scripts are TypeScript that Node runs directly), npm, python3.
- Sinko next to this folder, read only: `git clone https://github.com/iret33/sinko ../sinko` (or set `SINKO_DIR`).
- For iOS: Xcode with an iOS Simulator, and CocoaPods. CocoaPods needs a UTF-8 locale: if `pod install` fails with
  `Unicode Normalization not appropriate for ASCII-8BIT`, run `export LANG=en_US.UTF-8` first. For Android: JDK 17 and the Android SDK
  (platform `android-37.0`, build tools 37.0.0, NDK 27.1.12297006, CMake 3.22.1, the emulator and a system image), with `JAVA_HOME` and
  `ANDROID_HOME` set. Android Studio brings all of it. Without it, Homebrew does: `brew install openjdk@17` and
  `brew install --cask android-commandlinetools`, then `export JAVA_HOME=/usr/local/opt/openjdk@17
  ANDROID_HOME=/usr/local/share/android-commandlinetools` (under `/opt/homebrew` on Apple silicon), `sdkmanager --licenses`, and those
  packages with `sdkmanager`.

```bash
npm install
```

## The development box

```bash
npm run mock
```

Starts Sinko's own mock Pi-hole (`../sinko/tests/mock_pihole.py --setup --web`, unchanged) behind a small proxy that fills what the
mock does not do: Pi-hole's cookie, its two-factor answers, devices that asked just now, the scheduler's timers and bedtime, the outcomes
of updates, restarts and shut-downs, and more (see [MOCK-GAPS.md](MOCK-GAPS.md)). The password is `test`.

- iOS Simulator: `127.0.0.1:8080`. Android emulator: `10.0.2.2:8080`. A development build lists the mock box on the find screen by itself.
- Dev menu: <http://127.0.0.1:8080/__dev__/> in a browser on this computer.
- Options: `npm run mock -- --open` (no password set, for the claim screen), `-- --live` (demo traffic), `-- --update 3.2.0` (a newer
  version on offer), `-- --old-box` (no `/pb/box.json`), `-- --port 8090`, `-- --host 0.0.0.0` (lets a real phone on the Wi-Fi in).
- The mock box does not announce itself. To see the app find a box by Bonjour, start it with `-- --host 0.0.0.0` and announce it from
  this computer the way Sinko 3.2 does (`dns-sd -R sinko-test _sinko._tcp local 8080 v=1 path=/ info=/pb/box.json`): the find screen
  then lists it at this computer's Wi-Fi address, port 8080, which only Bonjour can find.

## The app

The app runs as a development build (expo-dev-client), not in Expo Go. Build and install it once, and again whenever a native module or
`app.json` changes:

```bash
npm run ios
```

```bash
npm run android
```

Each builds the native project (`ios/` and `android/` are generated and not kept in git), installs it on the simulator or emulator and
starts the JavaScript server. The native code includes react-native-zeroconf (Bonjour; on Android it also compiles mDNSResponder with the
NDK, so the first Android build takes a while) and the app's own module in `modules/sinko-net`. Later, when only JavaScript changed,
starting the server is enough:

```bash
npm start
```

## Tests and checks

```bash
npm test
```

- `test/core`: the ported logic, against Sinko's own fixtures (`test/fixtures`) and the cases of Sinko's own tests.
- `test/api`: the API client, and the proof that it never stores or sends a cookie although the box sets one.
- `test/state`: the model against the development box (it starts one per test file, so it needs `../sinko` and python3), the way in
  (`signin.test.ts`: claim, sign in and out, two-factor, the 429s, Keep me signed in across a restart), finding the box, the language.
- `test/i18n.test.ts`: both languages have the same words, every word a screen asks for exists, and the Local Network prompt.

```bash
npm run check
```

Types (the app, the tests, and the mock and scripts, each with its own tsconfig), lint, and the tests.

## Keeping up with Sinko

```bash
npm run sync-contract
```

Copies `tests/fixtures/state-cases.json` and `tests/fixtures/learned-rule-cases.json` from `../sinko` into `test/fixtures`, and records
Sinko's version, commit and a checksum of each file in `test/fixtures/sinko-contract.json`. A test fails when a fixture was edited by hand.
The app follows Sinko's `master` from commit `ec04916a` on (box.json's `api`, `boxId` and `hostname`, and Bonjour): keep `../sinko` at
least there.

```bash
npm run sync-strings
```

Copies the page's words (English and Arabic) into `src/i18n/sinko-strings.json`.

## Layout

| Folder | What |
|---|---|
| `app/` | Routes (expo-router): `index.tsx` shows the screen of the way in that the connection is at, `settings.tsx` the settings. |
| `src/core` | Sinko's logic, ported from `web/pb-core.js`, `web/pb-box.js` and `web/app.js`. No React. Each function names its original. |
| `src/api` | `call(method, path, options)`, the box's clock, `ApiError`, and the host rule (`hosts.ts`): only private IPv4 addresses. |
| `src/state` | The model of a box (`load`, `run`, `putGroup`, `putClient`, `flushDns`, `writeState`), the list of boxes, the sessions, the way in (`connection.ts`, `auth.ts`), finding the box (`discovery.ts`, `native.ts`), what a box's version allows (`compat.ts`), the language (`language.ts`). |
| `src/i18n` | The strings (`en.ts`, `ar.ts`: the page's, then the app's own) and `t()`. |
| `src/ui` | Design tokens (Sinko's colours, light and dark) and the components. |
| `src/screens` | The screens: find the box, the box does not answer, setup not finished, choose the password, sign in, signed in, settings. |
| `modules/sinko-net` | The app's own native module (Expo Modules API): the IPv4 addresses a name resolves to, for the host rule. |
| `locales/` | The Local Network prompt in English and Arabic (iOS). |
| `mock/` | The development box. |
| `test/` | The tests and Sinko's fixtures. |
