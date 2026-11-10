/**
 * O que as ações devolvem e o que o rail desenha: nada aqui é estado guardado — a leitura é feita na
 * hora e a tela só mostra o que veio.
 */

/** Um projeto da máquina, como o rail o mostra. */
export interface Projeto {
  name: string
  /** O caminho completo, que vai no popover do tile. */
  root: string
  /** O projeto desta janela. */
  current: boolean
  /** De pé: o pid e a URL que o host publica no lock dele. A URL é o alvo do clique do tile. */
  running?: { pid: number; url: string }
  /**
   * Conversas trabalhando agora. `undefined` quando a medida não foi pedida (`listar` do rail) ou o
   * host está parado, e `null` quando ele está de pé e não respondeu — os casos dizem coisas diferentes.
   */
  working?: number | null
  /** Perguntas do painel sem resposta naquele host, com a mesma regra do `working`. */
  perguntasAbertas?: number | null
  /** Por que não respondeu; vai no popover, não no tile. */
  motivo?: string
  /** `ultimate <caminho>`, o comando que sobe o projeto à mão. Mostrado e copiado, nunca executado. */
  comando?: string
}

/** A lista inteira e quando ela foi lida: o rail mostra a hora no popover do botão de atualizar. */
export interface Secao {
  projetos: Projeto[]
  at: string
  /**
   * A animação do splash como as settings **desta máquina** a deixam: é o que o botão do pé do rail diz
   * e o contrário do que o clique dele pede. Lido na hora, a cada leitura — nunca guardado.
   */
  splash: boolean
}

/** O que a ação `splash` deixou: a animação ligada ou desligada nas settings desta máquina. */
export interface Splash {
  splash: boolean
}

/**
 * O que se mediu num projeto quando o popover dele abriu: as conversas trabalhando, as perguntas sem
 * resposta, a hora da medida, e o motivo quando o host não respondeu — nunca um zero no lugar do
 * silêncio.
 */
export interface Medida {
  working: number | null
  perguntasAbertas: number | null
  motivo?: string
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
 * O que a ação `criar` fez: subiu um host para uma pasta nova (`criado: true`) ou selecionou o projeto
 * que já era aquela pasta — de pé, ou subindo agora —, sem um segundo host para a mesma raiz.
 */
export interface ResultadoDaCriacao {
  criado: boolean
  projeto: Projeto
}

/**
 * O que a ação `parar` fez: parou (e devolve a linha nova), ou ainda pede confirmação porque aquele
 * host não foi esta extensão que subiu.
 */
export type ResultadoDaParada =
  | { parado: true; projeto: Projeto }
  | { parado: false; precisaConfirmar: true; pid: number; url?: string }
