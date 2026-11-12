# projects — a rail of projects

A column on the left edge of the window, one tile per project: running hosts on top, stopped ones
below, each with a presence dot and the number of unanswered questions. One click opens a project or
brings it up.

![The rail on the left edge](screenshots/rail.png)

## How it works

One tile per project, drawn with its initials (`billing-app` → `BA`). This window's project comes first,
then the other running ones, a thin line, then the stopped ones — and inside each group the tiles are a
**stack**: the project whose rail was opened last is the first tile, the one before it the second. That
is what makes going back easy: switch to another project to capture something, come back, and the project
you left is right below this one.

The order is the machine's, not a window's — every window of every project reads the same stamps
(`~/.ultimate/projects-shown.json`, below), so they all agree on what came before. A project this machine
has no stamp for is placed by when it opened, and two with neither are ordered by name. The price of
"always the second" is that a tile can change place: opening a project moves its tile up in the rails of
this machine, this window's included.

The dot in the corner is the project's state: grey stopped, green up and idle, pulsing while the last
reading saw it working, hollow when the host does not answer. The number in the corner is the count of
questions without an answer (`9+` from ten up), in amber.

A tile is one click: a running project opens in this tab, a stopped one is brought up.

Hovering or focusing a tile opens its panel after a moment, with what the tile does not fit: the port,
the state in words, how many conversations are working and how many questions wait, the command to
copy, the stop button and, on a stopped project, `forget…`. Those numbers are measured when the panel
opens, with the time of the reading.

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
  onboarding and the trust decision happen in that project's own window. A folder whose project was
  forgotten comes back to the rail instead of being refused.
- **Refresh the projects** — `⟳` reads every project again now; each tile's panel says when its
  numbers were read.
- **Forget a project** — `forget…` in the panel of a stopped project (not this window's): the tile
  leaves the rail and the project's conversations stay where they are. Nothing is deleted; the panel
  says how to bring it back.
- **Turn the splash on or off** — the switch at the bottom of the rail. One click, and one click back.

## Configuration

Two keys of this machine's `~/.ultimate/settings.json` are this extension's: the splash switch and the
homes the rail hides. Everything else in the file stays as it is. A second file,
`~/.ultimate/projects-shown.json`, holds the order of the tiles; it is this extension's own, and the
settings file never mentions it.

### The order of the tiles

Every page load of the rail stamps its project, and that is all this file is:

```json
{ "/home/juliano/.ultimate/projects/billing-app-1a2b3c4d": 1770000000000 }
```

The key is the project's **home**, the same one the panel shows, and the value is when its rail was last
opened, in epoch ms. `list` reads it on every reading. `shown` keeps the 100 newest homes so the file does
not grow for ever, and writes it through a temporary and a `rename`. A file that cannot be read whole is
treated as empty — the rail is then ordered by when each project opened, without a word about it, and
nothing is rewritten. A home in the file that is not a project of this machine any more is simply not
used. Deleting the file is safe: the order starts from scratch and rebuilds itself as the windows are
opened.

### The splash animation

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

### Hidden projects

`forget…` adds the project's **home** to a list of that name — the home, not the project's name: two
folders can share a name, and the home is unique. The panel shows that home abbreviated with `~` (its
tooltip has the whole path), and the list takes it written either way, `~` counting from this machine's
home: a home that is not under it — an instance with its own home — is written in full.

```json
{ "projects": { "hidden": ["~/.ultimate/projects/old-app-1a2b3c4d"] } }
```

The rail reads that list on every reading, so a home in it has no tile. **Nothing is deleted**: the
home stays where it was, with the project's `state.sqlite` — that is, with its conversations. To bring
the project back, remove its home from `projects.hidden` and save; the tile returns on the next reading.
Asking for its folder again with the `+` does the same, and the answer says so. Writing the list by
hand does the same — the refusals (this window, a host that is up) belong to the panel's action, not to
the file.

![The panel's forget question](screenshots/forget.png)

A home in the list that is not a project of this machine hides nothing; a list that is not a list, or a
file that cannot be read whole, hides nobody — and a `forget…` that would have to rewrite such a file
refuses without writing anything.

## Actions

For agents and automation, one line each:

- `list` — this machine's projects with state, port and command, in the order the rail draws them;
  `{ measure: false }` skips asking the other hosts.
- `shown` — no arguments: stamps this project in `~/.ultimate/projects-shown.json`, which is what orders
  the rail. The rail calls it once per page load.
- `measure` — `{ name }`: that project measured now, with the time of the answer.
- `state` — this host only: working conversations and open questions; another host asks it.
- `start` — `{ name }`: brings that host up, and returns when it answers.
- `create` — `{ path }`: brings up the host of a new folder and returns the new project; a forgotten
  project's folder comes back to the rail (`unhidden: true`).
- `stop` — `{ name, confirm? }`: takes that host down; `needsConfirm` when it was not started here.
- `forget` — `{ name }`: hides that project from the rail by adding its home to `projects.hidden` in this
  machine's settings. Nothing is deleted. It is refused for this window's project and for a host that is
  up (stop it first).
- `splash` — `{ enabled }`: turns the splash animation on or off in this machine's settings.

`stop`, `create`, `forget` and `splash` are user actions: an agent calling them is refused, so nothing
stops a host, creates or hides a project, or flips this machine's splash behind the screen.

## What it does not do

- It does not poll: readings happen when the rail is opened, entered or focused, on `⟳`, and after
  every action that changes the machine.
- It does not stop the host of this window — stop it from another window.
- It does not delete anything: a forgotten project is hidden from this rail, and its home — with the
  conversations — stays where it was.
- It does not kill a host it did not start without asking.
- It does not reach another computer: only what runs on this one, on loopback.
