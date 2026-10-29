# The box's page

The page the QR code on the box opens ([`print/`](../print/README.md)): <https://iret33.github.io/sinko-app/>. Static files, no build step,
English and Arabic (right to left), light and dark.

GitHub Pages serves it from the `gh-pages` branch, which holds this folder and nothing else. After a change here is committed:

```bash
git subtree push --prefix docs origin gh-pages
```

The page changes a minute later. Once `main` has this folder, switch Pages to it (Settings, Pages, Branch: `main`, `/docs`) and stop
pushing `gh-pages`: the address stays the same, and a squash merge into `main` would make the next subtree push fail anyway.

| File | What it is |
|---|---|
| `index.html` | The links: the App Store, Google Play, the setup guide, the message for an AI, the box's own page (`sinko.local`) and, once there is one, help |
| `guide/index.html` | The setup guide, step by step, for someone who has never set up a gadget, with "Something wrong?" and the message to copy into an AI |
| `links.js` | The store links and the help contact, each explained inside. An empty one shows "Coming soon" (the stores) or nothing (help) |
| `site.js` | The behaviour: the links from `links.js`, the language button, the Copy button |
| `style.css` | One stylesheet for both directions (logical properties only), Sinko's colours from `src/ui/palette.ts` |
| `icon.svg`, `fonts/` | Sinko's logo and IBM Plex Sans Arabic (with its licence, `OFL.txt`), copied from Sinko's `web/` |
| `404.html` | What GitHub shows for an address that does not exist, with a way back |

Each page holds both languages, side by side in the source: every block has an `only-en` and an `only-ar` copy, and the small script in
`<head>` picks one before the first paint (`?lang=ar`, then the last choice, then the phone's language). Change one, change the other:
`test/site.test.ts` checks that they come in pairs, that every link lands on a file, and that the store links are the stores' own.

The guide follows the app's screens and uses the app's own words for every button (`src/i18n/en.ts`, `ar.ts`, and Sinko's
`sinko-strings.json`), and Sinko's website for the cables and the router (`site/strings.js` in Sinko). When a screen's words change, change
the guide and the two messages for an AI with them.

## When the app is in the stores

Put its address in `links.js`, commit, and publish (above): every box already printed shows it.

- App Store: `https://apps.apple.com/app/id<the app's id>` (App Store Connect, App Information, Apple ID).
- Google Play: `https://play.google.com/store/apps/details?id=bh.ioai.sinko`, once the app is public (not only on internal testing).

## Preview it

```bash
python3 -m http.server -d docs 8080
```

Then open <http://localhost:8080/> and <http://localhost:8080/?lang=ar>.
