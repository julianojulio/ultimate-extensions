/**
 * The server of the "Projects" rail: it reads the machine, asks the other hosts what only they know,
 * and brings a host up, brings one down or creates one when someone clicks a tile, in the tile's panel
 * or on the `+`.
 *
 * The code lives in the machine extensions' repository, `~/src/ultimate-extensions/projects`; what
 * Ultimate loads is the symlink `~/.ultimate/extensions/projects`, made by its `install.sh`. Editing is
 * in the repository, and the hot reload follows the link.
 *
 * `list` shows this machine's projects (`host.projects()`: the central homes of
 * `~/.ultimate/projects`, with the URL of those that are up). The rail opens with
 * `list({ measure: false })` — no trip to another host, the cheap read that paints the tiles — and then
 * makes a wave of full `list()` reads for the presence dot and the question count: on opening, on
 * entering the rail with the pointer and when the window regains the focus (at most once every 15 s for
 * each of those), on the refresh button and after each action. The panel's `measure` asks **that** host
 * when the panel opens. Neither the `busy` nor another
 * project's questions are anywhere on disk — the
 * conversation list each host publishes keeps neither the task graph nor the question box —, so the
 * question goes by HTTP to that project's own host, on loopback, and it answers about itself
 * (`state`). Loopback with the target's `Origin` is the same path `lib/remote.ts` uses to talk to
 * another instance. `list()` with no argument keeps measuring everyone: it is what the phone's list
 * shows and what any other host that calls the action receives.
 *
 * The three actions that touch the machine (`start`, `stop`, `create`) follow four rules, and all of
 * them are mandatory:
 *
 * 1. **The guard is the live pid, never the file.** A dead pid's lock is a stopped project and the click
 *    brings it up; a live pid's lock is "already running on :N" and the click does nothing.
 * 2. **The host is born detached** (`spawn` with `detached`, no tty): a child of the host that started
 *    it would die on its restart.
 * 3. **The port belongs to the host that took it.** The extension does not choose it and does not pass
 *    `--port`: `bin/ultimate.ts` picks it (from 4747), retries the next one when it is taken and
 *    publishes the one it got in the lock. Success is declared only when the lock names the pid this
 *    extension spawned, that pid is alive and the port answered — a port that answers without our lock
 *    is somebody else's host, and is reported as a failure with the reason in the tile's panel. What
 *    does not come up in the deadline is terminated.
 * 4. **Stopping kills only the pid of that project's lock** and checks that the lock is gone: no
 *    `pkill`, no killing by port. A host this extension did not bring up asks for confirmation in the
 *    tile's panel.
 *
 * The true state is always the re-read lock, never a list in memory: the extension may reload between
 * one action and the other. There is no poll — the screen reads on opening and again on the refresh
 * button. `stop`, `create` and `splash` are **user actions**: an agent calling the extension cannot
 * stop a host, create one or flip this machine's splash behind the screen (`list`, `measure`, `state`
 * and `start` remain callable).
 *
 * Outside the homes of the projects it brought up, this extension writes **one** file only: this
 * machine's `~/.ultimate/settings.json`, when the button at the bottom of the rail turns the splash
 * animation on or off (the `splash` action). There too nothing comes from memory: the action reads the
 * file, touches only the `splash` entry of `extensions.disable` and refuses, without writing, what the
 * core would refuse whole — invalid JSON, an `extensions` that is not an object (see README).
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import type { JsonValue } from '@earendil-works/chord'
import { defineExtension } from '@earendil-works/pi-durable'
import {
  adjustSplash,
  startArgs,
  absolutePath,
  command,
  stopDecision,
  hostOrigin,
  lockPort,
  projectHome,
  startProgram,
  uniqueByRoot,
  userSettings,
  splashEnabled,
} from './projects.ts'
import type {
  State,
  Measurement,
  Project,
  CreateResult,
  StopResult,
  Section,
  Splash,
} from './types.ts'

export default defineExtension({ name: 'projects' })

/** How long another project's host is given to answer before it is said not to have answered. */
const WAIT = 3000

/** The deadline of the whole bring-up: the lock, then the answer on that port. */
const START_WAIT = 20000

/** How long the SIGTERM is given before escalating to SIGKILL. */
const STOP_WAIT = 8000

/** What was written in the project's home when it was this extension that brought that pid up. */
const RECORD = 'projects-started.json'

/** The output of the host that was brought up, so that the row can say why it did not come up. */
const LOG = 'projects-start.log'

interface HostProject {
  name: string
  root?: string
  home: string
  current: boolean
  running?: { pid: number; url: string }
}

/** The `messages` service (core, always on), from which only what waits for the user is asked. */
interface MessagesService {
  openQuestions(ctx: unknown): Promise<{ message: number; conversation: number; at: number; text: string }[]>
}
const Messages = { name: 'messages' } as const

interface Context {
  signal: AbortSignal
  host: {
    ultimateRoot: string
    projects(): Promise<HostProject[]>
    /** This host's conversations, with the `busy` of the live task graph. */
    conversations(): readonly { busy: boolean }[]
    need<S>(api: { name: string }): S
    /** A value shared with the next load of this extension (the semaphore model, the write queue). */
    resource<T>(key: string, create: () => T): T
  }
}

/** The measurements of a host that is up: `null` is what it did not answer. */
interface Measurements {
  working: number | null
  openQuestions: number | null
  reason?: string
  /** When this row was measured: each host answers in its own time. */
  at?: string
}

/** How many conversations of this host are working now. */
const workingNow = (ctx: Context) => ctx.host.conversations().filter((item) => item.busy).length

/**
 * How many questions wait for an answer in this host. The `messages` service is the one that knows (it is
 * the same count as the questions panel); when it does not answer, the count does not become zero — it
 * becomes `null`.
 */
async function countOpenQuestions(ctx: Context): Promise<number | null> {
  try {
    const service = ctx.host.need<MessagesService>(Messages)
    return (await service.openQuestions(context)).length
  } catch {
    return null
  }
}

/** The reason in one short line, the way it fits in the `title` of a row of the rail. */
function reason(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return `no answer in ${WAIT / 1000}s`
    return error.message
  }
  return String(error)
}

/**
 * Asks another host of this machine how many of its conversations are working and how many questions wait
 * for an answer. `origin` is an address that already passed `hostOrigin`: this extension refuses to make
 * a request to anything a lock could talk it into. The target's `Origin` is what its `admit` accepts on
 * loopback; a host that does not answer (or does not have this extension) returns an error, and whoever
 * called shows `unavailable`.
 */
async function ask(
  origin: string,
  signal: AbortSignal,
): Promise<{ working: number | null; openQuestions: number | null }> {
  const response = await fetch(`${origin}/api/extensions/projects/actions/state`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.any([AbortSignal.timeout(WAIT), signal]),
  })
  const body = (await response.json().catch(() => ({}))) as {
    result?: { working?: unknown; openQuestions?: unknown }
    error?: unknown
  }
  if (!response.ok)
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`)
  const working = asCount(body.result?.working)
  const openQuestions = asCount(body.result?.openQuestions)
  // An answer with neither of the two numbers is no measurement at all: it is as if it had not answered.
  if (working === null && openQuestions === null) throw new Error('the answer carried no count')
  return { working, openQuestions }
}

/** A measurement number, or `null` for a crooked value; the same criterion as `projects.ts`. */
function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * A row of the section from what was measured: it never invents a number that did not come, and it never
 * hands the screen an address that did not pass `hostOrigin` — not to fetch, not to link.
 */
function toRow(project: HostProject, measurements?: Measurements): Project {
  const cmd = command(project.root)
  const origin = project.running ? hostOrigin(project.running.url) : undefined
  const reason = measurements?.reason ?? (project.running && !origin ? REFUSED_LOCK : undefined)
  return {
    name: project.name,
    root: project.root ?? '',
    home: project.home,
    current: project.current,
    ...(project.running && origin ? { running: { pid: project.running.pid, url: origin } } : {}),
    ...(cmd ? { command: cmd } : {}),
    ...(reason ? { reason } : {}),
    ...(measurements
      ? {
          working: measurements.working,
          openQuestions: measurements.openQuestions,
          ...(measurements.at ? { measuredAt: measurements.at } : {}),
        }
      : {}),
  }
}

/** The name the action received, or an error: project names, never paths. */
function nameArgument(args: JsonValue): string {
  const value =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as { name?: unknown }).name
      : undefined
  if (typeof value !== 'string' || !value.trim()) throw new Error('name must be a project name')
  return value.trim()
}

/** The project by name, read from disk now (`host.projects()` reads the lock on every call). The list is
 * the one the rail shows — one row per project — so a name addresses the same home the tile does. */
async function findProject(ctx: Context, name: string): Promise<HostProject> {
  const project = uniqueByRoot(await ctx.host.projects()).find((item) => item.name === name)
  if (!project) throw new Error(`Unknown project ${JSON.stringify(name)}`)
  return project
}

/** What a lock that names no address of this machine is reported as. */
const REFUSED_LOCK = 'the lock names no port of this machine'

/** Is the pid alive? A process of another owner (EPERM) counts as alive. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** A home's lock, re-read now: a `pid` with no live process is still a lock, but it is not a host. The
 * port is the only part of the lock that ends up in a URL, so it is validated here: `4748@evil.com`
 * inside the template would be another host's address. */
async function readLock(home: string): Promise<{ pid: number; port?: number } | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(home, 'ultimate.lock'), 'utf8')) as {
      pid?: unknown
      port?: unknown
    }
    if (typeof parsed.pid !== 'number' || !Number.isSafeInteger(parsed.pid) || parsed.pid < 1)
      return undefined
    const port = lockPort(parsed.port)
    return { pid: parsed.pid, ...(port === undefined ? {} : { port }) }
  } catch {
    return undefined
  }
}

/** The pid this extension brought up for that home, if it was this extension and it is still the
 * record's. */
async function remembered(home: string): Promise<number | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(home, RECORD), 'utf8')) as { pid?: unknown }
    return typeof parsed.pid === 'number' && Number.isSafeInteger(parsed.pid) ? parsed.pid : undefined
  } catch {
    return undefined
  }
}

async function remember(home: string, pid: number, port: number) {
  await writeFile(
    join(home, RECORD),
    JSON.stringify({ pid, port, at: new Date().toISOString() }) + '\n',
  )
}

/** Forgets the record, only when it still names `pid`: another one's pid is not erased by mistake. */
async function forget(home: string, pid: number | undefined) {
  if ((await remembered(home)) === pid) await rm(join(home, RECORD), { force: true })
}

/** The environment of the user's home, as the harness resolves it: `ULTIMATE_USER_HOME` when there is
 * one (an isolated preview, a test home), otherwise the system's. The projects and the settings come from
 * it. */
function userHome(): string {
  return process.env.ULTIMATE_USER_HOME ?? homedir()
}

/**
 * This machine's settings, read on the spot: the object, or the reason it does not serve for a write. A
 * missing file is an empty object — turning the splash off creates the file, turning it on has nothing to
 * create.
 */
async function readSettings(): Promise<{ settings?: Record<string, unknown>; error?: string }> {
  const path = userSettings(userHome())
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    return { error: `Cannot change the splash: ${path}: ${reason(error)}` }
  }
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('settings must be a JSON object')
    return { settings: value as Record<string, unknown> }
  } catch (error) {
    return { error: `Cannot change the splash: ${path}: ${reason(error)}. Nothing was written` }
  }
}

/**
 * Writes the settings through a temporary beside it and a `rename`: a half JSON does not exist for whoever
 * reads the file in the middle of the way. If the file is a link (settings in dotfiles), it is the target
 * that is rewritten — the link stays. The **mode** of the file survives too: `rename` replaces the inode,
 * so without this a `0600` settings would come back with `0666 & ~umask`. The JSON is written normalised,
 * in two spaces: the formatting from before is lost.
 */
async function writeSettings(path: string, settings: Record<string, unknown>) {
  const target = await realpath(path).catch(() => path)
  await mkdir(dirname(target), { recursive: true })
  // A file that does not exist yet is born private, as the core creates it.
  const mode = await stat(target).then(
    (info) => info.mode & 0o777,
    () => 0o600,
  )
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx', mode })
    // The umask narrows what `writeFile` is asked for; the file keeps exactly the mode it had.
    await chmod(temporary, mode)
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

/**
 * The writes to the settings file, one at a time and in order: this extension writes `splash`, the model
 * settings write other keys, and two read-modify-write passes in the middle of each other lose one of
 * them in silence. The queue is a `host.resource`, so a hot reload keeps the same one.
 */
async function serialised<T>(ctx: Context, path: string, work: () => Promise<T>): Promise<T> {
  const queue = ctx.host.resource('projects.settings-writes', () => new Map<string, Promise<unknown>>())
  const previous = queue.get(path) ?? Promise.resolve()
  const done = previous.then(work, work)
  queue.set(path, done)
  try {
    return await done
  } finally {
    // Nobody queued behind this one: the map does not grow with every write.
    if (queue.get(path) === done) queue.delete(path)
  }
}

/**
 * The splash as **this machine's** settings leave it now, read on every call: nothing in memory,
 * because the extension reloads between one and the other. A file that cannot be read counts as on —
 * which is what the core does with it too.
 */
async function splashNow(): Promise<boolean> {
  return splashEnabled((await readSettings()).settings)
}

/**
 * The environment of the host that is brought up: the identity of this host is not worth anything to
 * another project.
 */
function environment(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ULTIMATE_HOME: home,
    // The child reads this host's same `~/.ultimate` — in an isolated preview, the private copy, not the
    // system's.
    ULTIMATE_USER_HOME: userHome(),
    ULTIMATE_NO_OPEN: '1',
  }
  for (const name of [
    'ULTIMATE_PORT',
    'ULTIMATE_PROJECT',
    'ULTIMATE_SUPERVISED',
    'ULTIMATE_GENERATION',
    'ULTIMATE_PREVIOUS_BUILD',
    'ULTIMATE_PUBLIC_URL',
  ])
    delete env[name]
  return env
}

/**
 * Brings the detached process up, with the output in the project's log; `detached` is the `setsid` that
 * lets it go.
 */
function launch(
  program: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; log: string },
): ChildProcess {
  const output = openSync(options.log, 'w')
  try {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', output, output],
    })
    child.unref()
    return child
  } finally {
    closeSync(output)
  }
}

/**
 * Does the port answer? One try, with the short deadline: the health of a host that has just been brought
 * up is the HTTP answer, not the bind. Until the core opens, the supervisor holds the connection without
 * answering, so the deadline decides that one try.
 */
async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/`, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    return false
  }
}

/** The log line of the host that was brought up that says why it did not come up, for the tile's panel. */
async function logTail(log: string): Promise<string> {
  const text = await readFile(log, 'utf8').catch(() => '')
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  // The **first** line the process names as an error is the one that says why; the stack below it is
  // noise, and the last lines are usually the crash handler's.
  const error = lines.find((line) => /^(?:Error|\[error\])/.test(line))
  return (error ?? lines.slice(-2).join(' · ')).slice(0, 240)
}

/** Terminates a process this extension has just brought up: TERM and, past the deadline, KILL. */
async function terminate(pid: number) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  const deadline = Date.now() + STOP_WAIT
  while (alive(pid) && Date.now() < deadline) await sleep(100)
  if (!alive(pid)) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // It exited between the test and the signal.
  }
}

/**
 * Did the host stop and the lock vanish? It waits until that becomes true, and returns whether it did: a
 * lock of a pid other than ours counts as stopped (another host took the project).
 */
async function waitForGone(home: string, pid: number, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout
  for (;;) {
    const parsed = await readLock(home)
    if (!alive(pid) && parsed?.pid !== pid) return true
    if (Date.now() > deadline) return false
    await sleep(100)
  }
}

/**
 * Stops the host of pid `pid` and checks that that project's lock is gone. It kills **only** that pid: no
 * group, no `pkill`, no killing by port.
 */
async function shutDown(home: string, pid: number) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
      throw new Error(`Cannot stop pid ${pid}: ${reason(error)}`)
    // The pid vanished before the signal: there is nothing to stop. If its lock stayed, the row says so.
    if ((await readLock(home))?.pid === pid)
      throw new Error(`pid ${pid} was already gone, and its lock file was left behind`)
    return
  }
  if (await waitForGone(home, pid, STOP_WAIT)) return
  // It did not go down by itself: SIGKILL on the same pid. A host killed that way does not close the lock —
  // and the row says so.
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // It exited between the test and the signal.
  }
  const deadline = Date.now() + 3000
  while (alive(pid) && Date.now() < deadline) await sleep(100)
  if (alive(pid)) throw new Error(`pid ${pid} did not exit, even with SIGKILL`)
  if ((await readLock(home))?.pid === pid)
    throw new Error(`pid ${pid} only stopped with SIGKILL: its lock file was left behind`)
}

/** The port a project's lock publishes, when it is a port of this machine: the one address this extension
 * will ask: `http://127.0.0.1:<port>`. */
function publishedPort(project: HostProject): number | undefined {
  const origin = project.running ? hostOrigin(project.running.url) : undefined
  return origin === undefined ? undefined : Number(new URL(origin).port)
}

/** Is that port another project's host? A port another project's lock publishes is not ours to claim. */
async function claimedElsewhere(
  ctx: Context,
  home: string,
  port: number,
): Promise<boolean> {
  return (await ctx.host.projects()).some(
    (project) => project.home !== home && publishedPort(project) === port,
  )
}

/**
 * Did the action ask for a measurement? The rail calls `list({ measure: false })`: no number appears on a
 * tile.
 */
function wantsMeasurement(args: JsonValue): boolean {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return true
  return (args as { measure?: unknown }).measure !== false
}

/** Did the splash button ask for on or off: a boolean, never what one guesses from an `undefined`. */
function enabledArgument(args: JsonValue): boolean {
  const value =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as { enabled?: unknown }).enabled
      : undefined
  if (typeof value !== 'boolean') throw new Error('enabled must be true or false')
  return value
}

/** The path the `+` dialog sent, as text: empty is not a path, and the dialog asks for one. */
function pathArgument(args: JsonValue): string {
  const value =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as { path?: unknown }).path
      : undefined
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Enter a folder path, such as ~/src/my-project')
  return value
}

/**
 * Deletes the home a first start created and that never became a project. The directory exists only because
 * the child process made it (`bin/ultimate.ts` creates `ULTIMATE_HOME` before opening the core); if it died
 * before writing the `project.json`, that home is rubbish — and `list` reads every directory under
 * `~/.ultimate/projects`, so it would appear for ever as a tile without a path. A `project.json`
 * written, or a live host holding the lock, mean that the project is real and nothing is touched.
 */
async function discardHome(home: string) {
  const written = await readFile(join(home, 'project.json'), 'utf8').then(
    () => true,
    () => false,
  )
  if (written) return
  const owner = await readLock(home)
  if (owner && alive(owner.pid)) return
  await rm(home, { recursive: true, force: true })
}

/**
 * Brings a project's host up and only returns when the port answers; what does not come up in the
 * deadline is terminated and the error leaves with the tail of the log. A project that has no home yet
 * (`newFolder`) writes the log in a temporary directory and only gains the pid's record after answering —
 * the home is the host's, not this extension's.
 */
/**
 * Brings a project's host up and only returns when **our** host answers on the port its own lock publishes.
 *
 * The port is not chosen here (see `startArgs`): the program takes it and writes it in the lock, which is
 * the only statement of "this address is mine". So the loop waits for the lock to name the pid just
 * spawned **twice in a row** — the supervisor first writes the port it asked for and then the one it got
 * after listening, and only the second one answers for this project — and only then asks the port. The
 * success condition is `owner.pid === pid && alive(pid)` plus "no other project of this machine publishes
 * that port": a port that answers without our lock is somebody else's host, it is reported as a failure,
 * and the process this extension started is terminated.
 *
 * A project that has no home yet (`newFolder`) writes the log in a temporary directory; the home is the
 * host's, not this extension's, and a start that never became a project does not leave one behind.
 */
async function bringUp(
  ctx: Context,
  project: HostProject,
  options: { log: string; newFolder?: boolean },
): Promise<Project> {
  const root = project.root
  if (!root) throw new Error(`No path for ${project.name}`)
  const child = launch(
    process.execPath,
    [startProgram(ctx.host.ultimateRoot), ...startArgs(root)],
    { cwd: root, env: environment(project.home), log: options.log },
  )
  const pid = child.pid
  let output: string | undefined
  child.once('error', (error) => {
    output = `could not run ${process.execPath}: ${error.message}`
  })
  child.once('exit', (code, signal) => {
    output ??= `the process exited (${signal ?? `code ${code}`})`
  })
  // Without a pid the process was not even born, and the project's path is what usually is missing.
  if (pid === undefined) throw new Error(`Could not start ${project.name} in ${root}`)
  const deadline = Date.now() + START_WAIT
  /** Nothing that did not become a host keeps what it wrote: the process, the record, and the home of a
   * folder that never became a project. */
  const fail = async (cause: string): Promise<never> => {
    await terminate(pid)
    await forget(project.home, pid)
    if (options.newFolder) await discardHome(project.home)
    const tail = await logTail(options.log)
    throw new Error(`${project.name} did not come up — ${cause}${tail ? `: ${tail}` : ''}`)
  }
  /** The port the lock published on the previous pass: the same one twice is the one this host took. */
  let seen: number | undefined
  for (;;) {
    const owner = await readLock(project.home)
    // Another live host owns this home: the program refuses to start a second one, and ours exits.
    if (owner && owner.pid !== pid && alive(owner.pid))
      return await fail(`the home is already served by pid ${owner.pid}`)
    if (owner?.pid === pid && owner.port !== undefined) {
      const port = owner.port
      if (port === seen) {
        const url = `http://127.0.0.1:${port}`
        if (await answers(url)) {
          // The port answered: is it ours? The lock names it, the pid is alive, and no other project of
          // this machine publishes that port.
          const settled = await readLock(project.home)
          if (
            settled?.pid === pid &&
            settled.port === port &&
            alive(pid) &&
            !(await claimedElsewhere(ctx, project.home, port))
          ) {
            await remember(project.home, pid, port)
            return toRow({ ...project, running: { pid, url } })
          }
        }
      } else seen = port
    } else seen = undefined
    if (output !== undefined) return await fail(output)
    if (Date.now() > deadline)
      return await fail(
        `no lock and no answer in ${START_WAIT / 1000}s (a first boot on a cold disk can take longer: try again)`,
      )
    await sleep(150)
  }
}

export const actions = {
  /**
   * This machine's projects, with the state and the command. With no argument, it measures each host that
   * is up (it is what the phone's list shows); `{ measure: false }` is the rail's cheap read, which shows no
   * number.
   */
  async list(args: JsonValue, ctx: Context): Promise<Section> {
    // A home without a `project.json` (a start that died before registering) is no project of anyone's:
    // it has no path, it is neither brought up nor measured — showing its tile would lie about the machine.
    // Two homes of the same project are one project: the tile is one, and the actions address the home the
    // row says.
    const projects = uniqueByRoot((await ctx.host.projects()).filter((project) => project.root))
    // The button at the bottom of the rail says the state read now, not the one from an earlier opening.
    const splash = await splashNow()
    const at = new Date().toISOString()
    if (!wantsMeasurement(args))
      return { projects: projects.map((project) => toRow(project)), at, splash }
    const here: Measurements = {
      working: workingNow(ctx),
      openQuestions: await countOpenQuestions(ctx),
      at: new Date().toISOString(),
    }
    const lines = await Promise.all(
      projects.map(async (project): Promise<Project> => {
        // This window's project: the measurements are this host's, with no trip at all.
        if (project.current) return toRow(project, here)
        // Stopped: there is no one to ask, and the screen shows the command in place of the measurement.
        if (!project.running) return toRow(project)
        const origin = hostOrigin(project.running.url)
        if (!origin) return toRow(project)
        try {
          return toRow(project, {
            ...(await ask(origin, ctx.signal)),
            at: new Date().toISOString(),
          })
        } catch (error) {
          return toRow(project, {
            working: null,
            openQuestions: null,
            reason: reason(error),
            at: new Date().toISOString(),
          })
        }
      }),
    )
    return { projects: lines, at, splash }
  },

  /**
   * Turns the splash animation on or off in **this machine's** settings
   * (`<user home>/.ultimate/settings.json`): `splash` enters `extensions.disable` (turning off) or leaves
   * it (turning on), and every other key of the file stays as it is. It is the only place where this
   * extension writes outside the home of a project it brought up itself, and a project's settings is never
   * touched — a project can say the opposite on top, and that is its decision.
   *
   * What could not be preserved is refused **without writing**: invalid JSON, a file that is not an object,
   * an `extensions` that is not an object, a `disable` that is not a list of names — the core would reject
   * the whole file, and the user would lose the other keys. The write is through a temporary and a
   * `rename`, keeps the file's mode, and is serialised with the other writers of that path: two
   * read-modify-write passes in the middle of each other would lose one of the two keys in silence.
   */
  async splash(args: JsonValue, ctx: Context): Promise<Splash> {
    const enabled = enabledArgument(args)
    const path = userSettings(userHome())
    await serialised(ctx, path, async () => {
      const parsed = await readSettings()
      if (parsed.error) throw new Error(parsed.error)
      // With no file, the starting point is an empty object: turning it off creates the file, turning it on
      // creates nothing.
      const before = parsed.settings ?? {}
      let after: Record<string, unknown>
      try {
        after = adjustSplash(before, enabled)
      } catch (error) {
        throw new Error(`Cannot change the splash: ${path}: ${reason(error)}. Nothing was written`)
      }
      // `adjustSplash` returns the same object when nothing changes: nothing is rewritten for nothing.
      if (after !== before) await writeSettings(path, after)
    })
    return { splash: enabled }
  },

  /**
   * What was measured in a project now: the conversations working and the questions without an answer,
   * with the time — the tile's panel asks for this when it opens, and only it shows those numbers. A host
   * that does not answer returns `null` on both and the reason, never zero.
   */
  async measure(args: JsonValue, ctx: Context): Promise<Measurement> {
    const project = await findProject(ctx, nameArgument(args))
    // This window's project: the measurements are this host's, with no trip at all.
    if (project.current)
      return {
        working: workingNow(ctx),
        openQuestions: await countOpenQuestions(ctx),
        at: new Date().toISOString(),
      }
    if (!project.running)
      return {
        working: null,
        openQuestions: null,
        reason: 'the host is stopped',
        at: new Date().toISOString(),
      }
    const origin = hostOrigin(project.running.url)
    if (!origin)
      return {
        working: null,
        openQuestions: null,
        reason: REFUSED_LOCK,
        at: new Date().toISOString(),
      }
    try {
      // The time is the one the answer came at: a host that took 3 s must not be reported as measured 3 s
      // ago.
      return { ...(await ask(origin, ctx.signal)), at: new Date().toISOString() }
    } catch (error) {
      return {
        working: null,
        openQuestions: null,
        reason: reason(error),
        at: new Date().toISOString(),
      }
    }
  },

  /**
   * This host only: how many of its conversations are working now and how many questions wait for an
   * answer. It is what another host of the machine asks to measure a tile; it never leaves here to ask
   * anyone else.
   */
  async state(_args: JsonValue, ctx: Context): Promise<State> {
    return {
      working: workingNow(ctx),
      openQuestions: await countOpenQuestions(ctx),
      at: new Date().toISOString(),
    }
  },

  /**
   * Brings a stopped project's host up, on the port the host itself takes (see `bringUp`); a host that
   * already runs is not touched — the row comes back as it is, and the tile's panel says on which port it
   * is.
   */
  async start(args: JsonValue, ctx: Context): Promise<Project> {
    const name = nameArgument(args)
    const project = await findProject(ctx, name)
    // The guard is the live pid: a dead pid's lock is a stopped project, and it is the `undefined` here.
    if (project.running) return toRow(project)
    if (project.current) throw new Error(`${name} runs this window`)
    return bringUp(ctx, project, { log: join(project.home, LOG) })
  },

  /**
   * Creates a project from a folder: it expands `~`, demands a real directory, and brings its host up as
   * `start` does. A folder that is already a project of the list is selected — and, if it is stopped,
   * brought up — instead of a second host for the same root. That project's first run, the onboarding and
   * its trust decision happen in its window: this extension decides nothing for it. The new project's home
   * is born with the host, not here.
   */
  async create(args: JsonValue, ctx: Context): Promise<CreateResult> {
    // `~` is the home of whoever is using this Ultimate — in an isolated instance its private copy, not
    // the system's.
    const absolute = absolutePath(pathArgument(args), userHome())
    if (!absolute) throw new Error('Enter a full path, such as ~/src/my-project')
    const root = await realpath(absolute).catch(() => undefined)
    if (!root) throw new Error(`No such folder: ${absolute}`)
    const info = await stat(root).catch(() => undefined)
    if (!info?.isDirectory()) throw new Error(`Not a folder: ${root}`)
    const projects = uniqueByRoot(await ctx.host.projects())
    const existing = projects.find((project) => project.root === root)
    if (existing) {
      const origin = existing.running ? hostOrigin(existing.running.url) : undefined
      if ((existing.running && origin) || existing.current)
        return { created: false, project: toRow(existing) }
      return {
        created: false,
        project: await bringUp(ctx, existing, { log: join(existing.home, LOG) }),
      }
    }
    // Two folders with the same project name cannot be told apart here: the actions speak by name, and a
    // second `app` would make the first's tile answer for the second (and stop it in its place).
    const namesake = projects.find((project) => project.name === basename(root))
    if (namesake)
      throw new Error(
        `A project called ${basename(root)} already exists (${namesake.root ?? namesake.home}); two projects with the same folder name cannot be told apart here`,
      )
    // New folder: the home is born with the host, so the log stays in a temporary directory until it
    // answers.
    const temp = await mkdtemp(join(tmpdir(), 'ultimate-projects-'))
    try {
      const project: HostProject = {
        name: basename(root),
        root,
        home: projectHome(root, userHome()),
        current: false,
      }
      return {
        created: true,
        project: await bringUp(ctx, project, { log: join(temp, LOG), newFolder: true }),
      }
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  },

  /**
   * Brings a project's host down: only the pid of that project's lock, checking that the lock is gone. A
   * host this extension did not bring up asks for confirmation — the action returns `needsConfirm`
   * and nothing is touched until the same action arrives with `confirm: true`.
   */
  async stop(args: JsonValue, ctx: Context): Promise<StopResult> {
    const name = nameArgument(args)
    const confirm =
      args && typeof args === 'object' && !Array.isArray(args)
        ? (args as { confirm?: unknown }).confirm === true
        : false
    const project = await findProject(ctx, name)
    if (project.current) throw new Error(`${name} runs this window: stop it from another window`)
    const decision = stopDecision(project.running, await remembered(project.home), confirm)
    if (decision.action === 'confirm') {
      const url = project.running ? hostOrigin(project.running.url) : undefined
      return { stopped: false, needsConfirm: true, pid: decision.pid, ...(url ? { url } : {}) }
    }
    if (decision.action === 'stop') {
      await shutDown(project.home, decision.pid)
      await forget(project.home, decision.pid)
    }
    return { stopped: true, project: toRow(await findProject(ctx, name)) }
  },
}

/**
 * The actions only a click may take: stopping a host, creating one, and turning this machine's splash
 * animation on or off. An agent calling the extension cannot do them behind the screen — which is also
 * what makes the confirmation of `stop` mean something, since `confirm: true` from an agent is not a
 * person saying yes. `list`, `measure`, `state` and `start` stay open: the rail, the phone and another
 * project's window read them, and a host that is down is brought up by whoever needs it.
 */
export const userActions = ['stop', 'create', 'splash']
