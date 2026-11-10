/**
 * As contas puras da seção “Projetos”: a porta do link, as palavras do estado, o que a linha mede, a
 * porta que se escolhe para subir um host e o que o botão de parar decide. Nada aqui lê a máquina,
 * abre processo ou faz requisição — `projetos.test.ts` cobre tudo com fixtures.
 *
 * A cor nunca é o único sinal: o estado vem escrito (`running`, `stopped`), o que se mediu vem em
 * número, e o ponto colorido é enfeite.
 */
import { join } from 'node:path'
import type { Projeto } from './tipos.ts'

/** A primeira porta que se tenta ao subir um host. */
export const PRIMEIRA_PORTA = 4747

/** Quantas portas se tentam a partir dela: passando disso não é falta de porta, é outra coisa. */
export const TENTATIVAS_DE_PORTA = 100

/** O estado do host, em palavra: o que o ponto colorido também diz. */
export function palavra(projeto: Projeto): 'running' | 'stopped' {
  return projeto.running ? 'running' : 'stopped'
}

/**
 * A porta do link, como a linha a mostra: `:4747`, tirada da URL que o host publica. Uma URL sem
 * porta devolve nada — a linha fica sem o link em vez de inventar um endereço.
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

/** O comando que sobe o projeto à mão, na linha do projeto parado: `ultimate <caminho>`. */
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
