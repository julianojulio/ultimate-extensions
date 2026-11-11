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
 * The panel opens on hover and on focus — after a short delay, so crossing the left edge of the window does
 * not open it, and it closes when anything scrolls, because it is anchored where it opened —, and it is
 * what says what the tile cannot fit: `running` / `stopped`, the port, the path, the home the actions
 * address, and `1 working · 1 question` **measured when the panel opens**, with the time. Stopping and
 * copying the command live in it — outside the link, because a `<button>` inside an `<a>` is invalid HTML.
 * A stopped project shows no measurement; a host that does not answer shows `unavailable` with the reason,
 * never `0`.
 *
 * The `+` opens a new project's dialog: a path (`~/src/my-project`), validated and brought up as `start`
 * brings one up — first free port, detached, without a window, health in 20 s. From there the project is
 * its own: the first run, the onboarding and the trust decision for that folder happen in its window.
 *
 * On the phone there is no rail (there is no width for one): the sidebar's compact list — the one from
 * before, with the measurements and the buttons to bring up and stop — keeps being the project switcher,
 * and on the desktop it ceases to exist so that there are not two.
 *
 * No poll: the rail reads on opening, makes a wave of full reads on entering with the pointer (at most
 * once every 15 s), and again on the refresh button and after each action — one call per reading, the
 * rows and the numbers together. Every tile's `title` says when its dot and count are from.
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
  workingCount,
  groups,
  homeLabel,
  initials,
  linkOf,
  measured,
  questionCount,
  readingWave,
  stateWord,
  questions,
  canStop,
  portOf,
  presence,
  splashLabel,
  hasMeasurement,
  questionsTitle,
  tileTitle,
} from './projects.ts'
import type { Presence } from './projects.ts'
import type {
  Measurement,
  Project,
  CreateResult,
  StopResult,
  Section,
  Splash,
} from './types.ts'

/** `{ measure?: false }` → this machine's projects. The rail asks the cheap read: no tile shows a number. */
const ListAction = actionRef<{ measure?: boolean }, Section>('projects', 'list')

/** `{ name }` → what was measured in that host now, with the time. The tile's panel asks when it opens. */
const MeasureAction = actionRef<{ name: string }, Measurement>('projects', 'measure')

/** `{ name }` → brings that project's host up and only returns when the port answers. */
const StartAction = actionRef<{ name: string }, Project>('projects', 'start')

/** `{ name, confirm? }` → brings that project's host down, or says that it asks for confirmation. */
const StopAction = actionRef<{ name: string; confirm?: boolean }, StopResult>(
  'projects',
  'stop',
)

/** `{ path }` → brings a folder's host up (or selects the project that is already that folder). */
const CreateAction = actionRef<{ path: string }, CreateResult>('projects', 'create')

/** `{ enabled }` → turns the splash animation on or off in this machine's settings. */
const SplashAction = actionRef<{ enabled: boolean }, Splash>('projects', 'splash')

/** How often passing the pointer over the rail may redo the reading of who is up. */
const WAVE_INTERVAL = 15_000

/** How long the pointer or the focus has to rest on a tile before its panel opens: crossing the left edge
 * of the window must not open a panel of 240px over the conversation. */
const OPEN_DELAY = 150

export default defineWebExtension({
  slots: {
    // The column on the left edge: it exists on every surface, and on the phone it falls silent.
    'shell.rail': Rail,
    // The list from before, which on the phone keeps being the project switcher.
    sidebar: { component: List, order: -10 },
  },
})

/** The rail — except on the phone, where there is no width for it and the sidebar's list is the
 * switcher. */
function Rail() {
  const viewport = useViewport()
  if (viewport === 'phone') return null
  return <Column />
}

/** The compact list — on the phone only: on the desktop and on the tablet the rail is the one that
 * switches projects, a single one. */
function List() {
  const viewport = useViewport()
  if (viewport !== 'phone') return null
  return <PhoneList />
}

/**
 * The column: the running ones, the thin line, the stopped ones, and at the bottom the ⟳, the `+` and the
 * splash animation's button. The tile is a single piece — the link (or the button that brings it up), the
 * presence dot and its panel —, so opening the panel is opening a 32px `<div>` that was already there.
 */
function Column() {
  const { data, error, loading } = useAction(ListAction, { measure: false })
  const [creating, setCreating] = useState(false)
  // The last full reading: its rows are the ones on screen (the cheap read of mounting is only what
  // paints before it comes), and each row carries the time its own host answered.
  const [section, setSection] = useState<Section>()
  // The wave: what each host that is up is doing, by project, with the time of each measurement. It is
  // remade on mounting, on entering the rail (at most once every 15 s), when the window regains the
  // focus, on ⟳ and after every action — and never by a timer: the indicator says when it is from, and a
  // new reading corrects it.
  const [measurements, setMeasurements] = useState<Record<string, Measurement>>({})
  const [measuring, setMeasuring] = useState(false)
  const [failed, setFailed] = useState<string>()
  const last = useRef(0)

  const readWave = useCallback(async (force = false) => {
    if (!force && Date.now() - last.current < WAVE_INTERVAL) return
    last.current = Date.now()
    setMeasuring(true)
    try {
      // The full reading: the `state` of each host that is up, in parallel, with the deadline that already
      // exists. It brings the rows too — one call, not one for the list and another for the wave.
      const full = await api.action(ListAction, {})
      setSection(full)
      setMeasurements(readingWave(full))
      setFailed(undefined)
    } catch (cause) {
      // The rail keeps what it already knew — and the ⟳ says the reading failed and each tile's `title`
      // says when it is from.
      setFailed(errorMessage(cause))
    } finally {
      setMeasuring(false)
    }
  }, [])

  useEffect(() => {
    void readWave()
  }, [readWave])

  // The measurement a tile's panel made also holds for that tile on the rail, without another reading.
  const storeMeasurement = useCallback((name: string, measurement: Measurement) => {
    setMeasurements((before) => ({ ...before, [name]: measurement }))
  }, [])

  // The ⟳ and every click that changes the machine read once, and take the rows from that same reading.
  const refresh = () => readWave(true)
  const shown = section ?? data
  const { running, stopped } = groups(shown?.projects ?? [])
  const stale = failed ?? (shown ? undefined : error ? error.message : undefined)
  return (
    <nav
      aria-label="Projects"
      className="flex h-full w-12 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-2"
      data-projects-rail
      onPointerEnter={() => void readWave()}
    >
      {/* The corners' indicators hang outside the tile — the question badge 4px above it, 1.5 more of
          ring; the presence dot 2px below — and this box scrolls, so it clips what leaves it. The 6px
          at either end is that room: without it the first tile's badge is cut flat at the top edge,
          its ring gone, and the last tile's dot sits on the bottom edge. */}
      <div className="flex w-full min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto py-1.5">
        {shown ? (
          <>
            {running.map((project) => (
              <Tile
                key={project.home ?? project.root}
                measurement={measurements[project.name]}
                onChanged={refresh}
                onMeasured={storeMeasurement}
                project={project}
              />
            ))}
            {running.length > 0 && stopped.length > 0 && (
              <span aria-hidden="true" className="my-1.5 h-px w-6 shrink-0 bg-foreground/20" />
            )}
            {stopped.map((project) => (
              <Tile
                key={project.home ?? project.root}
                measurement={measurements[project.name]}
                onChanged={refresh}
                onMeasured={storeMeasurement}
                project={project}
              />
            ))}
          </>
        ) : (
          <button
            aria-label="The projects could not be read. Measure again"
            className="flex size-8 items-center justify-center rounded-md border border-error/40 font-mono text-[11px] text-error outline-none hover:bg-error/10 focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => void refresh()}
            title={error?.message}
            type="button"
          >
            !
          </button>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
        <Icon
          className={cn('size-6', (loading || measuring) && 'pointer-events-none')}
          label={
            stale ? `The last reading failed (${stale}). Measure again` : 'Measure the projects again'
          }
          onClick={() => void refresh()}
          title={
            shown
              ? `${stale ? `the last reading failed (${stale}) · ` : ''}measured at ${formatTime(shown.at)} · measure again`
              : 'Measure again'
          }
        >
          <RotateCwIcon
            className={cn(
              'size-3',
              (loading || measuring) && 'animate-spin',
              // A reading that failed leaves its mark: the tiles stay (they are what was known), and the
              // button says the last read did not come.
              stale && 'text-error',
            )}
          />
        </Icon>
        <Icon
          className="size-6"
          label="New project"
          onClick={() => setCreating(true)}
          title="New project"
        >
          <PlusIcon className="size-3.5" />
        </Icon>
        <SplashButton onChanged={refresh} splash={shown?.splash} />
      </div>
      <NewProject onChanged={refresh} onOpenChange={setCreating} open={creating} />
    </nav>
  )
}

/**
 * The splash animation's button, at the bottom of the rail: the icon says the state (switch to the right =
 * on) and the click does the opposite, which is reversible and therefore asks nothing. The state comes from
 * the column's read (`list`), never from a variable here: the extension hot-loads, and the file may have
 * changed from outside. A refusal — invalid JSON, a file without permission — becomes `!` with the reason
 * in the `title`, because when it refuses it **writes nothing**.
 */
function SplashButton({
  splash,
  onChanged,
}: {
  splash: boolean | undefined
  onChanged: () => Promise<unknown>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const toggle = async () => {
    if (pending || splash === undefined) return
    setError(undefined)
    setPending(true)
    try {
      await api.action(SplashAction, { enabled: !splash })
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }
  const label = splashLabel(splash)
  if (error)
    return (
      <Icon
        className="size-6"
        label={`${label} (${error})`}
        onClick={() => void toggle()}
        title={`${error} — click to try again`}
      >
        <span className="font-mono text-[11px] text-error">!</span>
      </Icon>
    )
  return (
    <Icon
      className="size-6"
      disabled={splash === undefined || pending}
      label={label}
      onClick={() => void toggle()}
      title={`${label} — turning it changes the extension bundle, so every open window reloads`}
    >
      {pending ? (
        <LoaderCircleIcon className="size-3 animate-spin" />
      ) : splash ? (
        <ToggleRightIcon className="size-4" />
      ) : (
        <ToggleLeftIcon className="size-4" />
      )}
    </Icon>
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
  project,
  measurement,
  onChanged,
  onMeasured,
}: {
  project: Project
  /** The last measurement of the rail's wave, or the one this tile's panel made (the panel's wins). */
  measurement?: Measurement
  onChanged: () => Promise<unknown>
  onMeasured: (name: string, measurement: Measurement) => void
}) {
  const { copied, copy } = useCopy()
  const [panelOpen, setPanelOpen] = useState(false)
  const [anchor, setAnchor] = useState<CSSProperties>()
  const [pending, setPending] = useState<'start' | 'stop'>()
  const [confirm, setConfirm] = useState<{ pid: number; url?: string }>()
  const [error, setError] = useState<string>()
  const [measuring, setMeasuring] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  // Closing waits an instant: the pointer that crosses the gap to the panel does not close it on the way.
  const exit = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Opening waits too: crossing the left edge of the window on the way somewhere else must not open a
  // panel of 240px over the conversation.
  const opening = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => {
    clearTimeout(exit.current)
    clearTimeout(opening.current)
  }, [])
  const running = project.running !== undefined
  const port = portOf(project.running?.url)
  const link = linkOf(project)
  const state =
    pending === 'start' ? 'starting' : pending === 'stop' ? 'stopping' : stateWord(project)
  const dot = presence(project, measurement)
  const questionBadge = questionCount(measurement?.openQuestions)
  const time = measurement ? formatTime(measurement.at) : undefined
  const buttonTitle = tileTitle(project, measurement, time)

  // What was said of one state does not hold for the other: a new action erases the warning and the
  // question.
  useEffect(() => {
    setError(undefined)
    setConfirm(undefined)
  }, [running])

  // The measurement is of the instant the panel opens — and the panel says when it is from. Closed, nothing
  // is measured: the tile keeps the rail's wave measurement, which is from when it was made.
  useEffect(() => {
    if (!panelOpen || !running) return undefined
    let alive = true
    setMeasuring(true)
    api
      .action(MeasureAction, { name: project.name })
      .then((result) => {
        if (alive) onMeasured(project.name, result)
      })
      .catch((cause: unknown) => {
        // The panel invents no number: what failed becomes `unavailable` with the reason.
        if (alive)
          onMeasured(project.name, {
            working: null,
            openQuestions: null,
            reason: errorMessage(cause),
            at: new Date().toISOString(),
          })
      })
      .finally(() => {
        if (alive) setMeasuring(false)
      })
    return () => {
      alive = false
    }
  }, [panelOpen, running, project.name, onMeasured])

  /** Opens the panel beside the tile: to the right, and upwards when the tile is in the lower half. */
  const openPanel = () => {
    const box = frame.current?.getBoundingClientRect()
    if (box)
      setAnchor({
        left: box.right + 8,
        ...(box.top > window.innerHeight / 2
          ? { bottom: window.innerHeight - box.bottom }
          : { top: box.top }),
      })
    setPanelOpen(true)
  }

  /**
   * The pointer or the focus came in: the panel opens after `OPEN_DELAY` (if it was already open, the
   * pending closing is cancelled). The delay is what keeps passing over the rail from opening panels.
   */
  const enter = () => {
    clearTimeout(exit.current)
    if (panelOpen || opening.current) return
    opening.current = setTimeout(() => {
      opening.current = undefined
      openPanel()
    }, OPEN_DELAY)
  }

  /** It left the tile and the panel: closes in 150 ms, so crossing the gap does not count as leaving. */
  const leave = () => {
    clearTimeout(opening.current)
    opening.current = undefined
    clearTimeout(exit.current)
    exit.current = setTimeout(close, 150)
  }

  const close = () => {
    clearTimeout(exit.current)
    setPanelOpen(false)
    setConfirm(undefined)
  }

  // The panel is anchored where it opened: a scroll (of the rail or of anything behind it) would leave tile
  // and panel apart, so it closes instead of pointing at the wrong place.
  useEffect(() => {
    if (!panelOpen) return undefined
    const onScroll = () => close()
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [panelOpen])

  // `Esc` closes the panel even when it opened with the pointer alone (no focus inside the tile), which is
  // the case in which no `onKeyDown` of the tile would arrive. Nothing is prevented: whoever listens to
  // `Esc` as well keeps listening.
  useEffect(() => {
    if (!panelOpen) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [panelOpen])

  const start = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    close()
    setPending('start')
    try {
      await api.action(StartAction, { name: project.name })
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
      setPending(undefined)
    } finally {
      setPending(undefined)
    }
  }

  const stop = async (confirm = false) => {
    setError(undefined)
    setPending('stop')
    try {
      const result = await api.action(StopAction, {
        name: project.name,
        ...(confirm ? { confirm: true } : {}),
      })
      if (result.stopped) {
        setConfirm(undefined)
        await onChanged()
      } else
        setConfirm({
          pid: result.pid,
          ...(result.url ? { url: result.url } : {}),
        })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(undefined)
    }
  }

  const letters = initials(project.name)
  const look = cn(
    'relative flex size-8 items-center justify-center rounded-md border font-mono text-[10.5px] font-medium uppercase tabular-nums outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring',
    project.current
      ? 'border-brand/40 bg-brand/10 text-brand'
      : running
        ? 'border-transparent bg-accent/70 text-foreground/85 hover:bg-accent'
        : 'border-transparent text-muted-foreground/60 hover:bg-accent/40 hover:text-muted-foreground',
    // An action that failed leaves its mark on the tile (the whole text is in the `title` and in the
    // panel): the click that did not work cannot vanish in silence.
    error && 'ring-1 ring-error/60',
  )
  // The `title` and the `aria-label` say the whole sentence — state, counts and the time of the
  // measurement. An action's error beats the sentence: the click that failed cannot vanish.
  const title = error ?? buttonTitle
  const content = pending === 'start' ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : letters

  return (
    <div
      className="relative flex w-full shrink-0 justify-center"
      data-project={project.name}
      data-status={running ? 'running' : 'stopped'}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) leave()
      }}
      onFocus={enter}
      onPointerEnter={enter}
      onPointerLeave={leave}
      ref={frame}
    >
      {project.current ? (
        <button
          aria-current="page"
          aria-label={title}
          className={look}
          onClick={openPanel}
          title={title}
          type="button"
        >
          {content}
          <Signals questionBadge={questionBadge} dot={dot} />
        </button>
      ) : running && link ? (
        <a aria-label={title} className={look} href={link} title={title}>
          {content}
          <Signals questionBadge={questionBadge} dot={dot} />
        </a>
      ) : (
        <button
          aria-busy={pending === 'start' || undefined}
          aria-label={title}
          className={look}
          disabled={pending === 'start'}
          onClick={(event) => void start(event)}
          title={title}
          type="button"
        >
          {content}
          <Signals questionBadge={questionBadge} dot={dot} />
        </button>
      )}
      {panelOpen && anchor && (
        <div
          className="fixed z-50 w-60 rounded-md border bg-popover p-3 text-popover-foreground shadow-md before:absolute before:inset-y-0 before:-left-2 before:w-2 before:content-['']"
          data-project-panel={project.name}
          style={anchor}
        >
          <div className="flex flex-col gap-2 text-[11px]">
            <div className="flex flex-col gap-0.5">
              <span className="truncate text-[12.5px] text-foreground" title={project.name}>
                {project.name}
              </span>
              <span className="truncate font-mono text-[10px] text-muted-foreground/70" title={project.root}>
                {project.root}
              </span>
              {/* Which home the actions address: two homes can be the same project, and the name is what
                  the actions speak. */}
              {project.home && (
                <span
                  className="truncate font-mono text-[9.5px] text-muted-foreground/50"
                  title={`the actions on this tile address ${project.home}`}
                >
                  {homeLabel(project.home)}
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-1.5 font-mono text-[10.5px]">
              <span className={running ? 'text-success' : 'text-muted-foreground/70'}>{state}</span>
              {port && (
                <>
                  <span aria-hidden="true" className="text-muted-foreground/40">
                    ·
                  </span>
                  <span className="text-muted-foreground">{port}</span>
                </>
              )}
              {project.current && (
                <>
                  <span aria-hidden="true" className="text-muted-foreground/40">
                    ·
                  </span>
                  <span className="text-brand">this window</span>
                </>
              )}
              {!running && (
                <>
                  <span aria-hidden="true" className="text-muted-foreground/40">
                    ·
                  </span>
                  <span className="text-muted-foreground/70">click to start</span>
                </>
              )}
            </div>
            {running && <MeasurementPanel measurement={measurement} measuring={measuring} />}
            {/* A row that is not running can still have something to say: a lock that names no address
                of this machine is not a host the tile can open, and the panel says why. */}
            {!running && project.reason && (
              <p className="font-mono text-[10.5px] leading-relaxed break-words text-muted-foreground/80">
                unavailable — {project.reason}
              </p>
            )}
            <div className="flex items-center gap-1">
              <Button
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                disabled={!project.command}
                onClick={() => project.command && copy(project.command)}
                size="xs"
                title={project.command ? `${project.command} — click to copy` : 'No path for this project'}
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
              {canStop(project) && (
                <Button
                  className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                  disabled={pending === 'stop'}
                  onClick={() => void stop()}
                  size="xs"
                  title={`Stop the host${project.running ? ` (pid ${project.running.pid})` : ''}`}
                  type="button"
                  variant="ghost"
                >
                  {pending === 'stop' ? (
                    <LoaderCircleIcon className="size-3 animate-spin" />
                  ) : (
                    <SquareIcon className="size-2.5 fill-current" />
                  )}
                  stop
                </Button>
              )}
            </div>
            {confirm && (
              <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2">
                <p className="leading-relaxed text-muted-foreground">
                  Stop the host{port ? ` on ${port}` : ''} (pid {confirm.pid})? It was not
                  started from here.
                </p>
                <div className="flex items-center gap-2 font-mono text-[10px]">
                  <button
                    className="cursor-pointer text-error outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => void stop(true)}
                    type="button"
                  >
                    stop it
                  </button>
                  <button
                    className="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => setConfirm(undefined)}
                    type="button"
                  >
                    keep it
                  </button>
                </div>
              </div>
            )}
            {error && (
              <p className="line-clamp-3 leading-relaxed break-words text-error" title={error}>
                {error}
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
 * (`AgentMark`): the presence dot — pulsing while it works, green up and idle, grey stopped, hollow when the
 * host did not answer — and, when there is a question without an answer, the number in amber in the top
 * corner. The whole sentence is in the tile's `title`/`aria-label`; here nothing is read by a screen reader.
 */
function Signals({ dot, questionBadge }: { dot: Presence; questionBadge: string | undefined }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-[1.5px] ring-sidebar',
          dot === 'working' && 'animate-pulse-dot bg-brand',
          dot === 'idle' && 'bg-success',
          dot === 'stopped' && 'bg-muted-foreground/60',
          // Not answering is not idle: the dot stays hollow, without pulse and without working colour.
          dot === 'unavailable' && 'bg-transparent ring-muted-foreground/50',
        )}
        data-presence={dot}
      />
      {questionBadge && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-amber-400 px-1 pt-px font-mono text-[8px] leading-none font-semibold tabular-nums text-amber-950 ring-[1.5px] ring-sidebar"
          data-questions={questionBadge}
        >
          {questionBadge}
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
function MeasurementPanel({ measurement, measuring }: { measurement: Measurement | undefined; measuring: boolean }) {
  if (measuring || !measurement)
    return (
      <p className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/70">
        <LoaderCircleIcon className="size-2.5 animate-spin" />
        measuring…
      </p>
    )
  const noMeasurement = !hasMeasurement(measurement.working, measurement.openQuestions)
  return (
    <div className="flex flex-col gap-0.5">
      {noMeasurement ? (
        <p className="font-mono text-[10.5px] text-muted-foreground/80">
          unavailable
          {measurement.reason && <span className="text-muted-foreground/60"> — {measurement.reason}</span>}
        </p>
      ) : (
        <p className="font-mono text-[10.5px] text-muted-foreground">
          <span className="text-foreground/80">{workingCount(measurement.working)}</span>
          <span aria-hidden="true"> · </span>
          {questions(measurement.openQuestions)}
        </p>
      )}
      <p
        className="font-mono text-[10px] text-muted-foreground/60"
        title={questionsTitle(measurement.openQuestions, measurement.reason)}
      >
        measured at {formatTime(measurement.at)}
      </p>
    </div>
  )
}

/** A round button at the bottom of the rail: the refresh one, the `+` and the splash animation's. */
function Icon({
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
 * brought up as `start` brings one up. A folder that is already a project of the list is selected instead
 * of gaining a second host; a new project appears on the rail, and its first run — onboarding and the trust
 * decision for that folder — happens in its window, not here.
 */
function NewProject({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<unknown>
}) {
  const [path, setPath] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const [outcome, setOutcome] = useState<CreateResult>()
  const changeOpen = (next: boolean) => {
    if (!next) {
      setPath('')
      setError(undefined)
      setOutcome(undefined)
      setSending(false)
    }
    onOpenChange(next)
  }
  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!path.trim() || sending) return
    setSending(true)
    setError(undefined)
    try {
      const result = await api.action(CreateAction, { path })
      setOutcome(result)
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSending(false)
    }
  }
  const url = outcome?.project.running?.url
  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" data-new-project showCloseButton={false}>
        <DialogTitle className="sr-only">New project</DialogTitle>
        <DialogDescription className="sr-only">
          Start a project from a folder on this machine.
        </DialogDescription>
        {outcome ? (
          <div className="flex flex-col gap-3 px-5 py-4">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-foreground">
                {outcome.project.name}{' '}
                {outcome.project.current ? 'is this window' : 'is running'}{' '}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {portOf(outcome.project.running?.url) ?? ''}
                </span>
              </span>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {outcome.created
                  ? 'Its first run — onboarding and the trust decision for that folder — happens in its own window. The tile is in the rail.'
                  : 'No second host was started for that folder.'}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              {url && !outcome.project.current && (
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
                onClick={() => changeOpen(false)}
                size="sm"
                type="button"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form className="flex flex-col gap-3 px-5 py-4" onSubmit={(e) => void create(e)}>
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
                disabled={sending}
                onChange={(event) => setPath(event.target.value)}
                placeholder="~/src/my-project"
                spellCheck={false}
                value={path}
              />
            </label>
            {error && <p className="font-mono text-[11px] leading-relaxed break-words text-error">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <Button
                className="h-7 text-[12px]"
                disabled={sending}
                onClick={() => changeOpen(false)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                className="h-7 gap-1.5 text-[12px]"
                disabled={!path.trim() || sending}
                size="sm"
                type="submit"
              >
                {sending && <LoaderCircleIcon className="size-3.5 animate-spin" />}
                {sending ? 'Starting…' : 'Start project'}
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
function PhoneList() {
  // The phone's list shows everyone's measurements, as before: it is the full reading.
  const { data, error, loading, refetch } = useAction(ListAction, {})
  const [open, setOpen] = useState(true)
  // A button that changes the machine measures the whole section again: what changed appears with no poll.
  const refresh = () => refetch().then(() => {})
  // While only one project is known there is nothing to jump between, and the section would be decoration.
  if (!error && (!data || data.projects.length < 2)) return null
  return (
    <Collapsible
      aria-label="Projects"
      className="mb-1 flex flex-col gap-px border-b border-border/60 pb-1"
      data-sidebar-section="projects"
      onOpenChange={setOpen}
      open={open}
    >
      <div className="mx-2 flex h-6 items-center gap-1">
        <CollapsibleTrigger className="group/projects flex h-6 cursor-pointer items-center gap-1 rounded-md px-1 section-label outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
          <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/projects:rotate-90" />
          Projects
        </CollapsibleTrigger>
        {data && (
          <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums">
            {data.projects.length}
          </span>
        )}
        <button
          aria-label="Measure the projects again"
          className="ml-auto flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => void refresh()}
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
              onClick={() => void refresh()}
              type="button"
            >
              try again
            </button>
          </div>
        ) : (
          data?.projects.map((project) => (
            <Row
              key={project.home ?? project.root}
              onChanged={refresh}
              project={project}
            />
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
function Row({ project, onChanged }: { project: Project; onChanged: () => Promise<unknown> }) {
  const { copied, copy } = useCopy()
  const [pending, setPending] = useState<'start' | 'stop'>()
  const [confirm, setConfirm] = useState<{ pid: number; url?: string }>()
  const [error, setError] = useState<string>()
  const running = project.running !== undefined
  // What was said of one state does not hold for the other: a new measurement erases the warning and the
  // question.
  useEffect(() => {
    setError(undefined)
    setConfirm(undefined)
  }, [running])
  const port = portOf(project.running?.url)
  const copyable = project.command
  const path = project.current ? `${project.root} — this window` : project.root
  const state =
    pending === 'start' ? 'starting' : pending === 'stop' ? 'stopping' : stateWord(project)

  const failed = (cause: unknown) => setError(errorMessage(cause))

  const start = async () => {
    setError(undefined)
    setConfirm(undefined)
    setPending('start')
    try {
      await api.action(StartAction, { name: project.name })
      await onChanged()
    } catch (cause) {
      failed(cause)
    } finally {
      setPending(undefined)
    }
  }

  const stop = async (confirm = false) => {
    setError(undefined)
    setPending('stop')
    try {
      const result = await api.action(StopAction, {
        name: project.name,
        ...(confirm ? { confirm: true } : {}),
      })
      if (result.stopped) {
        setConfirm(undefined)
        await onChanged()
      } else
        setConfirm({
          pid: result.pid,
          ...(result.url ? { url: result.url } : {}),
        })
    } catch (cause) {
      failed(cause)
    } finally {
      setPending(undefined)
    }
  }

  const action = project.current ? undefined : running ? (
    <RowButton
      label={`Stop ${project.name}`}
      onClick={() => void stop()}
      pending={pending === 'stop'}
      title={`Stop the host${port ? ` on ${port}` : ''}${project.running ? ` (pid ${project.running.pid})` : ''}`}
    >
      <SquareIcon className="size-2.5 fill-current" />
    </RowButton>
  ) : (
    <RowButton
      label={`Start ${project.name}`}
      onClick={() => void start()}
      pending={pending === 'start'}
      title={copyable ? `${copyable} — started detached, no window` : 'Start the host'}
    >
      <PlayIcon className="size-2.5 fill-current" />
    </RowButton>
  )

  return (
    <div
      className="group/project mx-2 flex min-w-0 flex-col gap-px rounded-md py-1 pr-2 pl-2.5"
      data-current={project.current ? '' : undefined}
      data-project={project.name}
    >
      <div className="flex min-w-0 items-center gap-2" title={path}>
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-1.5 shrink-0 rounded-full',
            running ? 'bg-success' : 'bg-muted-foreground/40',
          )}
          data-status={running ? 'running' : 'stopped'}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[12.5px]',
            project.current ? 'text-brand' : 'text-foreground/85',
          )}
        >
          {project.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{state}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1 pl-[14px] font-mono text-[10px] text-muted-foreground">
        {running ? (
          <>
            {port &&
              (project.current ? (
                <span className="shrink-0" title={`${project.running?.url} — this window`}>
                  {port}
                </span>
              ) : (
                <a
                  aria-label={`Open ${project.name} at ${project.running?.url}`}
                  className="shrink-0 outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                  href={project.running?.url}
                  title={`Open ${project.running?.url} in this tab`}
                >
                  {port}
                </a>
              ))}
            {port && <span aria-hidden="true">·</span>}
            <RowMeasurement project={project} />
          </>
        ) : copyable ? (
          <button
            className="group/copy flex min-w-0 cursor-pointer items-center gap-1 text-left outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => copy(copyable)}
            title={`${copyable}\nclick to copy`}
            type="button"
          >
            <span className="truncate">{copyable}</span>
            {copied ? (
              <CheckIcon className="size-3 shrink-0 text-success" />
            ) : (
              <CopyIcon className="size-3 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-50" />
            )}
          </button>
        ) : (
          <span>path unknown</span>
        )}
        {action && (
          <span className="pointer-coarse:opacity-100 ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-hover/project:opacity-100 focus-within:opacity-100">
            {action}
          </span>
        )}
      </div>
      {confirm && (
        <div className="mt-1 flex flex-col gap-1 rounded-md bg-muted/50 px-2 py-1.5">
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Stop the host{port ? ` on ${port}` : ''} (pid {confirm.pid})? It was not started from
            here.
          </p>
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <button
              className="cursor-pointer text-error outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => void stop(true)}
              type="button"
            >
              stop it
            </button>
            <button
              className="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setConfirm(undefined)}
              type="button"
            >
              keep it
            </button>
          </div>
        </div>
      )}
      {error && (
        <p
          className="mt-1 line-clamp-3 font-mono text-[10px] leading-relaxed break-words text-error"
          title={error}
        >
          {error}
        </p>
      )}
    </div>
  )
}

/** The measurement of the phone's row: `1 working · 1 question`, or `unavailable` — never an invented
 * zero. */
function RowMeasurement({ project }: { project: Project }) {
  if (!hasMeasurement(project.working, project.openQuestions))
    return (
      <span className="min-w-0 truncate" title={project.reason ?? 'no measurement'}>
        unavailable
      </span>
    )
  return (
    <>
      <span className="shrink-0">{workingCount(project.working)}</span>
      <span aria-hidden="true">·</span>
      <span
        className={cn(
          'min-w-0 truncate',
          (measured(project.openQuestions) ?? 0) > 0 && 'text-foreground/80',
        )}
        title={questionsTitle(project.openQuestions, project.reason)}
      >
        {questions(project.openQuestions)}
      </span>
    </>
  )
}

/** The button that brings a host up and down, at the end of the phone's row. */
function RowButton({
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
