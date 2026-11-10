/**
 * As contas puras do rail “Projetos”: as iniciais do tile, os dois grupos (rodando e parados), o
 * caminho que se digita no diálogo do `+`, o home central que um projeto novo vai ocupar, a porta que
 * só o popover mostra, e o que o botão de parar decide. Nada aqui lê a máquina, abre processo ou faz
 * requisição — `projetos.test.ts` cobre tudo com fixtures.
 *
 * O estado nunca é só a cor: o rail escreve `running`/`stopped` no popover de cada tile, o grupo é a
 * posição (rodando acima da linha, parados abaixo) e o que se mediu vem em número, com a hora.
 */
import { createHash } from 'node:crypto'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { Projeto } from './tipos.ts'

/** A primeira porta que se tenta ao subir um host. */
export const PRIMEIRA_PORTA = 4747

/** Quantas portas se tentam a partir dela: passando disso não é falta de porta, é outra coisa. */
export const TENTATIVAS_DE_PORTA = 100

/** O estado do host, em palavra: o popover diz `running` ou `stopped`, porque num tile de 32px não cabe. */
export function palavra(projeto: Projeto): 'running' | 'stopped' {
  return projeto.running ? 'running' : 'stopped'
}

/**
 * A porta, como o popover a mostra para diagnóstico: `:4747`, tirada da URL que o host publica. Uma
 * URL sem porta devolve nada — o popover fica sem número em vez de inventar um endereço.
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

/** Um número que se pode mostrar: inteiro, finito e não negativo. O resto não é medida. */
export function medido(valor: number | null | undefined): number | undefined {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 ? valor : undefined
}

/**
 * Se há medida para mostrar. **Um zero é medida** — o bug que isto fixa é o de tratar `0` como ausência:
 * `0 working · 0 questions` é uma resposta; `null` (o host está de pé e não respondeu) e `undefined`
 * (o projeto está parado, ninguém perguntou) não são.
 */
export function temMedida(
  working: number | null | undefined,
  abertas: number | null | undefined,
): boolean {
  return medido(working) !== undefined || medido(abertas) !== undefined
}

/** Se o projeto tem host para parar: de pé, e não o desta janela (quem serve a tela não se desliga nela). */
export function podeParar(projeto: Projeto): boolean {
  return projeto.running !== undefined && !projeto.current
}

/**
 * Quantas conversas estão trabalhando agora: `0 working`, `2 working`. Um número que não se mediu não
 * vira zero — vira `count unavailable`.
 */
export function contagem(working: number | null | undefined): string {
  const n = medido(working)
  return n === undefined ? 'count unavailable' : `${n} working`
}

/**
 * As perguntas do painel sem resposta, com o número à frente: `0 questions`, `1 question`. Sem medida,
 * `questions unavailable` — nunca um zero inventado, que é o que faria ignorar o projeto travado.
 */
export function perguntas(abertas: number | null | undefined): string {
  const n = medido(abertas)
  if (n === undefined) return 'questions unavailable'
  return `${n} ${n === 1 ? 'question' : 'questions'}`
}

/**
 * A frase inteira do contador, que fica no `title` da linha: `2 unanswered questions`. Sem medida, a
 * frase diz que não se mediu e por quê.
 */
export function tituloDasPerguntas(abertas: number | null | undefined, motivo?: string): string {
  const n = medido(abertas)
  if (n === undefined) return motivo ? `questions unavailable — ${motivo}` : 'questions unavailable'
  return n === 0 ? 'no unanswered questions' : `${n} unanswered question${n === 1 ? '' : 's'}`
}

/**
 * O alvo do clique de um tile: a URL do host, com a porta, para onde o navegador vai. O número não
 * entra em rótulo nenhum (`iniciais` só tem letras): ele é endereço, não informação da tela.
 */
export function linkDo(projeto: Projeto): string | undefined {
  return projeto.running?.url
}

/**
 * As iniciais do tile, em até duas letras: `app_evangelho` → `AE`, `gta2xlwifi-lineage` → `GL`,
 * `robsoncosta` → `RO`. Duas palavras dão a primeira letra de cada uma; uma só palavra dá as duas
 * primeiras letras. Dois projetos podem coincidir nas iniciais — o popover diz o nome e o caminho.
 */
export function iniciais(name: string): string {
  const partes = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const letras =
    partes.length > 1
      ? partes.slice(0, 2).map((parte) => Array.from(parte)[0])
      : Array.from(partes.join('')).slice(0, 2)
  return letras.join('').toUpperCase()
}

/** O rail dividido pelo que ele mostra: os hosts de pé em cima, os parados embaixo. */
export interface Grupos {
  rodando: Projeto[]
  parados: Projeto[]
}

/**
 * Os dois grupos do rail, na ordem em que ele os desenha: o projeto desta janela primeiro entre os que
 * rodam, o resto por nome — a mesma ordem em cada abertura, para um tile não pular de lugar.
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
 * O caminho que se digitou no diálogo do `+`, em absoluto: `~` vira o home de quem usa, `~/x` vira
 * `<home>/x`, e o resto é resolvido contra o diretório corrente. Vazio ou relativo ao acaso devolve
 * `undefined` — o diálogo pede um caminho em vez de adivinhar uma pasta.
 */
export function caminhoAbsoluto(valor: string, home: string): string | undefined {
  const texto = valor.trim()
  if (!texto) return undefined
  const expandido =
    texto === '~' ? home : texto.startsWith('~/') ? join(home, texto.slice(2)) : texto
  return isAbsolute(expandido) ? resolve(expandido) : undefined
}

/**
 * O home central de um projeto novo, `<home>/.ultimate/projects/<nome>-<8 hex do sha256 do caminho>`.
 * É o mesmo cálculo de `server/project.ts:projectHome`; um projeto novo não se registra à mão — o host
 * que roda naquela pasta nasce com este home, e é por isso que o tile aparece sozinho.
 */
export function homeDoProjeto(root: string, home: string): string {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 8)
  return join(home, '.ultimate', 'projects', `${basename(root)}-${hash}`)
}

/** O comando que sobe o projeto à mão, no popover de qualquer projeto: `ultimate <caminho>`. */
export function comando(root: string | undefined): string | undefined {
  if (!root) return undefined
  return `ultimate ${palavraDeShell(root)}`
}

/** Um caminho que o shell não partiria fica como está; qualquer outro vai entre aspas simples. */
function palavraDeShell(valor: string): string {
  return /^[\w@%+=:,./-]+$/.test(valor) ? valor : `'${valor.replaceAll("'", `'\\''`)}'`
}

/** O `argv` com que esta extensão sobe um host: o projeto, a porta escolhida, e sem abrir janela. */
export function argumentosDeInicio(root: string, port: number): string[] {
  return [root, '--port', String(port), '--no-open']
}

/** O programa que se roda: o `bin/ultimate.ts` do clone que serve esta janela. */
export function programaDeInicio(ultimateRoot: string): string {
  return join(ultimateRoot, 'bin', 'ultimate.ts')
}

/**
 * A primeira porta livre a partir de `primeira`, decidida por quem sabe ouvir (`livre` tenta abrir a
 * porta em loopback). Sem porta livre no intervalo, falha nomeando o intervalo — a linha mostra o erro
 * em vez de um link que não atende.
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

/** O host de um projeto como o lock o descreve: `pid` é o do supervisor, que é quem escreve o lock. */
export type Alvo = { pid: number; url?: string }

/** O que o botão de parar decide fazer. */
export type Parada =
  | { acao: 'nada' }
  | { acao: 'confirmar'; pid: number }
  | { acao: 'parar'; pid: number }

/**
 * O que o botão de parar faz, a partir do lock **relido**: um projeto sem host vivo não tem o que
 * parar; um host que esta extensão subiu (o pid que ela gravou) para direto; o de qualquer outro pede
 * confirmação — matar processo alheio a um clique cego não é o que este botão promete.
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
