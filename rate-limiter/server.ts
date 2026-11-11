/**
 * A ceiling on concurrent requests per provider, as an extension: a provider the settings name gets
 * that many requests at a time, the rest wait in arrival order. It wraps the provider's own stream and
 * nothing else, so a facet that fails to install leaves the provider as it was.
 *
 * The ceilings are the `rateLimiter.limits` of this machine's `~/.ultimate/settings.json` (never a
 * project's: a project must not raise the ceiling of the other conversations on this machine), over the
 * code's `LIMITS` in `limiter.ts`, which ships empty — a provider nobody named is not limited. Saving that file reinstalls the extension, and the
 * semaphore is kept across the reinstall, so the queue and the slots in flight survive it.
 *
 * The wrapper and the semaphore live in a `host.resource`: on a reload the composed provider
 * already carries the previous facet's wrapper, and wrapping that again would take two slots per
 * request. The resource keeps the flow this extension first saw, so a reload wraps it once more.
 * Closing touches no provider registration: unregistering would remove a provider that exists
 * without this extension.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from '@earendil-works/pi-ai'
import type { JsonValue } from '@earendil-works/chord'
import { defineExtension } from '@earendil-works/pi-durable'
import { LIMITS, ProviderLimiter, resolveLimits } from './limiter.ts'
import type { Limits, Resolved } from './limiter.ts'

/** Saving the settings file reinstalls this extension, so a new ceiling applies at once. */
export const reloadOnSettings = true

export type Stream = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream

/**
 * What this extension needs of the host: the provider runtime, a shared resource, a notice, and where
 * this machine's settings live.
 */
export type Host = {
  modelRuntime: {
    getProvider(id: string): { streamSimple: Stream; getModels(): readonly Model<Api>[] } | undefined
    registerProvider(id: string, config: { api: Api; streamSimple: Stream }): void
  }
  resource<T>(key: string, create: () => T): T
  notice(message: string): void
  /** Run `callback` on every harness open, at once when it is already open. */
  onOpen(callback: () => Promise<void>): void
  userHome: string
}

type State = {
  /** The ceilings in force at the last install; the limiter reads them on every acquire. */
  limits: Limits
  limiter: ProviderLimiter
  /** The provider's flow before this extension wrapped it, and the api it was registered with. */
  originals: Map<string, { api: Api; stream: Stream }>
  wrapped: Set<string>
  /** The names in the limits this machine has no provider for, sorted. */
  unknown: string[]
  /** The unknown names the last install reported, so the same set is not reported again. */
  reported: string
}

/**
 * No arguments → which providers are wrapped, which names have no provider here (sorted), the ceilings,
 * and the slots in flight and waiting.
 */
export type Status = {
  wrapped: string[]
  unknown: string[]
  limits: Record<string, number>
  active: Record<string, number>
  queued: Record<string, number>
}

const state = (host: Pick<Host, 'resource'>) =>
  host.resource<State>('rate-limiter.slots', () => {
    const shared: State = {
      limits: LIMITS,
      limiter: new ProviderLimiter(() => shared.limits),
      originals: new Map(),
      wrapped: new Set(),
      unknown: [],
      reported: '',
    }
    return shared
  })

/**
 * Wrap every provider this machine limits, or has limited before, that exists here. A reload
 * re-registers the same wrapper over the flow kept in the resource, a provider without
 * `streamSimple` is left alone and reported instead of registered, and a name that has no provider
 * here is reported once per set of names.
 *
 * `report` is what says whether the unknown names may be announced now: at load time the harness may not
 * be open yet, and a notice emitted then reaches nobody — the notice goes out from the install that runs
 * on open (`host.onOpen`), where there is someone to read it, and the set is deduplicated there.
 */
export async function install(host: Host, report = true): Promise<State> {
  const shared = state(host)
  // A reload keeps the semaphore (its slots and queue) and takes the ceilings saved in the file now.
  const { limits, problems } = await ceilings(host.userHome)
  for (const problem of problems) host.notice(`rate-limiter: ${problem}`)
  shared.limits = limits
  // A name without a provider limits nothing. The normal path is a human editing the settings file,
  // so the silence would leave a typo in place for good: say it, once per distinct set of names.
  const unknown = Object.keys(limits)
    .filter((provider) => !host.modelRuntime.getProvider(provider))
    .sort()
  if (report && unknown.join('\n') !== shared.reported) {
    shared.reported = unknown.join('\n')
    if (unknown.length) host.notice(noProvider(unknown))
  }
  shared.unknown = unknown
  // A provider left out of the settings today is still wrapped, with the code in force now: its
  // wrapper reads no ceiling and passes the call straight through.
  for (const provider of new Set([...Object.keys(limits), ...shared.originals.keys()])) {
    const current = host.modelRuntime.getProvider(provider)
    // A provider this machine does not have is not an error: the limits name machines' providers.
    if (!current) {
      shared.wrapped.delete(provider)
      continue
    }
    const api = current.getModels()[0]?.api
    // The api and the flow are two halves of one registration, so a provider can lack either: the
    // report names the half that is missing, or it would point at the wrong thing to fix.
    if (!current.streamSimple || !api) {
      const missing = api ? 'no streamSimple' : "no models' api"
      host.notice(`rate-limiter: provider ${provider} exposes ${missing}; it is running unlimited`)
      continue
    }
    const original = shared.originals.get(provider) ?? { api, stream: current.streamSimple }
    shared.originals.set(provider, original)
    try {
      host.modelRuntime.registerProvider(provider, {
        api: original.api,
        streamSimple: limited(original.stream, shared.limiter, provider),
      })
      shared.wrapped.add(provider)
    } catch (error) {
      shared.wrapped.delete(provider)
      host.notice(`rate-limiter: could not wrap ${provider}: ${message(error)}`)
    }
  }
  return shared
}

/** One line for every name in the limits this machine has no provider for. */
const noProvider = (names: string[]) =>
  `rate-limiter: no provider named ${names.map((name) => `"${name}"`).join(', ')} on this machine; ` +
  `${names.map((name) => `rateLimiter.limits.${name}`).join(' and ')} ` +
  `${names.length === 1 ? 'limits' : 'limit'} nothing`

export default async function rateLimiter(host: Host) {
  // Before the harness is open nobody reads a notice: this first install wraps what exists, and says
  // nothing about the names it cannot find.
  await install(host, false)
  // A provider can be registered after this facet loads (another extension opening, a partial reload):
  // install wraps what exists now on every open, over the flow and the semaphore the resource keeps —
  // and this is the install that reports the names this machine has no provider for.
  host.onOpen(() => install(host).then(() => {}))
  return defineExtension({ name: 'rate-limiter' })
}

/** This machine's settings file. A project's `.ultimate/settings.json` is deliberately not read. */
const settingsPath = (userHome: string) => join(userHome, '.ultimate/settings.json')

/** The settings file as parsed, `undefined` when there is none; unreadable or invalid JSON throws. */
async function readSettings(userHome: string): Promise<unknown> {
  const path = settingsPath(userHome)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return JSON.parse(text)
}

/** The ceilings of this machine, and why a saved one was refused; anything unreadable keeps the defaults. */
async function ceilings(userHome: string): Promise<Resolved> {
  let settings: unknown
  try {
    settings = await readSettings(userHome)
  } catch (error) {
    return {
      limits: LIMITS,
      problems: [
        `could not read ${settingsPath(userHome)} (${message(error)}); keeping the defaults`,
      ],
    }
  }
  return resolveLimits(settings)
}

/** The provider's flow, run only while holding a slot; the slot comes back when the stream ends. */
export function limited(original: Stream, limiter: ProviderLimiter, provider: string): Stream {
  return (model, context, options) => {
    const out = createAssistantMessageEventStream()
    const signal = options?.signal
    const run = async () => {
      let release: (() => void) | undefined
      try {
        release = await limiter.acquire(provider, signal)
        const inner = original(model, context, options)
        for await (const event of inner) out.push(event)
        out.end(await inner.result())
      } catch (error) {
        out.push(failure(model, error, signal))
        out.end()
      } finally {
        release?.()
      }
    }
    void run().catch((error: unknown) => {
      console.error('rate-limiter: relaying the provider stream failed:', error)
    })
    return out
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The stream a failed request ends with: the caller's abort if it aborted, the error otherwise. */
function failure(model: Model<Api>, error: unknown, signal?: AbortSignal) {
  const aborted = signal?.aborted === true
  const empty: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: aborted ? 'aborted' : 'error',
    timestamp: Date.now(),
    errorMessage: `rate-limiter: ${message(error)}`,
  }
  return { type: 'error' as const, reason: aborted ? ('aborted' as const) : ('error' as const), error: empty }
}

export const actions = {
  /** `{ wrapped, unknown, limits, active, queued }`: what is held to a ceiling, and the slots right now. */
  async status(_args: JsonValue, ctx: { host: Pick<Host, 'resource'> }): Promise<Status> {
    const shared = state(ctx.host)
    // The limits are read from the semaphore, so a ceiling of another value needs no rebuild.
    const limits = shared.limiter.limits()
    const wrapped = [...shared.wrapped].sort()
    const active: Record<string, number> = {}
    const queued: Record<string, number> = {}
    for (const provider of wrapped) {
      active[provider] = shared.limiter.active(provider)
      queued[provider] = shared.limiter.queued(provider)
    }
    return { wrapped, unknown: shared.unknown, limits, active, queued }
  },
}
