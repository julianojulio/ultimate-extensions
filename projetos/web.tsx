/**
 * O rail “Projetos” na borda esquerda da janela: uma coluna de 48px, presente em todas as superfícies,
 * com um tile por projeto — os hosts de pé em cima, uma linha fina, os parados embaixo (mais apagados)
 * e o `+` no pé.
 *
 * O bloco inteiro é o alvo do clique, e o número da porta não aparece nele: um projeto de pé abre
 * naquele projeto nesta mesma aba (é um trocador, não um espiador; ⌘/Ctrl+clique abre em aba nova, como
 * qualquer link), um projeto parado sobe, e o projeto desta janela não tem ação nenhuma — só o
 * `text-brand`. A porta continua ali, mas como **endereço** do link: `:porta` só se lê no painel do
 * tile, junto com o estado escrito e as medidas.
 *
 * O painel abre no hover e no foco, e é ele que diz o que o tile não cabe: `running` / `stopped`, a
 * porta, o caminho, e `1 working · 1 question` **medido quando o painel abre**, com a hora. Parar e
 * copiar o comando moram nele — fora do link, porque um `<button>` dentro de um `<a>` é HTML inválido.
 * Um projeto parado não mostra medida; um host que não responde mostra `unavailable` com o motivo,
 * nunca `0`.
 *
 * O `+` abre o diálogo de um projeto novo: um caminho (`~/src/novo`), validado e subido como o `iniciar`
 * sobe — primeira porta livre, destacado, sem janela, saúde em 20 s. A partir daí o projeto é dele: a
 * primeira execução, o onboarding e a decisão de confiança daquela pasta acontecem na janela dele.
 *
 * No celular não há rail (não há largura para um): a lista compacta da sidebar — a de antes, com as
 * medidas e os botões de subir e parar — continua sendo o trocador de projeto, e no desktop ela deixa
 * de existir para não haver dois.
 *
 * Sem poll: o rail lê ao abrir, as ações releem ao terminar, e o botão de atualizar é a outra leitura.
 */
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  LoaderCircleIcon,
  PlayIcon,
  PlusIcon,
  RotateCwIcon,
  SquareIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  actionRef,
  api,
  cn,
  defineWebExtension,
  errorMessage,
  formatTime,
  useAction,
  useCopy,
  useViewport,
} from '@/sdk'
import {
  contagem,
  grupos,
  iniciais,
  linkDo,
  medido,
  numeroDePerguntas,
  ondaDaLeitura,
  palavra,
  perguntas,
  podeParar,
  portaDo,
  presenca,
  rotuloDoSplash,
  temMedida,
  tituloDasPerguntas,
  tituloDoTile,
} from './projetos.ts'
import type { Presenca } from './projetos.ts'
import type {
  Medida,
  Projeto,
  ResultadoDaCriacao,
  ResultadoDaParada,
  Secao,
  Splash,
} from './tipos.ts'

/** `{ medir?: false }` → os projetos da máquina. O rail pede a leitura barata: nenhum tile mostra número. */
const SecaoAction = actionRef<{ medir?: boolean }, Secao>('projetos', 'listar')

/** `{ name }` → o que se mediu naquele host agora, com a hora. O painel do tile pede quando abre. */
const MedirAction = actionRef<{ name: string }, Medida>('projetos', 'medir')

/** `{ name }` → sobe o host daquele projeto e só volta quando a porta responde. */
const IniciarAction = actionRef<{ name: string }, Projeto>('projetos', 'iniciar')

/** `{ name, confirm? }` → deita o host daquele projeto, ou diz que ele pede confirmação. */
const PararAction = actionRef<{ name: string; confirm?: boolean }, ResultadoDaParada>(
  'projetos',
  'parar',
)

/** `{ caminho }` → sobe o host de uma pasta (ou seleciona o projeto que já é aquela pasta). */
const CriarAction = actionRef<{ caminho: string }, ResultadoDaCriacao>('projetos', 'criar')

/** `{ enabled }` → liga ou desliga a animação do splash nas settings desta máquina. */
const SplashAction = actionRef<{ enabled: boolean }, Splash>('projetos', 'splash')

/** De quanto em quanto tempo passar o ponteiro no rail pode refazer a leitura de quem está de pé. */
const INTERVALO_DA_ONDA = 15_000

export default defineWebExtension({
  slots: {
    // A coluna na borda esquerda: existe em toda superfície, e no celular se cala.
    'shell.rail': Rail,
    // A lista de antes, que no celular continua sendo o trocador de projeto.
    sidebar: { component: Lista, order: -10 },
  },
})

/** O rail — menos no celular, onde não há largura para ele e a lista da sidebar é o trocador. */
function Rail() {
  const viewport = useViewport()
  if (viewport === 'phone') return null
  return <Coluna />
}

/** A lista compacta — só no celular: no desktop e no tablet quem troca de projeto é o rail, um só. */
function Lista() {
  const viewport = useViewport()
  if (viewport !== 'phone') return null
  return <Secao />
}

/**
 * A coluna: os rodando, a linha fina, os parados, e no pé o ⟳, o `+` e o botão da animação do splash. O
 * tile é uma peça só — o link (ou o botão de subir), o ponto de presença e o painel dele —, então abrir o
 * painel é abrir um `<div>` de 32px que já estava ali.
 */
function Coluna() {
  const { data, error, loading, refetch } = useAction(SecaoAction, { medir: false })
  const [novo, setNovo] = useState(false)
  // A onda: o que cada host de pé está fazendo, por projeto, com a hora de cada medida. Ela é refeita ao
  // montar, ao entrar no rail (no máximo a cada 15 s), no ⟳ e depois de cada ação — e nunca por um timer:
  // o indicador diz de quando é, e uma leitura nova corrige.
  const [medidas, setMedidas] = useState<Record<string, Medida>>({})
  const [medindo, setMedindo] = useState(false)
  const ultima = useRef(0)

  const lerOnda = useCallback(async (forcar = false) => {
    if (!forcar && Date.now() - ultima.current < INTERVALO_DA_ONDA) return
    ultima.current = Date.now()
    setMedindo(true)
    try {
      // A leitura completa: o `estado` de cada host de pé, em paralelo, com o prazo que já existe.
      setMedidas(ondaDaLeitura(await api.action(SecaoAction, {})))
    } catch {
      // O rail continua com o que já sabia — e o `title` de cada tile diz de quando é.
    } finally {
      setMedindo(false)
    }
  }, [])

  useEffect(() => {
    void lerOnda()
  }, [lerOnda])

  // A medida que o painel de um tile fez vale para aquele tile no rail também, sem outra leitura.
  const guardarMedida = useCallback((name: string, medida: Medida) => {
    setMedidas((antes) => ({ ...antes, [name]: medida }))
  }, [])

  // O ⟳ e cada clique que muda a máquina releem a lista e medem todo mundo de novo.
  const atualizar = () => refetch().then(() => lerOnda(true))
  const { rodando, parados } = grupos(data?.projetos ?? [])
  return (
    <nav
      aria-label="Projects"
      className="flex h-full w-12 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-2"
      data-projects-rail
      onPointerEnter={() => void lerOnda()}
    >
      <div className="flex w-full min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {error ? (
          <button
            aria-label="The projects could not be read. Measure again"
            className="flex size-8 items-center justify-center rounded-md border border-error/40 font-mono text-[11px] text-error outline-none hover:bg-error/10 focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => void atualizar()}
            title={error.message}
            type="button"
          >
            !
          </button>
        ) : (
          <>
            {rodando.map((projeto) => (
              <Tile
                key={projeto.root}
                medida={medidas[projeto.name]}
                onChanged={atualizar}
                onMedida={guardarMedida}
                projeto={projeto}
              />
            ))}
            {rodando.length > 0 && parados.length > 0 && (
              <span aria-hidden="true" className="my-1.5 h-px w-6 shrink-0 bg-foreground/20" />
            )}
            {parados.map((projeto) => (
              <Tile
                key={projeto.root}
                medida={medidas[projeto.name]}
                onChanged={atualizar}
                onMedida={guardarMedida}
                projeto={projeto}
              />
            ))}
          </>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
        <Icone
          className={cn('size-6', (loading || medindo) && 'pointer-events-none')}
          label="Measure the projects again"
          onClick={() => void atualizar()}
          title={
            data ? `Measured at ${formatTime(data.at)} · measure again` : 'Measure again'
          }
        >
          <RotateCwIcon className={cn('size-3', (loading || medindo) && 'animate-spin')} />
        </Icone>
        <Icone
          className="size-6"
          label="New project"
          onClick={() => setNovo(true)}
          title="New project"
        >
          <PlusIcon className="size-3.5" />
        </Icone>
        <BotaDoSplash onChanged={atualizar} splash={data?.splash} />
      </div>
      <NovoProjeto onChanged={atualizar} onOpenChange={setNovo} open={novo} />
    </nav>
  )
}

/**
 * O botão da animação do splash, no pé do rail: o ícone diz o estado (interruptor à direita = ligado) e o
 * clique faz o contrário, que é reversível e por isso não pergunta nada. O estado vem da leitura da coluna
 * (`listar`), nunca de uma variável daqui: a extensão recarrega a quente, e o arquivo pode ter mudado por
 * fora. Uma recusa — JSON inválido, arquivo sem permissão — vira `!` com o motivo no `title`, porque
 * quando ela recusa ela **não escreve nada**.
 */
function BotaDoSplash({
  splash,
  onChanged,
}: {
  splash: boolean | undefined
  onChanged: () => Promise<unknown>
}) {
  const [pendente, setPendente] = useState(false)
  const [erro, setErro] = useState<string>()
  const alternar = async () => {
    if (pendente || splash === undefined) return
    setErro(undefined)
    setPendente(true)
    try {
      await api.action(SplashAction, { enabled: !splash })
      await onChanged()
    } catch (causa) {
      setErro(errorMessage(causa))
    } finally {
      setPendente(false)
    }
  }
  const rotulo = rotuloDoSplash(splash)
  if (erro)
    return (
      <Icone
        className="size-6"
        label={`${rotulo} (${erro})`}
        onClick={() => void alternar()}
        title={`${erro} — click to try again`}
      >
        <span className="font-mono text-[11px] text-error">!</span>
      </Icone>
    )
  return (
    <Icone
      className="size-6"
      disabled={splash === undefined || pendente}
      label={rotulo}
      onClick={() => void alternar()}
      title={rotulo}
    >
      {pendente ? (
        <LoaderCircleIcon className="size-3 animate-spin" />
      ) : splash ? (
        <ToggleRightIcon className="size-4" />
      ) : (
        <ToggleLeftIcon className="size-4" />
      )}
    </Icone>
  )
}

/**
 * Um projeto no rail: 32px de iniciais, com o ponto de presença no canto e o número de perguntas quando há
 * alguma. De pé e fora desta janela é um link para o host; parado é um botão que o sobe; o desta janela é
 * um botão que só abre o painel. O painel abre no hover e no foco e é `fixed`: assim ele não é recortado
 * quando a coluna rola, e continua filho do tile na ordem do DOM, que é o que deixa o teclado chegar aos
 * botões dele.
 */
function Tile({
  projeto,
  medida,
  onChanged,
  onMedida,
}: {
  projeto: Projeto
  /** A última medida da onda do rail, ou a que o painel deste tile fez (a do painel vence). */
  medida?: Medida
  onChanged: () => Promise<unknown>
  onMedida: (name: string, medida: Medida) => void
}) {
  const { copied, copy } = useCopy()
  const [aberto, setAberto] = useState(false)
  const [ancora, setAncora] = useState<CSSProperties>()
  const [pendente, setPendente] = useState<'start' | 'stop'>()
  const [confirmar, setConfirmar] = useState<{ pid: number; url?: string }>()
  const [erro, setErro] = useState<string>()
  const [medindo, setMedindo] = useState(false)
  const quadro = useRef<HTMLDivElement>(null)
  // Fechar espera um instante: o ponteiro que atravessa o vão até o painel não o fecha no caminho.
  const saida = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(saida.current), [])
  const depe = projeto.running !== undefined
  const porta = portaDo(projeto.running?.url)
  const link = linkDo(projeto)
  const estado =
    pendente === 'start' ? 'starting' : pendente === 'stop' ? 'stopping' : palavra(projeto)
  const ponto = presenca(projeto, medida)
  const perguntasAbertas = numeroDePerguntas(medida?.perguntasAbertas)
  const hora = medida ? formatTime(medida.at) : undefined
  const tituloDoBotao = tituloDoTile(projeto, medida, hora)

  // O que se disse de um estado não vale para o outro: uma ação nova apaga o aviso e a pergunta.
  useEffect(() => {
    setErro(undefined)
    setConfirmar(undefined)
  }, [depe])

  // A medida é do instante em que o painel abre — e o painel diz a hora dela. Fechado, não se mede
  // nada: o tile fica com a medida da onda do rail, que é de quando ela foi feita.
  useEffect(() => {
    if (!aberto || !depe) return undefined
    let vivo = true
    setMedindo(true)
    api
      .action(MedirAction, { name: projeto.name })
      .then((resultado) => {
        if (vivo) onMedida(projeto.name, resultado)
      })
      .catch((causa: unknown) => {
        // O painel não inventa um número: o que falhou vira `unavailable` com o motivo.
        if (vivo)
          onMedida(projeto.name, {
            working: null,
            perguntasAbertas: null,
            motivo: errorMessage(causa),
            at: new Date().toISOString(),
          })
      })
      .finally(() => {
        if (vivo) setMedindo(false)
      })
    return () => {
      vivo = false
    }
  }, [aberto, depe, projeto.name, onMedida])

  /** Abre o painel ao lado do tile: à direita, e para cima quando o tile está na metade de baixo. */
  const abrir = () => {
    const caixa = quadro.current?.getBoundingClientRect()
    if (caixa)
      setAncora({
        left: caixa.right + 8,
        ...(caixa.top > window.innerHeight / 2
          ? { bottom: window.innerHeight - caixa.bottom }
          : { top: caixa.top }),
      })
    setAberto(true)
  }

  /** O ponteiro ou o foco entrou: o painel abre (se já estava aberto, o fechamento pendente é cancelado). */
  const entrar = () => {
    clearTimeout(saida.current)
    if (!aberto) abrir()
  }

  /** Saiu do tile e do painel: fecha em 150 ms, para atravessar o vão não contar como saída. */
  const sair = () => {
    clearTimeout(saida.current)
    saida.current = setTimeout(fechar, 150)
  }

  const fechar = () => {
    clearTimeout(saida.current)
    setAberto(false)
    setConfirmar(undefined)
  }

  // `Esc` fecha o painel mesmo quando ele abriu só com o ponteiro (sem foco dentro do tile), que é o
  // caso em que nenhum `onKeyDown` do tile chegaria. Não se impede nada: quem também escuta `Esc`
  // segue ouvindo.
  useEffect(() => {
    if (!aberto) return undefined
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') fechar()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aberto])

  const iniciar = async (evento: { preventDefault: () => void }) => {
    evento.preventDefault()
    fechar()
    setPendente('start')
    try {
      await api.action(IniciarAction, { name: projeto.name })
      await onChanged()
    } catch (causa) {
      setErro(errorMessage(causa))
      setPendente(undefined)
    } finally {
      setPendente(undefined)
    }
  }

  const parar = async (confirm = false) => {
    setErro(undefined)
    setPendente('stop')
    try {
      const resultado = await api.action(PararAction, {
        name: projeto.name,
        ...(confirm ? { confirm: true } : {}),
      })
      if (resultado.parado) {
        setConfirmar(undefined)
        await onChanged()
      } else
        setConfirmar({
          pid: resultado.pid,
          ...(resultado.url ? { url: resultado.url } : {}),
        })
    } catch (causa) {
      setErro(errorMessage(causa))
    } finally {
      setPendente(undefined)
    }
  }

  const letras = iniciais(projeto.name)
  const aparencia = cn(
    'relative flex size-8 items-center justify-center rounded-md border font-mono text-[10.5px] font-medium uppercase tabular-nums outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring',
    projeto.current
      ? 'border-brand/40 bg-brand/10 text-brand'
      : depe
        ? 'border-transparent bg-accent/70 text-foreground/85 hover:bg-accent'
        : 'border-transparent text-muted-foreground/60 hover:bg-accent/40 hover:text-muted-foreground',
    // Uma ação que falhou deixa a marca no tile (o texto inteiro está no `title` e no painel): o
    // clique que não deu certo não pode sumir em silêncio.
    erro && 'ring-1 ring-error/60',
  )
  // O `title` e o `aria-label` dizem a frase inteira — estado, contas e a hora da medida. O erro de uma
  // ação vence a frase: o clique que falhou não pode sumir.
  const titulo = erro ?? tituloDoBotao
  const conteudo = pendente === 'start' ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : letras

  return (
    <div
      className="relative flex w-full shrink-0 justify-center"
      data-project={projeto.name}
      data-status={depe ? 'running' : 'stopped'}
      onBlur={(evento) => {
        if (!evento.currentTarget.contains(evento.relatedTarget)) sair()
      }}
      onFocus={entrar}
      onPointerEnter={entrar}
      onPointerLeave={sair}
      ref={quadro}
    >
      {projeto.current ? (
        <button
          aria-current="page"
          aria-label={titulo}
          className={aparencia}
          onClick={abrir}
          title={titulo}
          type="button"
        >
          {conteudo}
          <Sinais perguntas={perguntasAbertas} ponto={ponto} />
        </button>
      ) : depe && link ? (
        <a aria-label={titulo} className={aparencia} href={link} title={titulo}>
          {conteudo}
          <Sinais perguntas={perguntasAbertas} ponto={ponto} />
        </a>
      ) : (
        <button
          aria-busy={pendente === 'start' || undefined}
          aria-label={titulo}
          className={aparencia}
          disabled={pendente === 'start'}
          onClick={(evento) => void iniciar(evento)}
          title={titulo}
          type="button"
        >
          {conteudo}
          <Sinais perguntas={perguntasAbertas} ponto={ponto} />
        </button>
      )}
      {aberto && ancora && (
        <div
          className="fixed z-50 w-60 rounded-md border bg-popover p-3 text-popover-foreground shadow-md before:absolute before:inset-y-0 before:-left-2 before:w-2 before:content-['']"
          data-project-panel={projeto.name}
          style={ancora}
        >
          <div className="flex flex-col gap-2 text-[11px]">
            <div className="flex flex-col gap-0.5">
              <span className="truncate text-[12.5px] text-foreground" title={projeto.name}>
                {projeto.name}
              </span>
              <span className="truncate font-mono text-[10px] text-muted-foreground/70" title={projeto.root}>
                {projeto.root}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 font-mono text-[10.5px]">
              <span className={depe ? 'text-success' : 'text-muted-foreground/70'}>{estado}</span>
              {porta && (
                <>
                  <span aria-hidden="true" className="text-muted-foreground/40">
                    ·
                  </span>
                  <span className="text-muted-foreground">{porta}</span>
                </>
              )}
              {projeto.current && (
                <>
                  <span aria-hidden="true" className="text-muted-foreground/40">
                    ·
                  </span>
                  <span className="text-brand">this window</span>
                </>
              )}
              {!depe && (
                <>
                  <span aria-hidden="true" className="text-muted-foreground/40">
                    ·
                  </span>
                  <span className="text-muted-foreground/70">click to start</span>
                </>
              )}
            </div>
            {depe && <PainelMedida medida={medida} medindo={medindo} />}
            <div className="flex items-center gap-1">
              <Button
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                disabled={!projeto.comando}
                onClick={() => projeto.comando && copy(projeto.comando)}
                size="xs"
                title={projeto.comando ? `${projeto.comando} — click to copy` : 'No path for this project'}
                type="button"
                variant="ghost"
              >
                {copied ? (
                  <CheckIcon className="size-3 text-success" />
                ) : (
                  <CopyIcon className="size-3" />
                )}
                command
              </Button>
              {podeParar(projeto) && (
                <Button
                  className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                  disabled={pendente === 'stop'}
                  onClick={() => void parar()}
                  size="xs"
                  title={`Stop the host${projeto.running ? ` (pid ${projeto.running.pid})` : ''}`}
                  type="button"
                  variant="ghost"
                >
                  {pendente === 'stop' ? (
                    <LoaderCircleIcon className="size-3 animate-spin" />
                  ) : (
                    <SquareIcon className="size-2.5 fill-current" />
                  )}
                  stop
                </Button>
              )}
            </div>
            {confirmar && (
              <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2">
                <p className="leading-relaxed text-muted-foreground">
                  Stop the host{porta ? ` on ${porta}` : ''} (pid {confirmar.pid})? It was not
                  started from here.
                </p>
                <div className="flex items-center gap-2 font-mono text-[10px]">
                  <button
                    className="cursor-pointer text-error outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => void parar(true)}
                    type="button"
                  >
                    stop it
                  </button>
                  <button
                    className="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => setConfirmar(undefined)}
                    type="button"
                  >
                    keep it
                  </button>
                </div>
              </div>
            )}
            {erro && (
              <p className="line-clamp-3 leading-relaxed break-words text-error" title={erro}>
                {erro}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Os dois indicadores do canto do tile, com a semântica e as classes do mark do app (`AgentMark`): o
 * ponto de presença — pulsando enquanto trabalha, verde ocioso, cinza parado, vazado quando o host não
 * respondeu — e, quando há pergunta sem resposta, o número em âmbar no canto de cima. O texto inteiro
 * está no `title`/`aria-label` do tile; aqui nada é lido por leitor de tela.
 */
function Sinais({ ponto, perguntas }: { ponto: Presenca; perguntas: string | undefined }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-[1.5px] ring-sidebar',
          ponto === 'working' && 'animate-pulse-dot bg-brand',
          ponto === 'idle' && 'bg-success',
          ponto === 'stopped' && 'bg-muted-foreground/60',
          // Sem resposta não é ocioso: o ponto fica vazado, sem pulso e sem cor de trabalho.
          ponto === 'unavailable' && 'bg-transparent ring-muted-foreground/50',
        )}
        data-presence={ponto}
      />
      {perguntas && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-amber-400 px-0.5 font-mono text-[8px] leading-none font-medium tabular-nums text-amber-950 ring-[1.5px] ring-sidebar"
          data-questions={perguntas}
        >
          {perguntas}
        </span>
      )}
    </>
  )
}

/**
 * O que se mediu no host, no painel: `1 working · 1 question`, com a hora da medida. Um host que não
 * respondeu mostra `unavailable` e o motivo — nunca um zero inventado, que é o que faria ignorar
 * justamente o projeto travado.
 */
function PainelMedida({ medida, medindo }: { medida: Medida | undefined; medindo: boolean }) {
  if (medindo || !medida)
    return (
      <p className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/70">
        <LoaderCircleIcon className="size-2.5 animate-spin" />
        measuring…
      </p>
    )
  const semMedida = !temMedida(medida.working, medida.perguntasAbertas)
  return (
    <div className="flex flex-col gap-0.5">
      {semMedida ? (
        <p className="font-mono text-[10.5px] text-muted-foreground/80">
          unavailable
          {medida.motivo && <span className="text-muted-foreground/60"> — {medida.motivo}</span>}
        </p>
      ) : (
        <p className="font-mono text-[10.5px] text-muted-foreground">
          <span className="text-foreground/80">{contagem(medida.working)}</span>
          <span aria-hidden="true"> · </span>
          {perguntas(medida.perguntasAbertas)}
        </p>
      )}
      <p
        className="font-mono text-[10px] text-muted-foreground/60"
        title={tituloDasPerguntas(medida.perguntasAbertas, medida.motivo)}
      >
        measured at {formatTime(medida.at)}
      </p>
    </div>
  )
}

/** Um botão redondo do pé do rail: o de atualizar, o `+` e o da animação do splash. */
function Icone({
  label,
  title,
  onClick,
  className,
  disabled,
  children,
}: {
  label: string
  title: string
  onClick: () => void
  className?: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        'flex cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  )
}

/**
 * O diálogo do `+`: um caminho, que vira um projeto — expandido pelo servidor (`~`), conferido como
 * pasta e subido como o `iniciar` sobe. Uma pasta que já é um projeto da lista é selecionada em vez de
 * ganhar um segundo host; um projeto novo aparece no rail, e a primeira execução dele — onboarding e a
 * decisão de confiança daquela pasta — acontece na janela dele, não aqui.
 */
function NovoProjeto({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<unknown>
}) {
  const [caminho, setCaminho] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string>()
  const [feito, setFeito] = useState<ResultadoDaCriacao>()
  const abrir = (proximo: boolean) => {
    if (!proximo) {
      setCaminho('')
      setErro(undefined)
      setFeito(undefined)
      setEnviando(false)
    }
    onOpenChange(proximo)
  }
  const criar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (!caminho.trim() || enviando) return
    setEnviando(true)
    setErro(undefined)
    try {
      const resultado = await api.action(CriarAction, { caminho })
      setFeito(resultado)
      await onChanged()
    } catch (causa) {
      setErro(errorMessage(causa))
    } finally {
      setEnviando(false)
    }
  }
  const url = feito?.projeto.running?.url
  return (
    <Dialog onOpenChange={abrir} open={open}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" data-new-project showCloseButton={false}>
        <DialogTitle className="sr-only">New project</DialogTitle>
        <DialogDescription className="sr-only">
          Start a project from a folder on this machine.
        </DialogDescription>
        {feito ? (
          <div className="flex flex-col gap-3 px-5 py-4">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-foreground">
                {feito.projeto.name}{' '}
                {feito.projeto.current ? 'is this window' : 'is running'}{' '}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {portaDo(feito.projeto.running?.url) ?? ''}
                </span>
              </span>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {feito.criado
                  ? 'Its first run — onboarding and the trust decision for that folder — happens in its own window. The tile is in the rail.'
                  : 'No second host was started for that folder.'}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              {url && !feito.projeto.current && (
                <Button
                  className="h-7 text-[12px]"
                  onClick={() => window.location.assign(url)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Open it
                </Button>
              )}
              <Button
                className="h-7 text-[12px]"
                onClick={() => abrir(false)}
                size="sm"
                type="button"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form className="flex flex-col gap-3 px-5 py-4" onSubmit={(e) => void criar(e)}>
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-[13px]">New project</DialogTitle>
              <DialogDescription className="text-[12px] leading-relaxed text-muted-foreground">
                A folder on this machine. ultimate starts in it on the first free port, with no
                window; its tile appears in the rail.
              </DialogDescription>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] tracking-wide text-muted-foreground/70 uppercase">
                folder
              </span>
              <input
                aria-label="Folder"
                className="h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 font-mono text-[12px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
                disabled={enviando}
                onChange={(event) => setCaminho(event.target.value)}
                placeholder="~/src/my-project"
                spellCheck={false}
                value={caminho}
              />
            </label>
            {erro && <p className="font-mono text-[11px] leading-relaxed break-words text-error">{erro}</p>}
            <div className="flex items-center justify-end gap-2">
              <Button
                className="h-7 text-[12px]"
                disabled={enviando}
                onClick={() => abrir(false)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                className="h-7 gap-1.5 text-[12px]"
                disabled={!caminho.trim() || enviando}
                size="sm"
                type="submit"
              >
                {enviando && <LoaderCircleIcon className="size-3.5 animate-spin" />}
                {enviando ? 'Starting…' : 'Start project'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * A lista compacta do celular — a de antes do rail: uma seção que se abre, com o estado escrito, a
 * porta (link para a mesma aba) e a medida de cada projeto, o comando a copiar e o botão de subir e
 * parar. Sem hover para abrir painel num toque, os botões ficam visíveis em `pointer-coarse`.
 */
function Secao() {
  // A lista do celular mostra as medidas de todo mundo, como antes: é a leitura completa.
  const { data, error, loading, refetch } = useAction(SecaoAction, {})
  const [aberta, setAberta] = useState(true)
  // Um botão que muda a máquina mede de novo a seção inteira: o que mudou aparece sem poll.
  const atualizar = () => refetch().then(() => {})
  // Enquanto só se sabe de um projeto não há entre o que saltar, e a seção seria enfeite.
  if (!error && (!data || data.projetos.length < 2)) return null
  return (
    <Collapsible
      aria-label="Projects"
      className="mb-1 flex flex-col gap-px border-b border-border/60 pb-1"
      data-sidebar-section="projects"
      onOpenChange={setAberta}
      open={aberta}
    >
      <div className="mx-2 flex h-6 items-center gap-1">
        <CollapsibleTrigger className="group/projects flex h-6 cursor-pointer items-center gap-1 rounded-md px-1 section-label outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
          <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/projects:rotate-90" />
          Projects
        </CollapsibleTrigger>
        {data && (
          <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums">
            {data.projetos.length}
          </span>
        )}
        <button
          aria-label="Measure the projects again"
          className="ml-auto flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => void atualizar()}
          title={data ? `Measured at ${formatTime(data.at)} · measure again` : 'Measure again'}
          type="button"
        >
          <RotateCwIcon className={cn('size-3', loading && 'animate-spin')} />
        </button>
      </div>
      <CollapsibleContent className="flex flex-col gap-px">
        {error ? (
          <div className="mx-2 flex flex-col gap-1 rounded-md px-1 py-1">
            <p className="font-mono text-[10px] leading-relaxed break-words text-error">
              {error.message}
            </p>
            <button
              className="cursor-pointer text-left font-mono text-[10px] text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => void atualizar()}
              type="button"
            >
              try again
            </button>
          </div>
        ) : (
          data?.projetos.map((projeto) => (
            <Linha key={projeto.root} onChanged={atualizar} projeto={projeto} />
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Uma linha da lista do celular: o ponto e o nome, o estado escrito ao lado, e embaixo a porta (link
 * para a mesma aba) com a medida, ou o comando a copiar quando o host está parado. O botão da ponta
 * sobe o projeto parado e deita o que está de pé.
 */
function Linha({ projeto, onChanged }: { projeto: Projeto; onChanged: () => Promise<unknown> }) {
  const { copied, copy } = useCopy()
  const [pendente, setPendente] = useState<'start' | 'stop'>()
  const [confirmar, setConfirmar] = useState<{ pid: number; url?: string }>()
  const [erro, setErro] = useState<string>()
  const depe = projeto.running !== undefined
  // O que se disse de um estado não vale para o outro: uma medida nova apaga o aviso e a pergunta.
  useEffect(() => {
    setErro(undefined)
    setConfirmar(undefined)
  }, [depe])
  const porta = portaDo(projeto.running?.url)
  const copiavel = projeto.comando
  const caminho = projeto.current ? `${projeto.root} — this window` : projeto.root
  const estado =
    pendente === 'start' ? 'starting' : pendente === 'stop' ? 'stopping' : palavra(projeto)

  const falhou = (causa: unknown) => setErro(errorMessage(causa))

  const iniciar = async () => {
    setErro(undefined)
    setConfirmar(undefined)
    setPendente('start')
    try {
      await api.action(IniciarAction, { name: projeto.name })
      await onChanged()
    } catch (causa) {
      falhou(causa)
    } finally {
      setPendente(undefined)
    }
  }

  const parar = async (confirm = false) => {
    setErro(undefined)
    setPendente('stop')
    try {
      const resultado = await api.action(PararAction, {
        name: projeto.name,
        ...(confirm ? { confirm: true } : {}),
      })
      if (resultado.parado) {
        setConfirmar(undefined)
        await onChanged()
      } else
        setConfirmar({
          pid: resultado.pid,
          ...(resultado.url ? { url: resultado.url } : {}),
        })
    } catch (causa) {
      falhou(causa)
    } finally {
      setPendente(undefined)
    }
  }

  const acao = projeto.current ? undefined : depe ? (
    <Botao
      label={`Stop ${projeto.name}`}
      onClick={() => void parar()}
      pending={pendente === 'stop'}
      title={`Stop the host${porta ? ` on ${porta}` : ''}${projeto.running ? ` (pid ${projeto.running.pid})` : ''}`}
    >
      <SquareIcon className="size-2.5 fill-current" />
    </Botao>
  ) : (
    <Botao
      label={`Start ${projeto.name}`}
      onClick={() => void iniciar()}
      pending={pendente === 'start'}
      title={copiavel ? `${copiavel} — started detached, no window` : 'Start the host'}
    >
      <PlayIcon className="size-2.5 fill-current" />
    </Botao>
  )

  return (
    <div
      className="group/project mx-2 flex min-w-0 flex-col gap-px rounded-md py-1 pr-2 pl-2.5"
      data-current={projeto.current ? '' : undefined}
      data-project={projeto.name}
    >
      <div className="flex min-w-0 items-center gap-2" title={caminho}>
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-1.5 shrink-0 rounded-full',
            depe ? 'bg-success' : 'bg-muted-foreground/40',
          )}
          data-status={depe ? 'running' : 'stopped'}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[12.5px]',
            projeto.current ? 'text-brand' : 'text-foreground/85',
          )}
        >
          {projeto.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{estado}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1 pl-[14px] font-mono text-[10px] text-muted-foreground">
        {depe ? (
          <>
            {porta &&
              (projeto.current ? (
                <span className="shrink-0" title={`${projeto.running?.url} — this window`}>
                  {porta}
                </span>
              ) : (
                <a
                  aria-label={`Open ${projeto.name} at ${projeto.running?.url}`}
                  className="shrink-0 outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                  href={projeto.running?.url}
                  title={`Open ${projeto.running?.url} in this tab`}
                >
                  {porta}
                </a>
              ))}
            {porta && <span aria-hidden="true">·</span>}
            <LinhaMedida projeto={projeto} />
          </>
        ) : copiavel ? (
          <button
            className="group/copy flex min-w-0 cursor-pointer items-center gap-1 text-left outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => copy(copiavel)}
            title={`${copiavel}\nclick to copy`}
            type="button"
          >
            <span className="truncate">{copiavel}</span>
            {copied ? (
              <CheckIcon className="size-3 shrink-0 text-success" />
            ) : (
              <CopyIcon className="size-3 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-50" />
            )}
          </button>
        ) : (
          <span>path unknown</span>
        )}
        {acao && (
          <span className="pointer-coarse:opacity-100 ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-hover/project:opacity-100 focus-within:opacity-100">
            {acao}
          </span>
        )}
      </div>
      {confirmar && (
        <div className="mt-1 flex flex-col gap-1 rounded-md bg-muted/50 px-2 py-1.5">
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Stop the host{porta ? ` on ${porta}` : ''} (pid {confirmar.pid})? It was not started from
            here.
          </p>
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <button
              className="cursor-pointer text-error outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => void parar(true)}
              type="button"
            >
              stop it
            </button>
            <button
              className="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setConfirmar(undefined)}
              type="button"
            >
              keep it
            </button>
          </div>
        </div>
      )}
      {erro && (
        <p
          className="mt-1 line-clamp-3 font-mono text-[10px] leading-relaxed break-words text-error"
          title={erro}
        >
          {erro}
        </p>
      )}
    </div>
  )
}

/** A medida da linha do celular: `1 working · 1 question`, ou `unavailable` — nunca um zero inventado. */
function LinhaMedida({ projeto }: { projeto: Projeto }) {
  if (!temMedida(projeto.working, projeto.perguntasAbertas))
    return (
      <span className="min-w-0 truncate" title={projeto.motivo ?? 'no measurement'}>
        unavailable
      </span>
    )
  return (
    <>
      <span className="shrink-0">{contagem(projeto.working)}</span>
      <span aria-hidden="true">·</span>
      <span
        className={cn(
          'min-w-0 truncate',
          (medido(projeto.perguntasAbertas) ?? 0) > 0 && 'text-foreground/80',
        )}
        title={tituloDasPerguntas(projeto.perguntasAbertas, projeto.motivo)}
      >
        {perguntas(projeto.perguntasAbertas)}
      </span>
    </>
  )
}

/** O botão de subir e deitar um host, na ponta da linha do celular. */
function Botao({
  label,
  title,
  pending,
  onClick,
  children,
}: {
  label: string
  title: string
  pending: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      aria-busy={pending || undefined}
      aria-label={label}
      className="flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default"
      disabled={pending}
      onClick={onClick}
      title={title}
      type="button"
    >
      {pending ? <LoaderCircleIcon className="size-3 animate-spin" /> : children}
    </button>
  )
}
