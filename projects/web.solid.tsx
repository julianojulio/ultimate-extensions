/**
 * The "Projects" rail on the left edge of the window: a 48px column, present on every surface, with one
 * tile per project — the hosts that are up on top, a thin line, the stopped ones below (dimmer) and the
 * ⟳, the `+` and the splash switch at the bottom. Inside each group the tiles are a stack: this window's
 * project first, then the one whose rail was opened most recently — `shown` stamps it on every page load,
 * and `list` returns the rows already in that order, so the other window you came from is the second tile.
 * Each tile carries the app's presence dot in its corner and, when there are any, the number of unanswered
 * questions.
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
 * address, and `1 working · 1 question` **measured when the panel opens**, with the time. Stopping,
 * copying the command and hiding a stopped project from the rail (`forget…`, with the way back in the
 * question) live in it — outside the link, because a `<button>` inside an `<a>` is invalid HTML. A
 * stopped project shows no measurement; a host that does not answer shows `unavailable` with the reason,
 * never `0`.
 *
 * The `+` opens a new project's dialog: a path (`~/src/my-project`), validated and brought up as `start`
 * brings one up — the port the host takes, detached, without a window, the lock and then health in 20 s.
 * From there the project is
 * its own: the first run, the onboarding and the trust decision for that folder happen in its window.
 *
 * On the phone there is no rail (there is no width for one): the sidebar's compact list — the one from
 * before, with the measurements and the buttons to bring up and stop — keeps being the project switcher,
 * and on the desktop it ceases to exist so that there are not two.
 *
 * Every tile also has a **tone**, from its folder name alone (`colourOf`, copied from the app's own sidebar):
 * a wash of a cool, muted hue that the initials sit on, one hue per family — `ultimate` and its siblings in
 * brand —, so the same folder is the same colour on every machine and in every window. The tile keeps its
 * letters: the state is the dot, the questions are the amber number, and the tone only says *which* project.
 *
 * A tile that is clicked is on its way somewhere: the target builds its web bundle first, so the click marks
 * the tile (`opening…`) and runs a thin brand bar along the top of the window (`OpeningBar`, the `overlay`
 * slot) until the next page paints — with no timer left running and no poll: the mark dies with the
 * navigation, with the page the Back gesture brings back (`pageshow`), or, for a click that went nowhere, after
 * a quarter of a minute.
 *
 * The foot of the rail sums the tiles in one short line — `1 for you · 2 working`, questions first — from the
 * numbers the wave already brought, and disappears when both are zero. And the whole rail **steps aside** for
 * another extension in `shell.rail`: two rails in one window is one too many, and the one somebody installed
 * on purpose wins, so this one draws nothing and asks nothing.
 *
 * No poll: the rail reads on opening, makes a wave of full reads on entering with the pointer (at most
 * once every 15 s), when the window regains the focus (the same ceiling), and again on the refresh button
 * and after each action — one call per reading, the rows and the numbers together. The dot of *this*
 * window's project does not depend on any of that: its work comes from the conversation list the client
 * already streams, so it is live. Every tile's `title` says when its dot and count are from, and a reading
 * older than the wave stops the pulse instead of pretending to be now.
 */
import {
  CheckIcon,
  ChevronRightIcon,
  CircleArrowUpIcon,
  CopyIcon,
  EyeOffIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  LockIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  RotateCwIcon,
  SquareIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  XIcon,
} from '@lucide/solid'
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onSettled,
} from 'solid-js'
import type { JSX } from '@solidjs/web'
import { Button } from '@/components/ui/button.solid.tsx'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible.solid.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog.solid.tsx'
import {
  actionRef,
  api,
  cn,
  defineWebExtension,
  errorMessage,
  formatTime,
  useAction,
  useCopy,
  useExtensions,
  useNow,
  useRestart,
  useStore,
  useViewport,
} from '@/sdk/solid'
import {
  colourOf,
  workingCount,
  homeLabel,
  initials,
  linkOf,
  measured,
  nightlyTone,
  outcomeLine,
  pullLine,
  questionCount,
  railTaken,
  readingWave,
  repoLocked,
  stateWord,
  sumLine,
  questions,
  canStop,
  portOf,
  presence,
  splashLabel,
  hasMeasurement,
  questionsTitle,
  tileTitle,
  updateTitle,
  WAVE_INTERVAL,
} from './projects.ts'
import type { Presence } from './projects.ts'
import type {
  Measurement,
  NightlyView,
  Project,
  CreateResult,
  ForgetResult,
  Shown,
  StopResult,
  Section,
  Splash,
  UpdateReport,
} from './types.ts'

/** `{ measure?: false }` → this machine's projects. The rail asks the cheap read: no tile shows a number. */
const ListAction = actionRef<{ measure?: boolean }, Section>('projects', 'list')

/** `{}` → this project's rail was just shown: the machine's stamp that orders the stack in every window. */
const ShownAction = actionRef<Record<string, never>, Shown>('projects', 'shown')

/** `{ name }` → what was measured in that host now, with the time. The tile's panel asks when it opens. */
const MeasureAction = actionRef<{ name: string }, Measurement>('projects', 'measure')

/** `{ name }` → brings that project's host up and only returns when the port answers. */
const StartAction = actionRef<{ name: string }, Project>('projects', 'start')

/** `{ name, confirm? }` → brings that project's host down, or says that it asks for confirmation. */
const StopAction = actionRef<{ name: string; confirm?: boolean }, StopResult>(
  'projects',
  'stop',
)

/** `{ name }` → hides that project from this rail: its home enters the machine's `projects.hidden`. */
const ForgetAction = actionRef<{ name: string }, ForgetResult>('projects', 'forget')

/** `{ path }` → brings a folder's host up (or selects the project that is already that folder). */
const CreateAction = actionRef<{ path: string }, CreateResult>('projects', 'create')

/** `{ enabled }` → turns the splash animation on or off in this machine's settings. */
const SplashAction = actionRef<{ enabled: boolean }, Splash>('projects', 'splash')

/**
 * `{}` → pulls the shared clone once and restarts every host of the machine that runs code the clone has
 * moved past. A user-only action: this is a click, never an agent's call.
 */
const UpdateAllAction = actionRef<Record<string, never>, UpdateReport>('projects', 'update')

/** `{}` → the line of the last night was read: it is not drawn again. */
const SeenAction = actionRef<Record<string, never>, { seen: true }>('projects', 'seen')

/** How often the local reading of this window's own project is refreshed, so its dot keeps moving while
 * it works (the numbers come from this host, not from a request). */
const LOCAL_INTERVAL = 5000

/** How long the pointer or the focus has to rest on a tile before its panel opens: crossing the left edge
 * of the window must not open a panel of 240px over the conversation. */
const OPEN_DELAY = 150

export default defineWebExtension({
  slots: {
    // The column on the left edge: it exists on every surface, and on the phone it falls silent.
    'shell.rail': Rail,
    // The list from before, which on the phone keeps being the project switcher.
    sidebar: { component: List, order: -10 },
    // The thin bar that runs along the top of the window while a clicked tile is on its way.
    overlay: OpeningBar,
  },
})

/**
 * The tile that was clicked and the page it is going to. The rail cannot wait for a page that takes seconds to
 * paint — the target builds its web bundle first —, so the click leaves a mark here: the tile pulses, the top
 * edge of the window runs a thin brand bar. The mark dies with the navigation (a new page, a new module), with
 * the page the Back gesture brings back (`pageshow`, from the back/forward cache), or, for a click that went
 * nowhere, after `OPENING_EXPIRY_MS` — one deadline that is cleared by the next click, never a timer that keeps
 * running.
 */
const OPENING_EXPIRY_MS = 15_000

const [opening, setOpeningSignal] = createRoot(() => createSignal<string | undefined>())
let openingExpiry: ReturnType<typeof setTimeout> | undefined

function setOpening(url: string | undefined) {
  setOpeningSignal(url)
  clearTimeout(openingExpiry)
  openingExpiry =
    url === undefined ? undefined : setTimeout(() => setOpeningSignal(undefined), OPENING_EXPIRY_MS)
}

/** The thin brand bar along the top of the window, while a clicked tile is on its way to another project. */
function OpeningBar() {
  // The Back gesture brings the page back from the back/forward cache with its module state intact: the mark
  // of a click that did not arrive is cleared here.
  onSettled(() => {
    const clear = () => setOpening(undefined)
    window.addEventListener('pageshow', clear)
    return () => window.removeEventListener('pageshow', clear)
  })
  return (
    <Show when={opening()}>
      <div
        aria-hidden="true"
        class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 animate-sweep bg-brand/30 bg-size-[300%_100%] bg-no-repeat bg-[linear-gradient(90deg,transparent_30%,var(--color-brand)_50%,transparent_70%)]"
        data-opening-bar
      />
    </Show>
  )
}

/**
 * The colours of one tile, from its tone: the wash behind the initials (a light and a dark reading of the same
 * tone, because the theme is a class and a script cannot read it), a stronger wash for this window's project,
 * a quieter one for a stopped project, the ink of the letters, and the edge of the current one. The family's
 * lightness offset moves the wash a little, so two projects of one family are two shades and not one.
 *
 * The numbers are the ones `colourOf` returned: a hue in degrees, a chroma of 0.06 (brand is 0.11), and a
 * lightness offset from -0.17 to 0.15, which is scaled down here — a wash has a narrow range — while the
 * letters take more of it. All of it is quiet on purpose: the presence dot and the amber count sit on top,
 * and they are the ones that have to stand out.
 */
function toneStyle(name: string, family: readonly string[]): JSX.CSSProperties {
  const { hue, chroma, lightness } = colourOf(name, family)
  // The brand family's own chroma is nearly twice a project's, and at the lightness of a wash that reads as
  // pink rather than as violet: a wash takes the quieter chroma, the letters and the edge keep the tone's own.
  const washChroma = Math.min(chroma, 0.06)
  const tone = (
    base: number,
    chromaValue: number,
    scale: number,
    lightnessScale: number,
    alpha?: number,
  ) =>
    `oklch(${(base + lightness * lightnessScale).toFixed(3)} ${(chromaValue * scale).toFixed(3)} ${hue}${
      alpha === undefined ? '' : ` / ${alpha}`
    })`
  const wash = (base: number, scale: number, lightnessScale = 0.3) =>
    tone(base, washChroma, scale, lightnessScale)
  return {
    '--tile-wash': wash(0.91, 0.8),
    '--tile-wash-dark': wash(0.25, 0.8),
    '--tile-wash-hover': wash(0.88, 0.95),
    '--tile-wash-hover-dark': wash(0.29, 0.95),
    '--tile-wash-strong': wash(0.86, 1.05),
    '--tile-wash-strong-dark': wash(0.31, 1.05),
    '--tile-wash-idle': wash(0.94, 0.4, 0.15),
    '--tile-wash-idle-dark': wash(0.2, 0.4, 0.15),
    '--tile-ink': tone(0.4, chroma, 1.6, 0.2),
    '--tile-ink-dark': tone(0.8, chroma, 1.3, 0.15),
    '--tile-ink-strong': tone(0.34, chroma, 1.9, 0.2),
    '--tile-ink-strong-dark': tone(0.87, chroma, 1.6, 0.1),
    '--tile-edge': tone(0.42, chroma, 1.6, 0.2, 0.45),
  }
}

/** The rail — except on the phone, where there is no width for it and the sidebar's list is the
 * switcher, and except when another extension fills the slot: then this one draws nothing and asks nothing,
 * so a window never shows two rails. */
function Rail() {
  const viewport = useViewport()
  const extensions = useExtensions()
  const taken = createMemo(() =>
    railTaken(
      extensions().map((record) => ({
        name: record.name,
        rail: Boolean(record.extension?.slots?.['shell.rail']),
      })),
    ),
  )
  return (
    <Show when={!taken() && viewport() !== 'phone'}>
      <Column />
    </Show>
  )
}

/** The compact list — on the phone only: on the desktop and on the tablet the rail is the one that
 * switches projects, a single one. */
function List() {
  const viewport = useViewport()
  return (
    <Show when={viewport() === 'phone'}>
      <PhoneList />
    </Show>
  )
}

/**
 * The column: the running ones, the thin line, the stopped ones, and at the bottom the ⟳, the `+` and the
 * splash animation's button. The tile is a single piece — the link (or the button that brings it up), the
 * presence dot and its panel —, so opening the panel is opening a 32px `<div>` that was already there.
 * The order is the one `list` returned: this window's project, then the stack of the machine.
 */
function Column() {
  const list = useAction(ListAction, { measure: false })
  const [creating, setCreating] = createSignal(false)
  // The last full reading: its rows are the ones on screen (the cheap read of mounting is only what
  // paints before it comes), and each row carries the time its own host answered.
  const [section, setSection] = createSignal<Section>()
  // The wave: what each host that is up is doing, by project, with the time of each measurement. It is
  // remade on mounting, on entering the rail (at most once every 15 s), when the window regains the
  // focus, on ⟳ and after every action — and never by a timer: the indicator says when it is from, and a
  // new reading corrects it.
  const [measurements, setMeasurements] = createSignal<Record<string, Measurement>>({})
  const [measuring, setMeasuring] = createSignal(false)
  const [failed, setFailed] = createSignal<string>()
  let last = 0
  // This host's own work, from the conversation list it already streams: no request, and it changes the
  // moment a conversation starts or stops. The dot of this window's project is therefore never old.
  const workingHere = useStore((state) => state.conversations.filter((item) => item.busy).length)
  // Its time is refreshed with it, so the dot keeps pulsing while this host works (see `presence`).
  const now = useNow(LOCAL_INTERVAL)

  const readWave = async (force = false) => {
    if (!force && Date.now() - last < WAVE_INTERVAL) return
    last = Date.now()
    setMeasuring(true)
    try {
      // The full reading: the `state` of each host that is up, in parallel, with the deadline that already
      // exists. It brings the rows too — one call, not one for the list and another for the wave.
      const full = await api.action(ListAction, {})
      setSection(full)
      setMeasurements(readingWave(full))
      setFailed(undefined)
    } catch (cause) {
      // The rail keeps what it already knew — and the ⟳ says the refresh failed and each tile's `title`
      // says when it is from.
      setFailed(errorMessage(cause))
    } finally {
      setMeasuring(false)
    }
  }

  onSettled(() => {
    void readWave()
    // The rail was shown: this project is stamped in this machine's `projects-shown.json`, which is what
    // orders every rail of the machine — come back to it from another project and this one is the first
    // tile, that one the second. Once per page load, on mounting; it is not a gesture, so it is not on the
    // wave. A stamp that does not come changes the order of the tiles later, never the ones on screen, so
    // the failure is not worth a word.
    void api.action(ShownAction, {}).catch(() => undefined)
    // Coming back to the window is exactly when the rail is looked at: the wave again, with the same ceiling
    // (inside it, `readWave` does nothing). While the window is hidden nothing is asked.
    const onFocus = () => void readWave()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void readWave()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  })

  // The measurement a tile's panel made also holds for that tile on the rail, without another reading.
  const storeMeasurement = (name: string, measurement: Measurement) =>
    setMeasurements((before) => ({ ...before, [name]: measurement }))

  // The ⟳ and every click that changes the machine read once, and take the rows from that same reading.
  const refresh = () => readWave(true)
  const shown = () => section() ?? list.data()
  // The rows `list` returns are already in the order the rail draws them: this window's project, then the
  // stack of the machine. The thin line is a split, not another ordering — the client does not sort.
  const rows = () => shown()?.projects ?? []
  const running = () => rows().filter((project) => project.running !== undefined)
  const stopped = () => rows().filter((project) => project.running === undefined)
  // This window's project answers from the host that is serving the screen: its dot is live and its
  // numbers are now, whether or not a wave ever came back.
  const measurementOf = (project: Project): Measurement | undefined => {
    const wave = measurements()[project.name]
    if (!project.current) return wave
    return {
      working: workingHere(),
      openQuestions: wave?.openQuestions ?? null,
      at: new Date(now()).toISOString(),
    }
  }
  const stale = () => failed() ?? (shown() ? undefined : list.error()?.message)
  // The foot of the rail sums what the tiles already brought: the questions without an answer in the whole
  // machine first, then how many projects are working now. Nothing is asked for it — these are the wave's
  // own numbers, and this window's dot is the live one — and both at zero is no line at all.
  const askingAll = () =>
    rows().reduce(
      (total, project) => total + (measured(measurementOf(project)?.openQuestions) ?? 0),
      0,
    )
  const workingAll = () =>
    rows().filter((project) => (measured(measurementOf(project)?.working) ?? 0) > 0).length
  const sum = () => sumLine(askingAll(), workingAll())
  // The family the tones are taken from: the names of every row, so two projects of one stem take neighbouring
  // shades in every window they are both in.
  const family = () => rows().map((project) => project.name)
  // What the button at the foot of the rail promises: the clone as `list` read it (the shared clone, so any
  // reading does) and the hosts the wave saw running code the clone has moved past. Nothing is asked here:
  // the button appears from a reading the rail was going to make anyway.
  const restarting = () => rows().filter((project) => project.restart === true).length
  const updating = () =>
    updateTitle({
      behind: shown()?.clone?.behind,
      restart: restarting(),
      refused: shown()?.clone?.refused,
    })
  // The panel of the last click is worth reading even when the button's reason is gone by the time it ends —
  // every host restarted is a host that no longer asks for one. So the button stays while its panel is open,
  // and leaves with it.
  const [reading, setReading] = createSignal(false)
  return (
    <nav
      aria-label="Projects"
      class="flex h-full w-12 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-2"
      data-projects-rail
      onPointerEnter={() => void readWave()}
    >
      {/* The corners' indicators hang outside the tile — the question badge 4px above it, 1.5 more of
          ring; the presence dot 2px below — and this box scrolls, so it clips what leaves it. The 6px
          at either end is that room: without it the first tile's badge is cut flat at the top edge,
          its ring gone, and the last tile's dot sits on the bottom edge. */}
      <div class="flex w-full min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto py-1.5">
        <Show
          when={shown()}
          fallback={
            <button
              aria-label="The projects could not be read — refresh"
              class="flex size-8 items-center justify-center rounded-md border border-error/40 font-mono text-[11px] text-error outline-none hover:bg-error/10 focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => void refresh()}
              title={list.error()?.message}
              type="button"
            >
              !
            </button>
          }
        >
          <For each={running()} keyed={(project) => project.home ?? project.root}>
            {(project) => (
              <Tile
                family={family()}
                measurement={measurementOf(project())}
                now={now()}
                onChanged={refresh}
                onMeasured={storeMeasurement}
                project={project()}
              />
            )}
          </For>
          <Show when={running().length > 0 && stopped().length > 0}>
            <span aria-hidden="true" class="my-1.5 h-px w-6 shrink-0 bg-foreground/20" />
          </Show>
          <For each={stopped()} keyed={(project) => project.home ?? project.root}>
            {(project) => (
              <Tile
                family={family()}
                measurement={measurementOf(project())}
                now={now()}
                onChanged={refresh}
                onMeasured={storeMeasurement}
                project={project()}
              />
            )}
          </For>
        </Show>
      </div>
      <div class="flex shrink-0 flex-col items-center gap-1 pt-1">
        {/* What the tiles add up to, when there is something to add up: the questions first, in the amber of
            the corner counters, then the projects working, in the brand of the dot — the numbers the wave
            brought, with the whole sentence in the `title`. */}
        <Show when={sum()}>
          {(line) => (
            <div
              aria-label={line()}
              class="flex flex-col items-center gap-1 pb-0.5 font-mono text-[9.5px] leading-none tabular-nums"
              data-projects-sum
              role="group"
              title={line()}
            >
              <span aria-hidden="true" class="h-px w-6 shrink-0 bg-foreground/20" />
              <Show when={askingAll() > 0}>
                <span class="flex items-center gap-1 text-amber-700 dark:text-amber-300">
                  <span class="size-1.5 rounded-full bg-amber-400" />
                  {askingAll()}
                </span>
              </Show>
              <Show when={workingAll() > 0}>
                <span class="flex items-center gap-1 text-muted-foreground">
                  <span class="size-1.5 rounded-full bg-brand" />
                  {workingAll()}
                </span>
              </Show>
            </div>
          )}
        </Show>
        {/* The last night, when it has something to say: one item, dismissed with a click, and gone from the
            rail until the next night writes another. */}
        <Show when={shown()?.nightly}>
          {(nightly) => <Nightly nightly={nightly()} onChanged={refresh} />}
        </Show>
        <Icon
          class={cn('size-6', (list.loading() || measuring()) && 'pointer-events-none')}
          label={
            stale() ? `The last refresh failed (${stale()}). Try again` : 'Refresh the projects'
          }
          onClick={() => void refresh()}
          title={stale() ? `The last refresh failed (${stale()}) — try again` : 'Refresh the projects'}
        >
          <RotateCwIcon
            class={cn(
              'size-3',
              (list.loading() || measuring()) && 'animate-spin',
              // A reading that failed leaves its mark: the tiles stay (they are what was known), and the
              // button says the last read did not come.
              stale() && 'text-error',
            )}
          />
        </Icon>
        {/* Only when there is something to do: the clone is behind origin, or a host of this machine
            answered that the clone has moved past it. */}
        <Show when={updating() || reading()}>
          <UpdateButton
            label={updating()}
            onChanged={refresh}
            onOpenChange={setReading}
          />
        </Show>
        <Icon class="size-6" label="New project" onClick={() => setCreating(true)} title="New project">
          <PlusIcon class="size-3.5" />
        </Icon>
        <SplashButton onChanged={refresh} splash={shown()?.splash} />
      </div>
      <NewProject onChanged={refresh} onOpenChange={setCreating} open={creating()} />
    </nav>
  )
}

/**
 * A panel anchored to the right of a foot item, which is where the rail's 24px buttons are: it closes when
 * the pointer leaves both (with the usual moment of grace over the 8px between them), on Escape and on any
 * scroll, because it is anchored where it opened. Whoever uses it decides what opens it — a click for the
 * update button, the pointer for the line of the last night — and a touch never opens or closes by pointer:
 * there is no leaving a panel with a finger, so the click is the gesture.
 *
 * Two items at the foot of the rail use it, so the mechanics of "a panel beside a 24px button at the bottom
 * of the window" are written once.
 */
function useFootPanel(onOpenChange?: (open: boolean) => void) {
  const [open, setOpen] = createSignal(false)
  const [anchor, setAnchor] = createSignal<JSX.CSSProperties>()
  let frame: HTMLDivElement | undefined
  let exit: ReturnType<typeof setTimeout> | undefined
  let delay: ReturnType<typeof setTimeout> | undefined
  const show = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }
  const close = () => {
    clearTimeout(exit)
    clearTimeout(delay)
    show(false)
  }
  /** Beside the button and upwards: the foot of the rail is at the bottom of the window. */
  const openPanel = () => {
    const box = frame?.getBoundingClientRect()
    if (box)
      setAnchor({
        left: `${box.right + 8}px`,
        bottom: `${Math.max(8, window.innerHeight - box.bottom)}px`,
      })
    show(true)
  }
  /** Leaving the button and its panel closes it, with the moment of grace over the gap between them. */
  const leave = (event: PointerEvent) => {
    clearTimeout(delay)
    if (event.pointerType !== 'mouse') return
    clearTimeout(exit)
    exit = setTimeout(close, 200)
  }
  /** Reaching the panel cancels that moment: it is 8px to the right of a 24px button, and its lines are to be
   * read and selected, not passed over. */
  const enter = () => clearTimeout(exit)
  /**
   * The pointer resting on an item opens it, as it does on a tile — after the rail's own moment, so crossing
   * the foot of the window does not drop a panel over the conversation. A finger has no resting pointer: a
   * touch opens nothing here, and its click does.
   */
  const hover = (event: PointerEvent) => {
    enter()
    if (event.pointerType !== 'mouse' || open()) return
    clearTimeout(delay)
    delay = setTimeout(openPanel, OPEN_DELAY)
  }
  onSettled(() => () => {
    clearTimeout(exit)
    clearTimeout(delay)
  })
  createEffect(
    () => open(),
    (isOpen) => {
      if (!isOpen) return
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') close()
      }
      const onScroll = () => close()
      document.addEventListener('keydown', onKeyDown)
      document.addEventListener('scroll', onScroll, { capture: true, passive: true })
      return () => {
        document.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('scroll', onScroll, { capture: true })
      }
    },
  )
  return {
    open,
    anchor,
    frame: (element: HTMLDivElement) => {
      frame = element
    },
    openPanel,
    close,
    hover,
    enter,
    leave,
  }
}

/**
 * The update button at the foot of the rail — **update and restart the machine** — present only when there is
 * something to do (its label comes from `updateTitle`). One click pulls the shared clone once and restarts,
 * one at a time, every host that runs code the clone has moved past. This window's own host is the exception:
 * the process answering the click cannot swap itself, so the action says so (`restartSelf`) and the window
 * asks the SDK's `restart()`, which the core swaps with its own rollback.
 *
 * What came of it is the panel beside the button, in the words of the action: the pull (or the refusal, when
 * it refused — a diverged clone is the one that refuses the pull and restarts anyway, and its line says so),
 * one line per host, and the window's own swap while it runs or why it was rolled back. A host that did not
 * come back is a line in red: it is never called ready.
 *
 * The same flow is what the nightly update runs when the machine is idle (see `projects.update.at` and
 * `server.ts`): this button is the click, the night is the process.
 */
function UpdateButton(props: {
  /** What the click would do, from `updateTitle`; absent when the rail has nothing to offer and only the
   * panel of the last click keeps this button on screen. */
  label?: string
  onChanged: () => Promise<unknown>
  /** Whether the panel is open, so the column keeps the button while the result is being read. */
  onOpenChange: (open: boolean) => void
}) {
  const [pending, setPending] = createSignal(false)
  const [report, setReport] = createSignal<UpdateReport>()
  const [error, setError] = createSignal<string>()
  const foot = useFootPanel((open) => props.onOpenChange(open))
  const restart = useRestart()

  const run = async () => {
    if (pending()) return
    setError(undefined)
    setReport(undefined)
    foot.openPanel()
    setPending(true)
    try {
      const result = await api.action(UpdateAllAction, {})
      setReport(result)
      await props.onChanged()
      // The window's own host last: the SDK asks the core to swap, and the page stays as the stream reconnects.
      if (result.restartSelf) restart.run()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  const lines = () => report()?.projects ?? []
  const name = () => props.label ?? 'Update and restart the machine'
  const title = () =>
    props.label
      ? `${props.label} — restarting a project's window interrupts the turn running in it`
      : 'Update the clone and restart every project that runs old code'
  return (
    <div class="relative flex" onPointerEnter={foot.enter} onPointerLeave={foot.leave} ref={foot.frame}>
      <Icon
        class="size-6"
        disabled={pending()}
        label={name()}
        onClick={() => void run()}
        title={title()}
      >
        <Show
          when={pending()}
          fallback={<CircleArrowUpIcon class={cn('size-3.5', error() && 'text-error')} />}
        >
          <LoaderCircleIcon class="size-3 animate-spin" />
        </Show>
      </Icon>
      <Show when={foot.open() && foot.anchor()}>
        {(anchor) => (
          <div
            class="fixed z-50 w-64 rounded-md border bg-popover p-3 text-popover-foreground shadow-md before:absolute before:inset-y-0 before:-left-2 before:w-2 before:content-['']"
            data-projects-update
            style={anchor()}
          >
            <div class="flex flex-col gap-1.5">
              <span class="text-[12.5px] text-foreground">
                {pending() ? 'Updating and restarting…' : 'Update and restart'}
              </span>
              <Show when={report()?.pull}>
                {(pull) => (
                  <p
                    class={cn(
                      'text-[10.5px] leading-relaxed break-words',
                      pull().ok ? 'font-mono text-muted-foreground' : 'text-error',
                    )}
                  >
                    {pullLine(pull(), lines().length > 0)}
                  </p>
                )}
              </Show>
              <For each={lines()}>
                {(outcome) => (
                  <p
                    class={cn(
                      'font-mono text-[10.5px] leading-relaxed break-words',
                      outcome.result === 'restarted' && 'text-success',
                      outcome.result === 'failed' && 'text-error',
                      (outcome.result === 'held' || outcome.result === 'self') &&
                        'text-muted-foreground',
                    )}
                  >
                    {outcomeLine(outcome)}
                  </p>
                )}
              </For>
              <Show when={report() && !report()?.pull && lines().length === 0 && !pending()}>
                <p class="font-mono text-[10.5px] text-muted-foreground/70">nothing to restart</p>
              </Show>
              <Show when={pending() && !report()?.pull && lines().length === 0}>
                <p class="font-mono text-[10.5px] text-muted-foreground/70">asking the hosts…</p>
              </Show>
              <Show when={restart.busy()}>
                <p class="font-mono text-[10.5px] text-brand">this window is swapping its core…</p>
              </Show>
              <Show when={restart.error()}>
                {(message) => (
                  <p class="text-[10.5px] leading-relaxed break-words text-error">{message()}</p>
                )}
              </Show>
              <Show when={error()}>
                {(message) => (
                  <p class="text-[10.5px] leading-relaxed break-words text-error">{message()}</p>
                )}
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

/**
 * The line of the last night, at the foot of the rail — one item, and only when the night had something to
 * say. The moon is quiet after a night that updated, amber after one that stepped aside for a working
 * project or that restarted everything it could while the pull waited for a merge, red after one that could
 * not do the work; the panel beside it carries the detail, the range the update offers for a diverged clone,
 * and the one button that matters in the morning, which is `Dismiss`: read once, then out of the way.
 *
 * Everything drawn here came from `list` — the record of the night as this machine wrote it — so nothing is
 * computed on screen: the words of the run are the ones composed when it ended.
 */
function Nightly(props: { nightly: NightlyView; onChanged: () => Promise<unknown> }) {
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const foot = useFootPanel()
  const dismiss = async () => {
    if (pending()) return
    setError(undefined)
    setPending(true)
    try {
      await api.action(SeenAction, {})
      foot.close()
      await props.onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }
  const night = () => nightlyTone(props.nightly.outcome)
  const tone = () =>
    night() === 'error'
      ? 'text-error'
      : night() === 'warning'
        ? 'text-warning'
        : 'text-muted-foreground'
  return (
    <div class="relative flex" onPointerEnter={foot.hover} onPointerLeave={foot.leave} ref={foot.frame}>
      <Icon
        class="size-6"
        label={props.nightly.line}
        // A mouse has already opened the panel by resting on the item; a finger, and a click, open it — and
        // nothing closes it but the ✕, Escape, a scroll, or the pointer leaving. A touch cannot leave.
        onClick={foot.openPanel}
        title={props.nightly.line}
      >
        <MoonIcon class={cn('size-3.5', tone())} />
      </Icon>
      <Show when={foot.open() && foot.anchor()}>
        {(anchor) => (
          <div
            class="fixed z-50 w-64 rounded-md border bg-popover p-3 text-popover-foreground shadow-md before:absolute before:inset-y-0 before:-left-2 before:w-2 before:content-['']"
            data-projects-nightly
            style={anchor()}
          >
            <div class="flex flex-col gap-1.5">
              <div class="flex items-start justify-between gap-2">
                <span class="text-[12.5px] text-foreground">
                  {props.nightly.today
                    ? `Last night, ${props.nightly.at}`
                    : `${props.nightly.day}, ${props.nightly.at}`}
                </span>
                <button
                  aria-label="Dismiss the last night's report"
                  class="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default"
                  disabled={pending()}
                  onClick={() => void dismiss()}
                  title="Dismiss"
                  type="button"
                >
                  <Show
                    when={pending()}
                    fallback={<XIcon class="size-3" />}
                  >
                    <LoaderCircleIcon class="size-3 animate-spin" />
                  </Show>
                </button>
              </div>
              <p class={cn('text-[11px] leading-relaxed break-words', tone())}>
                {props.nightly.line}
              </p>
              <For each={props.nightly.lines.filter((line) => line !== props.nightly.line)}>
                {(line) => (
                  <p class="font-mono text-[10.5px] leading-relaxed break-words text-muted-foreground">
                    {line}
                  </p>
                )}
              </For>
              <Show when={props.nightly.diverged?.compare}>
                {(compare) => (
                  <a
                    class="w-fit text-[10.5px] text-muted-foreground hover:text-brand"
                    href={compare()}
                    rel="noreferrer"
                    target="_blank"
                  >
                    DiffsHub ↗
                  </a>
                )}
              </Show>
              <Show when={error()}>
                {(message) => (
                  <p class="text-[10.5px] leading-relaxed break-words text-error">{message()}</p>
                )}
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

/**
 * The splash animation's button, at the bottom of the rail: the icon says the state (switch to the right =
 * on) and the click does the opposite, which is reversible and therefore asks nothing. The state comes from
 * the column's read (`list`), never from a variable here: the extension hot-loads, and the file may have
 * changed from outside. A refusal — invalid JSON, a file without permission — becomes `!` with the reason
 * in the `title`, because when it refuses it **writes nothing**.
 */
function SplashButton(props: { splash: boolean | undefined; onChanged: () => Promise<unknown> }) {
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const toggle = async () => {
    if (pending() || props.splash === undefined) return
    setError(undefined)
    setPending(true)
    try {
      await api.action(SplashAction, { enabled: !props.splash })
      await props.onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }
  const label = () => splashLabel(props.splash)
  return (
    <Show
      when={error()}
      fallback={
        <Icon
          class="size-6"
          disabled={props.splash === undefined || pending()}
          label={label()}
          onClick={() => void toggle()}
          title={`${label()} — turning it changes the extension bundle, so every open window reloads`}
        >
          <Show
            when={pending()}
            fallback={
              <Show
                when={props.splash}
                fallback={<ToggleLeftIcon class="size-4" />}
              >
                <ToggleRightIcon class="size-4" />
              </Show>
            }
          >
            <LoaderCircleIcon class="size-3 animate-spin" />
          </Show>
        </Icon>
      }
    >
      {(message) => (
        <Icon
          class="size-6"
          label={`${label()} (${message()})`}
          onClick={() => void toggle()}
          title={`${message()} — click to try again`}
        >
          <span class="font-mono text-[11px] text-error">!</span>
        </Icon>
      )}
    </Show>
  )
}

/**
 * A project on the rail: 32px of initials, with the presence dot in the corner and the question count when
 * there is one. Up and outside this window it is a link to the host; stopped it is a button that brings it
 * up; this window's is a button that only opens the panel. The panel opens on hover and on focus and is
 * `fixed`: that way it is not clipped when the column scrolls, and it stays a child of the tile in the DOM
 * order, which is what lets the keyboard reach its buttons.
 */
function Tile(props: {
  project: Project
  /** Every project of the rail, by name: what one project's tone is shaded against (`colourOf`). */
  family: readonly string[]
  /** The last measurement of the rail's wave, or the one this tile's panel made (the panel's wins). */
  measurement?: Measurement
  /** The clock the pulse is judged against: a reading older than the wave does not pulse. */
  now: number
  onChanged: () => Promise<unknown>
  onMeasured: (name: string, measurement: Measurement) => void
}) {
  const { copied, copy } = useCopy()
  const [panelOpen, setPanelOpen] = createSignal(false)
  const [anchor, setAnchor] = createSignal<JSX.CSSProperties>()
  const [pending, setPending] = createSignal<'start' | 'stop' | 'forget'>()
  const [confirm, setConfirm] = createSignal<{ pid: number; url?: string }>()
  /** The question is on screen: `forget` is the only action of the panel that removes a tile. */
  const [forgetAsk, setForgetAsk] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [measuring, setMeasuring] = createSignal(false)
  let frame: HTMLDivElement | undefined
  // Closing waits an instant: the pointer that crosses the gap to the panel does not close it on the way.
  let exit: ReturnType<typeof setTimeout> | undefined
  // Opening waits too: crossing the left edge of the window on the way somewhere else must not open a
  // panel of 240px over the conversation.
  let delayed: ReturnType<typeof setTimeout> | undefined
  onSettled(() => () => {
    clearTimeout(exit)
    clearTimeout(delayed)
  })
  const running = () => props.project.running !== undefined
  const port = () => portOf(props.project.running?.url)
  const link = () => linkOf(props.project)
  const state = () =>
    pending() === 'start' ? 'starting' : pending() === 'stop' ? 'stopping' : stateWord(props.project)
  const dot = () => presence(props.project, props.measurement, props.now)
  const questionBadge = () => questionCount(props.measurement?.openQuestions)
  const time = () => (props.measurement ? formatTime(props.measurement.at) : undefined)
  const buttonTitle = () => tileTitle(props.project, props.measurement, time())

  // What was said of one state does not hold for the other: a new action erases the warning and the
  // question.
  createEffect(
    () => running(),
    () => {
      setError(undefined)
      setConfirm(undefined)
      setForgetAsk(false)
    },
  )

  // The measurement is of the instant the panel opens — and the panel says when it is from. Closed, nothing
  // is measured: the tile keeps the rail's wave measurement, which is from when it was made.
  createEffect(
    () => ({ open: panelOpen(), up: running(), name: props.project.name }),
    ({ open, up, name }) => {
      if (!open || !up) return
      let alive = true
      setMeasuring(true)
      api
        .action(MeasureAction, { name })
        .then((result) => {
          if (alive) props.onMeasured(name, result)
        })
        .catch((cause: unknown) => {
          // The panel invents no number: what failed becomes `unavailable` with the reason.
          if (alive)
            props.onMeasured(name, {
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
    },
  )

  /** Opens the panel beside the tile: to the right, and upwards when the tile is in the lower half. */
  function openPanel() {
    const box = frame?.getBoundingClientRect()
    if (box)
      setAnchor({
        left: `${box.right + 8}px`,
        ...(box.top > window.innerHeight / 2
          ? { bottom: `${window.innerHeight - box.bottom}px` }
          : { top: `${box.top}px` }),
      })
    setPanelOpen(true)
  }

  /**
   * The pointer or the focus came in: the panel opens after `OPEN_DELAY` (if it was already open, the
   * pending closing is cancelled). The delay is what keeps passing over the rail from opening panels.
   */
  const enter = () => {
    clearTimeout(exit)
    if (panelOpen() || delayed) return
    delayed = setTimeout(() => {
      delayed = undefined
      openPanel()
    }, OPEN_DELAY)
  }

  /** It left the tile and the panel: closes in 150 ms, so crossing the gap does not count as leaving. */
  const leave = () => {
    clearTimeout(delayed)
    delayed = undefined
    clearTimeout(exit)
    exit = setTimeout(close, 150)
  }

  function close() {
    clearTimeout(exit)
    setPanelOpen(false)
    setConfirm(undefined)
    setForgetAsk(false)
  }

  // The panel is anchored where it opened: a scroll (of the rail or of anything behind it) would leave tile
  // and panel apart, so it closes instead of pointing at the wrong place.
  createEffect(
    () => panelOpen(),
    (open) => {
      if (!open) return
      const onScroll = () => close()
      document.addEventListener('scroll', onScroll, { capture: true, passive: true })
      return () => document.removeEventListener('scroll', onScroll, { capture: true })
    },
  )

  // `Esc` closes the panel even when it opened with the pointer alone (no focus inside the tile), which is
  // the case in which no `onKeyDown` of the tile would arrive. Nothing is prevented: whoever listens to
  // `Esc` as well keeps listening.
  createEffect(
    () => panelOpen(),
    (open) => {
      if (!open) return
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') close()
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    },
  )

  const start = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    close()
    setPending('start')
    try {
      await api.action(StartAction, { name: props.project.name })
      await props.onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
      setPending(undefined)
    } finally {
      setPending(undefined)
    }
  }

  const stop = async (confirmed = false) => {
    setError(undefined)
    setPending('stop')
    try {
      const result = await api.action(StopAction, {
        name: props.project.name,
        ...(confirmed ? { confirm: true } : {}),
      })
      if (result.stopped) {
        setConfirm(undefined)
        await props.onChanged()
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

  /**
   * Hides the project from this rail: the rail reads the list again, and the tile leaves with it. If it
   * refuses (this window, a file it cannot rewrite), the reason stays in the panel and the tile stays
   * where it is — nothing was written.
   */
  const forgetTile = async () => {
    setError(undefined)
    setPending('forget')
    try {
      await api.action(ForgetAction, { name: props.project.name })
      setForgetAsk(false)
      await props.onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(undefined)
    }
  }

  const letters = () => initials(props.project.name)
  // The tone of this project — its wash, its ink and the edge of the one this window shows. It is applied to
  // the three shapes the tile takes (this window, a host, a stopped project) so a project looks the same
  // wherever it is in the rail.
  const tone = createMemo(() => toneStyle(props.project.name, props.family))
  // The page a click on this tile chose, when it is this tile that was clicked: the target builds its web
  // bundle first, so the tile says so until the page paints, or the Back gesture brings this one back.
  const goingTo = () => opening()
  const openingThis = () =>
    !props.project.current && link() !== undefined && goingTo() === link()
  const look = () =>
    cn(
      'relative flex size-8 items-center justify-center rounded-md border font-mono text-[10.5px] font-medium uppercase tabular-nums outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring',
      props.project.current
        ? 'border-[var(--tile-edge)] bg-[var(--tile-wash-strong)] text-[var(--tile-ink-strong)] dark:bg-[var(--tile-wash-strong-dark)] dark:text-[var(--tile-ink-strong-dark)]'
        : running()
          ? 'border-transparent bg-[var(--tile-wash)] text-[var(--tile-ink)] hover:bg-[var(--tile-wash-hover)] dark:bg-[var(--tile-wash-dark)] dark:text-[var(--tile-ink-dark)] dark:hover:bg-[var(--tile-wash-hover-dark)]'
          : 'border-transparent bg-[var(--tile-wash-idle)] text-muted-foreground/60 hover:text-muted-foreground dark:bg-[var(--tile-wash-idle-dark)]',
      openingThis() && 'animate-pulse-dot',
      // An action that failed leaves its mark on the tile (the whole text is in the `title` and in the
      // panel): the click that did not work cannot vanish in silence.
      error() && 'ring-1 ring-error/60',
    )
  // The `title` and the `aria-label` say the whole sentence — state, counts and the time of the
  // measurement. An action's error beats the sentence: the click that failed cannot vanish, and a click that
  // is on its way says where it goes.
  const title = () => error() ?? (openingThis() ? `opening ${props.project.name}…` : buttonTitle())
  const content = () =>
    pending() === 'start' ? <LoaderCircleIcon class="size-3.5 animate-spin" /> : letters()

  return (
    <div
      class="relative flex w-full shrink-0 justify-center"
      data-project={props.project.name}
      data-status={running() ? 'running' : 'stopped'}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) leave()
      }}
      onFocus={enter}
      onPointerEnter={enter}
      onPointerLeave={leave}
      ref={(element) => {
        frame = element
      }}
    >
      <Switch
        fallback={
          <button
            aria-busy={pending() === 'start' ? 'true' : undefined}
            aria-label={title()}
            class={look()}
            disabled={pending() === 'start'}
            onClick={(event) => void start(event)}
            style={tone()}
            title={title()}
            type="button"
          >
            {content()}
            <Signals dot={dot()} questionBadge={questionBadge()} />
          </button>
        }
      >
        <Match when={props.project.current}>
          <button
            aria-current="page"
            aria-label={title()}
            class={look()}
            onClick={openPanel}
            style={tone()}
            title={title()}
            type="button"
          >
            {content()}
            <Signals dot={dot()} questionBadge={questionBadge()} />
          </button>
        </Match>
        <Match when={running() && link()}>
          {(href) => (
            <a
              aria-label={title()}
              class={look()}
              href={href()}
              onClick={(event) => {
                // The click that stays in this tab is the one that is going somewhere: a modifier or another
                // button opens a new tab (or a window), and this page keeps the screen.
                const elsewhere =
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                if (!elsewhere) setOpening(href())
              }}
              style={tone()}
              title={title()}
            >
              {content()}
              <Signals dot={dot()} questionBadge={questionBadge()} />
            </a>
          )}
        </Match>
      </Switch>
      <Show when={panelOpen() && anchor()}>
        {(position) => (
          <div
            class="fixed z-50 w-60 rounded-md border bg-popover p-3 text-popover-foreground shadow-md before:absolute before:inset-y-0 before:-left-2 before:w-2 before:content-['']"
            data-project-panel={props.project.name}
            style={position()}
          >
            <div class="flex flex-col gap-2 text-[11px]">
              <div class="flex flex-col gap-0.5">
                <span class="truncate text-[12.5px] text-foreground" title={props.project.name}>
                  {props.project.name}
                </span>
                <span
                  class="truncate font-mono text-[10px] text-muted-foreground/70"
                  title={props.project.root}
                >
                  {props.project.root}
                </span>
                {/* Which home the actions address: two homes can be the same project, and the name is what
                    the actions speak. */}
                <Show when={props.project.home}>
                  {(home) => (
                    <span
                      class="truncate font-mono text-[9.5px] text-muted-foreground/50"
                      title={`the actions on this tile address ${home()}`}
                    >
                      {homeLabel(home())}
                    </span>
                  )}
                </Show>
                {/* Where the project comes from: its `origin`, with the lock when it is private. Read in the
                    background, once per process and root; a project that is not on GitHub, or whose repo and
                    visibility could not be read, simply has no chip. */}
                <Show when={props.project.repo}>
                  {(repo) => (
                    <span
                      class="flex min-w-0 items-center gap-1 font-mono text-[10px] text-muted-foreground"
                      data-project-repo={repo().name}
                      title={`${repo().name} — ${repo().visibility}`}
                    >
                      <GitBranchIcon aria-hidden="true" class="size-2.5 shrink-0 opacity-70" />
                      <span class="truncate">{repo().name}</span>
                      <Show when={repoLocked(repo())}>
                        <LockIcon
                          aria-label={repo().visibility}
                          class="size-2.5 shrink-0"
                          role="img"
                        />
                      </Show>
                    </span>
                  )}
                </Show>
              </div>
              <div class="flex items-baseline gap-1.5 font-mono text-[10.5px]">
                <span
                  class={
                    openingThis()
                      ? 'text-brand'
                      : running()
                        ? 'text-success'
                        : 'text-muted-foreground/70'
                  }
                >
                  {openingThis() ? 'opening…' : state()}
                </span>
                <Show when={port()}>
                  {(value) => (
                    <>
                      <span aria-hidden="true" class="text-muted-foreground/40">
                        ·
                      </span>
                      <span class="text-muted-foreground">{value()}</span>
                    </>
                  )}
                </Show>
                <Show when={props.project.current}>
                  <span aria-hidden="true" class="text-muted-foreground/40">
                    ·
                  </span>
                  <span class="text-brand">this window</span>
                </Show>
                <Show when={!running()}>
                  <span aria-hidden="true" class="text-muted-foreground/40">
                    ·
                  </span>
                  <span class="text-muted-foreground/70">click to start</span>
                </Show>
              </div>
              <Show when={running()}>
                <MeasurementPanel measurement={props.measurement} measuring={measuring()} />
              </Show>
              {/* A row that is not running can still have something to say: a lock that names no address
                  of this machine is not a host the tile can open, and the panel says why. */}
              <Show when={!running() && props.project.reason}>
                {(reason) => (
                  <p class="font-mono text-[10.5px] leading-relaxed break-words text-muted-foreground/80">
                    unavailable — {reason()}
                  </p>
                )}
              </Show>
              <div class="flex items-center gap-1">
                <Button
                  class="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                  disabled={!props.project.command}
                  onClick={() => {
                    const command = props.project.command
                    if (command) void copy(command)
                  }}
                  size="xs"
                  title={props.project.command ? `${props.project.command} — click to copy` : 'No path for this project'}
                  type="button"
                  variant="ghost"
                >
                  <Show when={copied()} fallback={<CopyIcon class="size-3" />}>
                    <CheckIcon class="size-3 text-success" />
                  </Show>
                  command
                </Button>
                <Show when={canStop(props.project)}>
                  <Button
                    class="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                    disabled={pending() === 'stop'}
                    onClick={() => void stop()}
                    size="xs"
                    title={`Stop the host${props.project.running ? ` (pid ${props.project.running.pid})` : ''}`}
                    type="button"
                    variant="ghost"
                  >
                    <Show
                      when={pending() === 'stop'}
                      fallback={<SquareIcon class="size-2.5 fill-current" />}
                    >
                      <LoaderCircleIcon class="size-3 animate-spin" />
                    </Show>
                    stop
                  </Button>
                </Show>
                {/* Stopped and not this window: a project that is up is stopped first, and the window that
                    serves the screen never hides itself. */}
                <Show when={!running() && !props.project.current}>
                  <Button
                    class="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                    disabled={pending() === 'forget'}
                    onClick={() => setForgetAsk(true)}
                    size="xs"
                    title="Hide it from this rail — its conversations stay where they are"
                    type="button"
                    variant="ghost"
                  >
                    <EyeOffIcon class="size-3" />
                    forget…
                  </Button>
                </Show>
              </div>
              <Show when={forgetAsk()}>
                <div class="flex flex-col gap-1 rounded-md bg-muted/50 p-2" data-forget={props.project.name}>
                  <p class="leading-relaxed text-muted-foreground">
                    Hide {props.project.name} from this rail? The project's conversations stay where they
                    are — nothing is deleted.
                  </p>
                  <p class="text-[10px] leading-relaxed break-words text-muted-foreground/60">
                    back: remove its home from projects.hidden in ~/.ultimate/settings.json
                  </p>
                  <div class="flex items-center gap-2 font-mono text-[10px]">
                    <button
                      class="cursor-pointer text-error outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                      disabled={pending() === 'forget'}
                      onClick={() => void forgetTile()}
                      type="button"
                    >
                      {pending() === 'forget' ? 'forgetting…' : 'forget it'}
                    </button>
                    <button
                      class="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={() => setForgetAsk(false)}
                      type="button"
                    >
                      keep it
                    </button>
                  </div>
                </div>
              </Show>
              <Show when={confirm()}>
                {(stopping) => (
                  <div class="flex flex-col gap-1 rounded-md bg-muted/50 p-2">
                    <p class="leading-relaxed text-muted-foreground">
                      Stop the host{port() ? ` on ${port()}` : ''} (pid {stopping().pid})? It was not
                      started from here.
                    </p>
                    <div class="flex items-center gap-2 font-mono text-[10px]">
                      <button
                        class="cursor-pointer text-error outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={() => void stop(true)}
                        type="button"
                      >
                        stop it
                      </button>
                      <button
                        class="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={() => setConfirm(undefined)}
                        type="button"
                      >
                        keep it
                      </button>
                    </div>
                  </div>
                )}
              </Show>
              <Show when={error()}>
                {(message) => (
                  <p class="line-clamp-3 leading-relaxed break-words text-error" title={message()}>
                    {message()}
                  </p>
                )}
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

/**
 * The two indicators in the tile's corner, with the semantics and the classes of the app's mark
 * (`AgentMark`): the presence dot — pulsing while it works, brand **still** when the last reading that said
 * "working" is older than the wave, green up and idle, grey stopped, hollow when the host did not answer —
 * and, when there is a question without an answer, the number in amber in the top corner. The whole
 * sentence is in the tile's `title`/`aria-label`; here nothing is read by a screen reader.
 */
function Signals(props: { dot: Presence; questionBadge: string | undefined }) {
  return (
    <>
      <span
        aria-hidden="true"
        class={cn(
          'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-[1.5px] ring-sidebar',
          props.dot === 'working' && 'animate-pulse-dot bg-brand',
          // Was working when it was measured, and that is longer ago than the wave: the same colour, no
          // pulse — the pixel does not claim "now".
          props.dot === 'stale' && 'bg-brand',
          props.dot === 'idle' && 'bg-success',
          props.dot === 'stopped' && 'bg-muted-foreground/60',
          // Not answering is not idle: the dot stays hollow, without pulse and without working colour.
          props.dot === 'unavailable' && 'bg-transparent ring-muted-foreground/50',
        )}
        data-presence={props.dot}
      />
      <Show when={props.questionBadge}>
        {(badge) => (
          <span
            aria-hidden="true"
            class="absolute -top-1 -right-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-amber-400 px-1 pt-px font-mono text-[8px] leading-none font-semibold tabular-nums text-amber-950 ring-[1.5px] ring-sidebar"
            data-questions={badge()}
          >
            {badge()}
          </span>
        )}
      </Show>
    </>
  )
}

/**
 * What was measured in the host, in the panel: `1 working · 1 question`, with the time of the measurement.
 * A host that did not answer shows `unavailable` and the reason — never an invented zero, which is exactly
 * what would make one ignore the stuck project.
 */
function MeasurementPanel(props: { measurement: Measurement | undefined; measuring: boolean }) {
  return (
    <Show
      when={!props.measuring && props.measurement}
      fallback={
        <p class="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/70">
          <LoaderCircleIcon class="size-2.5 animate-spin" />
          measuring…
        </p>
      }
    >
      {(measurement) => (
        <div class="flex flex-col gap-0.5">
          <Show
            when={hasMeasurement(measurement().working, measurement().openQuestions)}
            fallback={
              <p class="font-mono text-[10.5px] text-muted-foreground/80">
                unavailable
                <Show when={measurement().reason}>
                  {(reason) => (
                    <span class="text-muted-foreground/60"> — {reason()}</span>
                  )}
                </Show>
              </p>
            }
          >
            <p class="font-mono text-[10.5px] text-muted-foreground">
              <span class="text-foreground/80">{workingCount(measurement().working)}</span>
              <span aria-hidden="true"> · </span>
              {questions(measurement().openQuestions)}
            </p>
          </Show>
          <p
            class="font-mono text-[10px] text-muted-foreground/60"
            title={questionsTitle(measurement().openQuestions, measurement().reason)}
          >
            measured at {formatTime(measurement().at)}
          </p>
        </div>
      )}
    </Show>
  )
}

/** A round button at the bottom of the rail: the refresh one, the `+` and the splash animation's. */
function Icon(props: {
  label: string
  title: string
  onClick: () => void
  class?: string
  disabled?: boolean
  children: JSX.Element
}) {
  return (
    <button
      aria-label={props.label}
      class={cn(
        'flex cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
        props.disabled && 'pointer-events-none opacity-40',
        props.class,
      )}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      type="button"
    >
      {props.children}
    </button>
  )
}

/**
 * The `+` dialog: a path, which becomes a project — expanded by the server (`~`), checked as a folder and
 * brought up as `start` brings one up. A folder that is already a project of the list is selected instead
 * of gaining a second host; a new project appears on the rail, and its first run — onboarding and the trust
 * decision for that folder — happens in its window, not here.
 */
function NewProject(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<unknown>
}) {
  const [path, setPath] = createSignal('')
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [outcome, setOutcome] = createSignal<CreateResult>()
  const changeOpen = (next: boolean) => {
    if (!next) {
      setPath('')
      setError(undefined)
      setOutcome(undefined)
      setSending(false)
    }
    props.onOpenChange(next)
  }
  const create = async (event: Event) => {
    event.preventDefault()
    if (!path().trim() || sending()) return
    setSending(true)
    setError(undefined)
    try {
      const result = await api.action(CreateAction, { path: path() })
      setOutcome(result)
      await props.onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSending(false)
    }
  }
  const url = () => outcome()?.project.running?.url
  return (
    <Dialog open={props.open} onOpenChange={changeOpen}>
      <DialogContent class="gap-0 p-0 sm:max-w-md" data-new-project showCloseButton={false}>
        <DialogTitle class="sr-only">New project</DialogTitle>
        <DialogDescription class="sr-only">
          Start a project from a folder on this machine.
        </DialogDescription>
        <Show
          when={outcome()}
          fallback={
            <form
              class="flex flex-col gap-3 px-5 py-4"
              onSubmit={(event) => {
                event.preventDefault()
                void create(event)
              }}
            >
              <div class="flex flex-col gap-1">
                <DialogTitle class="text-[13px]">New project</DialogTitle>
                <DialogDescription class="text-[12px] leading-relaxed text-muted-foreground">
                  A folder on this machine. ultimate starts in it on the first free port, with no
                  window; its tile appears in the rail.
                </DialogDescription>
              </div>
              <label class="flex flex-col gap-1">
                <span class="font-mono text-[10px] tracking-wide text-muted-foreground/70 uppercase">
                  folder
                </span>
                <input
                  aria-label="Folder"
                  class="h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 font-mono text-[12px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
                  disabled={sending()}
                  onInput={(event) => setPath(event.currentTarget.value)}
                  placeholder="~/src/my-project"
                  spellcheck={false}
                  value={path()}
                />
              </label>
              <Show when={error()}>
                {(message) => (
                  <p class="font-mono text-[11px] leading-relaxed break-words text-error">{message()}</p>
                )}
              </Show>
              <div class="flex items-center justify-end gap-2">
                <Button
                  class="h-7 text-[12px]"
                  disabled={sending()}
                  onClick={() => changeOpen(false)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  class="h-7 gap-1.5 text-[12px]"
                  disabled={!path().trim() || sending()}
                  size="sm"
                  type="submit"
                >
                  <Show when={sending()}>
                    <LoaderCircleIcon class="size-3.5 animate-spin" />
                  </Show>
                  {sending() ? 'Starting…' : 'Start project'}
                </Button>
              </div>
            </form>
          }
        >
          {(result) => (
            <div class="flex flex-col gap-3 px-5 py-4">
              <div class="flex flex-col gap-1">
                <span class="text-[13px] text-foreground">
                  {result().project.name}{' '}
                  {result().project.current ? 'is this window' : 'is running'}{' '}
                  <span class="font-mono text-[11px] text-muted-foreground">
                    {portOf(result().project.running?.url) ?? ''}
                  </span>
                </span>
                <p class="text-[12px] leading-relaxed text-muted-foreground">
                  {result().created
                    ? 'Its first run — onboarding and the trust decision for that folder — happens in its own window. The tile is in the rail.'
                    : result().unhidden
                      ? 'It was hidden from this rail: asking for it again brought it back. No second host was started for that folder.'
                      : 'No second host was started for that folder.'}
                </p>
              </div>
              <div class="flex items-center justify-end gap-2">
                <Show when={url() && !result().project.current}>
                  <Button
                    class="h-7 text-[12px]"
                    onClick={() => window.location.assign(url() ?? '')}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Open it
                  </Button>
                </Show>
                <Button
                  class="h-7 text-[12px]"
                  onClick={() => changeOpen(false)}
                  size="sm"
                  type="button"
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </Show>
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
  const list = useAction(ListAction, {})
  const [open, setOpen] = createSignal(true)
  // A button that changes the machine measures the whole section again: what changed appears with no poll.
  const refresh = () => list.refetch().then(() => {})
  // While only one project is known there is nothing to jump between, and the section would be decoration.
  const visible = () => !!list.error() || (list.data()?.projects.length ?? 0) >= 2
  return (
    <Show when={visible()}>
      <Collapsible
        aria-label="Projects"
        class="mb-1 flex flex-col gap-px border-b border-border/60 pb-1"
        data-sidebar-section="projects"
        onOpenChange={setOpen}
        open={open()}
      >
        <div class="mx-2 flex h-6 items-center gap-1">
          <CollapsibleTrigger class="group/projects flex h-6 cursor-pointer items-center gap-1 rounded-md px-1 section-label outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
            <ChevronRightIcon class="size-3 transition-transform group-data-[state=open]/projects:rotate-90" />
            Projects
          </CollapsibleTrigger>
          <Show when={list.data()}>
            {(data) => (
              <span class="font-mono text-[11px] text-muted-foreground/60 tabular-nums">
                {data().projects.length}
              </span>
            )}
          </Show>
          <button
            aria-label="Refresh the projects"
            class="ml-auto flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => void refresh()}
            title="Refresh the projects"
            type="button"
          >
            <RotateCwIcon class={cn('size-3', list.loading() && 'animate-spin')} />
          </button>
        </div>
        <CollapsibleContent class="flex flex-col gap-px">
          <Show
            when={list.error()}
            fallback={
              <For
                each={list.data()?.projects ?? []}
                keyed={(project) => project.home ?? project.root}
              >
                {(project) => (
                  <Row
                    family={list.data()?.projects.map((item) => item.name) ?? []}
                    onChanged={refresh}
                    project={project()}
                  />
                )}
              </For>
            }
          >
            {(error) => (
              <div class="mx-2 flex flex-col gap-1 rounded-md px-1 py-1">
                <p class="font-mono text-[10px] leading-relaxed break-words text-error">
                  {error().message}
                </p>
                <button
                  class="cursor-pointer text-left font-mono text-[10px] text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => void refresh()}
                  type="button"
                >
                  try again
                </button>
              </div>
            )}
          </Show>
        </CollapsibleContent>
      </Collapsible>
    </Show>
  )
}

/**
 * A row of the phone's list: the dot and the name, the state written out beside it, and below the port
 * (link to the same tab) with the measurement, or the command to copy when the host is stopped. The button
 * at the end brings the stopped project up and brings down the one that is up.
 */
function Row(props: {
  project: Project
  /** The names of every project of the machine, for the tone of this row's name. */
  family: readonly string[]
  onChanged: () => Promise<unknown>
}) {
  const { copied, copy } = useCopy()
  const [pending, setPending] = createSignal<'start' | 'stop'>()
  const [confirm, setConfirm] = createSignal<{ pid: number; url?: string }>()
  const [error, setError] = createSignal<string>()
  const running = () => props.project.running !== undefined
  // What was said of one state does not hold for the other: a new measurement erases the warning and the
  // question.
  createEffect(
    () => running(),
    () => {
      setError(undefined)
      setConfirm(undefined)
    },
  )
  const port = () => portOf(props.project.running?.url)
  const copyable = () => props.project.command
  const path = () =>
    props.project.current ? `${props.project.root} — this window` : props.project.root
  // The tone of this project: on the phone the name itself takes it, there being no tile to wash.
  const tone = createMemo(() => toneStyle(props.project.name, props.family))
  const state = () =>
    pending() === 'start' ? 'starting' : pending() === 'stop' ? 'stopping' : stateWord(props.project)

  const failed = (cause: unknown) => setError(errorMessage(cause))

  const start = async () => {
    setError(undefined)
    setConfirm(undefined)
    setPending('start')
    try {
      await api.action(StartAction, { name: props.project.name })
      await props.onChanged()
    } catch (cause) {
      failed(cause)
    } finally {
      setPending(undefined)
    }
  }

  const stop = async (confirmed = false) => {
    setError(undefined)
    setPending('stop')
    try {
      const result = await api.action(StopAction, {
        name: props.project.name,
        ...(confirmed ? { confirm: true } : {}),
      })
      if (result.stopped) {
        setConfirm(undefined)
        await props.onChanged()
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

  const action = () =>
    props.project.current ? undefined : running() ? (
      <RowButton
        label={`Stop ${props.project.name}`}
        onClick={() => void stop()}
        pending={pending() === 'stop'}
        title={`Stop the host${port() ? ` on ${port()}` : ''}${props.project.running ? ` (pid ${props.project.running.pid})` : ''}`}
      >
        <SquareIcon class="size-2.5 fill-current" />
      </RowButton>
    ) : (
      <RowButton
        label={`Start ${props.project.name}`}
        onClick={() => void start()}
        pending={pending() === 'start'}
        title={copyable() ? `${copyable()} — started detached, no window` : 'Start the host'}
      >
        <PlayIcon class="size-2.5 fill-current" />
      </RowButton>
    )

  return (
    <div
      class="group/project mx-2 flex min-w-0 flex-col gap-px rounded-md py-1 pr-2 pl-2.5"
      data-current={props.project.current ? '' : undefined}
      data-project={props.project.name}
      style={tone()}
    >
      <div class="flex min-w-0 items-center gap-2" title={path()}>
        <span
          aria-hidden="true"
          class={cn(
            'inline-block size-1.5 shrink-0 rounded-full',
            running() ? 'bg-success' : 'bg-muted-foreground/40',
          )}
          data-status={running() ? 'running' : 'stopped'}
        />
        <span
          class={cn(
            'min-w-0 flex-1 truncate text-[12.5px]',
            props.project.current
              ? 'text-[var(--tile-ink-strong)] dark:text-[var(--tile-ink-strong-dark)]'
              : 'text-[var(--tile-ink)] dark:text-[var(--tile-ink-dark)]',
          )}
        >
          {props.project.name}
        </span>
        <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{state()}</span>
      </div>
      <div class="flex min-w-0 items-center gap-1 pl-[14px] font-mono text-[10px] text-muted-foreground">
        <Show
          when={running()}
          fallback={
            <Show
              when={copyable()}
              fallback={<span>path unknown</span>}
            >
              {(command) => (
                <button
                  class="group/copy flex min-w-0 cursor-pointer items-center gap-1 text-left outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => void copy(command())}
                  title={`${command()}\nclick to copy`}
                  type="button"
                >
                  <span class="truncate">{command()}</span>
                  <Show
                    when={copied()}
                    fallback={
                      <CopyIcon class="size-3 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-50" />
                    }
                  >
                    <CheckIcon class="size-3 shrink-0 text-success" />
                  </Show>
                </button>
              )}
            </Show>
          }
        >
          <Show when={port()}>
            {(value) => (
              <Show
                when={!props.project.current}
                fallback={
                  <span class="shrink-0" title={`${props.project.running?.url} — this window`}>
                    {value()}
                  </span>
                }
              >
                <a
                  aria-label={`Open ${props.project.name} at ${props.project.running?.url}`}
                  class="shrink-0 outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                  href={props.project.running?.url}
                  title={`Open ${props.project.running?.url} in this tab`}
                >
                  {value()}
                </a>
              </Show>
            )}
          </Show>
          <Show when={port()}>
            <span aria-hidden="true">·</span>
          </Show>
          <RowMeasurement project={props.project} />
        </Show>
        <Show when={action()}>
          <span class="pointer-coarse:opacity-100 ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-hover/project:opacity-100 focus-within:opacity-100">
            {action()}
          </span>
        </Show>
      </div>
      <Show when={confirm()}>
        {(stopping) => (
          <div class="mt-1 flex flex-col gap-1 rounded-md bg-muted/50 px-2 py-1.5">
            <p class="text-[10.5px] leading-relaxed text-muted-foreground">
              Stop the host{port() ? ` on ${port()}` : ''} (pid {stopping().pid})? It was not started from
              here.
            </p>
            <div class="flex items-center gap-2 font-mono text-[10px]">
              <button
                class="cursor-pointer text-error outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => void stop(true)}
                type="button"
              >
                stop it
              </button>
              <button
                class="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => setConfirm(undefined)}
                type="button"
              >
                keep it
              </button>
            </div>
          </div>
        )}
      </Show>
      <Show when={error()}>
        {(message) => (
          <p
            class="mt-1 line-clamp-3 font-mono text-[10px] leading-relaxed break-words text-error"
            title={message()}
          >
            {message()}
          </p>
        )}
      </Show>
    </div>
  )
}

/** The measurement of the phone's row: `1 working · 1 question`, or `unavailable` — never an invented
 * zero. */
function RowMeasurement(props: { project: Project }) {
  return (
    <Show
      when={hasMeasurement(props.project.working, props.project.openQuestions)}
      fallback={
        <span class="min-w-0 truncate" title={props.project.reason ?? 'no measurement'}>
          unavailable
        </span>
      }
    >
      <span class="shrink-0">{workingCount(props.project.working)}</span>
      <span aria-hidden="true">·</span>
      <span
        class={cn(
          'min-w-0 truncate',
          (measured(props.project.openQuestions) ?? 0) > 0 && 'text-foreground/80',
        )}
        title={questionsTitle(props.project.openQuestions, props.project.reason)}
      >
        {questions(props.project.openQuestions)}
      </span>
    </Show>
  )
}

/** The button that brings a host up and down, at the end of the phone's row. */
function RowButton(props: {
  label: string
  title: string
  pending: boolean
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <button
      aria-busy={props.pending ? 'true' : undefined}
      aria-label={props.label}
      class="flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default"
      disabled={props.pending}
      onClick={props.onClick}
      title={props.title}
      type="button"
    >
      <Show when={props.pending} fallback={props.children}>
        <LoaderCircleIcon class="size-3 animate-spin" />
      </Show>
    </button>
  )
}
