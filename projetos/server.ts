/**
 * O servidor da seção “Projetos”: lê a máquina, pergunta aos outros hosts o que só eles sabem, e sobe
 * ou deita um host quando alguém clica no botão.
 *
 * O código mora no repositório das extensões de máquina, `~/src/ultimate-extensions/projetos`; o que
 * o Ultimate carrega é o symlink `~/.ultimate/extensions/projetos`, feito pelo `install.sh` de lá.
 * Editar é no repositório, e a recarga a quente acompanha o link.
 *
 * `listar` mostra os projetos da máquina (`host.projects()`: os homes centrais de
 * `~/.ultimate/projects`, com a URL de quem está de pé) e, para cada um, quantas conversas estão
 * trabalhando e quantas perguntas esperam resposta **naquele** host. Nem o `busy` nem as perguntas de
 * outro projeto estão em lugar nenhum do disco — a lista de conversas que cada host publica não guarda
 * o grafo de tarefas nem a caixa de perguntas —, então a pergunta vai por HTTP ao próprio host
 * daquele projeto, em loopback, e ele responde de si mesmo (`estado`). Loopback com a `Origin` do alvo
 * é o mesmo caminho que `lib/remote.ts` usa para falar com outra instância.
 *
 * As duas ações que mexem na máquina seguem quatro regras, e são todas obrigatórias:
 *
 * 1. **A guarda é o pid vivo, nunca o arquivo.** Um lock de pid morto é um projeto parado e o botão
 *    sobe; um lock de pid vivo é «já roda em :N» e o botão não faz nada.
 * 2. **O host nasce destacado** (`spawn` com `detached`, sem tty): um filho do host que o subiu
 *    morreria no reinício deste.
 * 3. **A porta é a primeira livre a partir de 4747, e a resposta é a saúde.** Só se devolve o link
 *    quando a porta responde; o que não sobe no prazo é encerrado, e o erro vai para a linha.
 * 4. **Parar mata só o pid do lock daquele projeto** e confere que o lock sumiu: nada de `pkill`,
 *    nada de matar por porta. Um host que esta extensão não subiu pede confirmação no texto.
 *
 * O estado verdadeiro é sempre o lock relido, nunca uma lista em memória: a extensão pode recarregar
 * entre uma ação e outra. Não há poll — a tela lê ao abrir e de novo no botão de atualizar.
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import type { JsonValue } from '@earendil-works/chord'
import { defineExtension } from '@earendil-works/pi-durable'
import {
  argumentosDeInicio,
  comando,
  decisaoDeParada,
  escolherPorta,
  programaDeInicio,
} from './projetos.ts'
import type { Estado, Projeto, ResultadoDaParada, Secao } from './tipos.ts'

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

/** O ambiente do host que se sobe: a identidade deste host não vale para outro projeto. */
function ambiente(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ULTIMATE_HOME: home,
    ULTIMATE_NO_OPEN: '1',
  }
  for (const nome of [
    'ULTIMATE_PORT',
    'ULTIMATE_PROJECT',
    'ULTIMATE_USER_HOME',
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

/** A linha do log do host que se subiu que diz por que ele não subiu, para a linha do projeto. */
async function cauda(home: string): Promise<string> {
  const texto = await readFile(join(home, LOG), 'utf8').catch(() => '')
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

export const actions = {
  /** Os projetos da máquina, cada um com o estado, as medidas e o comando. Sem argumentos. */
  async listar(_args: JsonValue, ctx: Contexto): Promise<Secao> {
    const projetos = await ctx.host.projects()
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
    return { projetos: linhas, at: new Date().toISOString() }
  },

  /**
   * Só este host: quantas conversas dele estão trabalhando agora e quantas perguntas esperam resposta.
   * É o que outro host da máquina pergunta para montar a seção; nunca sai daqui para perguntar a mais
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
   * Sobe o host de um projeto parado, na primeira porta livre, e só devolve a linha quando a porta
   * responde; o que não sobe no prazo é encerrado e o erro vai para a linha. Um host que já roda não é
   * tocado: a linha já diz em que porta ele está.
   */
  async iniciar(args: JsonValue, ctx: Contexto): Promise<Projeto> {
    const name = nomeDoArgumento(args)
    const projeto = await procurar(ctx, name)
    // A guarda é o pid vivo: um lock de pid morto é um projeto parado, e é o `undefined` aqui.
    if (projeto.running) return montar(projeto)
    if (projeto.current) throw new Error(`${name} runs this window`)
    if (!projeto.root) throw new Error(`No path for ${name}`)
    const port = await escolherPorta(portaLivre)
    const child = lancar(
      process.execPath,
      [programaDeInicio(ctx.host.ultimateRoot), ...argumentosDeInicio(projeto.root, port)],
      { cwd: projeto.root, env: ambiente(projeto.home), log: join(projeto.home, LOG) },
    )
    const pid = child.pid
    if (pid === undefined) throw new Error(`Could not start ${name}`)
    let saida: string | undefined
    child.once('error', (erro) => {
      saida = `could not run ${process.execPath}: ${erro.message}`
    })
    child.once('exit', (code, sinal) => {
      saida ??= `the process exited (${sinal ?? `code ${code}`})`
    })
    // Gravado logo depois do spawn: a janela entre um e outro é o único caso em que o host fica sem
    // registo — e o pior que isso custa é um clique de confirmação a mais (ver README).
    await lembrar(projeto.home, pid, port)
    const url = `http://127.0.0.1:${port}`
    const falha = await saude(url, () => saida)
    // O host que atende pode não ser o nosso: um clique anterior, ou outro processo, chegou primeiro.
    const dono = await lerLock(projeto.home)
    const outro = dono && dono.pid !== pid && vivo(dono.pid) ? dono : undefined
    if (falha !== undefined && !outro) {
      await encerrar(pid)
      await esquecer(projeto.home, pid)
      const resto = await cauda(projeto.home)
      throw new Error(`${name} did not answer on :${port} — ${falha}${resto ? `: ${resto}` : ''}`)
    }
    // Não fomos nós que ficamos de pé: o registo deste pid não vale para o host que atende.
    if (dono?.pid !== pid) await esquecer(projeto.home, pid)
    const emPe = outro ?? (dono?.pid === pid ? dono : undefined)
    return montar({
      ...projeto,
      running: { pid: emPe?.pid ?? pid, url: emPe?.port ? `http://127.0.0.1:${emPe.port}` : url },
    })
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
