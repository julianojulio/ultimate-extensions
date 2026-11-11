/**
 * `node --test limiter.test.ts` — the semaphore alone, the ceilings the settings file sets, then two
 * loads over the same host: a reload must leave one level of wrapper, not two, and a name with no
 * provider here must be reported once per distinct set of names.
 *
 * The host is a fake and the settings live in a temporary home, so nothing here touches the
 * machine's providers or its own settings file. The stream comes from `host-doubles.ts`, so a clean
 * clone with no `node_modules` runs the same tests as the machine.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  TranscriptContext,
} from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from './host-doubles.ts'
import { LIMITS, ProviderLimiter, resolveLimits } from './limiter.ts'
import type { Host, Stream } from './server.ts'

// `server.ts` imports two of the host's packages as values, and a checkout has no `node_modules` until
// `install.sh` links it. Where they do not resolve they are answered from the local double, so this
// file loads in a clean clone; where they do, the machine's own packages are used.
const hostPackages = new Set(['@earendil-works/pi-ai', '@earendil-works/pi-durable'])
const doubles = new URL('./host-doubles.ts', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!hostPackages.has(specifier)) return nextResolve(specifier, context)
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      // Only a package that is not installed is answered here; anything else is the machine's problem.
      if ((error as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND') throw error
      return { url: doubles, shortCircuit: true }
    }
  },
})

// Imported after the hook, and after this file's static imports have resolved: a static import of
// `server.ts` would fail on a clean clone before the hook existed.
const server = await import('./server.ts')
const rateLimiter = server.default
const { actions, install, limited } = server

const tick = () => new Promise((resolve) => setImmediate(resolve))

const model = {
  api: 'openai-completions',
  provider: 'openai',
  id: 'gpt-5',
} as unknown as Model<Api>
const context = {} as TranscriptContext

const answer = (): AssistantMessage => ({
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
  stopReason: 'stop',
  timestamp: Date.now(),
})

/** A provider call that starts and finishes only when the test lets it. */
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  const calls = { count: 0 }
  const stream: Stream = () => {
    calls.count++
    const out = createAssistantMessageEventStream()
    void (async () => {
      await opened
      out.push({ type: 'done', reason: 'stop', message: answer() })
      out.end()
    })()
    return out
  }
  return { open, calls, stream }
}

const consume = async (out: AssistantMessageEventStream) => {
  const events = []
  for await (const event of out) events.push(event)
  return events
}

/** A home of its own, with its settings file written when `contents` is given. */
async function tempHome(contents?: string) {
  const home = await mkdtemp(join(tmpdir(), 'rate-limiter-'))
  if (contents === undefined) return home
  await mkdir(join(home, '.ultimate'), { recursive: true })
  await writeFile(join(home, '.ultimate/settings.json'), contents)
  return home
}

/** The settings file that gives the provider a ceiling. */
const saved = (ceiling: number) =>
  JSON.stringify({ rateLimiter: { limits: { [model.provider]: ceiling } } })

/**
 * A host with `openai` on a flow the test opens and closes; `flows` lets a test add a provider that
 * another extension registers after this one loaded. The resources are one map for the whole test, as
 * in the host: two installs share one semaphore. `openers` are the callbacks `onOpen` registered: the
 * test runs them where the host runs them at the harness open, so a provider can appear between two.
 */
function fakeHost(userHome: string) {
  const provided = gate()
  const flows = new Map<string, ReturnType<typeof gate>>([[model.provider, provided]])
  const resources = new Map<string, unknown>()
  const notices: string[] = []
  const openers: (() => Promise<void>)[] = []
  const runtime = {
    /** What the runtime holds per provider: the wrapper of the last registration. */
    registered: new Map<string, { api: Api; streamSimple: Stream }>(),
    // Composed like the runtime: what a reload sees is the wrapper registered before.
    getProvider(id: string) {
      const flow = flows.get(id)
      if (!flow) return undefined
      return {
        getModels: () => [model],
        streamSimple: this.registered.get(id)?.streamSimple ?? flow.stream,
      }
    },
    registerProvider(id: string, config: { api: Api; streamSimple: Stream }) {
      this.registered.set(id, config)
    },
  }
  const host: Host = {
    modelRuntime: runtime,
    resource: <T,>(key: string, create: () => T): T => {
      if (!resources.has(key)) resources.set(key, create())
      return resources.get(key) as T
    },
    notice: (notice: string) => notices.push(notice),
    onOpen: (callback) => {
      openers.push(callback)
    },
    userHome,
  }
  return { flows, host, notices, openers, provided, runtime }
}

test('the ceiling holds and the queued request runs on a handed-over slot', async () => {
  const limiter = new ProviderLimiter({ p: 2 })
  const first = await limiter.acquire('p')
  const second = await limiter.acquire('p')
  assert.equal(limiter.active('p'), 2)
  assert.equal(limiter.queued('p'), 0)

  let ran = false
  const waiting = limiter.acquire('p').then((release) => {
    ran = true
    return release
  })
  await tick()
  assert.equal(ran, false, 'a third request waits')
  assert.equal(limiter.queued('p'), 1)

  first()
  const third = await waiting
  assert.equal(ran, true)
  assert.equal(limiter.active('p'), 2, 'the released slot is handed over, not added to')
  second()
  third()
  assert.equal(limiter.active('p'), 0)
  assert.equal(limiter.queued('p'), 0)
})

test('the queue is first in, first out', async () => {
  const limiter = new ProviderLimiter({ p: 1 })
  const held = await limiter.acquire('p')
  const order: string[] = []
  const first = limiter.acquire('p').then((release) => {
    order.push('first')
    return release
  })
  const second = limiter.acquire('p').then((release) => {
    order.push('second')
    return release
  })
  await tick()
  assert.deepEqual(order, [])

  held()
  const firstRelease = await first
  await tick()
  assert.deepEqual(order, ['first'], 'the earlier request goes first')
  firstRelease()
  const secondRelease = await second
  assert.deepEqual(order, ['first', 'second'])
  secondRelease()
  assert.equal(limiter.active('p'), 0)
})

test('release is idempotent: the second call does not free another slot', async () => {
  const limiter = new ProviderLimiter({ p: 1 })
  const release = await limiter.acquire('p')
  const waiting = limiter.acquire('p')
  release()
  release()
  const next = await waiting
  assert.equal(limiter.active('p'), 1, 'the handed-over slot is still accounted for')
  next()
  assert.equal(limiter.active('p'), 0)
})

test('a request aborted while queued rejects and leaves no slot behind', async () => {
  const limiter = new ProviderLimiter({ p: 1 })
  const release = await limiter.acquire('p')
  const controller = new AbortController()
  const waiting = limiter.acquire('p', controller.signal)
  await tick()
  assert.equal(limiter.queued('p'), 1)

  controller.abort(new Error('cancelled'))
  await assert.rejects(waiting, /cancelled/)
  assert.equal(limiter.queued('p'), 0, 'the aborted request leaves the queue')
  assert.equal(limiter.active('p'), 1, 'the running request keeps its slot')

  release()
  assert.equal(limiter.active('p'), 0, 'the slot comes back')
  const again = await limiter.acquire('p')
  assert.equal(limiter.active('p'), 1, 'a later request is not stranded')
  again()
})

test('a provider without a ceiling never queues', async () => {
  const limiter = new ProviderLimiter({ p: Infinity })
  const releases = await Promise.all([limiter.acquire('p'), limiter.acquire('p'), limiter.acquire('unlisted')])
  assert.equal(limiter.active('p'), 0)
  assert.equal(limiter.queued('p'), 0)
  assert.equal(limiter.queued('unlisted'), 0)
  for (const release of releases) release()
  assert.equal(limiter.active('p'), 0)
})

test('the ceilings come from the machine’s settings, and from nowhere else', () => {
  const { limits, problems } = resolveLimits({
    rateLimiter: { limits: { anthropic: 2, other: 4 } },
  })
  assert.deepEqual(limits, { anthropic: 2, other: 4 })
  assert.deepEqual(problems, [])
})

test('nothing is limited until the settings name a provider', () => {
  // The code ships no ceiling: a provider nobody named is not throttled on someone else's machine.
  assert.deepEqual(LIMITS, {})
  for (const settings of [undefined, {}, { rateLimiter: {} }, { rateLimiter: { limits: {} } }]) {
    const { limits, problems } = resolveLimits(settings)
    assert.deepEqual(limits, LIMITS, `${JSON.stringify(settings)} limits nothing`)
    assert.deepEqual(problems, [])
  }
  assert.equal(new ProviderLimiter(resolveLimits({}).limits).limit('unlisted'), Infinity)
})

test('a ceiling that is not a whole number of at least 1 is refused and reported', () => {
  const { limits, problems } = resolveLimits({
    rateLimiter: { limits: { anthropic: 0, openai: -2, other: 1.5, also: '3' } },
  })
  assert.deepEqual(limits, LIMITS, 'a refused value changes no ceiling')
  assert.equal(problems.length, 4)
  assert.match(
    problems[0]!,
    /anthropic must be a whole number of at least 1, not 0: it stays unlimited/,
  )
  assert.match(problems[1]!, /openai must be a whole number of at least 1, not -2: it stays unlimited/)
  assert.match(problems[2]!, /other must be a whole number of at least 1, not 1\.5: it stays unlimited/)
})

test('an invalid settings file keeps the defaults and says so', async () => {
  const home = await tempHome('{ "rateLimiter": ')
  try {
    const { host, notices } = fakeHost(home)
    const state = await install(host)
    assert.deepEqual(state.limits, LIMITS)
    assert.equal(notices.length, 1)
    assert.match(
      notices[0]!,
      /^rate-limiter: could not read .*\.ultimate\/settings\.json \(.*\); keeping the defaults/,
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a saved ceiling applies on the same semaphore, and the queue keeps its order', async () => {
  const home = await tempHome(saved(1))
  try {
    const { host, notices } = fakeHost(home)
    const state = await install(host)
    assert.equal(state.limiter.limit(model.provider), 1, 'the saved ceiling is the one in force')

    const held = await state.limiter.acquire(model.provider)
    const order: string[] = []
    const take = (label: string) =>
      state.limiter.acquire(model.provider).then((release) => {
        order.push(label)
        return release
      })
    const first = take('first')
    const second = take('second')
    await tick()
    assert.equal(state.limiter.queued(model.provider), 2)

    // The person saves 2: the host reinstalls the extension, and the semaphore is the one from before.
    await writeFile(join(home, '.ultimate/settings.json'), saved(2))
    const reloaded = await install(host)
    assert.equal(reloaded, state, 'the same semaphore, not a new one')
    assert.equal(state.limiter.limit(model.provider), 2, 'the ceiling read now is the saved one')
    assert.equal(state.limiter.queued(model.provider), 2, 'the waiting requests stay queued')
    assert.deepEqual(order, [], 'and none starts behind the running request')
    assert.deepEqual([...state.wrapped], [model.provider], 'and the provider is wrapped once')

    held()
    const firstRelease = await first
    await tick()
    assert.deepEqual(order, ['first'], 'the earlier request still goes first')
    firstRelease()
    const secondRelease = await second
    assert.deepEqual(order, ['first', 'second'])
    secondRelease()
    assert.equal(state.limiter.active(model.provider), 0)
    assert.deepEqual(notices, [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('two loads over the same host leave one level of wrapper', async () => {
  // A provider has to be named in the settings to be wrapped at all: the code ships no ceiling.
  const home = await tempHome(saved(1))
  const { host, notices, provided, runtime } = fakeHost(home)

  const state = await install(host)
  const firstLoad = runtime.registered.get(model.provider)!.streamSimple
  await install(host)
  const secondLoad = runtime.registered.get(model.provider)!.streamSimple

  assert.notEqual(secondLoad, firstLoad, 'the reload installs its own wrapper')
  assert.equal(
    state.originals.get(model.provider)!.stream,
    provided.stream,
    'the flow kept is the provider’s own, not the previous wrapper',
  )
  assert.deepEqual(notices, [])

  const out = secondLoad(model, context)
  const done = consume(out)
  await tick()
  assert.equal(state.limiter.active(model.provider), 1, 'one slot per request, not one per wrapper level')

  provided.open()
  await done
  assert.equal(provided.calls.count, 1, 'the provider was called once')
  assert.equal(state.limiter.active(model.provider), 0)
  await rm(home, { recursive: true, force: true })
})

test('a stream aborted while queued ends with an aborted error and frees nothing', async () => {
  const limiter = new ProviderLimiter({ [model.provider]: 1 })
  const provided = gate()
  const running = limited(provided.stream, limiter, model.provider)
  const runningDone = consume(running(model, context))
  await tick()
  assert.equal(limiter.active(model.provider), 1)

  const controller = new AbortController()
  const queued = limited(provided.stream, limiter, model.provider)(model, context, {
    signal: controller.signal,
  })
  const queuedEvents = consume(queued)
  await tick()
  assert.equal(limiter.queued(model.provider), 1)
  controller.abort(new Error('cancelled'))

  const events = await queuedEvents
  assert.equal(events.at(-1)?.type, 'error')
  assert.equal((events.at(-1) as { reason: string }).reason, 'aborted')
  assert.equal(limiter.active(model.provider), 1, 'the running request keeps its slot')
  assert.equal(limiter.queued(model.provider), 0)

  provided.open()
  await runningDone
  assert.equal(limiter.active(model.provider), 0, 'the running slot comes back')
})

test('a name this machine has no provider for is reported once, and never wrapped', async () => {
  const home = await tempHome(
    JSON.stringify({ rateLimiter: { limits: { [model.provider]: 2, cirthan: 3 } } }),
  )
  try {
    const { host, notices, provided, runtime } = fakeHost(home)
    const state = await install(host)

    assert.deepEqual(state.limits, { [model.provider]: 2, cirthan: 3 }, 'the limits in force')
    assert.deepEqual([...state.wrapped], [model.provider], 'only the provider that exists here')
    assert.deepEqual(state.unknown, ['cirthan'])
    assert.deepEqual(notices, [
      'rate-limiter: no provider named "cirthan" on this machine; ' +
        'rateLimiter.limits.cirthan limits nothing',
    ])

    const reloaded = await install(host)
    assert.equal(reloaded, state, 'the same state')
    assert.deepEqual(state.unknown, ['cirthan'])
    assert.equal(notices.length, 1, 'the same set of names is not reported again')

    // One level of wrapper: a request in flight holds one slot, and the second load wraps the
    // provider's own flow, not the wrapper the first load left in the runtime.
    assert.equal(state.originals.get(model.provider)!.stream, provided.stream)
    const done = consume(runtime.registered.get(model.provider)!.streamSimple(model, context))
    await tick()
    assert.equal(state.limiter.active(model.provider), 1)
    provided.open()
    await done
    assert.equal(provided.calls.count, 1, 'the provider was called once')
    assert.equal(state.limiter.active(model.provider), 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('the report comes again when the set of names with no provider changes', async () => {
  const home = await tempHome(
    JSON.stringify({ rateLimiter: { limits: { [model.provider]: 1, cirthan: 3 } } }),
  )
  const settings = join(home, '.ultimate/settings.json')
  try {
    const { host, notices } = fakeHost(home)
    await install(host)
    assert.equal(notices.length, 1)

    // A second name with no provider here: the new set is reported, in one line.
    await writeFile(
      settings,
      JSON.stringify({ rateLimiter: { limits: { [model.provider]: 1, cirthan: 3, typo: 2 } } }),
    )
    const both = await install(host)
    assert.deepEqual(both.unknown, ['cirthan', 'typo'])
    assert.equal(notices.length, 2)
    assert.equal(
      notices[1],
      'rate-limiter: no provider named "cirthan", "typo" on this machine; ' +
        'rateLimiter.limits.cirthan and rateLimiter.limits.typo limit nothing',
    )

    // The person fixes both names: nothing left to report, and nothing reported.
    await writeFile(settings, saved(1))
    const fixed = await install(host)
    assert.deepEqual(fixed.unknown, [])
    assert.equal(notices.length, 2, 'an empty set of names reports nothing')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('the extension installs again on every harness open', async () => {
  const home = await tempHome(
    JSON.stringify({ rateLimiter: { limits: { [model.provider]: 1, late: 1 } } }),
  )
  try {
    const { flows, host, notices, openers, runtime } = fakeHost(home)
    await rateLimiter(host)
    assert.equal(openers.length, 1, 'the harness open runs install again')
    // Before the harness is open nobody reads a notice: the load-time install wraps and says nothing.
    assert.equal(notices.length, 0, 'the load reports nothing')
    assert.equal(runtime.registered.has('late'), false, 'it has no provider here yet')

    // The open that finds the same machine says it, now that there is someone to read it — once.
    for (const opener of openers) await opener()
    assert.equal(notices.length, 1, 'the name with no provider is reported on the open')
    assert.deepEqual((await actions.status({}, { host })).unknown, ['late'])

    // Another extension registers the provider after this facet loaded: the next open wraps it.
    flows.set('late', gate())
    for (const opener of openers) await opener()
    assert.equal(runtime.registered.has('late'), true, 'the provider that appeared is wrapped')
    const status = await actions.status({}, { host })
    assert.deepEqual(status.unknown, [], 'and it is no longer a name without a provider')
    assert.deepEqual(status.wrapped, [model.provider, 'late'].sort())
    assert.equal(notices.length, 1, 'an empty set of names reports nothing')

    // A second open over an unchanged machine, with the same names: still one notice.
    for (const opener of openers) await opener()
    assert.equal(notices.length, 1)
    assert.deepEqual([...runtime.registered.keys()].sort(), [model.provider, 'late'].sort())
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a provider that exists but cannot be wrapped says which half is missing', async () => {
  const home = await tempHome(
    JSON.stringify({ rateLimiter: { limits: { nomodels: 1, nostream: 1 } } }),
  )
  try {
    const notices: string[] = []
    const resources = new Map<string, unknown>()
    const flow = gate()
    const host: Host = {
      modelRuntime: {
        getProvider: (id: string) =>
          id === 'nomodels'
            ? { getModels: () => [], streamSimple: flow.stream }
            : id === 'nostream'
              ? { getModels: () => [model], streamSimple: undefined as unknown as Stream }
              : undefined,
        registerProvider: () => assert.fail('nothing here can be wrapped'),
      },
      resource: <T,>(key: string, create: () => T): T => {
        if (!resources.has(key)) resources.set(key, create())
        return resources.get(key) as T
      },
      notice: (notice: string) => notices.push(notice),
      onOpen: () => {},
      userHome: home,
    }
    const state = await install(host)
    assert.deepEqual(state.unknown, [], 'both providers exist, they just cannot be wrapped')
    assert.deepEqual(notices, [
      "rate-limiter: provider nomodels exposes no models' api; it is running unlimited",
      'rate-limiter: provider nostream exposes no streamSimple; it is running unlimited',
    ])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
