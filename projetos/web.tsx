/**
 * The "Projects" rail on the left edge of the window: a 48px column, present on every surface, with one
 * tile per project — the hosts that are up on top, a thin line, the stopped ones below (dimmer) and the
 * ⟳, the `+` and the splash switch at the bottom. Each tile carries the app's presence dot in its corner
 * and, when there are any, the number of unanswered questions.
 *
 * The whole block is the click target, and the port number does not appear on it: a project that is up
 * opens that project in this same tab (it is a switcher, not a peeker; ⌘/Ctrl+click opens a new tab, like
 * any link), a stopped project comes up, and this window's project has no action at all — only
 * `text-brand`. The port is still there, but as the link's **address**: `:port` is read only in the tile's
 * panel, together with the state written out and the measurements.
 *
 * The panel opens on hover and on focus, and it is what says what the tile cannot fit: `running` /
 * `stopped`, the port, the path, and `1 working · 1 question` **measured when the panel opens**, with the
 * time. Stopping and copying the command live in it — outside the link, because a `<button>` inside an
 * `<a>` is invalid HTML. A stopped project shows no measurement; a host that does not answer shows
 * `unavailable` with the reason, never `0`.
 *
 * The `+` opens a new project's dialog: a path (`~/src/my-project`), validated and brought up as `iniciar`
 * brings one up — first free port, detached, without a window, health in 20 s. From there the project is
 * its own: the first run, the onboarding and the trust decision for that folder happen in its window.
 *
 * On the phone there is no rail (there is no width for one): the sidebar's compact list — the one from
 * before, with the measurements and the buttons to bring up and stop — keeps being the project switcher,
 * and on the desktop it ceases to exist so that there are not two.
 *
 * No poll: the rail reads on opening, makes a wave of full reads on entering with the pointer (at most
 * once every 15 s), and again on the refresh button and after each action — and the tile's `title` says
 * when the dot and the count are from.
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

/** `{ medir?: false }` → this machine's projects. The rail asks the cheap read: no tile shows a number. */
const SecaoAction = actionRef<{ medir?: boolean }, Secao>('projetos', 'listar')

/** `{ name }` → what was measured in that host now, with the time. The tile's panel asks when it opens. */
const MedirAction = actionRef<{ name: string }, Medida>('projetos', 'medir')

/** `{ name }` → brings that project's host up and only returns when the port answers. */
const IniciarAction = actionRef<{ name: string }, Projeto>('projetos', 'iniciar')

/** `{ name, confirm? }` → brings that project's host down, or says that it asks for confirmation. */
const PararAction = actionRef<{ name: string; confirm?: boolean }, ResultadoDaParada>(
  'projetos',
  'parar',
)

/** `{ caminho }` → brings a folder's host up (or selects the project that is already that folder). */
const CriarAction = actionRef<{ caminho: string }, ResultadoDaCriacao>('projetos', 'criar')

/** `{ enabled }` → turns the splash animation on or off in this machine's settings. */
const SplashAction = actionRef<{ enabled: boolean }, Splash>('projetos', 'splash')

/** How often passing the pointer over the rail may redo the reading of who is up. */
const INTERVALO_DA_ONDA = 15_000

export default defineWebExtension({
  slots: {
    // The column on the left edge: it exists on every surface, and on the phone it falls silent.
    'shell.rail': Rail,
    // The list from before, which on the phone keeps being the project switcher.
    sidebar: { component: Lista, order: -10 },
  },
})

/** The rail — except on the phone, where there is no width for it and the sidebar's list is the
 * switcher. */
function Rail() {
  const viewport = useViewport()
  if (viewport === 'phone') return null
  return <Coluna />
}

/** The compact list — on the phone only: on the desktop and on the tablet the rail is the one that
 * switches projects, a single one. */
function Lista() {
  const viewport = useViewport()
  if (viewport !== 'phone') return null
  return <Secao />
}

/**
 * The column: the running ones, the thin line, the stopped ones, and at the bottom the ⟳, the `+` and the
 * splash animation's button. The tile is a single piece — the link (or the button that brings it up), the
 * presence dot and its panel —, so opening the panel is opening a 32px `<div>` that was already there.
 */
function Coluna() {
  const { data, error, loading, refetch } = useAction(SecaoAction, { medir: false })
  const [novo, setNovo] = useState(false)
  // The wave: what each host that is up is doing, by project, with the time of each measurement. It is
  // remade on mounting, on entering the rail (at most once every 15 s), on ⟳ and after every action — and
  // never by a timer: the indicator says when it is from, and a new reading corrects it.
  const [medidas, setMedidas] = useState<Record<string, Medida>>({})
  const [medindo, setMedindo] = useState(false)
  const ultima = useRef(0)

  const lerOnda = useCallback(async (forcar = false) => {
    if (!forcar && Date.now() - ultima.current < INTERVALO_DA_ONDA) return
    ultima.current = Date.now()
    setMedindo(true)
    try {
      // The full reading: the `estado` of each host that is up, in parallel, with the deadline that already
      // exists.
      setMedidas(ondaDaLeitura(await api.action(SecaoAction, {})))
    } catch {
      // The rail keeps what it already knew — and each tile's `title` says when it is from.
    } finally {
      setMedindo(false)
    }
  }, [])

  useEffect(() => {
    void lerOnda()
  }, [lerOnda])

  // The measurement a tile's panel made also holds for that tile on the rail, without another reading.
  const guardarMedida = useCallback((name: string, medida: Medida) => {
    setMedidas((antes) => ({ ...antes, [name]: medida }))
  }, [])

  // The ⟳ and every click that changes the machine re-read the list and measure everyone again.
  const atualizar = () => refetch().then(() => lerOnda(true))
  const { rodando, parados } = grupos(data?.projetos ?? [])
  return (
    <nav
      aria-label="Projects"
      className="flex h-full w-12 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-2"
      data-projects-rail
      onPointerEnter={() => void lerOnda()}
    >
      <div className="flex w-full min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto">
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
 * The splash animation's button, at the bottom of the rail: the icon says the state (switch to the right =
 * on) and the click does the opposite, which is reversible and therefore asks nothing. The state comes from
 * the column's read (`listar`), never from a variable here: the extension hot-loads, and the file may have
 * changed from outside. A refusal — invalid JSON, a file without permission — becomes `!` with the reason
 * in the `title`, because when it refuses it **writes nothing**.
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
 * A project on the rail: 32px of initials, with the presence dot in the corner and the question count when
 * there is one. Up and outside this window it is a link to the host; stopped it is a button that brings it
 * up; this window's is a button that only opens the panel. The panel opens on hover and on focus and is
 * `fixed`: that way it is not clipped when the column scrolls, and it stays a child of the tile in the DOM
 * order, which is what lets the keyboard reach its buttons.
 */
function Tile({
  projeto,
  medida,
  onChanged,
  onMedida,
}: {
  projeto: Projeto
  /** The last measurement of the rail's wave, or the one this tile's panel made (the panel's wins). */
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
  // Closing waits an instant: the pointer that crosses the gap to the panel does not close it on the way.
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

  // What was said of one state does not hold for the other: a new action erases the warning and the
  // question.
  useEffect(() => {
    setErro(undefined)
    setConfirmar(undefined)
  }, [depe])

  // The measurement is of the instant the panel opens — and the panel says when it is from. Closed, nothing
  // is measured: the tile keeps the rail's wave measurement, which is from when it was made.
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
        // The panel invents no number: what failed becomes `unavailable` with the reason.
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

  /** Opens the panel beside the tile: to the right, and upwards when the tile is in the lower half. */
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

  /**
   * The pointer or the focus came in: the panel opens (if it was already open, the pending closing is
   * cancelled).
   */
  const entrar = () => {
    clearTimeout(saida.current)
    if (!aberto) abrir()
  }

  /** It left the tile and the panel: closes in 150 ms, so crossing the gap does not count as leaving. */
  const sair = () => {
    clearTimeout(saida.current)
    saida.current = setTimeout(fechar, 150)
  }

  const fechar = () => {
    clearTimeout(saida.current)
    setAberto(false)
    setConfirmar(undefined)
  }

  // `Esc` closes the panel even when it opened with the pointer alone (no focus inside the tile), which is
  // the case in which no `onKeyDown` of the tile would arrive. Nothing is prevented: whoever listens to
  // `Esc` as well keeps listening.
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
    // An action that failed leaves its mark on the tile (the whole text is in the `title` and in the
    // panel): the click that did not work cannot vanish in silence.
    erro && 'ring-1 ring-error/60',
  )
  // The `title` and the `aria-label` say the whole sentence — state, counts and the time of the
  // measurement. An action's error beats the sentence: the click that failed cannot vanish.
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
 * The two indicators in the tile's corner, with the semantics and the classes of the app's mark
 * (`AgentMark`): the presence dot — pulsing while it works, green idle, grey stopped, hollow when the host
 * did not answer — and, when there is a question without an answer, the number in amber in the top corner.
 * The whole sentence is in the tile's `title`/`aria-label`; here nothing is read by a screen reader.
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
          // Not answering is not idle: the dot stays hollow, without pulse and without working colour.
          ponto === 'unavailable' && 'bg-transparent ring-muted-foreground/50',
        )}
        data-presence={ponto}
      />
      {perguntas && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-amber-400 px-1 pt-px font-mono text-[8px] leading-none font-semibold tabular-nums text-amber-950 ring-[1.5px] ring-sidebar"
          data-questions={perguntas}
        >
          {perguntas}
        </span>
      )}
    </>
  )
}

/**
 * What was measured in the host, in the panel: `1 working · 1 question`, with the time of the measurement.
 * A host that did not answer shows `unavailable` and the reason — never an invented zero, which is exactly
 * what would make one ignore the stuck project.
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

/** A round button at the bottom of the rail: the refresh one, the `+` and the splash animation's. */
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
 * The `+` dialog: a path, which becomes a project — expanded by the server (`~`), checked as a folder and
 * brought up as `iniciar` brings one up. A folder that is already a project of the list is selected instead
 * of gaining a second host; a new project appears on the rail, and its first run — onboarding and the trust
 * decision for that folder — happens in its window, not here.
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
 * The phone's compact list — the one from before the rail: a section that opens, with the state written
 * out, the port (link to the same tab) and the measurement of each project, the command to copy and the
 * button to bring up and stop. With no hover to open a panel on a touch, the buttons stay visible in
 * `pointer-coarse`.
 */
function Secao() {
  // The phone's list shows everyone's measurements, as before: it is the full reading.
  const { data, error, loading, refetch } = useAction(SecaoAction, {})
  const [aberta, setAberta] = useState(true)
  // A button that changes the machine measures the whole section again: what changed appears with no poll.
  const atualizar = () => refetch().then(() => {})
  // While only one project is known there is nothing to jump between, and the section would be decoration.
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
 * A row of the phone's list: the dot and the name, the state written out beside it, and below the port
 * (link to the same tab) with the measurement, or the command to copy when the host is stopped. The button
 * at the end brings the stopped project up and brings down the one that is up.
 */
function Linha({ projeto, onChanged }: { projeto: Projeto; onChanged: () => Promise<unknown> }) {
  const { copied, copy } = useCopy()
  const [pendente, setPendente] = useState<'start' | 'stop'>()
  const [confirmar, setConfirmar] = useState<{ pid: number; url?: string }>()
  const [erro, setErro] = useState<string>()
  const depe = projeto.running !== undefined
  // What was said of one state does not hold for the other: a new measurement erases the warning and the
  // question.
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

/** The measurement of the phone's row: `1 working · 1 question`, or `unavailable` — never an invented
 * zero. */
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

/** The button that brings a host up and down, at the end of the phone's row. */
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
