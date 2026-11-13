/**
 * The pure calculations of the Projects rail against fixtures: no test here reads the machine, opens
 * a process or makes a request — they are the functions of `projects.ts` and what the rail promises to
 * show.
 *
 * What matters to pin down:
 *
 * - the state comes written, not just in the colour: `running` and `stopped` are words in the tile's
 *   panel, and the group is the position in the rail;
 * - the tile does not show a port: the label is letters only (`initials`), and the port lives in the
 *   link's href;
 * - the count and the question counter come from a measured number: not measured is not `0`, it is
 *   `unavailable` — the invented zero is the worst possible error, because it makes one ignore the
 *   stuck project;
 * - the host comes up without a window and without a port chosen here — on the first free port from
 *   4747 that the program takes itself;
 * - the stop button kills only what it started itself; the rest asks for confirmation, and a dead-pid
 *   lock is not a host (there is nothing to stop, and the click brings it up);
 * - the command copied is the command that runs (`ultimate <path>`), with quotes when the path asks
 *   for them — and it is never run by this extension;
 * - the dot of the tile comes from the app's scheme: it pulses when working **and the reading is new
 *   enough**, is brand without pulsing when it is old, green idle, grey stopped —
 *   and a host that did not answer does not become idle;
 * - the question number is the one in the tile's corner (`1`..`9`, `9+`), and zero draws nothing;
 * - the tile's sentence says state, counts and the time of the measurement: the indicator ages, but
 *   does not lie;
 * - the splash button writes only the `splash` entry of `extensions.disable` in the user's settings,
 *   preserving the other keys, without duplicating, and refusing what the core would refuse whole;
 * - forgetting a project writes only its **home** into `projects.hidden`, once, preserving the other
 *   keys; the `list` does not return a hidden home, and a crooked file is read as hiding nobody and
 *   refused instead of being rewritten.
 * - the rail groups: running above the thin line, stopped below;
 * - the rail is a **stack**: inside each group the rail shown most recently is the first tile (this
 *   window's project always first), a project with no stamp falls back to when it opened, and only then
 *   to its name — so the project you came from is the second tile;
 * - the stamps are the machine's, in their own file: a missing or crooked one is read as nothing, and only
 *   the newest hundred homes are kept;
 * - the folder of the `+` dialog becomes an absolute path with `~` expanded, and a relative path is
 *   refused instead of becoming some folder at random;
 * - the home of a new project is the same one Ultimate calculates
 *   (`<home>/.ultimate/projects/<name>-<8>`).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  adjustHidden,
  adjustSplash,
  startArgs,
  absolutePath,
  command,
  hiddenHomes,
  homeKey,
  isHidden,
  workingCount,
  stopDecision,
  groups,
  ordered,
  shownFile,
  shownStamps,
  stamped,
  SHOWN_CAP,
  projectHome,
  initials,
  linkOf,
  measured,
  questionCount,
  readingWave,
  stateWord,
  questions,
  canStop,
  portOf,
  fresh,
  homeLabel,
  hostOrigin,
  lockPort,
  presence,
  startProgram,
  splashLabel,
  uniqueByRoot,
  userSettings,
  splashEnabled,
  withoutHidden,
  hasMeasurement,
  questionsTitle,
  tileTitle,
  WAVE_INTERVAL,
  ago,
  heldSince,
  outcomeLine,
  pullLine,
  pullOwed,
  restartKey,
  restartLog,
  restartPlan,
  restartServed,
  restartsFile,
  RESTART_WINDOW,
  stampsAfter,
  updateTitle,
} from './projects.ts'
import type { Candidate, Target } from './projects.ts'
import type { Measurement, Project, PullResult, Section } from './types.ts'

/** A row as the server sends it: up, with so many conversations working and so many questions. */
const running = (working: number | null, openQuestions: number | null = 0): Project => ({
  name: 'gta2xlwifi-lineage',
  root: '/projects/gta2xlwifi-lineage',
  current: false,
  running: { pid: 4242, url: 'http://127.0.0.1:4748' },
  working,
  openQuestions: openQuestions,
  ...(working === null ? { reason: 'no answer in 3s' } : {}),
})

/** The same row with the host stopped: no `running` and with the command to copy. */
const stopped: Project = {
  name: 'robsoncosta',
  root: '/projects/robsoncosta',
  current: false,
  command: 'ultimate /projects/robsoncosta',
}

test('the state comes written: the colour is never the only signal', () => {
  assert.equal(stateWord(running(2)), 'running')
  assert.equal(stateWord(stopped), 'stopped')
  // Without `running` there is no process: a `working: 0` alone does not invent a host that is up.
  assert.equal(stateWord({ name: 'x', root: '/x', current: false, working: 0 }), 'stopped')
})

test('the port of the link comes from the URL the host publishes', () => {
  assert.equal(portOf('http://127.0.0.1:4748'), ':4748')
  assert.equal(portOf('http://ultimate.localhost:4747'), ':4747')
  // Without a port there is no link: the row stays without an address instead of pointing at the wrong
  // place.
  assert.equal(portOf('http://127.0.0.1'), undefined)
  assert.equal(portOf(undefined), undefined)
  assert.equal(portOf('not a url'), undefined)
})

test('the count is a measured number, and what was not measured does not become zero', () => {
  assert.equal(workingCount(0), '0 working')
  assert.equal(workingCount(1), '1 working')
  assert.equal(workingCount(7), '7 working')
  // `null` is the host that is up and did not answer; `undefined`, the one that is stopped.
  assert.equal(workingCount(null), 'count unavailable')
  assert.equal(workingCount(undefined), 'count unavailable')
  // A malformed number does not pass as a measurement.
  assert.equal(workingCount(Number.NaN), 'count unavailable')
  assert.equal(workingCount(-1), 'count unavailable')
  assert.equal(workingCount(Number.POSITIVE_INFINITY), 'count unavailable')
})

test('the question counter counts in words, and what was not measured is never zero', () => {
  assert.equal(questions(0), '0 questions')
  assert.equal(questions(1), '1 question')
  assert.equal(questions(2), '2 questions')
  // The silence of a stuck host is not "no questions": it is a missing measurement.
  assert.equal(questions(null), 'questions unavailable')
  assert.equal(questions(undefined), 'questions unavailable')
  assert.equal(questions(Number.NaN), 'questions unavailable')
  assert.equal(questions(-2), 'questions unavailable')

  assert.equal(questionsTitle(0), 'no unanswered questions')
  assert.equal(questionsTitle(1), '1 unanswered question')
  assert.equal(questionsTitle(2), '2 unanswered questions')
  assert.equal(questionsTitle(null, 'no answer in 3s'), 'questions unavailable — no answer in 3s')
  assert.equal(questionsTitle(undefined), 'questions unavailable')
})

test('measured accepts only a finite, non-negative whole number', () => {
  assert.equal(measured(0), 0)
  assert.equal(measured(3), 3)
  for (const crooked of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined])
    assert.equal(measured(crooked), undefined)
})

test('a zero is a measurement: only the silence of the host and the stopped project are not', () => {
  // The bug this pins down: treating `0` as absence and writing `unavailable` for a host that answered.
  assert.equal(hasMeasurement(0, 0), true)
  assert.equal(hasMeasurement(0, null), true)
  assert.equal(hasMeasurement(null, 2), true)
  // `null` is the host that is up and did not answer; `undefined` is the stopped project, which nobody
  // asked.
  assert.equal(hasMeasurement(null, null), false)
  assert.equal(hasMeasurement(undefined, undefined), false)
  assert.equal(hasMeasurement(Number.NaN, -1), false)
})

test('only a running project that is not this window has something to stop', () => {
  assert.equal(canStop(running(1)), true)
  // A stopped project has no host to bring down: its click brings it up.
  assert.equal(canStop(stopped), false)
  // What serves the screen you are clicking in is not shut down from it.
  assert.equal(canStop({ ...running(0), current: true }), false)
})

test('the command copied is the command that runs, with quotes when the path asks for them', () => {
  assert.equal(command('/projects/robsoncosta'), 'ultimate /projects/robsoncosta')
  assert.equal(command('/projects/my project'), `ultimate '/projects/my project'`)
  assert.equal(command("/projects/it's"), `ultimate '/projects/it'\\''s'`)
  // A project without `project.json` has no path: the row says it does not know, it does not guess a
  // directory.
  assert.equal(command(undefined), undefined)
  assert.equal(command(''), undefined)
})

test('the row of a stopped project shows the command to copy, and no measurement', () => {
  assert.equal(stateWord(stopped), 'stopped')
  assert.equal(stopped.working, undefined)
  assert.equal(stopped.openQuestions, undefined)
  assert.equal(command(stopped.root), stopped.command)
})

test('the tile shows initials, in two letters', () => {
  assert.equal(initials('app_evangelho'), 'AE')
  assert.equal(initials('gta2xlwifi-lineage'), 'GL')
  assert.equal(initials('robsoncosta'), 'RO')
  // Space, full stop and hyphen separate alike: two words give the first letter of each one.
  assert.equal(initials('my project'), 'MP')
  assert.equal(initials('ultra.js'), 'UJ')
  // A single word gives its first two letters; a single letter is a single letter.
  assert.equal(initials('worktrees'), 'WO')
  assert.equal(initials('x'), 'X')
  // Empty words (separators only) become no letter at all.
  assert.equal(initials('--'), '')
})

test('the tile does not carry the port: the label is letters and the port lives in the href', () => {
  const project = running(1)
  // What is drawn in the block: no number, no address.
  assert.equal(initials(project.name), 'GL')
  assert.doesNotMatch(initials(project.name), /\d/)
  // What the click opens: the whole URL, with the port.
  assert.equal(linkOf(project), 'http://127.0.0.1:4748')
  assert.match(linkOf(project) ?? '', /:4748$/)
  // Stopped has no link: the click is another action (bring it up), not a trip to an address that does
  // not answer.
  assert.equal(linkOf(stopped), undefined)
})

test('the rail groups: running on top, stopped below, this window’s first', () => {
  const list = (projects: Project[]) => groups(projects)
  const { running: runningRows, stopped: stoppedRows } = list([
    { name: 'zulu', root: '/z', current: false, running: { pid: 1, url: 'http://127.0.0.1:4750' } },
    stopped,
    { name: 'alfa', root: '/a', current: false, running: { pid: 2, url: 'http://127.0.0.1:4749' } },
    { name: 'esta-janela', root: '/e', current: true, running: { pid: 3, url: 'http://127.0.0.1:4747' } },
    { name: 'beta', root: '/b', current: false },
  ])
  // This window's project opens the column; the rest of the running ones come by name.
  assert.deepEqual(
    runningRows.map((project) => project.name),
    ['esta-janela', 'alfa', 'zulu'],
  )
  assert.deepEqual(
    stoppedRows.map((project) => project.name),
    ['beta', 'robsoncosta'],
  )
  // A project that only has a measurement is not up: without `running` it is stopped, and the click
  // brings the host up.
  const measuredOnly = list([{ name: 'medido', root: '/m', current: false, working: 0 }])
  assert.deepEqual(measuredOnly.running, [])
  assert.deepEqual(
    measuredOnly.stopped.map((project) => project.name),
    ['medido'],
  )
  // With no project at all the two groups are empty, and the rail still has the `+`.
  assert.deepEqual(list([]), { running: [], stopped: [] })
})

test('the rail is a stack: the rail shown most recently is the first tile', () => {
  const up = (name: string, shownAt?: number, openedAt?: number): Project => ({
    name,
    root: `/${name}`,
    current: false,
    running: { pid: 1, url: 'http://127.0.0.1:4748' },
    ...(shownAt === undefined ? {} : { shownAt }),
    ...(openedAt === undefined ? {} : { openedAt }),
  })
  // The stamps are of the machine: the last rail opened is the first tile, and the one before it is the
  // second — which is the whole point of the order (`shown` writes these).
  assert.deepEqual(
    ordered([up('alfa', 1_000), up('beta', 3_000), up('gama', 2_000)]).map((project) => project.name),
    ['beta', 'gama', 'alfa'],
  )
  // Two rails stamped at the same moment are decided by name: an order that owes nothing to the machine is
  // still the same on every open.
  assert.deepEqual(
    ordered([up('zulu', 5_000), up('beta', 5_000), up('alfa', 5_000)]).map((project) => project.name),
    ['alfa', 'beta', 'zulu'],
  )
  // A project this machine never stamped falls back to when it opened, and a stamp wins over that: the
  // stamp is what was seen, `openedAt` is only how old the home is.
  assert.deepEqual(
    ordered([up('old', undefined, 1_000), up('new', undefined, 9_000), up('seen', 500)]).map(
      (project) => project.name,
    ),
    ['new', 'old', 'seen'],
  )
  // Nothing at all — no stamp, no `openedAt` — is decided by name, and every stamped project is above it.
  assert.deepEqual(
    ordered([up('unstamped'), up('stamped', 1), up('other')]).map((project) => project.name),
    ['stamped', 'other', 'unstamped'],
  )
})

test('this window’s project is the first tile, however old its stamp', () => {
  const rows: Project[] = [
    { name: 'old-stamp', root: '/a', current: true, shownAt: 1, running: { pid: 1, url: 'http://127.0.0.1:4747' } },
    { name: 'recent', root: '/r', current: false, shownAt: 9_000, running: { pid: 2, url: 'http://127.0.0.1:4748' } },
  ]
  // What serves the screen is the first tile of the column, even with a stamp from long ago: that is what
  // makes the other one the second.
  assert.deepEqual(ordered(rows).map((project) => project.name), ['old-stamp', 'recent'])
})

test('the stack keeps its two groups: the stopped ones stay below the thin line', () => {
  const rows: Project[] = [
    { name: 'stopped-new', root: '/pn', current: false, shownAt: 9_000 },
    { name: 'up-old', root: '/pa', current: false, shownAt: 1_000, running: { pid: 1, url: 'http://127.0.0.1:4748' } },
    { name: 'stopped-old', root: '/pv', current: false, shownAt: 2_000 },
  ]
  // `list` returns one flat array in the order the rail draws it: the recency orders each group, it never
  // moves a stopped project above a running one.
  assert.deepEqual(
    ordered(rows).map((project) => project.name),
    ['up-old', 'stopped-new', 'stopped-old'],
  )
  const { running: up, stopped } = groups(rows)
  assert.deepEqual(up.map((project) => project.name), ['up-old'])
  assert.deepEqual(stopped.map((project) => project.name), ['stopped-new', 'stopped-old'])
})

test('the stamps live in their own file, and a crooked one is read as nothing', () => {
  assert.equal(shownFile('/home/juliano'), '/home/juliano/.ultimate/projects-shown.json')
  // A home mapped to a time is a stamp; anything else in the file is not, and it is ignored without a
  // word — this file is a hint about order, not a document anyone trusts.
  assert.deepEqual(shownStamps({ '/h/one': 1_000, '/h/two': 2_000 }), { '/h/one': 1_000, '/h/two': 2_000 })
  assert.deepEqual(
    shownStamps({ '/h/one': 1_000, '/h/text': 'yesterday', '/h/zero': 0, '/h/negative': -1, '/h/nan': Number.NaN, '/h/crooked': null }),
    { '/h/one': 1_000 },
  )
  // A missing file, a list, a string and a number are no stamp at all: the rail is then ordered as if
  // nothing had ever been shown.
  for (const crooked of [undefined, null, [], ['/h'], '/h', 42])
    assert.deepEqual(shownStamps(crooked), {})
})

test('a rail that was shown stamps its home, newest first, and the file is capped', () => {
  assert.deepEqual(stamped({}, '/h/one', 1_000), { '/h/one': 1_000 })
  // Stamping again moves the line, it does not add a second one: one line per project, whatever the number
  // of page loads.
  assert.deepEqual(stamped({ '/h/one': 1_000, '/h/two': 500 }, '/h/one', 2_000), {
    '/h/one': 2_000,
    '/h/two': 500,
  })
  // Newest first: the file is read in that order, and the cap drops from the tail — the oldest.
  const many = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`/h/${index}`, 1_000 + index]))
  const kept = stamped(many, '/h/new', 10_000)
  assert.equal(Object.keys(kept).length, SHOWN_CAP)
  const lines = Object.entries(kept)
  assert.equal(lines[0][0], '/h/new')
  assert.equal(lines.at(-1)?.[0], `/h/${120 - SHOWN_CAP + 1}`)
  // The times come newest first, without a hole: nothing is kept twice and nothing is reordered.
  assert.deepEqual(
    lines.map(([, at]) => at),
    [...lines.map(([, at]) => at)].sort((a, b) => b - a),
  )
})

test('the dialog’s path expands ~ and refuses what is not absolute', () => {
  const home = '/home/juliano'
  assert.equal(absolutePath('~/src/novo', home), '/home/juliano/src/novo')
  assert.equal(absolutePath('/srv/app', home), '/srv/app')
  assert.equal(absolutePath('~', home), '/home/juliano')
  // Space around it is the user's, not the path's.
  assert.equal(absolutePath('  ~/src/novo  ', home), '/home/juliano/src/novo')
  // `.` and `..` resolve: the path that is brought up is the one the dialog shows.
  assert.equal(absolutePath('~/src/../outro', home), '/home/juliano/outro')
  // Empty and relative are not a path: the dialog asks for one instead of guessing a folder.
  assert.equal(absolutePath('', home), undefined)
  assert.equal(absolutePath('   ', home), undefined)
  assert.equal(absolutePath('src/novo', home), undefined)
  assert.equal(absolutePath('./novo', home), undefined)
  // `~outro` is not the home of whoever is typing: never expand someone else's name.
  assert.equal(absolutePath('~outro/src', home), undefined)
})

test('the home of a new project is <home>/.ultimate/projects/<name>-<8 hex>', () => {
  assert.equal(
    projectHome('/home/juliano/src/novo', '/home/juliano'),
    '/home/juliano/.ultimate/projects/novo-3f75ea87',
  )
  // Same folder, same home: it is the calculation that makes the tile appear on its own after coming
  // up.
  assert.equal(
    projectHome('/home/juliano/src/novo', '/home/juliano'),
    projectHome('/home/juliano/src/novo', '/home/juliano'),
  )
  // Different folders with the same name do not collide: the hash is of the root.
  assert.notEqual(
    projectHome('/a/novo', '/home/juliano'),
    projectHome('/b/novo', '/home/juliano'),
  )
  // The user's home goes in whole, including when it is a test home.
  assert.match(projectHome('/a/novo', '/tmp/h'), /^\/tmp\/h\/\.ultimate\/projects\/novo-[0-9a-f]{8}$/)
})

test('the host comes up in the project, without a window and without a port chosen here', () => {
  // No `--port`: the program takes the port itself (from 4747, retrying the next one when it is taken)
  // and publishes it in the lock. A port chosen from outside could not be reserved, so two starts at the
  // same instant would pick the same one.
  assert.deepEqual(startArgs('/projects/robsoncosta'), ['/projects/robsoncosta', '--no-open'])
  assert.equal(startProgram('/opt/ultimate'), '/opt/ultimate/bin/ultimate.ts')
})

test('a lock\u2019s port is a whole number from 1 to 65535, and nothing else is a port', () => {
  assert.equal(lockPort(1), 1)
  assert.equal(lockPort(4747), 4747)
  assert.equal(lockPort(65535), 65535)
  for (const crooked of [0, -1, 65536, 70000, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '4748', null, undefined, {}])
    assert.equal(lockPort(crooked), undefined)
})

test('a host\u2019s address is loopback, http, with a real port \u2014 and `user@host` is another host', () => {
  assert.equal(hostOrigin('http://127.0.0.1:4748'), 'http://127.0.0.1:4748')
  assert.equal(hostOrigin('http://localhost:4747'), 'http://localhost:4747')
  // The lock is third-party input: `127.0.0.1:4748@evil.com` is a URL for `evil.com`, and a `fetch` or an
  // `href` would go there.
  assert.equal(hostOrigin('http://127.0.0.1:4748@evil.com'), undefined)
  assert.equal(hostOrigin('http://user:pass@127.0.0.1:4748'), undefined)
  assert.equal(hostOrigin('http://evil.com:4748'), undefined)
  assert.equal(hostOrigin('https://127.0.0.1:4748'), undefined)
  // A URL without a port, with a path, or with a crooked number is no address of a host of this machine.
  assert.equal(hostOrigin('http://127.0.0.1'), undefined)
  assert.equal(hostOrigin('http://127.0.0.1:0'), undefined)
  assert.equal(hostOrigin('http://127.0.0.1:70000'), undefined)
  assert.equal(hostOrigin('http://127.0.0.1:4748/iframe'), undefined)
  assert.equal(hostOrigin('http://127.0.0.1:4748?x=1'), undefined)
  assert.equal(hostOrigin('not a url'), undefined)
  assert.equal(hostOrigin(undefined), undefined)
})

test('two homes of the same project are one row, and it is this window\u2019s', () => {
  const scratch = { name: 'app', root: '/src/app', home: '/tmp/scratch/app', current: false }
  const central = { name: 'app', root: '/src/app', home: '/home/j/.ultimate/projects/app-1a2b3c4d', current: false }
  const here = { name: 'app', root: '/src/app', home: '/tmp/another/app', current: true }
  // The tile is one; the row kept is the window's own, so the actions address the home that is on screen.
  assert.deepEqual(uniqueByRoot([scratch, central, here]), [here])
  // Without this window's row, the first home stays — the same order, the same address.
  assert.deepEqual(uniqueByRoot([scratch, central]), [scratch])
  // Different projects are all kept, in order, and a row without a path is not a duplicate of anything.
  assert.deepEqual(uniqueByRoot([scratch, { ...central, root: '/src/other', name: 'other' }]), [
    scratch,
    { ...central, root: '/src/other', name: 'other' },
  ])
  assert.deepEqual(uniqueByRoot([]), [])
})

test('a home is shown as the central one it is, or in full when it is somewhere else', () => {
  assert.equal(homeLabel('/home/j/.ultimate/projects/app-1a2b3c4d'), '~/.ultimate/projects/app-1a2b3c4d')
  // A home elsewhere (an instance with its own ULTIMATE_HOME) is shown as it is: the panel says which
  // home the action addresses, and two different homes are not the same.
  assert.equal(homeLabel('/tmp/scratch/app'), '/tmp/scratch/app')
})

test('the stop button kills only what it started; the rest asks for confirmation', () => {
  const target: Target = { pid: 48362, url: 'http://127.0.0.1:4748' }
  // The pid the extension recorded is the lock's: it is its own host, and it stops straight away.
  assert.deepEqual(stopDecision(target, 48362, false), { action: 'stop', pid: 48362 })
  // Another live pid (born in a terminal, in a supervisor, by someone else): it asks for confirmation,
  // and the next click, which has already read the question, is the one that orders the stop.
  assert.deepEqual(stopDecision(target, undefined, false), { action: 'confirm', pid: 48362 })
  assert.deepEqual(stopDecision(target, 111, false), { action: 'confirm', pid: 48362 })
  assert.deepEqual(stopDecision(target, undefined, true), { action: 'stop', pid: 48362 })
})

test('a dead-pid lock is not a host: there is nothing to stop, and the row says stopped', () => {
  // `host.projects()` only publishes `running` when the lock's pid is alive: a dead-pid lock arrives
  // here as `undefined`, and that is what lets the button bring the project up.
  assert.deepEqual(stopDecision(undefined, undefined, false), { action: 'none' })
  assert.deepEqual(stopDecision(undefined, 48362, true), { action: 'none' })
  // The dead lock stays on disk, but the row — and the button — read only the live pid.
  assert.equal(stateWord({ name: 'gta2xlwifi-lineage', root: '/x', current: false }), 'stopped')
})

/** A measurement of the rail's wave, with the time it was made at. */
const measurement = (
  working: number | null,
  openQuestions: number | null,
  extra: { reason?: string; at?: string } = {},
): Measurement => ({
  working,
  openQuestions: openQuestions,
  ...(extra.reason ? { reason: extra.reason } : {}),
  at: extra.at ?? '2026-11-10T03:22:43.079Z',
})

test('the dot of the tile: pulses working, green idle, grey stopped, hollow without an answer', () => {
  // The reading's own time is the reference: an indicator that ages is acceptable, one that lies is not.
  const now = Date.parse('2026-11-10T03:22:43.079Z')
  // Working: it is the app's mark class (`animate-pulse-dot bg-brand`), not a colour invented here.
  assert.equal(presence(running(2), measurement(2, 0), now), 'working')
  // Zero is a measurement: nothing working is idle for real.
  assert.equal(presence(running(0), measurement(0, 0), now), 'idle')
  // Stopped has nothing to measure — and a leftover measurement does not invent a host that is up.
  assert.equal(presence(stopped, measurement(3, 1), now), 'stopped')
  assert.equal(presence(stopped, undefined, now), 'stopped')
  // Up and with no reading yet (the wave did not come back): nothing is asserted.
  assert.equal(presence(running(1), undefined, now), 'unavailable')
  // The host that is up and did not answer **is not idle**: it is `unavailable`, with the reason at
  // hand.
  assert.equal(
    presence(running(null), measurement(null, null, { reason: 'no answer in 3s' }), now),
    'unavailable',
  )
  // It works even with a question open: both fit in the tile (the pulse and the number in amber).
  assert.equal(presence(running(1), measurement(1, 2), now), 'working')
  // A malformed number does not become work.
  assert.equal(presence(running(Number.NaN), measurement(Number.NaN, 0), now), 'idle')
})

test('the pulse ages: working only while the reading is newer than the wave', () => {
  const at = '2026-11-10T03:22:43.079Z'
  const now = Date.parse(at)
  const reading = measurement(2, 0, { at })
  // Just read: it pulses, it is happening now.
  assert.equal(presence(running(2), reading, now), 'working')
  // One millisecond before the wave's ceiling: still now.
  assert.equal(presence(running(2), reading, now + WAVE_INTERVAL - 1), 'working')
  // **At** the ceiling and older than it: the dot keeps the working colour and stops pulsing — the
  // pixel no longer claims what it cannot know.
  assert.equal(presence(running(2), reading, now + WAVE_INTERVAL), 'stale')
  assert.equal(presence(running(2), reading, now + 60 * 60_000), 'stale')
  // Idle and stopped have nothing to age: a still dot is a still dot.
  assert.equal(presence(running(0), measurement(0, 0, { at }), now + 60 * 60_000), 'idle')
  // A reading whose time cannot be parsed is not "now".
  assert.equal(presence(running(2), measurement(2, 0, { at: 'yesterday' }), now), 'stale')
  // A clock that is behind (a reading from the future) is not fire-and-forget: it is a fresh reading.
  assert.equal(fresh(at, now - 5000), true)
  assert.equal(fresh(at, now + WAVE_INTERVAL), false)
  assert.equal(fresh(undefined, now), false)
  assert.equal(WAVE_INTERVAL, 15_000)
})

test('the question number fits in the corner of the tile: 1..9, 9+ above, and nothing at zero', () => {
  assert.equal(questionCount(1), '1')
  assert.equal(questionCount(9), '9')
  // Above nine it does not fit in the corner: the number becomes a warning, not an exact piece of data.
  assert.equal(questionCount(10), '9+')
  assert.equal(questionCount(42), '9+')
  // Zero draws no counter at all, and what was not measured does not become a number either.
  assert.equal(questionCount(0), undefined)
  assert.equal(questionCount(null), undefined)
  assert.equal(questionCount(undefined), undefined)
  assert.equal(questionCount(Number.NaN), undefined)
  assert.equal(questionCount(-1), undefined)
})

test('the tile’s sentence says state, counts and the time of the measurement', () => {
  // Stopped: the usual sentence, because there is no reading at all to quote.
  assert.equal(tileTitle(stopped, undefined, undefined), 'robsoncosta — stopped, click to start it')
  // Up: the state, the counts as the panel writes them, and **when** the measurement is from.
  assert.equal(
    tileTitle(running(2), measurement(2, 1), '21:53'),
    'gta2xlwifi-lineage — running · 2 working · 1 unanswered question · measured at 21:53 — open it in this tab',
  )
  assert.equal(
    tileTitle(running(0), measurement(0, 0), '21:53'),
    'gta2xlwifi-lineage — running · 0 working · no unanswered questions · measured at 21:53 — open it in this tab',
  )
  // The wave has not come back yet: the tile says it did not measure, instead of faking an idle.
  assert.equal(
    tileTitle(running(0), undefined, undefined),
    'gta2xlwifi-lineage — running · not measured yet — open it in this tab',
  )
  // No answer: `counts unavailable` with the reason, and never a zero.
  assert.equal(
    tileTitle(running(null), measurement(null, null, { reason: 'no answer in 3s' }), '21:53'),
    'gta2xlwifi-lineage — running · counts unavailable — no answer in 3s · measured at 21:53 — open it in this tab',
  )
  // This window's project: the sentence ends by saying that it is this window.
  assert.equal(
    tileTitle({ ...running(0), current: true }, measurement(0, 0), '21:53'),
    'gta2xlwifi-lineage — running · 0 working · no unanswered questions · measured at 21:53 — this window',
  )
})

test('the wave keeps one measurement per project that is up, with the time of the reading', () => {
  const section: Section = {
    at: '2026-11-10T03:22:43.079Z',
    splash: true,
    projects: [
      running(2, 1),
      {
        name: 'travado',
        root: '/t',
        current: false,
        running: { pid: 7, url: 'http://127.0.0.1:4751' },
        working: null,
        openQuestions: null,
        reason: 'no answer in 3s',
      },
      stopped,
      // A project that is up and only has the question count measured does not lose its entry.
      {
        name: 'soPerguntas',
        root: '/s',
        current: false,
        running: { pid: 8, url: 'http://127.0.0.1:4752' },
        openQuestions: 3,
      },
    ],
  }
  const measurements = readingWave(section)
  assert.deepEqual(Object.keys(measurements).sort(), ['gta2xlwifi-lineage', 'soPerguntas', 'travado'])
  // The time is the reading's, not now's: the tile shows when the indicator is from.
  assert.equal(measurements['gta2xlwifi-lineage'].at, section.at)
  assert.equal(measurements['gta2xlwifi-lineage'].working, 2)
  assert.equal(measurements['gta2xlwifi-lineage'].openQuestions, 1)
  // The silence of a stuck host arrives as `null` with the reason, not as zero.
  assert.deepEqual(measurements['travado'], {
    working: null,
    openQuestions: null,
    reason: 'no answer in 3s',
    at: section.at,
  })
  // A measured zero stays zero (and not `null`): it is an answer, not an absence.
  assert.deepEqual(readingWave({ at: section.at, splash: true, projects: [running(0, 0)] }), {
    'gta2xlwifi-lineage': { working: 0, openQuestions: 0, at: section.at },
  })
  // Each row keeps the time **its own** host answered: a slow host in the wave does not make the others
  // claim an older reading.
  assert.deepEqual(
    readingWave({
      at: section.at,
      splash: true,
      projects: [{ ...running(2, 1), measuredAt: '2026-11-10T03:22:40.000Z' }],
    }),
    {
      'gta2xlwifi-lineage': {
        working: 2,
        openQuestions: 1,
        at: '2026-11-10T03:22:40.000Z',
      },
    },
  )
  // No project up: no measurement, and no invented entry.
  assert.deepEqual(readingWave({ at: section.at, splash: true, projects: [stopped] }), {})
})

test('the splash is off when the disable list names it', () => {
  assert.equal(splashEnabled({ extensions: { disable: ['splash'] } }), false)
  assert.equal(splashEnabled({ extensions: { disable: ['splash', 'rate-limiter'] } }), false)
  // A missing file, without the key, or with something else in the list: nothing turned the splash off.
  assert.equal(splashEnabled(undefined), true)
  assert.equal(splashEnabled({}), true)
  assert.equal(splashEnabled({ extensions: {} }), true)
  assert.equal(splashEnabled({ extensions: { disable: ['rate-limiter'] } }), true)
  // What the core ignores whole (broken JSON, an `extensions` that is not an object) is read as on.
  assert.equal(splashEnabled([]), true)
  assert.equal(splashEnabled({ extensions: [] }), true)
  assert.equal(splashEnabled({ extensions: 'splash' }), true)
  assert.equal(splashEnabled({ extensions: { disable: 'splash' } }), true)
})

test('turning the splash off puts splash in disable once, and turning it on takes it out', () => {
  // Turning off a file that does not speak of the splash yet: the entry is born once only.
  assert.deepEqual(adjustSplash({}, false), { extensions: { disable: ['splash'] } })
  // Turning it on takes the name out of the list — and the other entries stay where they were.
  assert.deepEqual(adjustSplash({ extensions: { disable: ['rate-limiter', 'splash'] } }, true), {
    extensions: { disable: ['rate-limiter'] },
  })
  // No duplicating: turning off what is already off does not touch the object (nor the file).
  const disabled = { extensions: { disable: ['splash'] } }
  assert.equal(adjustSplash(disabled, false), disabled)
  // And turning on what is already on does not rewrite anything either.
  const enabled = { modelFamilies: { fast: { model: 'anthropic/x' } } }
  assert.equal(adjustSplash(enabled, true), enabled)
  // The other keys of the file are what the user wrote: they all stay, at any level.
  const full = {
    modelFamilies: { default: 'fast' },
    lander: { checks: [['node --test', { timeout: 120 }]] },
    extensions: { enable: ['parallel'], disable: ['rate-limiter'], orphans: 'not mine' },
  }
  assert.deepEqual(adjustSplash(full, false), {
    ...full,
    extensions: { ...full.extensions, disable: ['rate-limiter', 'splash'] },
  })
  // `extensions.enable` is never touched: `disable` wins over `enable` in the same layer, so turning it
  // off works even with the splash there — and turning it on takes nothing out of it.
  assert.deepEqual(adjustSplash({ extensions: { enable: ['splash'] } }, false), {
    extensions: { enable: ['splash'], disable: ['splash'] },
  })
  assert.deepEqual(adjustSplash({ extensions: { enable: ['splash'], disable: ['splash'] } }, true), {
    extensions: { enable: ['splash'], disable: [] },
  })
})

test('the splash refuses, without writing, what the core would refuse whole', () => {
  // An `extensions` that is not an object would make the core throw the whole file away — and the user
  // would lose the other keys. Refusing is the only honest way out.
  for (const crooked of [[], 'splash', null, 3]) {
    assert.throws(
      () => adjustSplash({ extensions: crooked }, false),
      /extensions must be a JSON object/,
    )
  }
  // A list that is not a list of names is not rewritten either.
  assert.throws(() => adjustSplash({ extensions: { disable: 'splash' } }, false), /array of names/)
  assert.throws(() => adjustSplash({ extensions: { disable: [1] } }, true), /array of names/)
  assert.throws(() => adjustSplash({ extensions: { disable: {} } }, true), /array of names/)
  // A file that is not an object is no settings at all.
  for (const crooked of [[], 'x', null, undefined, 7]) {
    assert.throws(() => adjustSplash(crooked, false), /settings must be a JSON object/)
  }
  assert.equal(userSettings('/home/juliano'), '/home/juliano/.ultimate/settings.json')
})

test('the splash button’s sentence says the state and what the click does', () => {
  assert.equal(splashLabel(true), 'Splash on project switch: on — turn it off')
  assert.equal(splashLabel(false), 'Splash on project switch: off — turn it on')
  // Before the first reading the button does not guess a state.
  assert.equal(splashLabel(undefined), 'Splash on project switch: unknown')
})

// The home is what is stored, not the project's name: a name can repeat, and the `list` returns `home`.
const home = '/home/j/.ultimate/projects/app-1a2b3c4d'
const other = '/home/j/.ultimate/projects/other-5e6f7a8b'
/** This machine's home: the `~` of the panel and of the settings file is expanded against it. */
const machine = '/home/j'

test('the homes the machine hides are read from projects.hidden, and a crooked file hides nobody', () => {
  assert.deepEqual(hiddenHomes({ projects: { hidden: [home] } }), [home])
  assert.deepEqual(hiddenHomes({ projects: { hidden: [home, other] } }), [home, other])
  // Nothing hidden: no file, no `projects`, no `hidden`, an empty list.
  assert.deepEqual(hiddenHomes(undefined), [])
  assert.deepEqual(hiddenHomes({}), [])
  assert.deepEqual(hiddenHomes({ projects: {} }), [])
  assert.deepEqual(hiddenHomes({ projects: { hidden: [] } }), [])
  // What the core would not read whole hides nobody either: a broken shape is not a list of homes.
  assert.deepEqual(hiddenHomes([]), [])
  assert.deepEqual(hiddenHomes({ projects: [] }), [])
  assert.deepEqual(hiddenHomes({ projects: 'app' }), [])
  assert.deepEqual(hiddenHomes({ projects: { hidden: home } }), [])
  assert.deepEqual(hiddenHomes({ projects: { hidden: {} } }), [])
  // A list with something else inside it: what is not a home is not a home to hide.
  assert.deepEqual(hiddenHomes({ projects: { hidden: [home, 3, null, {}, other] } }), [home, other])
})

test('hiding a home puts it in projects.hidden once, and showing it again takes it out', () => {
  // Hiding the first project has nothing to preserve but the other keys.
  assert.deepEqual(adjustHidden({}, home, true, machine), { projects: { hidden: [home] } })
  assert.deepEqual(adjustHidden({ projects: { hidden: [other] } }, home, true, machine), {
    projects: { hidden: [other, home] },
  })
  // No duplicating: hiding what is already hidden does not touch the object (nor the file).
  const listed = { projects: { hidden: [home] } }
  assert.equal(adjustHidden(listed, home, true, machine), listed)
  // Showing it again takes only its own home out — and leaves an empty list rather than a deleted key.
  assert.deepEqual(adjustHidden({ projects: { hidden: [other, home] } }, home, false, machine), {
    projects: { hidden: [other] },
  })
  assert.deepEqual(adjustHidden({ projects: { hidden: [home] } }, home, false, machine), {
    projects: { hidden: [] },
  })
  // Showing a home that is not hidden does not rewrite anything either.
  const notListed = { projects: { hidden: [other] } }
  assert.equal(adjustHidden(notListed, home, false, machine), notListed)
  // The other keys of the file are what the user wrote: they all stay, at any level — including the keys
  // of `projects` itself.
  const full = {
    modelFamilies: { default: 'fast' },
    lander: { checks: [['node --test', { timeout: 120 }]] },
    extensions: { disable: ['splash'] },
    projects: { hidden: [other], note: 'mine' },
  }
  assert.deepEqual(adjustHidden(full, home, true, machine), {
    ...full,
    projects: { hidden: [other, home], note: 'mine' },
  })
})

test('a home written with ~ or with a trailing slash is the same home', () => {
  assert.equal(homeKey(home, machine), home)
  assert.equal(homeKey('~/.ultimate/projects/app-1a2b3c4d', machine), home)
  assert.equal(homeKey('~/.ultimate/projects/app-1a2b3c4d/', machine), home)
  assert.equal(homeKey('/home/j/.ultimate/other/../projects/app-1a2b3c4d', machine), home)
  // A path of somewhere else, or something that is not an absolute path, matches no home of the machine.
  assert.equal(
    homeKey('/home/other/.ultimate/projects/app-1a2b3c4d', machine),
    '/home/other/.ultimate/projects/app-1a2b3c4d',
  )
  assert.equal(homeKey('app', machine), 'app')
  // A list written by hand with the `~` the panel shows hides the project — and asking for it again (or
  // taking it out of the list) knows it is the same home, written the other way.
  assert.deepEqual(withoutHidden([{ home }], ['~/.ultimate/projects/app-1a2b3c4d'], machine), [])
  assert.equal(isHidden(home, ['~/.ultimate/projects/app-1a2b3c4d'], machine), true)
  assert.equal(isHidden(home, [], machine), false)
  assert.deepEqual(
    adjustHidden({ projects: { hidden: ['~/.ultimate/projects/app-1a2b3c4d'] } }, home, false, machine),
    { projects: { hidden: [] } },
  )
  const tilde = { projects: { hidden: ['~/.ultimate/projects/app-1a2b3c4d'] } }
  assert.equal(adjustHidden(tilde, home, true, machine), tilde)
})

test('forgetting refuses, without writing, what it cannot rewrite whole', () => {
  // A file that is not an object is no settings at all.
  for (const crooked of [[], 'x', null, undefined, 7]) {
    assert.throws(() => adjustHidden(crooked, home, true, machine), /settings must be a JSON object/)
  }
  // A `projects` that is not an object, and a `hidden` that is not a list of homes: the core would throw
  // the whole file away, and the user would lose the other keys.
  for (const crooked of [[], 'app', null, 3]) {
    assert.throws(
      () => adjustHidden({ projects: crooked }, home, true, machine),
      /projects must be a JSON object/,
    )
  }
  assert.throws(
    () => adjustHidden({ projects: { hidden: home } }, home, true, machine),
    /must be an array of homes/,
  )
  assert.throws(
    () => adjustHidden({ projects: { hidden: [1] } }, home, false, machine),
    /must be an array of homes/,
  )
  assert.throws(
    () => adjustHidden({ projects: { hidden: {} } }, home, false, machine),
    /must be an array of homes/,
  )
})

test('the rail does not draw a hidden home, and draws the rest as they came', () => {
  const app = { name: 'app', root: '/src/app', home, current: false }
  const elsewhere = { name: 'other', root: '/src/other', home: other, current: false }
  assert.deepEqual(withoutHidden([app, elsewhere], [], machine), [app, elsewhere])
  assert.deepEqual(withoutHidden([app, elsewhere], [home], machine), [elsewhere])
  assert.deepEqual(withoutHidden([app, elsewhere], [other, home], machine), [])
  // The home that is not among the rows hides nobody, and the rows come back untouched and in order.
  assert.deepEqual(
    withoutHidden([app, elsewhere], ['/home/j/.ultimate/projects/gone-00000000'], machine),
    [app, elsewhere],
  )
  // A row without a home cannot be told apart: it stays.
  const nameless = { name: 'x' }
  assert.deepEqual(withoutHidden([nameless], [home], machine), [nameless])
})

/** A host the update button may restart, as the action found it: up, on loopback, running old code. */
const candidate = (over: Partial<Candidate> & { name: string; home: string }): Candidate => ({
  self: false,
  origin: 'http://127.0.0.1:4750',
  restart: true,
  build: 'build-1',
  generation: 1,
  ...over,
})

test('only the hosts that answered `restart` enter the list, this window’s own last', () => {
  const plan = restartPlan(
    [
      candidate({ name: 'app', home: '/h/app' }),
      // Up, but running the clone's own code: no restart is owed.
      candidate({ name: 'api', home: '/h/api', restart: false }),
      // Did not say (an older build of this extension): nothing to act on.
      candidate({ name: 'web', home: '/h/web', restart: undefined }),
      // Nowhere to ask: a lock that names no address of this machine is no candidate.
      candidate({ name: 'lost', home: '/h/lost', origin: undefined }),
      // This window's host: it is in the list, and it is the last line, because the process answering the
      // click is the one that must not be touched mid-way.
      candidate({ name: 'me', home: '/h/me', self: true, origin: undefined }),
    ],
    {},
    1_000,
  )
  assert.deepEqual(
    plan.map((target) => target.name),
    ['app', 'me'],
  )
  assert.deepEqual(
    plan.map((target) => target.key),
    ['/h/app@build-1', '/h/me@build-1'],
  )
  assert.equal(plan[1].self, true)
  // Nothing was tried yet: nothing is held.
  assert.deepEqual(
    plan.map((target) => target.held),
    [undefined, undefined],
  )
})

test('the anti-loop window holds the same home and build, and lets it go after it', () => {
  const now = 1_700_000_000_000
  const key = restartKey('/h/app', 'build-1')
  assert.equal(heldSince({}, key, now), undefined)
  assert.equal(heldSince({ [key]: now - 60_000 }, key, now), now - 60_000)
  // Just inside the window: still held; exactly at its edge: free again.
  assert.equal(heldSince({ [key]: now - RESTART_WINDOW + 1 }, key, now), now - RESTART_WINDOW + 1)
  assert.equal(heldSince({ [key]: now - RESTART_WINDOW }, key, now), undefined)
  // A stamp from the future (two windows with clocks apart) counts as inside it: the window is kept by
  // waiting, never by restarting sooner.
  assert.equal(heldSince({ [key]: now + 5_000 }, key, now), now + 5_000)
})

test('a host that restarted comes back on another build, so its stamp does not hold it', () => {
  const now = 1_700_000_000_000
  const attempts = { [restartKey('/h/app', 'old')]: now - 60_000 }
  const [plan] = restartPlan([candidate({ name: 'app', home: '/h/app', build: 'new' })], attempts, now)
  assert.equal(plan.key, '/h/app@new')
  assert.equal(plan.held, undefined)
  // The same host on the same build is the one the window holds — and the plan says since when.
  const [held] = restartPlan([candidate({ name: 'app', home: '/h/app', build: 'old' })], attempts, now)
  assert.equal(held.held, now - 60_000)
  // This window's own host is held like any other: a swap that was rolled back does not come back on another
  // build, and asking for it again inside the window would loop.
  const key = restartKey('/h/me', 'build-1')
  const [self] = restartPlan(
    [candidate({ name: 'me', home: '/h/me', self: true, origin: undefined })],
    { [key]: now - 120_000 },
    now,
  )
  assert.equal(self.self, true)
  assert.equal(self.held, now - 120_000)
})

test('the attempts file keeps what is inside the window and drops the rest', () => {
  const now = 1_700_000_000_000
  const inside = now - 60_000
  const outside = now - RESTART_WINDOW - 1
  assert.deepEqual(stampsAfter({ app: inside, api: outside }, ['web'], now), {
    app: inside,
    web: now,
  })
  // Stamping the same key again moves its line instead of adding a second one.
  assert.deepEqual(stampsAfter({ app: inside }, ['app'], now), { app: now })
})

test('a crooked attempts file is no attempt at all', () => {
  for (const crooked of [null, [], 'x', 7, undefined]) assert.deepEqual(restartLog(crooked), {})
  // A value that is not an epoch ms is not an attempt either: reading it as one would hold a restart nobody
  // tried.
  assert.deepEqual(restartLog({ ok: 5, text: 'yesterday', infinite: Infinity, negative: -1 }), { ok: 5 })
  assert.equal(restartsFile('/home/j'), '/home/j/.ultimate/projects-restarts.json')
})

test('the pull is owed only when the clone is behind or an install is owed', () => {
  assert.equal(pullOwed(undefined), false)
  assert.equal(pullOwed({ behind: 0, install: false }), false)
  assert.equal(pullOwed({ behind: 2, install: false }), true)
  assert.equal(pullOwed({ behind: 0, install: true }), true)
})

test('the button promises what it counts, and is not on the rail when there is nothing', () => {
  assert.equal(updateTitle({}), undefined)
  assert.equal(updateTitle({ behind: 0, restart: 0 }), undefined)
  assert.equal(
    updateTitle({ behind: 5, restart: 2 }),
    'Update and restart: update 5 commits · restart 2 projects',
  )
  assert.equal(
    updateTitle({ behind: 1, restart: 1 }),
    'Update and restart: update 1 commit · restart 1 project',
  )
  assert.equal(updateTitle({ restart: 3 }), 'Update and restart: restart 3 projects')
  assert.equal(updateTitle({ behind: 1 }), 'Update and restart: update 1 commit')
})

test('a restart is proved by the generation that serves, not by the port', () => {
  // The port keeps answering throughout the supervisor's swap, with the old process.
  assert.equal(restartServed({ generation: 4 }, 4), true)
  assert.equal(restartServed({ generation: 5 }, 4), true)
  assert.equal(restartServed({ generation: 3 }, 4), false)
  assert.equal(restartServed({}, 4), false)
  assert.equal(restartServed(undefined, 4), false)
})

test('the summary says what came of each host, and the pull says what moved', () => {
  assert.equal(outcomeLine({ name: 'app', result: 'restarted', seconds: 4 }), 'app — restarted in 4s')
  assert.equal(
    outcomeLine({ name: 'api', result: 'failed', reason: 'no answer in 20s' }),
    'api — no answer in 20s',
  )
  assert.equal(
    outcomeLine({ name: 'web', result: 'held', reason: 'tried 3 min ago' }),
    'web — held, tried 3 min ago',
  )
  assert.equal(outcomeLine({ name: 'me', result: 'self' }), 'me — this window restarts itself')
  // A failure with no reason still says it did not come back.
  assert.equal(outcomeLine({ name: 'x', result: 'failed' }), 'x — did not come back')
  const pull = (over: Partial<Extract<PullResult, { ok: true }>>): PullResult => ({
    ok: true,
    from: 'aaaaaaa',
    to: 'bbbbbbb',
    commits: 2,
    install: 'skipped',
    ...over,
  })
  assert.equal(pullLine(pull({})), 'updated 2 commits (aaaaaaa → bbbbbbb)')
  assert.equal(
    pullLine(pull({ commits: 1, install: 'done' })),
    'updated 1 commit (aaaaaaa → bbbbbbb) · packages installed',
  )
  assert.equal(pullLine(pull({ install: 'failed' })), 'updated 2 commits (aaaaaaa → bbbbbbb) · install failed')
  // A failed install carries the line that says why — the last thing pnpm wrote, not a made-up summary.
  assert.equal(
    pullLine(pull({ install: 'failed', installError: 'progress\nERR_PNPM_LOCKFILE_BREAKING_CHANGE\n' })),
    'updated 2 commits (aaaaaaa → bbbbbbb) · install failed: ERR_PNPM_LOCKFILE_BREAKING_CHANGE',
  )
  // A restart whose seconds did not come says it restarted, never "in 0s": an invented zero is the one thing
  // this extension must not print.
  assert.equal(outcomeLine({ name: 'app', result: 'restarted' }), 'app — restarted')
  // A refusal is reported whole: it is what stopped the rest of the click.
  assert.equal(
    pullLine({ ok: false, refused: 'The clone has uncommitted changes' }),
    'refused: The clone has uncommitted changes',
  )
})

test('how long ago a restart was tried, in the words of a line', () => {
  const now = 1_700_000_000_000
  assert.equal(ago(now - 1_000, now), 'just now')
  assert.equal(ago(now - 42_000, now), '42s ago')
  assert.equal(ago(now - 3 * 60_000, now), '3 min ago')
  assert.equal(ago(now - 2 * 3_600_000, now), '2h ago')
  // A stamp from the future never reads as a negative time.
  assert.equal(ago(now + 5_000, now), 'just now')
})
