/**
 * The semaphore: at most `limit` requests in flight per provider, the rest waiting in arrival order.
 *
 * Pure Node (no host, no pi), so it is tested on its own. `LIMITS` ships **empty**: a provider nobody
 * named is not limited, and `resolveLimits` reads the ceilings saved in `~/.ultimate/settings.json`.
 * `Infinity` returns a slot without queueing.
 */
export type Limits = Readonly<Record<string, number>>

/**
 * The ceilings the code ships with: none. A default here would throttle a stranger's subscription
 * before they asked for it, and this repository is public — the machine's settings name the providers
 * that need a ceiling. Editing this file reinstalls the extension too.
 */
export const LIMITS: Limits = {}

/** The ceilings in force, and what in the settings was refused. */
export type Resolved = { limits: Limits; problems: string[] }

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const unchanged = (ceiling: number | undefined) =>
  ceiling === undefined ? 'it stays unlimited' : `it stays at ${ceiling}`

/**
 * The ceilings in force: `LIMITS` (empty today), with this machine's `rateLimiter.limits` over them.
 * A provider named in neither is not limited.
 *
 * A value that is not a whole number of at least one is refused, and only a problem comes back for
 * it: `0` would hold back every call on this machine for good, and that is an outage, not a ceiling.
 */
export function resolveLimits(settings: unknown): Resolved {
  const limits: Record<string, number> = { ...LIMITS }
  const problems: string[] = []
  if (settings === undefined) return { limits, problems }
  if (!isObject(settings)) return { limits, problems: ['settings are not a JSON object'] }
  const block = settings.rateLimiter
  if (block === undefined) return { limits, problems }
  if (!isObject(block)) return { limits, problems: ['rateLimiter must be an object'] }
  const named = block.limits
  if (named === undefined) return { limits, problems }
  if (!isObject(named))
    return { limits, problems: ['rateLimiter.limits must be an object of provider to ceiling'] }
  for (const [provider, value] of Object.entries(named)) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
      limits[provider] = value
      continue
    }
    problems.push(
      `rateLimiter.limits.${provider} must be a whole number of at least 1, ` +
        `not ${JSON.stringify(value)}: ${unchanged(limits[provider])}`,
    )
  }
  return { limits, problems }
}

type Waiter = {
  signal?: AbortSignal
  /** Hands a free slot over; the slot count does not change. */
  grant: () => void
  reject: (reason: unknown) => void
  detach: () => void
}

const aborted = (signal?: AbortSignal) => signal?.reason ?? new Error('aborted')

export class ProviderLimiter {
  readonly #limits: () => Limits
  readonly #active = new Map<string, number>()
  readonly #queue = new Map<string, Waiter[]>()

  /**
   * The ceilings are read at every acquire, so the extension can hand in the ones saved in the
   * file now: a reload builds a new limiter, and requests already in flight keep the slots they
   * hold through the closure they read from their own instance.
   */
  constructor(limits: Limits | (() => Limits) = LIMITS) {
    this.#limits = typeof limits === 'function' ? limits : () => limits
  }

  /** The ceiling of `provider`; a provider absent from the limits is not limited. */
  limit(provider: string): number {
    const limit = this.#limits()[provider]
    return limit === undefined ? Infinity : Math.max(1, Math.floor(limit))
  }

  active(provider: string): number {
    return this.#active.get(provider) ?? 0
  }

  queued(provider: string): number {
    return this.#queue.get(provider)?.length ?? 0
  }

  /**
   * One slot for `provider`. `release` is idempotent; a request aborted while queued rejects and
   * leaves no slot behind.
   */
  async acquire(provider: string, signal?: AbortSignal): Promise<() => void> {
    const limit = this.limit(provider)
    if (limit === Infinity) return () => {}
    if (signal?.aborted) throw aborted(signal)
    const current = this.active(provider)
    if (current < limit) {
      this.#active.set(provider, current + 1)
      return this.#slot(provider)
    }
    await new Promise<void>((resolve, reject) => {
      const queue = this.#queue.get(provider) ?? []
      this.#queue.set(provider, queue)
      const waiter: Waiter = {
        signal,
        grant: () => {
          waiter.detach()
          resolve()
        },
        reject: (reason) => {
          waiter.detach()
          reject(reason)
        },
        detach: () => signal?.removeEventListener('abort', onAbort),
      }
      const onAbort = () => {
        const at = queue.indexOf(waiter)
        if (at >= 0) queue.splice(at, 1)
        if (!queue.length) this.#queue.delete(provider)
        waiter.reject(aborted(signal))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      queue.push(waiter)
    })
    // The slot was handed over by a release: the active count already accounts for it.
    return this.#slot(provider)
  }

  /** Where the ceiling is read, so a reload's new limits apply without rebuilding the semaphore. */
  limits(): Record<string, number> {
    const listed: Record<string, number> = {}
    for (const provider of Object.keys(this.#limits())) listed[provider] = this.limit(provider)
    return listed
  }

  #slot(provider: string): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const queue = this.#queue.get(provider)
      while (queue?.length) {
        const next = queue.shift()!
        if (!queue.length) this.#queue.delete(provider)
        // An abort event that has not run yet must not take the slot it can no longer use.
        if (next.signal?.aborted) {
          next.reject(aborted(next.signal))
          continue
        }
        next.grant()
        return
      }
      const left = this.active(provider) - 1
      if (left > 0) this.#active.set(provider, left)
      else this.#active.delete(provider)
    }
  }
}
