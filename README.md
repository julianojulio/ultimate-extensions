# ultimate-extensions

The **machine** extensions of [Ultimate](https://github.com/HazAT/ultimate): they live in
`~/.ultimate/extensions/` and apply to **all** projects on this machine.

## What a machine extension is

Ultimate discovers extensions in three layers:

| Layer | Where | Applies to |
| --- | --- | --- |
| `builtin` | `extensions/` of the Ultimate clone | everything, and it belongs to the machine |
| `project` | `<project>/.ultimate/extensions/` | that project |
| `user` | `~/.ultimate/extensions/` | **all projects on this machine** |

This repository is what sits in the third row: the extensions that belong to no product project but
change how the machine works — how many simultaneous requests each provider accepts, and where
something is happening in each open project. They hot-load, alongside any project, and they also
apply to automation conversations and to subagents.

**What goes in** here: an extension about the machine (processes, provider caps, ports, other
projects' homes), not about anyone's product. **What does not**: a project's UI or rule — that is
`<project>/.ultimate/extensions/`.

## The extensions

### `projetos` — the rail of this machine's projects

**What it solves:** with more than one project open on this machine, switching from one to the other
and answering «where is something happening right now» without a window or a terminal: a 48px
**rail** on the left edge of the window, present on every surface, with one initials tile per project
— running hosts on top, stopped ones below —, the whole block as the click target, the port number
off-screen and, in the corner of each tile, the app's **presence dot**: grey stopped, green idle,
pulsing while it works, and the number of unanswered questions in amber. A running project opens in
that project in this tab; a stopped one comes up; the tile panel (hover or focus) gives the port, the
state in words, how many conversations of that project are working and how many questions wait for
an answer, measured at the moment the panel opens, with the time; the `+` creates a project from a
folder; and the switch at the foot of the rail turns the **splash animation** on and off, writing only
that entry in this machine's settings. On the phone there is no rail: the sidebar drawer keeps the
compact list, with the measurements.

**What it does not do:** it does not measure the host at every instant (the indicator says when it is
from), it does not show the port on the tile, it schedules nothing, it does not poll, it
does not kill a process that failed to come up without asking (and never by port, name or group), it
does not hide or move a project, it does not decide onboarding or trust for a new project, it
touches no extension besides the splash (and only in this machine's layer), and it does not reach
another machine. Details in [`projetos/README.md`](projetos/README.md).

### `rate-limiter` — simultaneous request cap per provider

**What it solves:** the provider returns `error 429` when it receives too many requests at once. The
extension holds how many requests are **in flight at the same time** per provider (3 on `cirthan-dev`
and on `cirthan`, or whatever this machine's `~/.ultimate/settings.json` says) and puts the rest in a
queue in arrival order. The cap is per provider and per machine: it holds for conversations,
subagents and automations together, and it changes when the file is saved, with no restart.

**What it does not do:** it does not touch a provider that does not exist here, it does not limit a
provider outside the map (`Infinity`), it does not read any project's `settings.json` (one project
cannot raise the others' cap), and it does not count tokens or cost. Details in
[`rate-limiter/README.md`](rate-limiter/README.md).

## Install

```sh
sh ~/src/ultimate-extensions/install.sh
```

The script is idempotent — running it again changes nothing — and does two things, for each folder of
this repository that is an extension (`server.ts` or `web.tsx`):

1. links `~/.ultimate/extensions/<name>` as a **symlink** to the folder here;
2. links `<name>/node_modules` into the Ultimate clone's `node_modules`, which is where the tests
   resolve `@earendil-works/*` from. The clone comes from `$ULTIMATE_ROOT`, by default
   `~/src/ultimate`.

A real folder at `~/.ultimate/extensions/<name>` is **not** replaced: the script warns and moves on
(no deleting someone else's content). A `node_modules` that is not a link also stays as it is.

**None of this asks for an Ultimate restart**: the extensions reload hot. The proof, in any
conversation:

```ts
ultimate.action('projetos', 'listar', {})              // this machine's projects, with state and measurements
ultimate.action('projetos', 'listar', { medir: false }) // the rail's cheap read, without measuring
ultimate.action('projetos', 'splash', { enabled: false }) // turns the splash animation off (and true turns it on)
ultimate.action('rate-limiter', 'status', {})          // { wrapped, limits, active, queued }
```

And `ultimate.extensions()` shows both with `server.loadedAt` and without `server.error`.

## Hot reload survives the symlink — measured

The host loads the extension through the link's **target** (`realpath`, in `server/discovery.ts`) and
the watcher reports the file **through the link**; `server/extensions.ts` already resolves one to the
other before invalidating the module. Measurement made on this machine, with both extensions live:

| | `projetos` `loadedAt` | `rate-limiter` `loadedAt` |
| --- | --- | --- |
| before editing `projetos/server.ts` in the repository | `2026-11-10T01:16:39.746Z` | `2026-11-10T01:16:40.111Z` |
| after saving | `2026-11-10T01:17:27.808Z` | `2026-11-10T01:16:40.111Z` (untouched) |

And it was not only the `loadedAt`: the test edit added a temporary field to the return of `listar`
(`sonda: 'symlink-reload'`), which the action returned right after. That is, the module re-read was
**the link target's**, with the new content — not a cache, not the link's file. With the `sonda`
removed, the action returned `{ projetos, at, splash }` again. The `rate-limiter` answered `status`
normally the whole time, and **the host was not restarted**.

That is why the install is by symlink: you edit here, and Ultimate reloads on its own.

## Edit and test

The code is **here**; `~/.ultimate/extensions/<name>` is only the link Ultimate reads. After a
`git pull` (or moving the clone), run `install.sh` again.

```sh
cd ~/src/ultimate-extensions/projetos     && node --test projetos.test.ts   # 26 tests
cd ~/src/ultimate-extensions/rate-limiter && node --test limiter.test.ts    # 12 tests
```

Both suites are pure (fixtures, a temporary `HOME` and a fake host): no test reads the machine, opens
a process or talks to a real provider. What is about the machine — the link, the reload, the section
in the sidebar — is proven live, with Ultimate open.

## Structure

```
ultimate-extensions/
├── install.sh          # links each extension into ~/.ultimate/extensions/<name>
├── LICENSE             # MIT
├── projetos/           # the projects rail on the left edge
│   ├── README.md
│   ├── server.ts        # actions: listar, medir, estado, iniciar, criar, parar, splash
│   ├── projetos.ts      # the pure calculations (initials, groups, presence, path, port, stop, splash)
│   ├── tipos.ts         # what the actions return
│   ├── web.tsx          # the rail, the tile panel, the + dialog, the phone list and the foot
│   ├── projetos.test.ts
│   └── screenshots/     # rail, state, foot, panel and a new project's dialog
└── rate-limiter/       # simultaneous request cap per provider
    ├── README.md
    ├── server.ts        # wraps the provider stream; action: status
    ├── limiter.ts       # the semaphore and the reading of the caps
    └── limiter.test.ts
```

## License

MIT — © 2026 Juliano Julio Costa. See [`LICENSE`](LICENSE).
