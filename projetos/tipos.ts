/**
 * What the actions return and what the rail draws: nothing here is stored state — the reading is made
 * on the spot and the screen only shows what came.
 */

/** A project of the machine, as the rail shows it. */
export interface Projeto {
  name: string
  /** The full path, which goes in the tile's panel. */
  root: string
  /** The project of this window. */
  current: boolean
  /**
   * Running: the pid and the URL the host publishes in its lock. The URL is the click target of the
   * tile.
   */
  running?: { pid: number; url: string }
  /**
   * Conversations working now. `undefined` when the measurement was not asked for (the rail's
   * `listar`) or the host is stopped, and `null` when it is up and did not answer — the cases say
   * different things.
   */
  working?: number | null
  /** Questions of the panel without an answer in that host, with the same rule as `working`. */
  perguntasAbertas?: number | null
  /** Why it did not answer; it goes in the panel, not on the tile. */
  motivo?: string
  /**
   * `ultimate <path>`, the command that brings the project up by hand. Shown and copied, never
   * executed.
   */
  comando?: string
}

/** The whole list and when it was read: the rail shows the time in the refresh button's panel. */
export interface Secao {
  projetos: Projeto[]
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
 * What was measured in a project when its panel opened: the conversations working, the questions
 * without an answer, the time of the measurement, and the reason when the host did not answer — never
 * a zero in place of the silence.
 */
export interface Medida {
  working: number | null
  perguntasAbertas: number | null
  motivo?: string
  at: string
}

/** What a host answers about itself, when another host of the machine asks. */
export interface Estado {
  working: number
  /** Questions without an answer in this host; `null` when not even that was measured. */
  perguntasAbertas: number | null
  at: string
}

/**
 * What the `criar` action did: it brought a host up for a new folder (`criado: true`) or selected
 * the project that was already that folder — up, or coming up now —, without a second host for the
 * same root.
 */
export interface ResultadoDaCriacao {
  criado: boolean
  projeto: Projeto
}

/**
 * What the `parar` action did: it stopped (and returns the new row), or it still asks for
 * confirmation because that host was not started by this extension.
 */
export type ResultadoDaParada =
  | { parado: true; projeto: Projeto }
  | { parado: false; precisaConfirmar: true; pid: number; url?: string }
