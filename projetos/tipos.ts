/**
 * O que as ações devolvem e o que a seção desenha: nada aqui é estado guardado — a leitura é feita na
 * hora e a tela só mostra o que veio.
 */

/** Um projeto da máquina, como a seção o mostra. */
export interface Projeto {
  name: string
  /** O caminho completo, que vai no `title` da linha. */
  root: string
  /** O projeto desta janela. */
  current: boolean
  /** De pé: o pid e a URL que o host publica no lock dele. */
  running?: { pid: number; url: string }
  /**
   * Conversas trabalhando agora. `undefined` quando o host está parado (não há o que medir) e `null`
   * quando ele está de pé e não respondeu — os dois casos dizem coisas diferentes na tela.
   */
  working?: number | null
  /** Perguntas do painel sem resposta naquele host, com a mesma regra do `working`. */
  perguntasAbertas?: number | null
  /** Por que não respondeu; vai no `title` da linha, não na linha. */
  motivo?: string
  /** `ultimate <caminho>`, o comando que sobe o projeto à mão. Mostrado e copiado, nunca executado. */
  comando?: string
}

/** A lista inteira e quando ela foi medida: o botão de atualizar diz a hora no `title`. */
export interface Secao {
  projetos: Projeto[]
  at: string
}

/** O que um host responde de si mesmo, quando outro host da máquina pergunta. */
export interface Estado {
  working: number
  /** Perguntas sem resposta neste host; `null` quando nem isso se mediu. */
  perguntasAbertas: number | null
  at: string
}

/**
 * O que a ação `parar` fez: parou (e devolve a linha nova), ou ainda pede confirmação porque aquele
 * host não foi esta extensão que subiu.
 */
export type ResultadoDaParada =
  | { parado: true; projeto: Projeto }
  | { parado: false; precisaConfirmar: true; pid: number; url?: string }
