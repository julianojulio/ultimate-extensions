# ultimate-extensions

Extensions for [Ultimate](https://github.com/HazAT/ultimate).

## `projects` — a rail of projects

A column on the left edge of the window with one tile per project: running hosts on top, stopped
ones below, each with a presence dot and the number of unanswered questions. Click a tile to switch to
that project in this tab, or to bring a stopped one up. Details in [`projects/`](projects/).

## `rate-limiter` — a ceiling on simultaneous requests per provider

Holds how many requests are in flight at once on a provider, queueing the rest in arrival order — the
answer to `429` errors when too much runs at the same time. Nothing is limited until you name a
provider. Details in [`rate-limiter/`](rate-limiter/).

## Install

Paste this into any agent (Claude Code, Codex, @ultimate):

```text
Install the Ultimate extensions from https://github.com/julianojulio/ultimate-extensions on this computer.
Read skills/install-extensions/SKILL.md there first: it is the source of truth, so follow it and don't
invent steps. Install only the extensions it finds justified here, ask me before installing, and tell me
what was written and how to undo it.
```

It measures the computer first and shows one card with what it found — one option per extension, each
with its screenshot — and installs only what you pick.

Or by hand:

```sh
git clone https://github.com/julianojulio/ultimate-extensions ~/src/ultimate-extensions
sh ~/src/ultimate-extensions/install.sh
```

## License

MIT — see [`LICENSE`](LICENSE).
