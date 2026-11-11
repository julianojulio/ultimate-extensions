# Contributing

The practical part: how to run these extensions on your machine, how to run the tests, and how the
repository is laid out.

## Run them on your machine

```sh
sh install.sh
```

The script links every extension in this repository into `~/.ultimate/extensions/<name>` — a symlink,
so the folder here is the folder Ultimate reads — and links each extension's `node_modules` to the
Ultimate clone's, which is where the tests find `@earendil-works/*`. The clone comes from
`$ULTIMATE_ROOT`, by default `~/src/ultimate`.

It is idempotent: running it again changes nothing, and a real folder where it wants to link a
symlink is reported and left alone. It also removes a dead link: a link in `~/.ultimate/extensions/`
that points into this repository, at a folder that no longer exists, is removed — which is what
a renamed extension leaves behind. After a `git pull`, or after moving the clone, run it again.

## Tests

From the repository root:

```sh
node --test $(find . -name '*.test.ts' -not -path '*/node_modules/*')
```

That picks up every test file in the repository, whatever the extension folders are called. The
suites are pure — fixtures, a temporary `HOME`, a fake host — so they need nothing installed, spawn no
processes and talk to no provider. What only happens inside Ultimate (a link being read, a provider
being wrapped, the rail in the window) is checked by hand in a running Ultimate.

There is no build step: the files in the repository are the files that run.

## Layout

```
ultimate-extensions/
├── install.sh                      # links each extension into ~/.ultimate/extensions/<name>
├── LICENSE                         # MIT
├── projects/                       # the rail of this computer's projects
│   ├── README.md                   # what it does, what it does not do, screenshots
│   ├── server.ts                   # the actions
│   ├── projects.ts                 # the pure calculations
│   ├── types.ts                    # what the actions return
│   ├── web.tsx                     # the rail, its tile panel and its dialogs
│   ├── projects.test.ts
│   └── screenshots/
├── rate-limiter/                   # a ceiling on simultaneous requests per provider
│   ├── README.md
│   ├── server.ts                   # wraps the provider stream; action: status
│   ├── limiter.ts                  # the semaphore and the reading of the ceilings
│   └── limiter.test.ts
└── skills/
    └── install-extensions/
        └── SKILL.md                # the flow the README's "Install with an agent" follows
```

An extension is a top-level folder with a `server.ts` or a `web.tsx` and a `README.md`. `install.sh`
looks for exactly that, and so does the test command.
