/**
 * The pure calculations of the Projects rail: the initials of the tile, the two groups (running and
 * stopped), the path typed into the `+` dialog, the central home a new project will occupy, the port
 * that only the panel shows, what the stop button decides, and what the splash button and the `forget`
 * button write to this machine's settings. Nothing here reads the machine, opens a process or makes a
 * request — `projects.test.ts` covers all of it with fixtures.
 *
 * The state is never the colour alone: the rail writes `running`/`stopped` in each tile's panel, the
 * group is the position (running above the line, stopped below) and what was measured comes as a
 * number, with the time.
 */
import { createHash } from 'node:crypto'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { Measurement, Project, Section } from './types.ts'

/**
 * How old a reading may be and still move the rail: the wave's ceiling, and the age at which the pulse
 * stops. A pulse is the app's word for "happening now" (`animate-pulse-dot`); a reading older than
 * this is a fact about the past, and its dot is a still brand dot.
 */
export const WAVE_INTERVAL = 15_000

/**
 * The state of the host, in a word: the panel says `running` or `stopped`, because it does not fit in a
 * 32px tile.
 */
export function stateWord(project: Project): 'running' | 'stopped' {
  return project.running ? 'running' : 'stopped'
}

/**
 * The port, as the panel shows it for diagnostics: `:4747`, taken from the URL the host publishes. A
 * URL without a port returns nothing — the panel stays without a number instead of inventing an
 * address.
 */
export function portOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const { port } = new URL(url)
    return port ? `:${port}` : undefined
  } catch {
    return undefined
  }
}

/**
 * A port, when it is one: a whole number from 1 to 65535. A lock is written by another process, so what
 * it says is third-party input — `"4748@evil.com"` inside the URL template becomes a host of someone
 * else's choosing, and a `fetch` or an `href` goes there.
 */
export function lockPort(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535)
    return undefined
  return value
}

/**
 * The address of a host, when it is a host of this machine: `http` (not `https`, not a scheme that
 * redirects), loopback, with a real port and nothing else in the URL. A lock is third-party input, and
 * `http://127.0.0.1:4748@evil.com` is a URL for `evil.com` — it must not reach a `fetch` or an `href`.
 * What does not pass is refused, and the row says the lock names no address of this machine.
 */
export function hostOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:') return undefined
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return undefined
  // `user@host` and `user:pass@host` are another destination with the loopback in the user name.
  if (parsed.username || parsed.password) return undefined
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) return undefined
  const port = lockPort(Number(parsed.port))
  return port === undefined ? undefined : parsed.origin
}

/** A number that can be shown: whole, finite and not negative. The rest is not a measurement. */
export function measured(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

/**
 * Whether there is a measurement to show. **A zero is a measurement** — the bug this pins down is
 * treating `0` as absence: `0 working · 0 questions` is an answer; `null` (the host is up and did not
 * answer) and `undefined` (the project is stopped, nobody asked) are not.
 */
export function hasMeasurement(
  working: number | null | undefined,
  openQuestions: number | null | undefined,
): boolean {
  return measured(working) !== undefined || measured(openQuestions) !== undefined
}

/**
 * Whether the project has a host to stop: running, and not this window's (what serves the screen is not
 * shut down from it).
 */
export function canStop(project: Project): boolean {
  return project.running !== undefined && !project.current
}

/**
 * How many conversations are working now: `0 working`, `2 working`. A number that was not measured does
 * not become zero — it becomes `count unavailable`.
 */
export function workingCount(working: number | null | undefined): string {
  const n = measured(working)
  return n === undefined ? 'count unavailable' : `${n} working`
}

/**
 * The panel's questions without an answer, with the number in front: `0 questions`, `1 question`. Not
 * measured, `questions unavailable` — never an invented zero, which is what would make one ignore the
 * stuck project.
 */
export function questions(openQuestions: number | null | undefined): string {
  const n = measured(openQuestions)
  if (n === undefined) return 'questions unavailable'
  return `${n} ${n === 1 ? 'question' : 'questions'}`
}

/**
 * The whole sentence of the counter, which sits in the row's `title`: `2 unanswered questions`. Not
 * measured, the sentence says that nothing was measured and why.
 */
export function questionsTitle(openQuestions: number | null | undefined, reason?: string): string {
  const n = measured(openQuestions)
  if (n === undefined) return reason ? `questions unavailable — ${reason}` : 'questions unavailable'
  return n === 0 ? 'no unanswered questions' : `${n} unanswered question${n === 1 ? '' : 's'}`
}

/**
 * The click target of a tile: the host's URL, with the port, where the browser goes. The number enters
 * no label (`initials` has letters only): it is an address, not on-screen information.
 */
export function linkOf(project: Project): string | undefined {
  return project.running?.url
}

/**
 * The initials of the tile, in up to two letters: `app_evangelho` → `AE`, `gta2xlwifi-lineage` → `GL`,
 * `robsoncosta` → `RO`. Two words give the first letter of each one; a single word gives its first two
 * letters. Two projects can coincide in their initials — the panel gives the name and the path.
 */
export function initials(name: string): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const letters =
    parts.length > 1
      ? parts.slice(0, 2).map((part) => Array.from(part)[0])
      : Array.from(parts.join('')).slice(0, 2)
  return letters.join('').toUpperCase()
}

/** The rail split by what it shows: the running hosts on top, the stopped ones below. */
export interface Groups {
  running: Project[]
  stopped: Project[]
}

/**
 * The two groups of the rail, in the order it draws them: this window's project first among the running
 * ones, the rest by name — the same order on every open, so that a tile does not jump around.
 */
export function groups(projects: Project[]): Groups {
  const byName = (a: Project, b: Project) => a.name.localeCompare(b.name)
  const running = projects
    .filter((project) => project.running !== undefined)
    .sort((a, b) => Number(b.current) - Number(a.current) || byName(a, b))
  const stopped = projects.filter((project) => project.running === undefined).sort(byName)
  return { running, stopped }
}

/**
 * The path typed into the `+` dialog, made absolute: `~` becomes the home of whoever is using it, `~/x`
 * becomes `<home>/x`, and the rest is resolved against the current directory. Empty or accidentally
 * relative returns `undefined` — the dialog asks for a path instead of guessing a folder.
 */
export function absolutePath(value: string, home: string): string | undefined {
  const text = value.trim()
  if (!text) return undefined
  const expanded =
    text === '~' ? home : text.startsWith('~/') ? join(home, text.slice(2)) : text
  return isAbsolute(expanded) ? resolve(expanded) : undefined
}

/**
 * A home as the tile's panel shows it: `~/.ultimate/projects/app-1a2b3c4d` for the central homes, and
 * the whole path for a home somewhere else (an instance with its own `ULTIMATE_HOME`) — the panel
 * says which home an action addresses, so it must not pretend two different homes are the same.
 */
export function homeLabel(home: string): string {
  const central = /(?:^|\/)\.ultimate\/projects\/([^/]+)$/.exec(home)
  return central ? `~/.ultimate/projects/${central[1]}` : home
}

/**
 * The central home of a new project, `<home>/.ultimate/projects/<name>-<8 hex of the path's sha256>`.
 * It is the same calculation as `server/project.ts:projectHome`; a new project does not register itself
 * by hand — the host running in that folder is born with this home, and that is why the tile appears
 * on its own.
 */
export function projectHome(root: string, home: string): string {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 8)
  return join(home, '.ultimate', 'projects', `${basename(root)}-${hash}`)
}

/** The command that brings the project up by hand, in any project's panel: `ultimate <path>`. */
export function command(root: string | undefined): string | undefined {
  if (!root) return undefined
  return `ultimate ${shellWord(root)}`
}

/** A path the shell would not split stays as it is; any other goes between single quotes. */
function shellWord(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * The `argv` with which this extension brings a host up: the project, and no window. The port is **not**
 * passed: `bin/ultimate.ts` chooses it (from 4747) and, with no `--port`, retries the next one when the
 * port is taken (`EADDRINUSE`) — a port chosen from outside cannot be reserved, so two starts at the
 * same instant would pick the same one. The port actually taken is read from the lock once the host
 * publishes it.
 */
export function startArgs(root: string): string[] {
  return [root, '--no-open']
}

/** The program that is run: the `bin/ultimate.ts` of the clone that serves this window. */
export function startProgram(ultimateRoot: string): string {
  return join(ultimateRoot, 'bin', 'ultimate.ts')
}

/**
 * One row per project. A home outside `~/.ultimate/projects` — a second instance of the same project
 * with its own `ULTIMATE_HOME` — is the same project: two tiles with the same `root`, and every action
 * addressing whichever home came first. The row kept is this window's; among the others, the first.
 * Order is preserved, with the kept row where the project first appeared: the list and the actions that
 * look a project up by name must agree on which home they mean.
 */
export function uniqueByRoot<T extends { root?: string; current: boolean }>(
  projects: readonly T[],
): T[] {
  const kept = new Map<string, T>()
  for (const project of projects) {
    if (!project.root) continue
    const seen = kept.get(project.root)
    if (!seen || (project.current && !seen.current)) kept.set(project.root, project)
  }
  const emitted = new Set<string>()
  const rows: T[] = []
  for (const project of projects) {
    if (!project.root) {
      rows.push(project)
      continue
    }
    if (emitted.has(project.root)) continue
    emitted.add(project.root)
    rows.push(kept.get(project.root)!)
  }
  return rows
}

/**
 * A project's host as the lock describes it: `pid` is the supervisor's, since the supervisor is the one
 * that writes the lock.
 */
export type Target = { pid: number; url?: string }

/** What the stop button decides to do. */
export type StopDecision =
  | { action: 'none' }
  | { action: 'confirm'; pid: number }
  | { action: 'stop'; pid: number }

/**
 * What the stop button does, from the **re-read** lock: a project without a live host has nothing to
 * stop; a host this extension started (the pid it recorded) stops straight away; anyone else's asks for
 * confirmation — killing someone else's process on a blind click is not what this button promises.
 */
export function stopDecision(
  target: Target | undefined,
  recorded: number | undefined,
  confirm: boolean,
): StopDecision {
  if (!target) return { action: 'none' }
  if (recorded === target.pid) return { action: 'stop', pid: target.pid }
  return confirm ? { action: 'stop', pid: target.pid } : { action: 'confirm', pid: target.pid }
}

/**
 * The presence dot of the tile, in the same scheme as the app's mark (`AgentMark`): working (brand,
 * pulsing), up and idle (green), stopped (grey). A host that is up and **did not answer** is not idle:
 * it stays without a pulse and the tile says `unavailable` — the silence of a stuck host is not calm.
 */
export type Presence = 'working' | 'stale' | 'idle' | 'stopped' | 'unavailable'

/**
 * Is this reading new enough to move? A pulse says "now", so a reading older than the wave's ceiling is
 * not: `presence` turns it into `stale` and the dot keeps the working colour without the animation. A
 * reading whose time does not parse is not fresh either — an unknowable age is not "now".
 */
export function fresh(at: string | undefined, now: number): boolean {
  if (!at) return false
  const time = Date.parse(at)
  return Number.isFinite(time) && now - time < WAVE_INTERVAL
}

/**
 * The dot of a tile, from the project and its last measurement: stopped has nothing to measure, and a
 * measurement that did not come (`null` on both, with a reason) is `unavailable`, never `idle`. A
 * measurement with zero is a measurement: `0 working` is idle for real. Working **and** measured within
 * the wave is `working` (pulsing); working and older than that is `stale` (brand, still): the pixel does
 * not claim what it cannot know, and the `title` says when the reading is from.
 */
export function presence(
  project: Project,
  measurement: Measurement | undefined,
  now = Date.now(),
): Presence {
  if (project.running === undefined) return 'stopped'
  // Up and with no reading yet (the wave did not come back, or the host has just come up): there is
  // nothing to assert.
  if (!measurement || !hasMeasurement(measurement.working, measurement.openQuestions)) return 'unavailable'
  if ((measured(measurement.working) ?? 0) === 0) return 'idle'
  return fresh(measurement.at, now) ? 'working' : 'stale'
}

/**
 * The number of the question counter, as it fits in the corner of the tile: `1`..`9`, `9+` from ten up,
 * and `undefined` at zero — a counter of zero is noise. What was not measured does not become a number
 * either.
 */
export function questionCount(openQuestions: number | null | undefined): string | undefined {
  const n = measured(openQuestions)
  if (!n) return undefined
  return n > 9 ? '9+' : String(n)
}

/**
 * The whole sentence of the tile, in the `title` and the `aria-label`: the state written out, the counts
 * of the reading **with the time they are from** (the indicator ages, but does not lie: it says when it
 * is from) and what the click does. `time` arrives already formatted — the calculation does not format
 * dates.
 */
export function tileTitle(
  project: Project,
  measurement: Measurement | undefined,
  time: string | undefined,
): string {
  const click = project.current
    ? 'this window'
    : project.running
      ? 'open it in this tab'
      : 'stopped, click to start it'
  // Stopped has no reading at all: the sentence is the usual one, and the grey dot already says the rest.
  if (project.running === undefined) return `${project.name} — ${click}`
  const counts = !measurement
    ? 'not measured yet'
    : hasMeasurement(measurement.working, measurement.openQuestions)
      ? `${workingCount(measurement.working)} · ${questionsTitle(measurement.openQuestions)}`
      : `counts unavailable${measurement.reason ? ` — ${measurement.reason}` : ''}`
  const when = measurement && time ? ` · measured at ${time}` : ''
  return `${project.name} — running · ${counts}${when} — ${click}`
}

/**
 * The whole reading of the column, the way each tile keeps it: one measurement per project **that is
 * up**, each with the time it was measured at. A stopped project gets no entry — there is nobody to ask.
 */
export function readingWave(section: Section): Record<string, Measurement> {
  const measurements: Record<string, Measurement> = {}
  for (const project of section.projects) {
    if (project.working === undefined && project.openQuestions === undefined) continue
    measurements[project.name] = {
      working: measured(project.working) ?? null,
      openQuestions: measured(project.openQuestions) ?? null,
      ...(project.reason ? { reason: project.reason } : {}),
      // Each row carries the time **its own** host answered: a wave with a host that took 3 s must not
      // make the other tiles claim a reading 3 s older than it is.
      at: project.measuredAt ?? section.at,
    }
  }
  return measurements
}

/**
 * **This machine's** settings file, `<user home>/.ultimate/settings.json` — the layer of whoever is using
 * it, which applies to every project. The `<project>/.ultimate/settings.json` is another file, and this
 * extension never touches it: a project can turn the splash off or on on top of it, and that is its
 * decision.
 */
export function userSettings(userHome: string): string {
  return join(userHome, '.ultimate', 'settings.json')
}

/**
 * Is the splash on in these settings? `splash` in `extensions.disable` turns it off; a missing file, a
 * `disable` that is not a list or broken JSON count as **on**, because that is what the core does with
 * them (a file that is not read whole does not turn any extension off). It is the user's layer that is
 * read here.
 */
export function splashEnabled(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return true
  const extensions = (settings as Record<string, unknown>).extensions
  if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) return true
  const disable = (extensions as Record<string, unknown>).disable
  return !(Array.isArray(disable) && disable.includes('splash'))
}

/**
 * The same settings with the splash on or off: `splash` leaves `extensions.disable` (turning on) or
 * enters **once** (turning off), and all the rest of the file stays as it is — the keys this extension
 * does not know included (`modelFamilies`, `lander`, whatever there is). `extensions.enable` is not
 * touched: `disable` wins over `enable` in the same layer, so turning it off works even with `splash`
 * there.
 *
 * Nothing the core would refuse whole gets past here: a value that is not an object, an `extensions`
 * that is not an object and a `disable` that is not a list of names throw, and whoever called writes
 * nothing. The object returned is **the same** one that came in when there is nothing to change —
 * whoever writes compares and does not write again.
 */
export function adjustSplash(settings: unknown, enabled: boolean): Record<string, unknown> {
  const object = asObject(settings, 'settings')
  const extensions =
    object.extensions === undefined ? undefined : asObject(object.extensions, 'extensions')
  const disable = extensions?.disable === undefined ? [] : asNames(extensions.disable)
  // It is already as asked: no key is rewritten for nothing.
  if (enabled === !disable.includes('splash')) return object
  const withoutSplash = disable.filter((name) => name !== 'splash')
  const next = enabled ? withoutSplash : [...withoutSplash, 'splash']
  return { ...object, extensions: { ...extensions, disable: next } }
}

/**
 * The sentence of the button at the bottom of the rail, which goes in the `title` and the `aria-label`:
 * the state now and what the click does with it. Before the first reading the state is not known, and
 * the button says so.
 */
export function splashLabel(enabled: boolean | undefined): string {
  if (enabled === undefined) return 'Splash on project switch: unknown'
  return `Splash on project switch: ${enabled ? 'on — turn it off' : 'off — turn it on'}`
}

/**
 * The homes this machine's settings hide from the rail: `projects.hidden` in
 * `<user home>/.ultimate/settings.json`. What is stored is the **home** (`~/.ultimate/projects/app-<8>`),
 * not the project's name: a name can repeat, and the home is what the `list` returns.
 *
 * A missing file, a `projects` that is not an object or a `hidden` that is not a list are read as
 * nothing hidden — the same tolerance `splashEnabled` has, since a file the core does not read whole
 * does not hide anyone either. What is not a string is not a home, and is ignored.
 */
export function hiddenHomes(settings: unknown): string[] {
  if (!isObject(settings)) return []
  const projects = settings.projects
  if (!isObject(projects)) return []
  const hidden = projects.hidden
  if (!Array.isArray(hidden)) return []
  return hidden.filter((home): home is string => typeof home === 'string')
}

/**
 * A home the way a person writes it in `projects.hidden`: the machine's own home may be abbreviated with
 * `~` — which is how the tile's panel shows it — and `~/x`, a trailing slash or `..` do not make another
 * home. Two writings of the same home are the same home, so a hand-edited list does not silently hide
 * nobody. What is not an absolute path stays as it is: it matches no home of the machine.
 */
export function homeKey(home: string, userHome: string): string {
  return absolutePath(home, userHome) ?? home
}

/**
 * Is that home in the list? A home written the other way — with `~`, with a trailing slash — is the
 * same home, and `forget` and `create` must agree with the `list` about which entries hide it.
 */
export function isHidden(home: string, hidden: readonly string[], userHome: string): boolean {
  const key = homeKey(home, userHome)
  return hidden.some((item) => homeKey(item, userHome) === key)
}

/**
 * The rows the rail draws: a home in that list is not among them — the rest stays as it came, in the
 * same order. The row itself is untouched: the window of a hidden project keeps working, it only stops
 * having a tile here. A row without a home cannot be told apart, and stays.
 */
export function withoutHidden<T extends object>(
  projects: readonly T[],
  hidden: readonly string[],
  userHome: string,
): T[] {
  if (!hidden.length) return [...projects]
  return projects.filter((project) => {
    const home = (project as { home?: unknown }).home
    return typeof home !== 'string' || !isHidden(home, hidden, userHome)
  })
}

/**
 * The same settings with one home hidden from the rail (`hidden: true`) or shown again: the home enters
 * `projects.hidden` **once**, or leaves it, and every other key of the file stays as it is — the keys
 * this extension does not know included. Which entries are the same home is decided by `homeKey`, so a
 * list written by hand with the `~` form the panel shows works as well. Showing the last hidden home
 * leaves an empty list rather than deleting the key: what this extension did not write is not erased.
 *
 * What this extension cannot rewrite whole is refused, as `adjustSplash` does: a value that is not an
 * object, a `projects` that is not an object, a `hidden` that is not a list of homes throw, and whoever
 * called writes nothing. The object returned is **the same** one that came in when there is nothing to
 * change — whoever writes compares and does not write again.
 */
export function adjustHidden(
  settings: unknown,
  home: string,
  hidden: boolean,
  userHome: string,
): Record<string, unknown> {
  const object = asObject(settings, 'settings')
  const projects = object.projects === undefined ? undefined : asObject(object.projects, 'projects')
  const homes = projects?.hidden === undefined ? [] : asHomes(projects.hidden)
  const key = homeKey(home, userHome)
  if (hidden === isHidden(home, homes, userHome)) return object
  const next = hidden
    ? [...homes, home]
    : homes.filter((item) => homeKey(item, userHome) !== key)
  return { ...object, projects: { ...projects, hidden: next } }
}

/** A JSON object — what can be rewritten preserving the keys; anything else is refused. */
function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${field} must be a JSON object`)
  return value
}

/** A JSON object of a settings file: what the keys of the file can be read from. */
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** A list of extension names: a list with something else inside it is not a list of names. */
function asNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((name) => typeof name !== 'string'))
    throw new Error('extensions.disable must be an array of names')
  return value as string[]
}

/** A list of homes: a list with something else inside it is not a list of homes. */
function asHomes(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((home) => typeof home !== 'string'))
    throw new Error('projects.hidden must be an array of homes')
  return value as string[]
}
