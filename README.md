# Sinko for iPhone and Android

A free app for parents that controls a [Sinko](https://github.com/iret33/sinko) box: the parental-controls page and scheduler on top
of Pi-hole v6. This repository holds the app; Sinko itself is the source of truth for how a box behaves.

So far it has the groundwork and no feature screens: the logic ported from Sinko's page (`src/core`), the API client (`src/api`), the
data model (`src/state`), the strings (`src/i18n`), the first pieces of the design system (`src/ui`), a development box (`mock/`) and a
placeholder screen that shows the box's shared state and clock.

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

- iOS Simulator: `127.0.0.1:8080`. Android emulator: `10.0.2.2:8080`. The placeholder screen fills in the right one.
- Dev menu: <http://127.0.0.1:8080/__dev__/> in a browser on this computer.
- Options: `npm run mock -- --open` (no password set, for the claim screen), `-- --live` (demo traffic), `-- --update 3.2.0` (a newer
  version on offer), `-- --old-box` (no `/pb/box.json`), `-- --port 8090`, `-- --host 0.0.0.0` (lets a real phone on the Wi-Fi in).

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
starts the JavaScript server. Later, when only JavaScript changed, starting the server is enough:

```bash
npm start
```

## Tests and checks

```bash
npm test
```

- `test/core`: the ported logic, against Sinko's own fixtures (`test/fixtures`) and the cases of Sinko's own tests.
- `test/api`: the API client, and the proof that it never stores or sends a cookie although the box sets one.
- `test/state`: the model against the development box (it starts one per test file, so it needs `../sinko` and python3).

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

```bash
npm run sync-strings
```

Copies the page's words (English and Arabic) into `src/i18n/sinko-strings.json`.

## Layout

| Folder | What |
|---|---|
| `app/` | Routes (expo-router). |
| `src/core` | Sinko's logic, ported from `web/pb-core.js`, `web/pb-box.js` and `web/app.js`. No React. Each function names its original. |
| `src/api` | `call(method, path, options)`, the box's clock, `ApiError`. |
| `src/state` | The model of a box (`load`, `run`, `putGroup`, `putClient`, `flushDns`, `writeState`), the list of boxes, the sessions. |
| `src/i18n` | The strings and `t()`. |
| `src/ui` | Design tokens (Sinko's colours, light and dark) and the first components. |
| `mock/` | The development box. |
| `test/` | The tests and Sinko's fixtures. |
