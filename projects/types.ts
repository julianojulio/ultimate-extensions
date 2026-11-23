/**
 * What the actions return and what the rail draws: nothing here is stored state — the reading is made
 * on the spot and the screen only shows what came.
 */

/**
 * A project's repository on GitHub, as the tile's panel names it: `owner/repo` and how private it is. Read in
 * the background (`git`, then one `gh repo view`), once per process and root, and absent until that read came —
 * which draws no chip at all. There is no token here, and nothing of a credential.
 */
export interface Repo {
  /** `owner/repo`, as GitHub spells it. */
  name: string
  /** What `gh` answered about it: the chip draws a lock for a private repo, and for an internal one. */
  visibility: 'public' | 'private' | 'internal'
}

/** A project of the machine, as the rail shows it. */
export interface Project {
  name: string
  /** The full path, which goes in the tile's panel. */
  root: string
  /**
   * The home this row — and every action that speaks its name — addresses. Two homes can be the same
   * project (an instance with its own `ULTIMATE_HOME`): the rail keeps one tile per project, and the
   * panel says which home it is.
   */
  home?: string
  /** The project of this window. */
  current: boolean
  /**
   * When this machine stamped the project as shown — the last time its rail was opened by a page load
   * (`shown`), in epoch ms. What orders the rail; `undefined` when this machine never stamped it.
   */
  shownAt?: number
  /**
   * When the project's host last started, from its `project.json` — the order of a project this machine has
   * no stamp for, so a project opened today is above the old ones even before any stamp exists.
   */
  openedAt?: number
  /**
   * Running: the pid and the URL the host publishes in its lock. The URL is the click target of the
   * tile.
   */
  running?: { pid: number; url: string }
  /**
   * Conversations working now. `undefined` when the measurement was not asked for (the rail's
   * `list`) or the host is stopped, and `null` when it is up and did not answer — the cases say
   * different things.
   */
  working?: number | null
  /** Questions of the panel without an answer in that host, with the same rule as `working`. */
  openQuestions?: number | null
  /**
   * When **this** row's counts were read: each host answers in its own time, so a slow one does not
   * make the others claim an older reading. The wave falls back to the section's time when it is
   * absent.
   */
  measuredAt?: string
  /** Why it did not answer, or why its lock names no address of this machine: it goes in the panel, not on
   * the tile. */
  reason?: string
  /**
   * The clone moved past this host's process (`server/`, `shared/` or the packages changed after it
   * started): a restart loads it. `undefined` when nobody asked — the cheap read of the rail never does.
   */
  restart?: boolean
  /**
   * The repo of this project's `origin`, once it is known: the panel's chip. Absent off GitHub, when `gh`
   * could not say how private it is, and until the first background read finished — and then the panel shows
   * no chip rather than a guessed one.
   */
  repo?: Repo
  /**
   * `ultimate <path>`, the command that brings the project up by hand. Shown and copied, never
   * executed.
   */
  command?: string
}

/**
 * The whole list and when it was read. The time is not on a button: a reading's worth is said by the tile
 * it belongs to (`measured at` in the tile's sentence, from that reading's own time), and the older this
 * one is, the older those sentences are.
 */
export interface Section {
  projects: Project[]
  at: string
  /**
   * The splash animation as **this machine's** settings leave it: it is what the button at the bottom
   * of the rail says and the opposite of what its click asks for. Read on the spot, on every reading —
   * never stored.
   */
  splash: boolean
  /**
   * What the shared clone needs, from the `update` extension's last check — the same clone for every host
   * of this machine. Absent when that extension is not enabled, or refused to be read.
   */
  clone?: Clone
  /**
   * The last nightly update this machine attempted (`projects.update.at`), as the rail shows it: one line.
   * Absent when nothing ran, when the night had nothing to say, or when the reader dismissed it.
   */
  nightly?: NightlyView
}

/** The clone as the update button needs it: how far behind origin, whether a pull owes an install, and what
 * the clone refuses. */
export interface Clone {
  /** Commits on `origin/<branch>` the clone lacks, as of the last fetch. */
  behind: number
  /** Commits of the clone's own that origin lacks, from the same reading: what a diverged pull waits for. */
  ahead?: number
  /** The lockfile names packages that are not installed: the next pull installs them. */
  install: boolean
  /**
   * Why that check refused the pull — uncommitted changes, another branch, a diverged branch, the lander
   * landing. Only a diverged clone goes on to the restart (`afterRefusal`), and it is the one the button
   * says it will not update.
   */
  refused?: string
  /** The comparison of the range, as `update` offers it (DiffsHub). Shown only when it is an https address. */
  compare?: string
}

/**
 * The clone's own commits that origin lacks, read when a pull was refused for divergence: the branch, how
 * many commits of yours are not on `origin/<branch>` (`update`'s `ahead`), and the comparison it offered for
 * the range. The rule is not touched by it: a diverged clone only lets the restarts go on (`afterRefusal`).
 */
export interface Diverged {
  /** The branch the clone is on, from `update`'s refusal (`main`). */
  branch: string
  /** Commits of the clone that `origin/<branch>` does not have. Absent when the reading did not say. */
  ahead?: number
  /** The comparison `update` offers for the range, when it is an https address. */
  compare?: string
}

/** What the `splash` action left: the animation on or off in this machine's settings. */
export interface Splash {
  splash: boolean
}

/**
 * What the `shown` action left: the epoch ms it stamped this project with. It is written in this machine's
 * `~/.ultimate/projects-shown.json`, which is what orders the rail.
 */
export interface Shown {
  shownAt: number
}

/**
 * What was measured in a project when its panel opened: the conversations working, the questions
 * without an answer, the time of the measurement, and the reason when the host did not answer — never
 * a zero in place of the silence.
 */
export interface Measurement {
  working: number | null
  openQuestions: number | null
  reason?: string
  at: string
}

/**
 * What a host answers about itself, when another host of the machine asks — and what this window's host
 * knows without asking anyone. The counts are what the rail measures; the rest is what the update button
 * needs to know about this host alone, which is why the wave carries it instead of a second request.
 */
export interface State {
  working: number
  /** Questions without an answer in this host; `null` when not even that was measured. */
  openQuestions: number | null
  at: string
  /** The build this process runs, by id: half of the stamp that keeps a restart from looping. Absent when the
   * host could not read its own build. */
  build?: string
  /**
   * Which process of this host answers (`ULTIMATE_GENERATION`): the proof that a restart took, since the
   * port keeps answering throughout the supervisor's swap with the old generation.
   */
  generation?: number
  /** The clone moved past this process: a restart loads it. Absent when `update` is not enabled here. */
  restart?: boolean
  /** Commits origin has that the clone lacks, as of the last fetch. */
  behind?: number
  /** An install is owed: the next pull installs the packages the lockfile names. */
  install?: boolean
}

/**
 * What the `update` extension answered when this button pulled the clone: its own `update` action, verbatim,
 * as much of it as this extension reports. A refusal is reported whole, and it stops the rest of the click —
 * except a clone that has diverged, whose restart does not need the fast-forward that was refused.
 */
export type PullResult =
  | {
      ok: true
      from: string
      to: string
      commits: number
      install: 'done' | 'failed' | 'skipped'
      installError?: string
      /**
       * What the range touches, by how it goes live (`update`'s own `Layers`). Only `bin` is read here: the
       * supervisor is the one layer a restart cannot swap, so a nightly run says so instead of pretending.
       */
      layers?: { bin?: boolean }
    }
  | { ok: false; refused: string }

/** What became of one host the button tried to restart. */
export interface RestartOutcome {
  name: string
  /**
   * `restarted`: the generation that was announced now serves. `failed`: it did not come back in the
   * deadline. `held`: the same host on the same build was tried inside the anti-loop window. `self`: this
   * window's host, which an action cannot restart — the window does it.
   */
  result: 'restarted' | 'failed' | 'held' | 'self'
  /** How long the host took to serve the new generation, for `restarted`. */
  seconds?: number
  /** Why it is not `restarted`: `no answer in 20s`, `refused: …`, `tried 3 min ago`. */
  reason?: string
}

/**
 * What the `update` action did, in the order it did it: the pull (when one was owed), then each host. Empty
 * `projects` with a refused `pull` is the refusal stopping everything.
 */
export interface UpdateReport {
  /**
   * The pull, when one was owed. A refusal stops the rest — nothing is restarted onto a clone that did not
   * move —, except the divergence one: that clone is clean and committed, and the hosts still restart onto
   * the code already on disk.
   */
  pull?: PullResult
  /** Each host, in the order it was tried, this window's own last. */
  projects: RestartOutcome[]
  /** The clone's own commits, when the pull was refused for divergence and the hosts restarted anyway. */
  diverged?: Diverged
  /** This window's host is in the list and only the window can restart it: `web.solid.tsx` calls the SDK's
   * `restart()` and the core does the swap with its own rollback. */
  restartSelf: boolean
}

/**
 * What the `create` action did: it brought a host up for a new folder (`created: true`) or selected
 * the project that was already that folder — up, or coming up now —, without a second host for the
 * same root. `unhidden` says the project was hidden from the rail and came back: asking for its folder
 * again is asking for the project.
 */
export interface CreateResult {
  created: boolean
  project: Project
  unhidden?: boolean
}

/**
 * What the `forget` action did: the project's home entered `projects.hidden` of this machine's settings,
 * so the `list` no longer returns it and the rail no longer draws it. **Nothing was deleted** — the home
 * stays where it is, with the project's conversations.
 */
export interface ForgetResult {
  hidden: true
  project: Project
}

/**
 * What the `stop` action did: it stopped (and returns the new row), or it still asks for
 * confirmation because that host was not started by this extension.
 */
export type StopResult =
  | { stopped: true; project: Project }
  | { stopped: false; needsConfirm: true; pid: number; url?: string }

/** What the `seen` action left: the morning's line was read and will not be drawn again. */
export interface Seen {
  seen: true
}

/**
 * One night of the automatic update, as the machine keeps it: the turn one host of the machine took for a
 * local day, and what came of it. It is the election and the record in one file
 * (`~/.ultimate/projects-update-<day>.json`): the turn is a file only one host can create, and the winner
 * rewrites it with its result.
 */
export interface NightlyRecord {
  /** The local day (`YYYY-MM-DD`) this turn belongs to. */
  day: string
  /** The time of day the run was armed for, as the settings said it (`HH:MM`). */
  at: string
  /** The home of the host that took the turn: only that one writes the result, and retries. */
  by: string
  /** When the turn was taken (ISO). */
  claimedAt: string
  /** What the run did; absent while it still runs, or when the process died in the middle. */
  result?: NightlyResult
  /** When the one retry after a busy machine is due (ISO); absent when there is none. */
  retryAt?: string
  /** How many times this night ran: 1, or 2 after the retry. */
  attempts?: number
  /** When the report was read and put away. */
  seenAt?: string
}

/**
 * What came of one night. The words are composed when the run ends, so the rail only draws them: the clone
 * and the hosts are not read again to say what happened.
 */
export interface NightlyResult {
  /**
   * `ran` updated the clone and the hosts; `busy` stepped aside; `diverged` did everything a diverged clone
   * allows — the restarts — and left the pull waiting for a merge; `failed` could not do the work.
   */
  outcome: 'ran' | 'busy' | 'diverged' | 'failed'
  /** When the run (or the step aside) ended (ISO). */
  at: string
  /** The one line the rail shows. Absent when the night had nothing worth a line. */
  line?: string
  /** The detail, one line per host and of the pull, for the panel. */
  lines?: string[]
  /** The diverged clone the night waited on: how many commits of yours, and the range `update` offers. */
  diverged?: Diverged
  /** `bin/` changed in the pull: the supervisor still runs the old one, and only a person restarts it. */
  supervisor?: boolean
}

/**
 * The report as the rail draws it: its one line, the detail behind it, and the two numbers the panel's
 * sentence uses (`Last night, 03:00`). Nothing here is computed on screen.
 */
export interface NightlyView {
  /** The local day the run was taken for. */
  day: string
  /** The hour it was armed for (`HH:MM`). */
  at: string
  /** The record is the machine's today: the night that just passed — "last night". */
  today: boolean
  outcome: 'ran' | 'busy' | 'diverged' | 'failed'
  /** The one line. */
  line: string
  /** The detail, one line per host and of the pull. */
  lines: string[]
  /** The clone waited for a merge: the number of your commits and the comparison, when `update` offered one. */
  diverged?: Diverged
  /** The night ended with `bin/` changed and the supervisor not restarted. */
  supervisor?: true
}
