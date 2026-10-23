# Router guides

The app's screen "Tell your router to use Sinko" shows steps that work on every router. For the routers that Batelco, Zain and stc give to
homes in Bahrain it can show steps for that router instead, from the files in this folder. Until a file is filled in from a real router and
marked `ready`, the app shows the steps for every router, so a guide that is not finished never reaches a parent.

**Never guess a menu name.** Write a guide with the router in front of you, in the language its pages are in, and take the pictures from it.

## The files

- `<brand>.en.md` and `<brand>.ar.md`: one guide per brand and language (`batelco`, `zain`, `stc`). Both languages are needed.
- `screenshots/<brand>/<slot>.png`: the pictures a guide asks for (`screenshot:<slot>`), the same for both languages. When a language needs
  its own (the router's pages in Arabic), add `screenshots/<brand>/<slot>.<lang>.png`; it is used for that language instead.
- `guides.ts`: made from all of the above by `npm run build-guides`. Do not edit it; run the command after every change here (a test fails
  when it is out of date).

## The format

```md
---
brand: batelco
name: Batelco
status: todo
---

# Batelco router

A paragraph: one or more lines, ended by a blank line.

## Open the router's settings

Each `##` heading is one step; the app numbers them.

- A bullet, inside a step.

![What the picture shows, for people who cannot see it](screenshot:sign-in)

Type {ip} there.
```

- The front matter: `brand` (the file's brand), `name` (what the choice button says), `status` (`todo` or `ready`).
- `#` the guide's title, then paragraphs before the first step (the introduction).
- `{ip}` is replaced by the box's address (for example 192.168.1.50).
- A line that starts with `TODO` and anything inside `<!-- -->` are notes for whoever writes the guide: the app never shows them.
- A guide is shown only when its `status` is `ready`, it has at least one step, it has no `TODO` left and every picture it asks for exists.
  `npm test` checks all of this for each file marked `ready`.
