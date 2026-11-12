/**
 * What the actions return and what the rail draws: nothing here is stored state — the reading is made
 * on the spot and the screen only shows what came.
 */

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

/** What a host answers about itself, when another host of the machine asks. */
export interface State {
  working: number
  /** Questions without an answer in this host; `null` when not even that was measured. */
  openQuestions: number | null
  at: string
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
