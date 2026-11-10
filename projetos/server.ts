/**
 * The server of the "Projects" rail: it reads the machine, asks the other hosts what only they know,
 * and brings a host up, brings one down or creates one when someone clicks a tile, in the tile's panel
 * or on the `+`.
 *
 * The code lives in the machine extensions' repository, `~/src/ultimate-extensions/projetos`; what
 * Ultimate loads is the symlink `~/.ultimate/extensions/projetos`, made by its `install.sh`. Editing is
 * in the repository, and the hot reload follows the link.
 *
 * `listar` shows this machine's projects (`host.projects()`: the central homes of
 * `~/.ultimate/projects`, with the URL of those that are up). The rail calls `listar({ medir: false })`:
 * no trip to another host, because a tile shows no number. The measurements (`1 working · 1 question`)
 * exist only in a tile's panel, and they are the `medir` action's, which asks **that** host when the
 * panel opens. Neither the `busy` nor another project's questions are anywhere on disk — the
 * conversation list each host publishes keeps neither the task graph nor the question box —, so the
 * question goes by HTTP to that project's own host, on loopback, and it answers about itself
 * (`estado`). Loopback with the target's `Origin` is the same path `lib/remote.ts` uses to talk to
 * another instance. `listar()` with no argument keeps measuring everyone: it is what the phone's list
 * shows and what any other host that calls the action receives.
 *
 * The three actions that touch the machine (`iniciar`, `parar`, `criar`) follow four rules, and all of
 * them are mandatory:
 *
 * 1. **The guard is the live pid, never the file.** A dead pid's lock is a stopped project and the click
 *    brings it up; a live pid's lock is "already running on :N" and the click does nothing.
 * 2. **The host is born detached** (`spawn` with `detached`, no tty): a child of the host that started
 *    it would die on its restart.
 * 3. **The port is the first free one from 4747, and the answer is the health check.** The link is
 *    returned only when the port answers; what does not come up in the deadline is terminated, and the
 *    error goes to the tile's panel.
 * 4. **Stopping kills only the pid of that project's lock** and checks that the lock is gone: no
 *    `pkill`, no killing by port. A host this extension did not bring up asks for confirmation in the
 *    tile's panel.
 *
 * The true state is always the re-read lock, never a list in memory: the extension may reload between
 * one action and the other. There is no poll — the screen reads on opening and again on the refresh
 * button.
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
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import type { JsonValue } from '@earendil-works/chord'
import { defineExtension } from '@earendil-works/pi-durable'
import {
  ajustarSplash,
  argumentosDeInicio,
  caminhoAbsoluto,
  comando,
  decisaoDeParada,
  escolherPorta,
  homeDoProjeto,
  programaDeInicio,
  settingsDoUsuario,
  splashLigado,
} from './projetos.ts'
import type {
  Estado,
  Medida,
  Projeto,
  ResultadoDaCriacao,
  ResultadoDaParada,
  Secao,
  Splash,
} from './tipos.ts'

export default defineExtension({ name: 'projetos' })

/** How long another project's host is given to answer before it is said not to have answered. */
const ESPERA = 3000

/** The deadline of the health check of a host that has just been brought up. */
const ESPERA_SUBIDA = 20000

/** How long the SIGTERM is given before escalating to SIGKILL. */
const ESPERA_PARADA = 8000

/** What was written in the project's home when it was this extension that brought that pid up. */
const REGISTO = 'projetos-started.json'

/** The output of the host that was brought up, so that the row can say why it did not come up. */
const LOG = 'projetos-start.log'

interface ProjetoDoHost {
  name: string
  root?: string
  home: string
  current: boolean
  running?: { pid: number; url: string }
}

/** The `messages` service (core, always on), from which only what waits for the user is asked. */
interface ServicoDeMensagens {
  openQuestions(ctx: unknown): Promise<{ message: number; conversation: number; at: number; text: string }[]>
}
const Mensagens = { name: 'messages' } as const

interface Contexto {
  signal: AbortSignal
  host: {
    ultimateRoot: string
    projects(): Promise<ProjetoDoHost[]>
    /** This host's conversations, with the `busy` of the live task graph. */
    conversations(): readonly { busy: boolean }[]
    need<S>(api: { name: string }): S
  }
}

/** The measurements of a host that is up: `null` is what it did not answer. */
interface Medidas {
  working: number | null
  perguntasAbertas: number | null
  motivo?: string
}

/** How many conversations of this host are working now. */
const trabalhando = (ctx: Contexto) => ctx.host.conversations().filter((item) => item.busy).length

/**
 * How many questions wait for an answer in this host. The `messages` service is the one that knows (it is
 * the same count as the questions panel); when it does not answer, the count does not become zero — it
 * becomes `null`.
 */
async function abertas(ctx: Contexto): Promise<number | null> {
  try {
    const servico = ctx.host.need<ServicoDeMensagens>(Mensagens)
    return (await servico.openQuestions(context)).length
  } catch {
    return null
  }
}

/** The reason in one short line, the way it fits in the `title` of a row of the rail. */
function motivo(erro: unknown): string {
  if (erro instanceof Error) {
    if (erro.name === 'TimeoutError') return `no answer in ${ESPERA / 1000}s`
    return erro.message
  }
  return String(erro)
}

/**
 * Asks another host of this machine how many of its conversations are working and how many questions wait
 * for an answer. The target's `Origin` is what its `admit` accepts on loopback; a host that does not
 * answer (or does not have this extension) returns an error, and whoever called shows `unavailable`.
 */
async function perguntar(
  url: string,
  signal: AbortSignal,
): Promise<{ working: number | null; perguntasAbertas: number | null }> {
  const origin = new URL(url).origin
  const resposta = await fetch(`${origin}/api/extensions/projetos/actions/estado`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.any([AbortSignal.timeout(ESPERA), signal]),
  })
  const corpo = (await resposta.json().catch(() => ({}))) as {
    result?: { working?: unknown; perguntasAbertas?: unknown }
    error?: unknown
  }
  if (!resposta.ok)
    throw new Error(typeof corpo.error === 'string' ? corpo.error : `HTTP ${resposta.status}`)
  const working = numero(corpo.result?.working)
  const perguntasAbertas = numero(corpo.result?.perguntasAbertas)
  // An answer with neither of the two numbers is no measurement at all: it is as if it had not answered.
  if (working === null && perguntasAbertas === null) throw new Error('the answer carried no count')
  return { working, perguntasAbertas }
}

/** A measurement number, or `null` for a crooked value; the same criterion as `projetos.ts`. */
function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 ? valor : null
}

/** A row of the section from what was measured: it never invents a number that did not come. */
function montar(projeto: ProjetoDoHost, medidas?: Medidas): Projeto {
  const cmd = comando(projeto.root)
  return {
    name: projeto.name,
    root: projeto.root ?? '',
    current: projeto.current,
    ...(projeto.running ? { running: projeto.running } : {}),
    ...(cmd ? { comando: cmd } : {}),
    ...(medidas
      ? {
          working: medidas.working,
          perguntasAbertas: medidas.perguntasAbertas,
          ...(medidas.motivo ? { motivo: medidas.motivo } : {}),
        }
      : {}),
  }
}

/** The name the action received, or an error: project names, never paths. */
function nomeDoArgumento(args: JsonValue): string {
  const valor =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as { name?: unknown }).name
      : undefined
  if (typeof valor !== 'string' || !valor.trim()) throw new Error('name must be a project name')
  return valor.trim()
}

/** The project by name, read from disk now (`host.projects()` reads the lock on every call). */
async function procurar(ctx: Contexto, name: string): Promise<ProjetoDoHost> {
  const projeto = (await ctx.host.projects()).find((item) => item.name === name)
  if (!projeto) throw new Error(`Unknown project ${JSON.stringify(name)}`)
  return projeto
}

/** Is the pid alive? A process of another owner (EPERM) counts as alive. */
function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (erro) {
    return (erro as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** A home's lock, re-read now: a `pid` with no live process is still a lock, but it is not a host. */
async function lerLock(home: string): Promise<{ pid: number; port?: number } | undefined> {
  try {
    const lido = JSON.parse(await readFile(join(home, 'ultimate.lock'), 'utf8')) as {
      pid?: unknown
      port?: unknown
    }
    if (typeof lido.pid !== 'number' || !Number.isSafeInteger(lido.pid) || lido.pid < 1)
      return undefined
    return { pid: lido.pid, ...(typeof lido.port === 'number' ? { port: lido.port } : {}) }
  } catch {
    return undefined
  }
}

/** The pid this extension brought up for that home, if it was this extension and it is still the
 * record's. */
async function lembrado(home: string): Promise<number | undefined> {
  try {
    const lido = JSON.parse(await readFile(join(home, REGISTO), 'utf8')) as { pid?: unknown }
    return typeof lido.pid === 'number' && Number.isSafeInteger(lido.pid) ? lido.pid : undefined
  } catch {
    return undefined
  }
}

async function lembrar(home: string, pid: number, port: number) {
  await writeFile(
    join(home, REGISTO),
    JSON.stringify({ pid, port, at: new Date().toISOString() }) + '\n',
  )
}

/** Forgets the record, only when it still names `pid`: another one's pid is not erased by mistake. */
async function esquecer(home: string, pid: number | undefined) {
  if ((await lembrado(home)) === pid) await rm(join(home, REGISTO), { force: true })
}

/** The environment of the user's home, as the harness resolves it: `ULTIMATE_USER_HOME` when there is
 * one (an isolated preview, a test home), otherwise the system's. The projects and the settings come from
 * it. */
function usuario(): string {
  return process.env.ULTIMATE_USER_HOME ?? homedir()
}

/**
 * This machine's settings, read on the spot: the object, or the reason it does not serve for a write. A
 * missing file is an empty object — turning the splash off creates the file, turning it on has nothing to
 * create.
 */
async function lerSettings(): Promise<{ settings?: Record<string, unknown>; erro?: string }> {
  const path = settingsDoUsuario(usuario())
  let texto: string
  try {
    texto = await readFile(path, 'utf8')
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return {}
    return { erro: `Cannot change the splash: ${path}: ${motivo(erro)}` }
  }
  try {
    const valor: unknown = JSON.parse(texto)
    if (!valor || typeof valor !== 'object' || Array.isArray(valor))
      throw new Error('settings must be a JSON object')
    return { settings: valor as Record<string, unknown> }
  } catch (erro) {
    return { erro: `Cannot change the splash: ${path}: ${motivo(erro)}. Nothing was written` }
  }
}

/**
 * Writes the settings through a temporary beside it and a `rename`: a half JSON does not exist for whoever
 * reads the file in the middle of the way. If the file is a link (settings in dotfiles), it is the target
 * that is rewritten — the link stays. The JSON is written normalised, in two spaces: the formatting from
 * before is lost.
 */
async function escreverSettings(path: string, settings: Record<string, unknown>) {
  const alvo = await realpath(path).catch(() => path)
  await mkdir(dirname(alvo), { recursive: true })
  const temporario = join(dirname(alvo), `.${basename(alvo)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporario, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx' })
    await rename(temporario, alvo)
  } finally {
    await rm(temporario, { force: true })
  }
}

/**
 * The splash as **this machine's** settings leave it now, read on every call: nothing in memory,
 * because the extension reloads between one and the other. A file that cannot be read counts as on —
 * which is what the core does with it too.
 */
async function splashAgora(): Promise<boolean> {
  return splashLigado((await lerSettings()).settings)
}

/**
 * The environment of the host that is brought up: the identity of this host is not worth anything to
 * another project.
 */
function ambiente(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ULTIMATE_HOME: home,
    // The child reads this host's same `~/.ultimate` — in an isolated preview, the private copy, not the
    // system's.
    ULTIMATE_USER_HOME: usuario(),
    ULTIMATE_NO_OPEN: '1',
  }
  for (const nome of [
    'ULTIMATE_PORT',
    'ULTIMATE_PROJECT',
    'ULTIMATE_SUPERVISED',
    'ULTIMATE_GENERATION',
    'ULTIMATE_PREVIOUS_BUILD',
    'ULTIMATE_PUBLIC_URL',
  ])
    delete env[nome]
  return env
}

/**
 * Brings the detached process up, with the output in the project's log; `detached` is the `setsid` that
 * lets it go.
 */
function lancar(
  programa: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; log: string },
): ChildProcess {
  const saida = openSync(options.log, 'w')
  try {
    const child = spawn(programa, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', saida, saida],
    })
    child.unref()
    return child
  } finally {
    closeSync(saida)
  }
}

/**
 * Does the port answer? The health check of a host that has just been brought up is the HTTP answer, not
 * the bind.
 */
async function saude(url: string, saiu: () => string | undefined): Promise<string | undefined> {
  const limite = Date.now() + ESPERA_SUBIDA
  for (;;) {
    try {
      // Until the core opens, the supervisor holds the connection without answering: the deadline decides.
      if ((await fetch(`${url}/`, { signal: AbortSignal.timeout(1500) })).ok) return undefined
    } catch {
      // Not answering yet.
    }
    const motivo = saiu()
    if (motivo) return motivo
    if (Date.now() > limite) return `no answer in ${ESPERA_SUBIDA / 1000}s`
    await sleep(150)
  }
}

/** The log line of the host that was brought up that says why it did not come up, for the tile's panel. */
async function cauda(log: string): Promise<string> {
  const texto = await readFile(log, 'utf8').catch(() => '')
  const linhas = texto
    .split('\n')
    .map((linha) => linha.trim())
    .filter(Boolean)
  // The error that matters is the line the process names; the stack below it is noise.
  const erro = linhas.find((linha) => /^(?:Error|\[error\])/.test(linha))
  return (erro ?? linhas.slice(-2).join(' · ')).slice(0, 240)
}

/** Terminates a process this extension has just brought up: TERM and, past the deadline, KILL. */
async function encerrar(pid: number) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  const limite = Date.now() + ESPERA_PARADA
  while (vivo(pid) && Date.now() < limite) await sleep(100)
  if (!vivo(pid)) return
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
async function esperarSumir(home: string, pid: number, prazo: number): Promise<boolean> {
  const limite = Date.now() + prazo
  for (;;) {
    const lido = await lerLock(home)
    if (!vivo(pid) && lido?.pid !== pid) return true
    if (Date.now() > limite) return false
    await sleep(100)
  }
}

/**
 * Stops the host of pid `pid` and checks that that project's lock is gone. It kills **only** that pid: no
 * group, no `pkill`, no killing by port.
 */
async function desligar(home: string, pid: number) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== 'ESRCH')
      throw new Error(`Cannot stop pid ${pid}: ${motivo(erro)}`)
    // The pid vanished before the signal: there is nothing to stop. If its lock stayed, the row says so.
    if ((await lerLock(home))?.pid === pid)
      throw new Error(`pid ${pid} was already gone, and its lock file was left behind`)
    return
  }
  if (await esperarSumir(home, pid, ESPERA_PARADA)) return
  // It did not go down by itself: SIGKILL on the same pid. A host killed that way does not close the lock —
  // and the row says so.
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // It exited between the test and the signal.
  }
  const limite = Date.now() + 3000
  while (vivo(pid) && Date.now() < limite) await sleep(100)
  if (vivo(pid)) throw new Error(`pid ${pid} did not exit, even with SIGKILL`)
  if ((await lerLock(home))?.pid === pid)
    throw new Error(`pid ${pid} only stopped with SIGKILL: its lock file was left behind`)
}

/** The port that can be opened on loopback now. */
function portaLivre(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const servidor = createServer()
    servidor.once('error', () => resolve(false))
    servidor.listen(port, '127.0.0.1', () => servidor.close(() => resolve(true)))
  })
}

/**
 * Did the action ask for a measurement? The rail calls `listar({ medir: false })`: no number appears on a
 * tile.
 */
function pediuMedida(args: JsonValue): boolean {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return true
  return (args as { medir?: unknown }).medir !== false
}

/** Did the splash button ask for on or off: a boolean, never what one guesses from an `undefined`. */
function ligadoDoArgumento(args: JsonValue): boolean {
  const valor =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as { enabled?: unknown }).enabled
      : undefined
  if (typeof valor !== 'boolean') throw new Error('enabled must be true or false')
  return valor
}

/** The path the `+` dialog sent, as text: empty is not a path, and the dialog asks for one. */
function caminhoDoArgumento(args: JsonValue): string {
  const valor =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as { caminho?: unknown }).caminho
      : undefined
  if (typeof valor !== 'string' || !valor.trim())
    throw new Error('Enter a folder path, such as ~/src/my-project')
  return valor
}

/**
 * Deletes the home a first start created and that never became a project. The directory exists only because
 * the child process made it (`bin/ultimate.ts` creates `ULTIMATE_HOME` before opening the core); if it died
 * before writing the `project.json`, that home is rubbish — and `listar` reads every directory under
 * `~/.ultimate/projects`, so it would appear for ever as a tile without a path. A `project.json`
 * written, or a live host holding the lock, mean that the project is real and nothing is touched.
 */
async function descartarHome(home: string) {
  const escrito = await readFile(join(home, 'project.json'), 'utf8').then(
    () => true,
    () => false,
  )
  if (escrito) return
  const dono = await lerLock(home)
  if (dono && vivo(dono.pid)) return
  await rm(home, { recursive: true, force: true })
}

/**
 * Brings a project's host up and only returns when the port answers; what does not come up in the
 * deadline is terminated and the error leaves with the tail of the log. A project that has no home yet
 * (`pastaNova`) writes the log in a temporary directory and only gains the pid's record after answering —
 * the home is the host's, not this extension's.
 */
async function subir(
  ctx: Contexto,
  projeto: ProjetoDoHost,
  options: { log: string; pastaNova?: boolean },
): Promise<Projeto> {
  const root = projeto.root
  if (!root) throw new Error(`No path for ${projeto.name}`)
  const port = await escolherPorta(portaLivre)
  const child = lancar(
    process.execPath,
    [programaDeInicio(ctx.host.ultimateRoot), ...argumentosDeInicio(root, port)],
    { cwd: root, env: ambiente(projeto.home), log: options.log },
  )
  const pid = child.pid
  let saida: string | undefined
  child.once('error', (erro) => {
    saida = `could not run ${process.execPath}: ${erro.message}`
  })
  child.once('exit', (code, sinal) => {
    saida ??= `the process exited (${sinal ?? `code ${code}`})`
  })
  // Without a pid the process was not even born, and the project's path is what usually is missing.
  if (pid === undefined) throw new Error(`Could not start ${projeto.name} in ${root}`)
  // Written right after the spawn: the window between the two is the only case in which the host stays
  // without a record — and the worst it costs is one extra confirmation click (see README).
  if (!options.pastaNova) await lembrar(projeto.home, pid, port)
  const url = `http://127.0.0.1:${port}`
  const falha = await saude(url, () => saida)
  // The host that answers may not be ours: an earlier click, or another process, got there first.
  const dono = await lerLock(projeto.home)
  const outro = dono && dono.pid !== pid && vivo(dono.pid) ? dono : undefined
  if (falha !== undefined && !outro) {
    await encerrar(pid)
    await esquecer(projeto.home, pid)
    const resto = await cauda(options.log)
    // A folder that did not become a project cannot leave the home the process created behind.
    if (options.pastaNova) await descartarHome(projeto.home)
    throw new Error(
      `${projeto.name} did not answer on :${port} — ${falha}${resto ? `: ${resto}` : ''}`,
    )
  }
  // The home exists now (whoever answers wrote the lock in it), and it is where this pid's record counts —
  // or does not.
  if (dono?.pid === pid) await lembrar(projeto.home, pid, port)
  else await esquecer(projeto.home, pid)
  const emPe = outro ?? (dono?.pid === pid ? dono : undefined)
  return montar({
    ...projeto,
    running: { pid: emPe?.pid ?? pid, url: emPe?.port ? `http://127.0.0.1:${emPe.port}` : url },
  })
}

export const actions = {
  /**
   * This machine's projects, with the state and the command. With no argument, it measures each host that
   * is up (it is what the phone's list shows); `{ medir: false }` is the rail's cheap read, which shows no
   * number.
   */
  async listar(args: JsonValue, ctx: Contexto): Promise<Secao> {
    // A home without a `project.json` (a start that died before registering) is no project of anyone's:
    // it has no path, it is neither brought up nor measured — showing its tile would lie about the machine.
    const projetos = (await ctx.host.projects()).filter((projeto) => projeto.root)
    // The button at the bottom of the rail says the state read now, not the one from an earlier opening.
    const splash = await splashAgora()
    const at = new Date().toISOString()
    if (!pediuMedida(args))
      return { projetos: projetos.map((projeto) => montar(projeto)), at, splash }
    const aqui: Medidas = { working: trabalhando(ctx), perguntasAbertas: await abertas(ctx) }
    const linhas = await Promise.all(
      projetos.map(async (projeto): Promise<Projeto> => {
        // This window's project: the measurements are this host's, with no trip at all.
        if (projeto.current) return montar(projeto, aqui)
        // Stopped: there is no one to ask, and the screen shows the command in place of the measurement.
        if (!projeto.running) return montar(projeto)
        try {
          return montar(projeto, await perguntar(projeto.running.url, ctx.signal))
        } catch (erro) {
          return montar(projeto, {
            working: null,
            perguntasAbertas: null,
            motivo: motivo(erro),
          })
        }
      }),
    )
    return { projetos: linhas, at, splash }
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
   * `rename`.
   */
  async splash(args: JsonValue, _ctx: Contexto): Promise<Splash> {
    const ligado = ligadoDoArgumento(args)
    const path = settingsDoUsuario(usuario())
    const lido = await lerSettings()
    if (lido.erro) throw new Error(lido.erro)
    // With no file, the starting point is an empty object: turning it off creates the file, turning it on
    // creates nothing.
    const antes = lido.settings ?? {}
    let depois: Record<string, unknown>
    try {
      depois = ajustarSplash(antes, ligado)
    } catch (erro) {
      throw new Error(`Cannot change the splash: ${path}: ${motivo(erro)}. Nothing was written`)
    }
    // `ajustarSplash` returns the same object when nothing changes: nothing is rewritten for nothing.
    if (depois !== antes) await escreverSettings(path, depois)
    return { splash: ligado }
  },

  /**
   * What was measured in a project now: the conversations working and the questions without an answer,
   * with the time — the tile's panel asks for this when it opens, and only it shows those numbers. A host
   * that does not answer returns `null` on both and the reason, never zero.
   */
  async medir(args: JsonValue, ctx: Contexto): Promise<Medida> {
    const projeto = await procurar(ctx, nomeDoArgumento(args))
    const at = new Date().toISOString()
    // This window's project: the measurements are this host's, with no trip at all.
    if (projeto.current)
      return { working: trabalhando(ctx), perguntasAbertas: await abertas(ctx), at }
    if (!projeto.running)
      return { working: null, perguntasAbertas: null, motivo: 'the host is stopped', at }
    try {
      return { ...(await perguntar(projeto.running.url, ctx.signal)), at }
    } catch (erro) {
      return { working: null, perguntasAbertas: null, motivo: motivo(erro), at }
    }
  },

  /**
   * This host only: how many of its conversations are working now and how many questions wait for an
   * answer. It is what another host of the machine asks to measure a tile; it never leaves here to ask
   * anyone else.
   */
  async estado(_args: JsonValue, ctx: Contexto): Promise<Estado> {
    return {
      working: trabalhando(ctx),
      perguntasAbertas: await abertas(ctx),
      at: new Date().toISOString(),
    }
  },

  /**
   * Brings a stopped project's host up, on the first free port; a host that already runs is not touched —
   * the row comes back as it is, and the tile's panel says on which port it is.
   */
  async iniciar(args: JsonValue, ctx: Contexto): Promise<Projeto> {
    const name = nomeDoArgumento(args)
    const projeto = await procurar(ctx, name)
    // The guard is the live pid: a dead pid's lock is a stopped project, and it is the `undefined` here.
    if (projeto.running) return montar(projeto)
    if (projeto.current) throw new Error(`${name} runs this window`)
    return subir(ctx, projeto, { log: join(projeto.home, LOG) })
  },

  /**
   * Creates a project from a folder: it expands `~`, demands a real directory, and brings its host up as
   * `iniciar` does. A folder that is already a project of the list is selected — and, if it is stopped,
   * brought up — instead of a second host for the same root. That project's first run, the onboarding and
   * its trust decision happen in its window: this extension decides nothing for it. The new project's home
   * is born with the host, not here.
   */
  async criar(args: JsonValue, ctx: Contexto): Promise<ResultadoDaCriacao> {
    const absoluto = caminhoAbsoluto(caminhoDoArgumento(args), homedir())
    if (!absoluto) throw new Error('Enter a full path, such as ~/src/my-project')
    const root = await realpath(absoluto).catch(() => undefined)
    if (!root) throw new Error(`No such folder: ${absoluto}`)
    const info = await stat(root).catch(() => undefined)
    if (!info?.isDirectory()) throw new Error(`Not a folder: ${root}`)
    const projetos = await ctx.host.projects()
    const existente = projetos.find((projeto) => projeto.root === root)
    if (existente) {
      if (existente.running || existente.current)
        return { criado: false, projeto: montar(existente) }
      return {
        criado: false,
        projeto: await subir(ctx, existente, { log: join(existente.home, LOG) }),
      }
    }
    // Two folders with the same project name cannot be told apart here: the actions speak by name, and a
    // second `app` would make the first's tile answer for the second (and stop it in its place).
    const homonimo = projetos.find((projeto) => projeto.name === basename(root))
    if (homonimo)
      throw new Error(
        `A project called ${basename(root)} already exists (${homonimo.root ?? homonimo.home}); two projects with the same folder name cannot be told apart here`,
      )
    // New folder: the home is born with the host, so the log stays in a temporary directory until it
    // answers.
    const temp = await mkdtemp(join(tmpdir(), 'ultimate-projetos-'))
    try {
      const projeto: ProjetoDoHost = {
        name: basename(root),
        root,
        home: homeDoProjeto(root, usuario()),
        current: false,
      }
      return {
        criado: true,
        projeto: await subir(ctx, projeto, { log: join(temp, LOG), pastaNova: true }),
      }
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  },

  /**
   * Brings a project's host down: only the pid of that project's lock, checking that the lock is gone. A
   * host this extension did not bring up asks for confirmation — the action returns `precisaConfirmar`
   * and nothing is touched until the same action arrives with `confirm: true`.
   */
  async parar(args: JsonValue, ctx: Contexto): Promise<ResultadoDaParada> {
    const name = nomeDoArgumento(args)
    const confirmar =
      args && typeof args === 'object' && !Array.isArray(args)
        ? (args as { confirm?: unknown }).confirm === true
        : false
    const projeto = await procurar(ctx, name)
    if (projeto.current) throw new Error(`${name} runs this window: stop it from another window`)
    const decisao = decisaoDeParada(projeto.running, await lembrado(projeto.home), confirmar)
    if (decisao.acao === 'confirmar')
      return {
        parado: false,
        precisaConfirmar: true,
        pid: decisao.pid,
        ...(projeto.running?.url ? { url: projeto.running.url } : {}),
      }
    if (decisao.acao === 'parar') {
      await desligar(projeto.home, decisao.pid)
      await esquecer(projeto.home, decisao.pid)
    }
    return { parado: true, projeto: montar(await procurar(ctx, name)) }
  },
}
