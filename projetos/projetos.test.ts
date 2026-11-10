/**
 * As contas puras do rail “Projetos” contra fixtures: nenhum teste aqui lê a máquina, abre processo
 * ou faz requisição — são as funções de `projetos.ts` e o que o rail promete mostrar.
 *
 * O que importa fixar:
 *
 * - o estado vem escrito, não só na cor: `running` e `stopped` são palavras no popover do tile, e o
 *   grupo é a posição no rail;
 * - o tile não mostra porta: o rótulo é só letras (`iniciais`), e a porta vive no href do link;
 * - a contagem e o contador de perguntas vêm de um número medido: sem medida não é `0`, é
 *   `unavailable` — o zero inventado é o pior erro possível, porque faz ignorar o projeto travado;
 * - o host se sobe na primeira porta livre a partir de 4747, sem abrir janela;
 * - o botão de parar só mata o que ele mesmo subiu; o resto pede confirmação, e um lock de pid morto
 *   não é um host (não há nada a parar, e o clique sobe);
 * - o comando copiado é o comando que roda (`ultimate <caminho>`), com aspas quando o caminho pede —
 *   e nunca é executado por esta extensão;
 * - o ponto do tile vem do esquema do app: pulsa quando trabalha, verde ocioso, cinza parado — e um host
 *   que não respondeu não vira ocioso;
 * - o número de perguntas é o do canto do tile (`1`..`9`, `9+`), e zero não desenha nada;
 * - a frase do tile diz estado, contas e a hora da medida: o indicador envelhece, mas não mente;
 * - o botão do splash escreve só a entrada `splash` de `extensions.disable` nas settings do usuário,
 *   preservando as outras chaves, sem duplicar, e recusando o que o core recusaria inteiro;
 * - a pasta do diálogo do `+` vira caminho absoluto com `~` expandido, e um caminho relativo é recusado
 *   em vez de virar alguma pasta ao acaso;
 * - o home de um projeto novo é o mesmo que o Ultimate calcula (`<home>/.ultimate/projects/<nome>-<8>`).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ajustarSplash,
  argumentosDeInicio,
  caminhoAbsoluto,
  comando,
  contagem,
  decisaoDeParada,
  escolherPorta,
  grupos,
  homeDoProjeto,
  iniciais,
  linkDo,
  medido,
  numeroDePerguntas,
  ondaDaLeitura,
  palavra,
  perguntas,
  podeParar,
  portaDo,
  PRIMEIRA_PORTA,
  presenca,
  programaDeInicio,
  rotuloDoSplash,
  settingsDoUsuario,
  splashLigado,
  temMedida,
  tituloDasPerguntas,
  tituloDoTile,
} from './projetos.ts'
import type { Alvo } from './projetos.ts'
import type { Medida, Projeto, Secao } from './tipos.ts'

/** Uma linha como o servidor a manda: de pé, com tantas conversas trabalhando e tantas perguntas. */
const depe = (working: number | null, abertas: number | null = 0): Projeto => ({
  name: 'gta2xlwifi-lineage',
  root: '/projects/gta2xlwifi-lineage',
  current: false,
  running: { pid: 4242, url: 'http://127.0.0.1:4748' },
  working,
  perguntasAbertas: abertas,
  ...(working === null ? { motivo: 'no answer in 3s' } : {}),
})

/** A mesma linha com o host parado: sem `running` e com o comando para copiar. */
const parado: Projeto = {
  name: 'robsoncosta',
  root: '/projects/robsoncosta',
  current: false,
  comando: 'ultimate /projects/robsoncosta',
}

test('o estado vem escrito: a cor nunca é o único sinal', () => {
  assert.equal(palavra(depe(2)), 'running')
  assert.equal(palavra(parado), 'stopped')
  // Sem `running` não há processo: um `working: 0` sozinho não inventa um host de pé.
  assert.equal(palavra({ name: 'x', root: '/x', current: false, working: 0 }), 'stopped')
})

test('a porta do link sai da URL que o host publica', () => {
  assert.equal(portaDo('http://127.0.0.1:4748'), ':4748')
  assert.equal(portaDo('http://ultimate.localhost:4747'), ':4747')
  // Sem porta não há link: a linha fica sem endereço em vez de apontar para o lugar errado.
  assert.equal(portaDo('http://127.0.0.1'), undefined)
  assert.equal(portaDo(undefined), undefined)
  assert.equal(portaDo('não é uma url'), undefined)
})

test('a contagem é um número medido, e o que não se mediu não vira zero', () => {
  assert.equal(contagem(0), '0 working')
  assert.equal(contagem(1), '1 working')
  assert.equal(contagem(7), '7 working')
  // `null` é o host que está de pé e não respondeu; `undefined`, o que está parado.
  assert.equal(contagem(null), 'count unavailable')
  assert.equal(contagem(undefined), 'count unavailable')
  // Um número torto não passa por medida.
  assert.equal(contagem(Number.NaN), 'count unavailable')
  assert.equal(contagem(-1), 'count unavailable')
  assert.equal(contagem(Number.POSITIVE_INFINITY), 'count unavailable')
})

test('o contador de perguntas conta em palavra, e o que não se mediu nunca é zero', () => {
  assert.equal(perguntas(0), '0 questions')
  assert.equal(perguntas(1), '1 question')
  assert.equal(perguntas(2), '2 questions')
  // O silêncio de um host travado não é «nenhuma pergunta»: é falta de medida.
  assert.equal(perguntas(null), 'questions unavailable')
  assert.equal(perguntas(undefined), 'questions unavailable')
  assert.equal(perguntas(Number.NaN), 'questions unavailable')
  assert.equal(perguntas(-2), 'questions unavailable')

  assert.equal(tituloDasPerguntas(0), 'no unanswered questions')
  assert.equal(tituloDasPerguntas(1), '1 unanswered question')
  assert.equal(tituloDasPerguntas(2), '2 unanswered questions')
  assert.equal(tituloDasPerguntas(null, 'no answer in 3s'), 'questions unavailable — no answer in 3s')
  assert.equal(tituloDasPerguntas(undefined), 'questions unavailable')
})

test('medido só aceita inteiro finito e não negativo', () => {
  assert.equal(medido(0), 0)
  assert.equal(medido(3), 3)
  for (const torto of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined])
    assert.equal(medido(torto), undefined)
})

test('um zero é medida: só o silêncio do host e o projeto parado não são', () => {
  // O bug que isto fixa: tratar `0` como ausência e escrever `unavailable` num host que respondeu.
  assert.equal(temMedida(0, 0), true)
  assert.equal(temMedida(0, null), true)
  assert.equal(temMedida(null, 2), true)
  // `null` é o host de pé que não respondeu; `undefined` é o projeto parado, que ninguém perguntou.
  assert.equal(temMedida(null, null), false)
  assert.equal(temMedida(undefined, undefined), false)
  assert.equal(temMedida(Number.NaN, -1), false)
})

test('só um projeto de pé que não é esta janela tem o que parar', () => {
  assert.equal(podeParar(depe(1)), true)
  // Um projeto parado não tem host para deitar: o clique dele sobe.
  assert.equal(podeParar(parado), false)
  // Quem serve a tela em que se clica não se desliga nela.
  assert.equal(podeParar({ ...depe(0), current: true }), false)
})

test('o comando copiado é o comando que roda, com aspas quando o caminho pede', () => {
  assert.equal(comando('/projects/robsoncosta'), 'ultimate /projects/robsoncosta')
  assert.equal(comando('/projects/my project'), `ultimate '/projects/my project'`)
  assert.equal(comando("/projects/it's"), `ultimate '/projects/it'\\''s'`)
  // Um projeto sem `project.json` não tem caminho: a linha diz que não sabe, não chuta um diretório.
  assert.equal(comando(undefined), undefined)
  assert.equal(comando(''), undefined)
})

test('a linha de um projeto parado mostra o comando que se copia, e nenhuma medida', () => {
  assert.equal(palavra(parado), 'stopped')
  assert.equal(parado.working, undefined)
  assert.equal(parado.perguntasAbertas, undefined)
  assert.equal(comando(parado.root), parado.comando)
})

test('o tile mostra iniciais, em duas letras', () => {
  assert.equal(iniciais('app_evangelho'), 'AE')
  assert.equal(iniciais('gta2xlwifi-lineage'), 'GL')
  assert.equal(iniciais('robsoncosta'), 'RO')
  // Espaço, ponto e hífen separam igual: duas palavras dão a primeira letra de cada uma.
  assert.equal(iniciais('my project'), 'MP')
  assert.equal(iniciais('ultra.js'), 'UJ')
  // Uma palavra só dá as duas primeiras letras; uma letra só é uma letra.
  assert.equal(iniciais('worktrees'), 'WO')
  assert.equal(iniciais('x'), 'X')
  // Palavras vazias (só separadores) não viram letra nenhuma.
  assert.equal(iniciais('--'), '')
})

test('o tile não carrega a porta: o rótulo é letra e a porta vive no href', () => {
  const projeto = depe(1)
  // O que se desenha no bloco: nada de número, nada de endereço.
  assert.equal(iniciais(projeto.name), 'GL')
  assert.doesNotMatch(iniciais(projeto.name), /\d/)
  // O que o clique abre: a URL inteira, com a porta.
  assert.equal(linkDo(projeto), 'http://127.0.0.1:4748')
  assert.match(linkDo(projeto) ?? '', /:4748$/)
  // Parado não tem link: o clique é outra ação (subir), não uma viagem a um endereço que não atende.
  assert.equal(linkDo(parado), undefined)
})

test('o rail agrupa: rodando em cima, parados embaixo, o desta janela primeiro', () => {
  const listar = (projetos: Projeto[]) => grupos(projetos)
  const { rodando, parados } = listar([
    { name: 'zulu', root: '/z', current: false, running: { pid: 1, url: 'http://127.0.0.1:4750' } },
    parado,
    { name: 'alfa', root: '/a', current: false, running: { pid: 2, url: 'http://127.0.0.1:4749' } },
    { name: 'esta-janela', root: '/e', current: true, running: { pid: 3, url: 'http://127.0.0.1:4747' } },
    { name: 'beta', root: '/b', current: false },
  ])
  // O projeto desta janela abre a coluna; o resto dos que rodam vem por nome.
  assert.deepEqual(
    rodando.map((projeto) => projeto.name),
    ['esta-janela', 'alfa', 'zulu'],
  )
  assert.deepEqual(
    parados.map((projeto) => projeto.name),
    ['beta', 'robsoncosta'],
  )
  // Um projeto que só tem medida não está de pé: sem `running` ele é parado, e o clique sobe o host.
  const soMedida = listar([{ name: 'medido', root: '/m', current: false, working: 0 }])
  assert.deepEqual(soMedida.rodando, [])
  assert.deepEqual(
    soMedida.parados.map((projeto) => projeto.name),
    ['medido'],
  )
  // Sem projeto nenhum os dois grupos são vazios, e o rail ainda tem o `+`.
  assert.deepEqual(listar([]), { rodando: [], parados: [] })
})

test('o caminho do diálogo expande ~ e recusa o que não é absoluto', () => {
  const home = '/home/juliano'
  assert.equal(caminhoAbsoluto('~/src/novo', home), '/home/juliano/src/novo')
  assert.equal(caminhoAbsoluto('/srv/app', home), '/srv/app')
  assert.equal(caminhoAbsoluto('~', home), '/home/juliano')
  // Espaço em volta é do usuário, não do caminho.
  assert.equal(caminhoAbsoluto('  ~/src/novo  ', home), '/home/juliano/src/novo')
  // `.` e `..` resolvem: o caminho que se sobe é o que o diálogo mostra.
  assert.equal(caminhoAbsoluto('~/src/../outro', home), '/home/juliano/outro')
  // Vazio e relativo não são caminho: o diálogo pede um em vez de adivinhar uma pasta.
  assert.equal(caminhoAbsoluto('', home), undefined)
  assert.equal(caminhoAbsoluto('   ', home), undefined)
  assert.equal(caminhoAbsoluto('src/novo', home), undefined)
  assert.equal(caminhoAbsoluto('./novo', home), undefined)
  // `~outro` não é o home de quem digita: nada de expandir o nome de outra pessoa.
  assert.equal(caminhoAbsoluto('~outro/src', home), undefined)
})

test('o home de um projeto novo é <home>/.ultimate/projects/<nome>-<8 hex>', () => {
  assert.equal(
    homeDoProjeto('/home/juliano/src/novo', '/home/juliano'),
    '/home/juliano/.ultimate/projects/novo-3f75ea87',
  )
  // Mesma pasta, mesmo home: é o cálculo que faz o tile aparecer sozinho depois de subir.
  assert.equal(
    homeDoProjeto('/home/juliano/src/novo', '/home/juliano'),
    homeDoProjeto('/home/juliano/src/novo', '/home/juliano'),
  )
  // Pastas diferentes com o mesmo nome não colidem: o hash é da raiz.
  assert.notEqual(
    homeDoProjeto('/a/novo', '/home/juliano'),
    homeDoProjeto('/b/novo', '/home/juliano'),
  )
  // O home do usuário entra inteiro, inclusive quando é um home de testes.
  assert.match(homeDoProjeto('/a/novo', '/tmp/h'), /^\/tmp\/h\/\.ultimate\/projects\/novo-[0-9a-f]{8}$/)
})

test('o host se sobe no projeto, na porta escolhida e sem abrir janela', () => {
  assert.deepEqual(argumentosDeInicio('/projects/robsoncosta', 4748), [
    '/projects/robsoncosta',
    '--port',
    '4748',
    '--no-open',
  ])
  assert.equal(programaDeInicio('/opt/ultimate'), '/opt/ultimate/bin/ultimate.ts')
})

test('a porta é a primeira livre a partir de 4747', async () => {
  const visto: number[] = []
  const livre = async (port: number) => {
    visto.push(port)
    // 4747 e 4748 ocupadas; a primeira livre é 4749.
    return port >= 4749
  }
  assert.equal(await escolherPorta(livre), 4749)
  assert.deepEqual(visto, [4747, 4748, 4749])
  assert.equal(PRIMEIRA_PORTA, 4747)

  // Sem porta nenhuma livre no intervalo, falha nomeando o intervalo em vez de inventar uma.
  await assert.rejects(
    () => escolherPorta(() => false, 4747, 3),
    /No free port from 4747 \(3 tried\)/,
  )
  // O intervalo começa onde se pediu: a mesma sonda devolve outra porta.
  assert.equal(await escolherPorta((port) => port === 4800, 4800, 1), 4800)
})

test('o botão de parar mata só o que ele subiu; o resto pede confirmação', () => {
  const alvo: Alvo = { pid: 48362, url: 'http://127.0.0.1:4748' }
  // O pid que a extensão gravou é o do lock: é o host dela, e para direto.
  assert.deepEqual(decisaoDeParada(alvo, 48362, false), { acao: 'parar', pid: 48362 })
  // Outro pid vivo (nascido num terminal, no supervisor, por outra pessoa): pede confirmação, e o
  // clique seguinte, que já leu a pergunta, é quem manda parar.
  assert.deepEqual(decisaoDeParada(alvo, undefined, false), { acao: 'confirmar', pid: 48362 })
  assert.deepEqual(decisaoDeParada(alvo, 111, false), { acao: 'confirmar', pid: 48362 })
  assert.deepEqual(decisaoDeParada(alvo, undefined, true), { acao: 'parar', pid: 48362 })
})

test('um lock de pid morto não é host: não há o que parar, e a linha diz parado', () => {
  // `host.projects()` só publica `running` quando o pid do lock está vivo: um lock de pid morto chega
  // aqui como `undefined`, e é isso que faz o botão poder subir o projeto.
  assert.deepEqual(decisaoDeParada(undefined, undefined, false), { acao: 'nada' })
  assert.deepEqual(decisaoDeParada(undefined, 48362, true), { acao: 'nada' })
  // O lock morto continua no disco, mas a linha — e o botão — leem só o pid vivo.
  assert.equal(palavra({ name: 'gta2xlwifi-lineage', root: '/x', current: false }), 'stopped')
})

/** Uma medida da onda do rail, com a hora em que foi feita. */
const medida = (
  working: number | null,
  abertas: number | null,
  extra: { motivo?: string; at?: string } = {},
): Medida => ({
  working,
  perguntasAbertas: abertas,
  ...(extra.motivo ? { motivo: extra.motivo } : {}),
  at: extra.at ?? '2026-11-10T03:22:43.079Z',
})

test('o ponto do tile: pulsa trabalhando, verde ocioso, cinza parado, vazado sem resposta', () => {
  // Trabalhando: é a classe do mark do app (`animate-pulse-dot bg-brand`), não uma cor inventada aqui.
  assert.equal(presenca(depe(2), medida(2, 0)), 'working')
  // Zero é medida: nada trabalhando é ocioso de verdade.
  assert.equal(presenca(depe(0), medida(0, 0)), 'idle')
  // Parado não tem o que medir — e uma medida sobrando não inventa um host de pé.
  assert.equal(presenca(parado, medida(3, 1)), 'stopped')
  assert.equal(presenca(parado, undefined), 'stopped')
  // De pé e sem leitura ainda (a onda não voltou): não se afirma nada.
  assert.equal(presenca(depe(1), undefined), 'unavailable')
  // O host de pé que não respondeu **não é ocioso**: é `unavailable`, com o motivo à mão.
  assert.equal(presenca(depe(null), medida(null, null, { motivo: 'no answer in 3s' })), 'unavailable')
  // Trabalha mesmo com pergunta aberta: as duas coisas cabem no tile (pulso e o número em âmbar).
  assert.equal(presenca(depe(1), medida(1, 2)), 'working')
  // Um número torto não vira trabalho.
  assert.equal(presenca(depe(Number.NaN), medida(Number.NaN, 0)), 'idle')
})

test('o número de perguntas cabe no canto do tile: 1..9, 9+ acima, e nada em zero', () => {
  assert.equal(numeroDePerguntas(1), '1')
  assert.equal(numeroDePerguntas(9), '9')
  // Acima de nove não cabe no canto: o número vira um aviso, não um dado exato.
  assert.equal(numeroDePerguntas(10), '9+')
  assert.equal(numeroDePerguntas(42), '9+')
  // Zero não desenha contador nenhum, e o que não se mediu também não vira número.
  assert.equal(numeroDePerguntas(0), undefined)
  assert.equal(numeroDePerguntas(null), undefined)
  assert.equal(numeroDePerguntas(undefined), undefined)
  assert.equal(numeroDePerguntas(Number.NaN), undefined)
  assert.equal(numeroDePerguntas(-1), undefined)
})

test('a frase do tile diz estado, contas e a hora da medida', () => {
  // Parado: a frase de sempre, porque não há leitura nenhuma para citar.
  assert.equal(tituloDoTile(parado, undefined, undefined), 'robsoncosta — stopped, click to start it')
  // De pé: o estado, as contas como o painel as escreve, e **de quando** é a medida.
  assert.equal(
    tituloDoTile(depe(2), medida(2, 1), '21:53'),
    'gta2xlwifi-lineage — running · 2 working · 1 unanswered question · measured at 21:53 — open it in this tab',
  )
  assert.equal(
    tituloDoTile(depe(0), medida(0, 0), '21:53'),
    'gta2xlwifi-lineage — running · 0 working · no unanswered questions · measured at 21:53 — open it in this tab',
  )
  // A onda ainda não voltou: o tile diz que não mediu, em vez de fingir um ocioso.
  assert.equal(
    tituloDoTile(depe(0), undefined, undefined),
    'gta2xlwifi-lineage — running · not measured yet — open it in this tab',
  )
  // Sem resposta: `counts unavailable` com o motivo, e nunca um zero.
  assert.equal(
    tituloDoTile(depe(null), medida(null, null, { motivo: 'no answer in 3s' }), '21:53'),
    'gta2xlwifi-lineage — running · counts unavailable — no answer in 3s · measured at 21:53 — open it in this tab',
  )
  // O projeto desta janela: a frase termina dizendo que ele é esta janela.
  assert.equal(
    tituloDoTile({ ...depe(0), current: true }, medida(0, 0), '21:53'),
    'gta2xlwifi-lineage — running · 0 working · no unanswered questions · measured at 21:53 — this window',
  )
})

test('a onda guarda uma medida por projeto de pé, com a hora da leitura', () => {
  const secao: Secao = {
    at: '2026-11-10T03:22:43.079Z',
    splash: true,
    projetos: [
      depe(2, 1),
      { name: 'travado', root: '/t', current: false, running: { pid: 7, url: 'http://127.0.0.1:4751' }, working: null, perguntasAbertas: null, motivo: 'no answer in 3s' },
      parado,
      // Um projeto de pé que só tem a contagem de perguntas medida não perde a entrada.
      { name: 'soPerguntas', root: '/s', current: false, running: { pid: 8, url: 'http://127.0.0.1:4752' }, perguntasAbertas: 3 },
    ],
  }
  const medidas = ondaDaLeitura(secao)
  assert.deepEqual(Object.keys(medidas).sort(), ['gta2xlwifi-lineage', 'soPerguntas', 'travado'])
  // A hora é a da leitura, não a de agora: o tile mostra de quando é o indicador.
  assert.equal(medidas['gta2xlwifi-lineage'].at, secao.at)
  assert.equal(medidas['gta2xlwifi-lineage'].working, 2)
  assert.equal(medidas['gta2xlwifi-lineage'].perguntasAbertas, 1)
  // O silêncio de um host travado chega como `null` com o motivo, não como zero.
  assert.deepEqual(medidas['travado'], {
    working: null,
    perguntasAbertas: null,
    motivo: 'no answer in 3s',
    at: secao.at,
  })
  // Um zero medido continua zero (e não `null`): é uma resposta, não uma ausência.
  assert.deepEqual(ondaDaLeitura({ at: secao.at, splash: true, projetos: [depe(0, 0)] }), {
    'gta2xlwifi-lineage': { working: 0, perguntasAbertas: 0, at: secao.at },
  })
  // Nenhum projeto de pé: nenhuma medida, e nada de entrada inventada.
  assert.deepEqual(ondaDaLeitura({ at: secao.at, splash: true, projetos: [parado] }), {})
})

test('o splash está desligado quando a lista disable o nomeia', () => {
  assert.equal(splashLigado({ extensions: { disable: ['splash'] } }), false)
  assert.equal(splashLigado({ extensions: { disable: ['splash', 'rate-limiter'] } }), false)
  // O arquivo ausente, sem a chave, ou com outra coisa na lista: nada desligou o splash.
  assert.equal(splashLigado(undefined), true)
  assert.equal(splashLigado({}), true)
  assert.equal(splashLigado({ extensions: {} }), true)
  assert.equal(splashLigado({ extensions: { disable: ['rate-limiter'] } }), true)
  // O que o core ignora inteiro (JSON torto, `extensions` que não é objeto) é lido como ligado.
  assert.equal(splashLigado([]), true)
  assert.equal(splashLigado({ extensions: [] }), true)
  assert.equal(splashLigado({ extensions: 'splash' }), true)
  assert.equal(splashLigado({ extensions: { disable: 'splash' } }), true)
})

test('desligar o splash põe splash em disable uma vez, e ligar tira', () => {
  // Desligar um arquivo que ainda não fala de splash: a entrada nasce uma vez só.
  assert.deepEqual(ajustarSplash({}, false), { extensions: { disable: ['splash'] } })
  // Ligar tira o nome da lista — e as outras entradas ficam onde estavam.
  assert.deepEqual(ajustarSplash({ extensions: { disable: ['rate-limiter', 'splash'] } }, true), {
    extensions: { disable: ['rate-limiter'] },
  })
  // Nada de duplicar: desligar o que já está desligado não mexe no objeto (nem no arquivo).
  const desligado = { extensions: { disable: ['splash'] } }
  assert.equal(ajustarSplash(desligado, false), desligado)
  // E ligar o que já está ligado também não reescreve nada.
  const ligado = { modelFamilies: { fast: { model: 'cirthan-dev/x' } } }
  assert.equal(ajustarSplash(ligado, true), ligado)
  // As outras chaves do arquivo são o que o usuário escreveu: ficam todas, em qualquer nível.
  const cheio = {
    modelFamilies: { default: 'fast' },
    lander: { checks: [['node --test', { timeout: 120 }]] },
    extensions: { enable: ['parallel'], disable: ['rate-limiter'], orphans: 'não é meu' },
  }
  assert.deepEqual(ajustarSplash(cheio, false), {
    ...cheio,
    extensions: { ...cheio.extensions, disable: ['rate-limiter', 'splash'] },
  })
  // `extensions.enable` nunca é tocado: `disable` vence `enable` na mesma camada, então desligar
  // funciona mesmo com o splash lá — e ligar não tira nada dele.
  assert.deepEqual(ajustarSplash({ extensions: { enable: ['splash'] } }, false), {
    extensions: { enable: ['splash'], disable: ['splash'] },
  })
  assert.deepEqual(ajustarSplash({ extensions: { enable: ['splash'], disable: ['splash'] } }, true), {
    extensions: { enable: ['splash'], disable: [] },
  })
})

test('o splash recusa, sem escrever, o que o core recusaria inteiro', () => {
  // Um `extensions` que não é objeto faria o core jogar o arquivo todo fora — e o usuário perderia as
  // outras chaves. Recusar é a única saída honesta.
  for (const torto of [[], 'splash', null, 3]) {
    assert.throws(
      () => ajustarSplash({ extensions: torto }, false),
      /extensions must be a JSON object/,
    )
  }
  // Uma lista que não é lista de nomes também não se reescreve.
  assert.throws(() => ajustarSplash({ extensions: { disable: 'splash' } }, false), /array of names/)
  assert.throws(() => ajustarSplash({ extensions: { disable: [1] } }, true), /array of names/)
  assert.throws(() => ajustarSplash({ extensions: { disable: {} } }, true), /array of names/)
  // O arquivo que não é um objeto não é settings nenhum.
  for (const torto of [[], 'x', null, undefined, 7]) {
    assert.throws(() => ajustarSplash(torto, false), /settings must be a JSON object/)
  }
  assert.equal(settingsDoUsuario('/home/juliano'), '/home/juliano/.ultimate/settings.json')
})

test('a frase do botão do splash diz o estado e o que o clique faz', () => {
  assert.equal(rotuloDoSplash(true), 'Splash on project switch: on — turn it off')
  assert.equal(rotuloDoSplash(false), 'Splash on project switch: off — turn it on')
  // Antes da primeira leitura o botão não chuta um estado.
  assert.equal(rotuloDoSplash(undefined), 'Splash on project switch: unknown')
})
