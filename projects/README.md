# projects — a rail of projects

A column on the left edge of the window, one tile per project: running hosts on top, stopped ones
below, each with a presence dot and the number of unanswered questions. One click opens a project or
brings it up.

![The rail on the left edge](screenshots/rail.png)

## How it works

One tile per project, drawn with its initials (`billing-app` → `BA`). This window's project comes
first, then the other running ones by name, a thin line, then the stopped ones. The same order on every
open, so no tile jumps around.

The dot in the corner is the project's state: grey stopped, green up and idle, pulsing while the last
reading saw it working, hollow when the host does not answer. The number in the corner is the count of
questions without an answer (`9+` from ten up), in amber.

A tile is one click: a running project opens in this tab, a stopped one is brought up.

Hovering or focusing a tile opens its panel after a moment, with what the tile does not fit: the port,
the state in words, how many conversations are working and how many questions wait, the command to
copy and the stop button. Those numbers are measured when the panel opens, with the time of the
reading.

![The tile panel](screenshots/panel.png)

On the phone there is no rail: the same list, compact, stays in the sidebar.

## Using it

- **Switch project** — click a running tile: it opens in this tab. ⌘/Ctrl+click opens a new tab, like
  any link.
- **Bring a stopped project up** — click its tile; it shows a spinner until the host answers. If it
  does not come up, the tile gains a red ring and the panel says why.
- **Stop a host** — the button in the tile's panel. A host this extension did not start (born in a
  terminal or in a supervisor) stops only after a confirmation, with the port and the pid in the
  question.
- **Create a project** — `+` at the bottom of the rail: type the folder's path, absolute or starting
  with `~`. The host comes up and its tile appears; the card offers `Open it`. Its first run, its
  onboarding and the trust decision happen in that project's own window.
- **Measure again** — `⟳` reads the machine now; its `title` says when the last reading was.
- **Turn the splash on or off** — the switch at the bottom of the rail. One click, and one click back.

## Configuration

This extension has no options of its own. What exists is the one thing the splash switch writes, in
this machine's `~/.ultimate/settings.json`:

```json
{ "extensions": { "disable": ["splash"] } }
```

The switch flips that entry: off adds `splash`, on removes it, and every other key of the file stays as
it is. With no file there, turning it off creates the file. The file is rewritten as normalised JSON —
the old formatting is lost, no key is.

Writing it by hand has the same effect: a different set of extensions means a new web bundle, so
**every open window reloads**. The switch's tooltip says so. To undo, remove `splash` from the list and
save, or click the switch again.

A project's `.ultimate/settings.json` can say the opposite on top; this switch speaks about this
machine's layer only.

## Actions

For agents and automation, one line each:

- `list` — this machine's projects with state, port and command; `{ measure: false }` skips asking the
  other hosts.
- `measure` — `{ name }`: that project measured now, with the time of the answer.
- `state` — this host only: working conversations and open questions; another host asks it.
- `start` — `{ name }`: brings that host up, and returns when it answers.
- `create` — `{ path }`: brings up the host of a new folder and returns the new project.
- `stop` — `{ name, confirm? }`: takes that host down; `needsConfirm` when it was not started here.
- `splash` — `{ enabled }`: turns the splash animation on or off in this machine's settings.

`stop`, `create` and `splash` are user actions: an agent calling them is refused, so nothing stops a
host, creates a project or flips this machine's splash behind the screen.

## What it does not do

- It does not poll: readings happen when the rail is opened, entered or focused, on `⟳`, and after
  every action that changes the machine.
- It does not stop the host of this window — stop it from another window.
- It does not kill a host it did not start without asking.
- It does not reach another computer: only what runs on this one, on loopback.
