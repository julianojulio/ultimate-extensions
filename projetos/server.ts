/**
 * O servidor do rail “Projetos”: lê a máquina, pergunta aos outros hosts o que só eles sabem, e sobe,
 * deita ou cria um host quando alguém clica num tile, no popover ou no `+`.
 *
 * O código mora no repositório das extensões de máquina, `~/src/ultimate-extensions/projetos`; o que
 * o Ultimate carrega é o symlink `~/.ultimate/extensions/projetos`, feito pelo `install.sh` de lá.
 * Editar é no repositório, e a recarga a quente acompanha o link.
 *
 * `listar` mostra os projetos da máquina (`host.projects()`: os homes centrais de
 * `~/.ultimate/projects`, com a URL de quem está de pé). O rail chama `listar({ medir: false })`: sem
 * viagem a outro host, porque um tile não mostra número. As medidas (`1 working · 1 question`) só
 * existem no popover de um tile, e são da ação `medir`, que pergunta **àquele** host quando o popover
 * abre. Nem o `busy` nem as perguntas de outro projeto estão em lugar nenhum do disco — a lista de
 * conversas que cada host publica não guarda o grafo de tarefas nem a caixa de perguntas —, então a
 * pergunta vai por HTTP ao próprio host daquele projeto, em loopback, e ele responde de si mesmo
 * (`estado`). Loopback com a `Origin` do alvo é o mesmo caminho que `lib/remote.ts` usa para falar com
 * outra instância. `listar()` sem argumento continua medindo todo mundo: é o que a lista do celular
 * mostra e o que qualquer outro host que chame a ação recebe.
 *
 * As três ações que mexem na máquina (`iniciar`, `parar`, `criar`) seguem quatro regras, e são todas
 * obrigatórias:
 *
 * 1. **A guarda é o pid vivo, nunca o arquivo.** Um lock de pid morto é um projeto parado e o clique
 *    sobe; um lock de pid vivo é «já roda em :N» e o clique não faz nada.
 * 2. **O host nasce destacado** (`spawn` com `detached`, sem tty): um filho do host que o subiu
 *    morreria no reinício deste.
 * 3. **A porta é a primeira livre a partir de 4747, e a resposta é a saúde.** Só se devolve o link
 *    quando a porta responde; o que não sobe no prazo é encerrado, e o erro vai para o popover.
 * 4. **Parar mata só o pid do lock daquele projeto** e confere que o lock sumiu: nada de `pkill`,
 *    nada de matar por porta. Um host que esta extensão não subiu pede confirmação no popover.
 *
 * O estado verdadeiro é sempre o lock relido, nunca uma lista em memória: a extensão pode recarregar
 * entre uma ação e outra. Não há poll — a tela lê ao abrir e de novo no botão de atualizar.
 *
 * Fora do home dos projetos que ela subiu, esta extensão escreve **um** arquivo só: o
 * `~/.ultimate/settings.json` desta máquina, quando o botão do pé do rail liga ou desliga a animação do
 * splash (a ação `splash`). Ali também nada vem de memória: a ação lê o arquivo, mexe só na entrada
 * `splash` de `extensions.disable` e recusa, sem escrever, o que o core recusaria inteiro — JSON
 * inválido, `extensions` que não é objeto (ver README).
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

/** Quanto se espera o host de outro projeto responder antes de dizer que ele não respondeu. */
const ESPERA = 3000

/** O prazo da saúde de um host que se acabou de subir. */
const ESPERA_SUBIDA = 20000

/** Quanto se espera o SIGTERM antes de escalar para SIGKILL. */
const ESPERA_PARADA = 8000

/** O que se gravou no home do projeto quando foi esta extensão que subiu aquele pid. */
const REGISTO = 'projetos-started.json'

/** A saída do host que se subiu, para a linha poder dizer por que ele não subiu. */
const LOG = 'projetos-start.log'

interface ProjetoDoHost {
  name: string
  root?: string
  home: string
  current: boolean
  running?: { pid: number; url: string }
}

/** O serviço `messages` (core, sempre ligado), do qual se pede só o que espera o usuário. */
interface ServicoDeMensagens {
  openQuestions(ctx: unknown): Promise<{ message: number; conversation: number; at: number; text: string }[]>
}
const Mensagens = { name: 'messages' } as const

interface Contexto {
  signal: AbortSignal
  host: {
    ultimateRoot: string
    projects(): Promise<ProjetoDoHost[]>
    /** As conversas deste host, com o `busy` do grafo de tarefas vivo. */
    conversations(): readonly { busy: boolean }[]
    need<S>(api: { name: string }): S
  }
}

/** As medidas de um host de pé: `null` é o que ele não respondeu. */
interface Medidas {
  working: number | null
  perguntasAbertas: number | null
  motivo?: string
}

/** Quantas conversas deste host estão trabalhando agora. */
const trabalhando = (ctx: Contexto) => ctx.host.conversations().filter((item) => item.busy).length

/**
 * Quantas perguntas esperam resposta neste host. O serviço `messages` é quem sabe (é a mesma conta do
 * painel de perguntas); quando ele não responde, a conta não vira zero — vira `null`.
 */
async function abertas(ctx: Contexto): Promise<number | null> {
  try {
    const servico = ctx.host.need<ServicoDeMensagens>(Mensagens)
    return (await servico.openQuestions(context)).length
  } catch {
    return null
  }
}

/** O motivo em uma linha curta, do jeito que ele cabe no `title` de uma linha da barra. */
function motivo(erro: unknown): string {
  if (erro instanceof Error) {
    if (erro.name === 'TimeoutError') return `no answer in ${ESPERA / 1000}s`
    return erro.message
  }
  return String(erro)
}

/**
 * Pergunta a outro host desta máquina quantas conversas dele estão trabalhando e quantas perguntas
 * esperam resposta. A `Origin` do alvo é o que o admit dele aceita em loopback; um host que não
 * responde (ou não tem esta extensão) devolve um erro, e quem chamou mostra `unavailable`.
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
  // Uma resposta sem nenhum dos dois números não é medida nenhuma: é como se não tivesse respondido.
  if (working === null && perguntasAbertas === null) throw new Error('the answer carried no count')
  return { working, perguntasAbertas }
}

/** Um número de medida, ou `null` para um valor torto; o mesmo critério de `projetos.ts`. */
function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 ? valor : null
}

/** Uma linha da seção a partir do que se mediu: nunca inventa um número que não veio. */
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

/** O nome que a ação recebeu, ou um erro: nomes de projeto, nunca caminhos. */
function nomeDoArgumento(args: JsonValue): string {
  const valor =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as { name?: unknown }).name
      : undefined
  if (typeof valor !== 'string' || !valor.trim()) throw new Error('name must be a project name')
  return valor.trim()
}

/** O projeto pelo nome, lido agora do disco (`host.projects()` lê o lock a cada chamada). */
async function procurar(ctx: Contexto, name: string): Promise<ProjetoDoHost> {
  const projeto = (await ctx.host.projects()).find((item) => item.name === name)
  if (!projeto) throw new Error(`Unknown project ${JSON.stringify(name)}`)
  return projeto
}

/** O pid está vivo? Um processo de outro dono (EPERM) conta como vivo. */
function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (erro) {
    return (erro as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** O lock de um home, relido agora: `pid` sem processo vivo ainda é um lock, mas não é um host. */
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

/** O pid que esta extensão subiu para aquele home, se foi ela e se ele ainda é o do registo. */
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

/** Esquece o registo, só quando ele ainda nomeia `pid`: o pid de outro não se apaga por engano. */
async function esquecer(home: string, pid: number | undefined) {
  if ((await lembrado(home)) === pid) await rm(join(home, REGISTO), { force: true })
}

/** O ambiente do home do usuário, como o harness o resolve: `ULTIMATE_USER_HOME` quando há (uma prévia
 * isolada, um home de testes), senão o do sistema. É dele que saem os projetos e as settings. */
function usuario(): string {
  return process.env.ULTIMATE_USER_HOME ?? homedir()
}

/**
 * As settings desta máquina, lidas na hora: o objeto, ou o motivo de ele não servir para uma escrita. Um
 * arquivo ausente é um objeto vazio — desligar o splash cria o arquivo, ligar não tem o que criar.
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
 * Grava as settings por um temporário ao lado e um `rename`: um JSON pela metade não existe para quem lê o
 * arquivo no meio do caminho. Se o arquivo é um link (settings em dotfiles), é o alvo que se reescreve —
 * o link fica. O JSON é escrito normalizado, em dois espaços: a formatação de antes se perde.
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
 * O splash como os settings **desta máquina** o deixam agora, lido a cada chamada: nada em memória, porque
 * a extensão recarrega entre uma e outra. Um arquivo que não se lê conta como ligado — é o que o core
 * também faz com ele.
 */
async function splashAgora(): Promise<boolean> {
  return splashLigado((await lerSettings()).settings)
}

/** O ambiente do host que se sobe: a identidade deste host não vale para outro projeto. */
function ambiente(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ULTIMATE_HOME: home,
    // O filho lê o mesmo `~/.ultimate` deste host — numa prévia isolada, a cópia privada, não a do sistema.
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

/** Sobe o processo destacado, com a saída no log do projeto; `detached` é o `setsid` que o solta. */
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

/** A porta responde? A saúde de um host que se acabou de subir é a resposta em HTTP, não o bind. */
async function saude(url: string, saiu: () => string | undefined): Promise<string | undefined> {
  const limite = Date.now() + ESPERA_SUBIDA
  for (;;) {
    try {
      // Enquanto o core não abre, o supervisor segura a conexão sem responder: é o prazo que decide.
      if ((await fetch(`${url}/`, { signal: AbortSignal.timeout(1500) })).ok) return undefined
    } catch {
      // Ainda não atende.
    }
    const motivo = saiu()
    if (motivo) return motivo
    if (Date.now() > limite) return `no answer in ${ESPERA_SUBIDA / 1000}s`
    await sleep(150)
  }
}

/** A linha do log do host que se subiu que diz por que ele não subiu, para o popover do tile. */
async function cauda(log: string): Promise<string> {
  const texto = await readFile(log, 'utf8').catch(() => '')
  const linhas = texto
    .split('\n')
    .map((linha) => linha.trim())
    .filter(Boolean)
  // O erro que interessa é a linha que o processo nomeia; a pilha abaixo dela é ruído.
  const erro = linhas.find((linha) => /^(?:Error|\[error\])/.test(linha))
  return (erro ?? linhas.slice(-2).join(' · ')).slice(0, 240)
}

/** Encerra um processo que esta extensão acabou de subir: TERM e, passado o prazo, KILL. */
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
    // Saiu entre o teste e o sinal.
  }
}

/**
 * O host parou e o lock sumiu? Espera até isso virar verdade, e devolve se virou: o lock de outro pid
 * que não o nosso conta como parado (outro host tomou o projeto).
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
 * Para o host de pid `pid` e confere que o lock daquele projeto sumiu. Mata **só** esse pid: nada de
 * grupo, nada de `pkill`, nada de matar por porta.
 */
async function desligar(home: string, pid: number) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== 'ESRCH')
      throw new Error(`Cannot stop pid ${pid}: ${motivo(erro)}`)
    // O pid sumiu antes do sinal: não há o que parar. Se o lock dele ficou, a linha diz isso.
    if ((await lerLock(home))?.pid === pid)
      throw new Error(`pid ${pid} was already gone, and its lock file was left behind`)
    return
  }
  if (await esperarSumir(home, pid, ESPERA_PARADA)) return
  // Não desligou sozinho: SIGKILL no mesmo pid. Um host morto assim não fecha o lock — e a linha diz.
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Saiu entre o teste e o sinal.
  }
  const limite = Date.now() + 3000
  while (vivo(pid) && Date.now() < limite) await sleep(100)
  if (vivo(pid)) throw new Error(`pid ${pid} did not exit, even with SIGKILL`)
  if ((await lerLock(home))?.pid === pid)
    throw new Error(`pid ${pid} only stopped with SIGKILL: its lock file was left behind`)
}

/** A porta que se pode abrir em loopback agora. */
function portaLivre(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const servidor = createServer()
    servidor.once('error', () => resolve(false))
    servidor.listen(port, '127.0.0.1', () => servidor.close(() => resolve(true)))
  })
}

/** A ação pediu medida? O rail chama `listar({ medir: false })`: nenhum número aparece num tile. */
function pediuMedida(args: JsonValue): boolean {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return true
  return (args as { medir?: unknown }).medir !== false
}

/** O botão do splash pediu ligado ou desligado: um booleano, nunca o que se adivinha de um `undefined`. */
function ligadoDoArgumento(args: JsonValue): boolean {
  const valor =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as { enabled?: unknown }).enabled
      : undefined
  if (typeof valor !== 'boolean') throw new Error('enabled must be true or false')
  return valor
}

/** O caminho que o diálogo do `+` mandou, como texto: vazio não é caminho, e o diálogo pede um. */
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
 * Apaga o home que uma primeira subida criou e que não chegou a virar projeto. O diretório só existe
 * porque o processo filho o fez (`bin/ultimate.ts` cria `ULTIMATE_HOME` antes de abrir o core); se ele
 * morreu antes de escrever o `project.json`, aquele home é lixo — e `listar` lê todo diretório sob
 * `~/.ultimate/projects`, então ele apareceria para sempre como um tile sem caminho. Um `project.json`
 * escrito, ou um host vivo segurando o lock, significam que o projeto é de verdade e nada é tocado.
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
 * Sobe o host de um projeto e só devolve quando a porta responde; o que não sobe no prazo é encerrado
 * e o erro sai com a cauda do log. Um projeto que ainda não tem home (`pastaNova`) escreve o log num
 * diretório temporário e só ganha o registo do pid depois de responder — o home é do host, não desta
 * extensão.
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
  // Sem pid o processo nem chegou a nascer, e o caminho do projeto é o que costuma faltar.
  if (pid === undefined) throw new Error(`Could not start ${projeto.name} in ${root}`)
  // Gravado logo depois do spawn: a janela entre um e outro é o único caso em que o host fica sem
  // registo — e o pior que isso custa é um clique de confirmação a mais (ver README).
  if (!options.pastaNova) await lembrar(projeto.home, pid, port)
  const url = `http://127.0.0.1:${port}`
  const falha = await saude(url, () => saida)
  // O host que atende pode não ser o nosso: um clique anterior, ou outro processo, chegou primeiro.
  const dono = await lerLock(projeto.home)
  const outro = dono && dono.pid !== pid && vivo(dono.pid) ? dono : undefined
  if (falha !== undefined && !outro) {
    await encerrar(pid)
    await esquecer(projeto.home, pid)
    const resto = await cauda(options.log)
    // Uma pasta que não virou projeto não pode deixar o home que o processo criou para trás.
    if (options.pastaNova) await descartarHome(projeto.home)
    throw new Error(
      `${projeto.name} did not answer on :${port} — ${falha}${resto ? `: ${resto}` : ''}`,
    )
  }
  // O home existe agora (quem atende escreveu o lock nele), e é onde o registo deste pid vale — ou não.
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
   * Os projetos da máquina, com o estado e o comando. Sem argumento, mede cada host de pé (é o que a
   * lista do celular mostra); `{ medir: false }` é a leitura barata do rail, que não mostra número.
   */
  async listar(args: JsonValue, ctx: Contexto): Promise<Secao> {
    // Um home sem `project.json` (uma subida que morreu antes de registrar) não é projeto de nada:
    // não tem caminho, não se sobe e não se mede — mostrar um tile dele seria mentir sobre a máquina.
    const projetos = (await ctx.host.projects()).filter((projeto) => projeto.root)
    // O botão do pé do rail diz o estado lido agora, não o de uma abertura anterior.
    const splash = await splashAgora()
    const at = new Date().toISOString()
    if (!pediuMedida(args))
      return { projetos: projetos.map((projeto) => montar(projeto)), at, splash }
    const aqui: Medidas = { working: trabalhando(ctx), perguntasAbertas: await abertas(ctx) }
    const linhas = await Promise.all(
      projetos.map(async (projeto): Promise<Projeto> => {
        // O projeto desta janela: as medidas são as deste host, sem viagem nenhuma.
        if (projeto.current) return montar(projeto, aqui)
        // Parado: não há a quem perguntar, e a tela mostra o comando no lugar da medida.
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
   * Liga ou desliga a animação do splash nas settings **desta máquina**
   * (`<home do usuário>/.ultimate/settings.json`): `splash` entra em `extensions.disable` (desligar) ou
   * sai dela (ligar), e todas as outras chaves do arquivo ficam como estão. É o único lugar em que esta
   * extensão escreve fora do home de um projeto que ela mesma subiu, e o settings de um projeto nunca é
   * tocado — um projeto pode dizer o contrário por cima, e essa é a decisão dele.
   *
   * O que não se conseguiria preservar é recusado **sem escrever**: JSON inválido, arquivo que não é
   * objeto, `extensions` que não é objeto, `disable` que não é lista de nomes — o core rejeitaria o
   * arquivo inteiro, e o usuário perderia as outras chaves. A escrita é por temporário e `rename`.
   */
  async splash(args: JsonValue, _ctx: Contexto): Promise<Splash> {
    const ligado = ligadoDoArgumento(args)
    const path = settingsDoUsuario(usuario())
    const lido = await lerSettings()
    if (lido.erro) throw new Error(lido.erro)
    // Sem arquivo, o ponto de partida é um objeto vazio: desligar cria o arquivo, ligar não cria nada.
    const antes = lido.settings ?? {}
    let depois: Record<string, unknown>
    try {
      depois = ajustarSplash(antes, ligado)
    } catch (erro) {
      throw new Error(`Cannot change the splash: ${path}: ${motivo(erro)}. Nothing was written`)
    }
    // `ajustarSplash` devolve o mesmo objeto quando não há o que mudar: nada se reescreve à toa.
    if (depois !== antes) await escreverSettings(path, depois)
    return { splash: ligado }
  },

  /**
   * O que se mediu num projeto agora: as conversas trabalhando e as perguntas sem resposta, com a hora
   * — o popover do tile pede isto quando abre, e só ele mostra esses números. Um host que não responde
   * devolve `null` nos dois e o motivo, nunca zero.
   */
  async medir(args: JsonValue, ctx: Contexto): Promise<Medida> {
    const projeto = await procurar(ctx, nomeDoArgumento(args))
    const at = new Date().toISOString()
    // O projeto desta janela: as medidas são as deste host, sem viagem nenhuma.
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
   * Só este host: quantas conversas dele estão trabalhando agora e quantas perguntas esperam resposta.
   * É o que outro host da máquina pergunta para medir um tile; nunca sai daqui para perguntar a mais
   * ninguém.
   */
  async estado(_args: JsonValue, ctx: Contexto): Promise<Estado> {
    return {
      working: trabalhando(ctx),
      perguntasAbertas: await abertas(ctx),
      at: new Date().toISOString(),
    }
  },

  /**
   * Sobe o host de um projeto parado, na primeira porta livre; um host que já roda não é tocado — a
   * linha volta como está, e o popover diz em que porta ele está.
   */
  async iniciar(args: JsonValue, ctx: Contexto): Promise<Projeto> {
    const name = nomeDoArgumento(args)
    const projeto = await procurar(ctx, name)
    // A guarda é o pid vivo: um lock de pid morto é um projeto parado, e é o `undefined` aqui.
    if (projeto.running) return montar(projeto)
    if (projeto.current) throw new Error(`${name} runs this window`)
    return subir(ctx, projeto, { log: join(projeto.home, LOG) })
  },

  /**
   * Cria um projeto a partir de uma pasta: expande `~`, exige um diretório de verdade, e sobe o host
   * dele como o `iniciar` faz. Uma pasta que já é um projeto da lista é selecionada — e, se estiver
   * parada, subida — em vez de um segundo host para a mesma raiz. A primeira execução daquele projeto,
   * o onboarding e a decisão de confiança dele acontecem na janela dele: esta extensão não decide nada
   * por ele. O home do projeto novo nasce com o host, não aqui.
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
    // Duas pastas com o mesmo nome de projeto não se distinguem aqui: as ações falam por nome, e um
    // segundo `app` faria o tile do primeiro responder pelo segundo (e pará-lo no lugar dele).
    const homonimo = projetos.find((projeto) => projeto.name === basename(root))
    if (homonimo)
      throw new Error(
        `A project called ${basename(root)} already exists (${homonimo.root ?? homonimo.home}); two projects with the same folder name cannot be told apart here`,
      )
    // Pasta nova: o home nasce com o host, então o log fica num diretório temporário até ele responder.
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
   * Deita o host de um projeto: só o pid do lock daquele projeto, conferindo que o lock sumiu. Um host
   * que esta extensão não subiu pede confirmação — a ação devolve `precisaConfirmar` e nada é tocado
   * até a mesma ação chegar com `confirm: true`.
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
