/**
 * The pure calculations of the Projects rail: the initials of the tile, the two groups (running and
 * stopped), the path typed into the `+` dialog, the central home a new project will occupy, the port
 * that only the panel shows, what the stop button decides, and what the splash button writes to this
 * machine's settings. Nothing here reads the machine, opens a process or makes a request —
 * `projetos.test.ts` covers all of it with fixtures.
 *
 * The state is never the colour alone: the rail writes `running`/`stopped` in each tile's panel, the
 * group is the position (running above the line, stopped below) and what was measured comes as a
 * number, with the time.
 */
import { createHash } from 'node:crypto'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { Medida, Projeto, Secao } from './tipos.ts'

/** The first port tried when bringing a host up. */
export const PRIMEIRA_PORTA = 4747

/** How many ports are tried from there: beyond that it is not a missing port, it is something else. */
export const TENTATIVAS_DE_PORTA = 100

/**
 * The state of the host, in a word: the panel says `running` or `stopped`, because it does not fit in a
 * 32px tile.
 */
export function palavra(projeto: Projeto): 'running' | 'stopped' {
  return projeto.running ? 'running' : 'stopped'
}

/**
 * The port, as the panel shows it for diagnostics: `:4747`, taken from the URL the host publishes. A
 * URL without a port returns nothing — the panel stays without a number instead of inventing an
 * address.
 */
export function portaDo(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const { port } = new URL(url)
    return port ? `:${port}` : undefined
  } catch {
    return undefined
  }
}

/** A number that can be shown: whole, finite and not negative. The rest is not a measurement. */
export function medido(valor: number | null | undefined): number | undefined {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 ? valor : undefined
}

/**
 * Whether there is a measurement to show. **A zero is a measurement** — the bug this pins down is
 * treating `0` as absence: `0 working · 0 questions` is an answer; `null` (the host is up and did not
 * answer) and `undefined` (the project is stopped, nobody asked) are not.
 */
export function temMedida(
  working: number | null | undefined,
  abertas: number | null | undefined,
): boolean {
  return medido(working) !== undefined || medido(abertas) !== undefined
}

/**
 * Whether the project has a host to stop: running, and not this window's (what serves the screen is not
 * shut down from it).
 */
export function podeParar(projeto: Projeto): boolean {
  return projeto.running !== undefined && !projeto.current
}

/**
 * How many conversations are working now: `0 working`, `2 working`. A number that was not measured does
 * not become zero — it becomes `count unavailable`.
 */
export function contagem(working: number | null | undefined): string {
  const n = medido(working)
  return n === undefined ? 'count unavailable' : `${n} working`
}

/**
 * The panel's questions without an answer, with the number in front: `0 questions`, `1 question`. Not
 * measured, `questions unavailable` — never an invented zero, which is what would make one ignore the
 * stuck project.
 */
export function perguntas(abertas: number | null | undefined): string {
  const n = medido(abertas)
  if (n === undefined) return 'questions unavailable'
  return `${n} ${n === 1 ? 'question' : 'questions'}`
}

/**
 * The whole sentence of the counter, which sits in the row's `title`: `2 unanswered questions`. Not
 * measured, the sentence says that nothing was measured and why.
 */
export function tituloDasPerguntas(abertas: number | null | undefined, motivo?: string): string {
  const n = medido(abertas)
  if (n === undefined) return motivo ? `questions unavailable — ${motivo}` : 'questions unavailable'
  return n === 0 ? 'no unanswered questions' : `${n} unanswered question${n === 1 ? '' : 's'}`
}

/**
 * The click target of a tile: the host's URL, with the port, where the browser goes. The number enters
 * no label (`iniciais` has letters only): it is an address, not on-screen information.
 */
export function linkDo(projeto: Projeto): string | undefined {
  return projeto.running?.url
}

/**
 * The initials of the tile, in up to two letters: `app_evangelho` → `AE`, `gta2xlwifi-lineage` → `GL`,
 * `robsoncosta` → `RO`. Two words give the first letter of each one; a single word gives its first two
 * letters. Two projects can coincide in their initials — the panel gives the name and the path.
 */
export function iniciais(name: string): string {
  const partes = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const letras =
    partes.length > 1
      ? partes.slice(0, 2).map((parte) => Array.from(parte)[0])
      : Array.from(partes.join('')).slice(0, 2)
  return letras.join('').toUpperCase()
}

/** The rail split by what it shows: the running hosts on top, the stopped ones below. */
export interface Grupos {
  rodando: Projeto[]
  parados: Projeto[]
}

/**
 * The two groups of the rail, in the order it draws them: this window's project first among the running
 * ones, the rest by name — the same order on every open, so that a tile does not jump around.
 */
export function grupos(projetos: Projeto[]): Grupos {
  const porNome = (a: Projeto, b: Projeto) => a.name.localeCompare(b.name)
  const rodando = projetos
    .filter((projeto) => projeto.running !== undefined)
    .sort((a, b) => Number(b.current) - Number(a.current) || porNome(a, b))
  const parados = projetos.filter((projeto) => projeto.running === undefined).sort(porNome)
  return { rodando, parados }
}

/**
 * The path typed into the `+` dialog, made absolute: `~` becomes the home of whoever is using it, `~/x`
 * becomes `<home>/x`, and the rest is resolved against the current directory. Empty or accidentally
 * relative returns `undefined` — the dialog asks for a path instead of guessing a folder.
 */
export function caminhoAbsoluto(valor: string, home: string): string | undefined {
  const texto = valor.trim()
  if (!texto) return undefined
  const expandido =
    texto === '~' ? home : texto.startsWith('~/') ? join(home, texto.slice(2)) : texto
  return isAbsolute(expandido) ? resolve(expandido) : undefined
}

/**
 * The central home of a new project, `<home>/.ultimate/projects/<name>-<8 hex of the path's sha256>`.
 * It is the same calculation as `server/project.ts:projectHome`; a new project does not register itself
 * by hand — the host running in that folder is born with this home, and that is why the tile appears
 * on its own.
 */
export function homeDoProjeto(root: string, home: string): string {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 8)
  return join(home, '.ultimate', 'projects', `${basename(root)}-${hash}`)
}

/** The command that brings the project up by hand, in any project's panel: `ultimate <path>`. */
export function comando(root: string | undefined): string | undefined {
  if (!root) return undefined
  return `ultimate ${palavraDeShell(root)}`
}

/** A path the shell would not split stays as it is; any other goes between single quotes. */
function palavraDeShell(valor: string): string {
  return /^[\w@%+=:,./-]+$/.test(valor) ? valor : `'${valor.replaceAll("'", `'\\''`)}'`
}

/** The `argv` with which this extension brings a host up: the project, the chosen port, and no window. */
export function argumentosDeInicio(root: string, port: number): string[] {
  return [root, '--port', String(port), '--no-open']
}

/** The program that is run: the `bin/ultimate.ts` of the clone that serves this window. */
export function programaDeInicio(ultimateRoot: string): string {
  return join(ultimateRoot, 'bin', 'ultimate.ts')
}

/**
 * The first free port from `primeira`, decided by whoever knows how to listen (`livre` tries to open the
 * port on loopback). With no free port in the range, it fails naming the range — the row shows the
 * error instead of a link that does not answer.
 */
export async function escolherPorta(
  livre: (port: number) => Promise<boolean> | boolean,
  primeira = PRIMEIRA_PORTA,
  tentativas = TENTATIVAS_DE_PORTA,
): Promise<number> {
  for (let port = primeira; port < primeira + tentativas && port <= 65535; port++)
    if (await livre(port)) return port
  throw new Error(`No free port from ${primeira} (${tentativas} tried)`)
}

/**
 * A project's host as the lock describes it: `pid` is the supervisor's, since the supervisor is the one
 * that writes the lock.
 */
export type Alvo = { pid: number; url?: string }

/** What the stop button decides to do. */
export type Parada =
  | { acao: 'nada' }
  | { acao: 'confirmar'; pid: number }
  | { acao: 'parar'; pid: number }

/**
 * What the stop button does, from the **re-read** lock: a project without a live host has nothing to
 * stop; a host this extension started (the pid it recorded) stops straight away; anyone else's asks for
 * confirmation — killing someone else's process on a blind click is not what this button promises.
 */
export function decisaoDeParada(
  alvo: Alvo | undefined,
  registado: number | undefined,
  confirmar: boolean,
): Parada {
  if (!alvo) return { acao: 'nada' }
  if (registado === alvo.pid) return { acao: 'parar', pid: alvo.pid }
  return confirmar ? { acao: 'parar', pid: alvo.pid } : { acao: 'confirmar', pid: alvo.pid }
}

/**
 * The presence dot of the tile, in the same scheme as the app's mark (`AgentMark`): working (brand,
 * pulsing), up and idle (green), stopped (grey). A host that is up and **did not answer** is not idle:
 * it stays without a pulse and the tile says `unavailable` — the silence of a stuck host is not calm.
 */
export type Presenca = 'working' | 'idle' | 'stopped' | 'unavailable'

/**
 * The dot of a tile, from the project and its last measurement: stopped has nothing to measure, and a
 * measurement that did not come (`null` on both, with a reason) is `unavailable`, never `idle`. A
 * measurement with zero is a measurement: `0 working` is idle for real.
 */
export function presenca(projeto: Projeto, medida: Medida | undefined): Presenca {
  if (projeto.running === undefined) return 'stopped'
  // Up and with no reading yet (the wave did not come back, or the host has just come up): there is
  // nothing to assert.
  if (!medida || !temMedida(medida.working, medida.perguntasAbertas)) return 'unavailable'
  return (medido(medida.working) ?? 0) > 0 ? 'working' : 'idle'
}

/**
 * The number of the question counter, as it fits in the corner of the tile: `1`..`9`, `9+` from ten up,
 * and `undefined` at zero — a counter of zero is noise. What was not measured does not become a number
 * either.
 */
export function numeroDePerguntas(abertas: number | null | undefined): string | undefined {
  const n = medido(abertas)
  if (!n) return undefined
  return n > 9 ? '9+' : String(n)
}

/**
 * The whole sentence of the tile, in the `title` and the `aria-label`: the state written out, the counts
 * of the reading **with the time they are from** (the indicator ages, but does not lie: it says when it
 * is from) and what the click does. `hora` arrives already formatted — the calculation does not format
 * dates.
 */
export function tituloDoTile(
  projeto: Projeto,
  medida: Medida | undefined,
  hora: string | undefined,
): string {
  const clique = projeto.current
    ? 'this window'
    : projeto.running
      ? 'open it in this tab'
      : 'stopped, click to start it'
  // Stopped has no reading at all: the sentence is the usual one, and the grey dot already says the rest.
  if (projeto.running === undefined) return `${projeto.name} — ${clique}`
  const contas = !medida
    ? 'not measured yet'
    : temMedida(medida.working, medida.perguntasAbertas)
      ? `${contagem(medida.working)} · ${tituloDasPerguntas(medida.perguntasAbertas)}`
      : `counts unavailable${medida.motivo ? ` — ${medida.motivo}` : ''}`
  const quando = medida && hora ? ` · measured at ${hora}` : ''
  return `${projeto.name} — running · ${contas}${quando} — ${clique}`
}

/**
 * The whole reading of the column, the way each tile keeps it: one measurement per project **that is
 * up**, each with the time it was measured at. A stopped project gets no entry — there is nobody to ask.
 */
export function ondaDaLeitura(secao: Secao): Record<string, Medida> {
  const medidas: Record<string, Medida> = {}
  for (const projeto of secao.projetos) {
    if (projeto.working === undefined && projeto.perguntasAbertas === undefined) continue
    medidas[projeto.name] = {
      working: medido(projeto.working) ?? null,
      perguntasAbertas: medido(projeto.perguntasAbertas) ?? null,
      ...(projeto.motivo ? { motivo: projeto.motivo } : {}),
      at: secao.at,
    }
  }
  return medidas
}

/**
 * **This machine's** settings file, `<user home>/.ultimate/settings.json` — the layer of whoever is using
 * it, which applies to every project. The `<project>/.ultimate/settings.json` is another file, and this
 * extension never touches it: a project can turn the splash off or on on top of it, and that is its
 * decision.
 */
export function settingsDoUsuario(userHome: string): string {
  return join(userHome, '.ultimate', 'settings.json')
}

/**
 * Is the splash on in these settings? `splash` in `extensions.disable` turns it off; a missing file, a
 * `disable` that is not a list or broken JSON count as **on**, because that is what the core does with
 * them (a file that is not read whole does not turn any extension off). It is the user's layer that is
 * read here.
 */
export function splashLigado(settings: unknown): boolean {
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
export function ajustarSplash(settings: unknown, ligado: boolean): Record<string, unknown> {
  const objeto = comoObjeto(settings, 'settings')
  const extensions =
    objeto.extensions === undefined ? undefined : comoObjeto(objeto.extensions, 'extensions')
  const disable = extensions?.disable === undefined ? [] : comoNomes(extensions.disable)
  // It is already as asked: no key is rewritten for nothing.
  if (ligado === !disable.includes('splash')) return objeto
  const semSplash = disable.filter((nome) => nome !== 'splash')
  const proxima = ligado ? semSplash : [...semSplash, 'splash']
  return { ...objeto, extensions: { ...extensions, disable: proxima } }
}

/**
 * The sentence of the button at the bottom of the rail, which goes in the `title` and the `aria-label`:
 * the state now and what the click does with it. Before the first reading the state is not known, and
 * the button says so.
 */
export function rotuloDoSplash(ligado: boolean | undefined): string {
  if (ligado === undefined) return 'Splash on project switch: unknown'
  return `Splash on project switch: ${ligado ? 'on — turn it off' : 'off — turn it on'}`
}

/** A JSON object — what can be rewritten preserving the keys; anything else is refused. */
function comoObjeto(valor: unknown, campo: string): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor))
    throw new Error(`${campo} must be a JSON object`)
  return valor as Record<string, unknown>
}

/** A list of extension names: a list with something else inside it is not a list of names. */
function comoNomes(valor: unknown): string[] {
  if (!Array.isArray(valor) || valor.some((nome) => typeof nome !== 'string'))
    throw new Error('extensions.disable must be an array of names')
  return valor as string[]
}
