---
name: install-extensions
description: Install the machine extensions of ultimate-extensions into ~/.ultimate/extensions, suggesting only the ones this machine's own use justifies and asking with one card that carries each extension's screenshot. Use when someone asks to install these extensions, pastes the README's "Install with an agent" prompt, or asks for the projects rail or the rate limiter on this machine.
---

# Install the machine extensions

These extensions belong to the machine, not to a project: they live in `~/.ultimate/extensions/<name>`, they
apply to every project on this machine, and they load hot — no restart. This file is the whole flow; the
repository's `README.md` summarises it and each extension's own `README.md` goes into detail.

Five steps: find the repository, measure this machine, ask with one card, install what was picked, prove it and
say what changed.

## 1. The repository

The default clone is `~/src/ultimate-extensions`. If it is there, work in it; if it is not, clone it there
(`julianojulio/ultimate-extensions` — **private today**, so the user needs access) and say where it went.
Everything below runs from the repository.

Never edit the Ultimate clone's `server/` or `shared/`, and never restart Ultimate: these extensions are
discovered through `~/.ultimate/extensions/` and reload by themselves.

## 2. Measure this machine before suggesting anything

A suggestion earns its card when it comes from what this machine shows. Measure, let each number speak in the
card's `detail`, and do not interrogate.

**`projetos` — the rail of this machine's projects.** Count the project homes:

```sh
ls -d ~/.ultimate/projects/*/project.json | wc -l
```

With two or more, the rail answers a question that has no other answer on screen ("where is something happening
right now"); with one, it spends 48px of every window to show a single tile, so leave it out of the
recommendations and say why. Also check whether it is already installed (`ls -l ~/.ultimate/extensions/projetos`):
then the option is "already installed" instead of "install".

**`rate-limiter` — a ceiling on simultaneous requests per provider.** Look for the failures it exists for
(`429`, `rate_limit`, `overloaded`, `quota`), in this order:

1. **This machine's provider health:** `~/.ultimate/health.json` keeps, per provider, the `error` of its last
   failure — a capacity failure is stored as its code. A missing file is no data, not a zero.
2. **The machine's recorded model calls**, from codemode:
   `ultimate.trace({ limit: 1000 })`, keeping the ones with `!ok` whose `error` matches
   `/429|rate.?limit|overloaded|quota/i`. The trace keeps the last 7 days.
3. **Neither:** nothing was measured — say so in the `detail` and let the card's one short question cover it
   (step 3). Do not guess a number.

Report what you measured with its number: "12 rate-limit failures in this machine's last 1000 model calls",
"no rate-limit failure in 7 days of calls here".

## 3. Ask with one card

One message, not a questionnaire: Ultimate's `message` tool, `to: 'user'`, `questions` carrying

- **one `multi` question** — "Which extensions should I install?" — with one option per extension: `label` the
  extension's name, a `key` letter each (`a`, `b`), `recommended` only where the measurement supports it, `detail`
  the measured reason in one sentence with its number, and `preview` the three lines below;
- **plus, and only when a measurement was missing, one short question about that signal** — for the limiter:
  `confirm`, "Has a provider ever answered 429 (too many requests) on this machine?". Never more than that one.

**The screenshots ride as attachments, not in the preview.** The preview is Markdown the app renders, and the app
hardens it: a repository path resolves against the app's origin and 404s, and a `data:` URI is dropped — measured on
this host, a data URI in a preview came out as `[Image blocked: The rail on the left edge]` (the markdown hardening
of `rehype-harden`, which refuses `data:` images outright). So read each extension's PNG
(`projetos/screenshots/rail.png`), attach them to the same message in the order of the options (`images`, the entry
ids of the reads; at most 4 images of 2 MB each), and say which one is which in each option's `detail`
("screenshot 1, above").

**The preview** is then three lines, the last one about the disk. For `projetos`:

```markdown
**The rail** (screenshot 1): one tile per project on the left edge of every surface — running hosts on top, a
presence dot in the corner, the number of unanswered questions in amber.

- **Does:** opens a running project in this tab, brings a stopped one up, and the tile panel gives the port
  and what was measured, with the time.
- **Writes:** one symlink in `~/.ultimate/extensions/`, one `node_modules` link, and — only if you use the
  switch at its bottom — the `splash` entry of `~/.ultimate/settings.json`.
```

`rate-limiter` has no window of its own, so it has no picture: its preview opens with the reading the `status`
action gives, which is the whole of what it shows.

````markdown
**A ceiling, not a panel**: no window of its own. This is what `ultimate.action('rate-limiter', 'status')`
says while it holds a provider — 1 in flight, 2 waiting:

```json
{ "wrapped": ["anthropic"], "limits": { "anthropic": 3 }, "active": { "anthropic": 1 }, "queued": { "anthropic": 2 } }
```

- **Does:** holds how many requests are in flight per provider and queues the rest, in arrival order.
- **Writes:** one symlink in `~/.ultimate/extensions/`, one `node_modules` link, and `rateLimiter.limits` in
  `~/.ultimate/settings.json` — a provider you do not name stays unlimited.
````

Look at the card before you rely on it (with `screenshot`, or by the user's answer): the thumbnails must be there
and open full size. Once this repository is public, an `https://raw.githubusercontent.com/…` image inside a preview
is the shortcut that shows the picture beside the option — never a dependency, since the attachment works today.

Never mark every option, and never install an option the user did not pick. If the agent you run in has no
card, write the same question as numbered options with letters and ask for the letters.

## 4. Install what was picked

```sh
sh ~/src/ultimate-extensions/install.sh
```

It needs no arguments and is idempotent: for each extension folder it links `~/.ultimate/extensions/<name>` to
the folder here, and links the folder's `node_modules` at the Ultimate clone's (`$ULTIMATE_ROOT`, by default
`~/src/ultimate`), which is where the tests resolve `@earendil-works/*` from. It **refuses a real folder** at
`~/.ultimate/extensions/<name>` — if it skips a name, stop and tell the user that something else lives there.

**`rate-limiter`: installing it is not enough.** Its own map is empty on purpose, so nothing is limited until
this machine names a provider. Ask with a small card of its own, measured like the first one: one `multi` listing
the providers registered here (`ultimate.models()`, with the number of models each one holds — say so in the
`detail`), `recommended` the provider whose calls fill the trace ("68 of 68 model calls on this machine went to
`cirthan-dev`"); and one `choice` for the ceiling — 2, 3, 5 or 10, with 3 recommended, the repository's own
starting point. Then write it into `~/.ultimate/settings.json`:

```json
{ "rateLimiter": { "limits": { "anthropic": 3 } } }
```

A read-modify-write that keeps every other key: read the file, refuse when it is not a JSON object, change only
`rateLimiter.limits`, write through a temporary beside the file and a `rename`. Refuse rather than write
something wrong: this file reaches every extension on the machine, and a typo costs the user their other keys.
`projetos` does exactly this for its `splash` switch (`projetos/server.ts`, `escreverSettings`) — follow it.
The extension refuses `0`, a negative, `1.5` and `"3"` with a notification, leaving that provider unlimited.

The ceiling is per provider and per machine — conversations, subagents and automations together — and saving
the file applies it without a restart.

## 5. Prove it, and say what changed

```ts
ultimate.extensions()                                    // both, with server.loadedAt and no server.error
ultimate.action('projetos', 'listar', { medir: false })   // this machine's projects, cheap read
ultimate.action('rate-limiter', 'status', {})            // { wrapped, limits, active, queued }
```

No restart: they are found on the next read. Then say, in the user's terms:

- **what was written:** one symlink per extension in `~/.ultimate/extensions/`, one `node_modules` link inside
  the folder here (they are the same folder — edit here and Ultimate reloads), and, for the limiter, the
  `rateLimiter.limits` key in `~/.ultimate/settings.json`;
- **what is on screen now:** the rail down the left edge of every surface, or the ceiling holding a provider;
- **how to undo:** remove `~/.ultimate/extensions/<name>` and, for the limiter, its key. The rail disappears at
  once; the limiter's wrapper lets go on the next host restart, so a ceiling can still apply until then.
  Nothing else was touched — no project's `.ultimate/`, no settings key you did not name.

## What this flow does not do

- It does not install for one project: that is `<project>/.ultimate/extensions/`, and a project's own UI and
  rules do not belong in this repository.
- It does not restart Ultimate, edit the clone's `server/` or `shared/`, or read a secret — no credentials, no
  `auth.json`, no `keys/`.
- It does not replace a real folder at `~/.ultimate/extensions/<name>`.
- It does not invent a ceiling: a provider nobody named stays unlimited.
- It does not decide in the user's place: it installs exactly what came back from the card.
