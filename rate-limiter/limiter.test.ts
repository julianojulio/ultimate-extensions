/**
 * `node --test limiter.test.ts` — the semaphore alone, the ceilings the settings file sets, then two
 * loads over the same host: a reload must leave one level of wrapper, not two.
 *
 * The host is a fake and the settings live in a temporary home, so nothing here touches the
 * machine's providers or its own settings file.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  TranscriptContext,
} from '@earendil-works/pi-ai'
import { LIMITS, ProviderLimiter, resolveLimits } from './limiter.ts'
import { install, limited } from './server.ts'
import type { Host, Stream } from './server.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))

const model = {
  api: 'openai-completions',
  provider: 'cirthan-dev',
  id: 'deepseek-v4.1-flash',
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

/** The settings file that gives `cirthan-dev` a ceiling. */
const saved = (ceiling: number) =>
  JSON.stringify({ rateLimiter: { limits: { [model.provider]: ceiling } } })

/**
 * A host with one provider, `cirthan-dev`, on a flow the test opens and closes. The resources are one
 * map for the whole test, as in the host: two installs share one semaphore.
 */
function fakeHost(userHome: string) {
  const provided = gate()
  const resources = new Map<string, unknown>()
  const notices: string[] = []
  const runtime = {
    registered: undefined as { api: Api; streamSimple: Stream } | undefined,
    // Composed like the runtime: what a reload sees is the wrapper registered before.
    getProvider(id: string) {
      if (id !== model.provider) return undefined
      return {
        getModels: () => [model],
        streamSimple: this.registered?.streamSimple ?? provided.stream,
      }
    },
    registerProvider(_id: string, config: { api: Api; streamSimple: Stream }) {
      this.registered = config
    },
  }
  const host: Host = {
    modelRuntime: runtime,
    resource: <T,>(key: string, create: () => T): T => {
      if (!resources.has(key)) resources.set(key, create())
      return resources.get(key) as T
    },
    notice: (notice: string) => notices.push(notice),
    userHome,
  }
  return { host, notices, provided, runtime }
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

test('the ceilings come from the machine’s settings, over the defaults', () => {
  const { limits, problems } = resolveLimits({
    rateLimiter: { limits: { 'cirthan-dev': 2, other: 4 } },
  })
  assert.deepEqual(limits, { 'cirthan-dev': 2, cirthan: 3, other: 4 })
  assert.deepEqual(problems, [])
})

test('with no key the defaults hold, and a provider named nowhere is not limited', () => {
  for (const settings of [undefined, {}, { rateLimiter: {} }, { rateLimiter: { limits: {} } }]) {
    const { limits, problems } = resolveLimits(settings)
    assert.deepEqual(limits, LIMITS, `${JSON.stringify(settings)} keeps the defaults`)
    assert.deepEqual(problems, [])
  }
  assert.equal(new ProviderLimiter(resolveLimits({}).limits).limit('unlisted'), Infinity)
})

test('a ceiling that is not a whole number of at least 1 is refused and reported', () => {
  const { limits, problems } = resolveLimits({
    rateLimiter: { limits: { 'cirthan-dev': 0, cirthan: -2, other: 1.5, also: '3' } },
  })
  assert.deepEqual(limits, LIMITS, 'a refused value changes no ceiling')
  assert.equal(problems.length, 4)
  assert.match(problems[0]!, /cirthan-dev must be a whole number of at least 1, not 0: it stays at 3/)
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
  const home = await tempHome()
  const { host, notices, provided, runtime } = fakeHost(home)

  const state = await install(host)
  const firstLoad = runtime.registered!.streamSimple
  await install(host)
  const secondLoad = runtime.registered!.streamSimple

  assert.notEqual(secondLoad, firstLoad, 'the reload installs its own wrapper')
  assert.equal(
    state.originals.get('cirthan-dev')!.stream,
    provided.stream,
    'the flow kept is the provider’s own, not the previous wrapper',
  )
  assert.deepEqual(notices, [])

  const out = secondLoad(model, context)
  const done = consume(out)
  await tick()
  assert.equal(state.limiter.active('cirthan-dev'), 1, 'one slot per request, not one per wrapper level')

  provided.open()
  await done
  assert.equal(provided.calls.count, 1, 'the provider was called once')
  assert.equal(state.limiter.active('cirthan-dev'), 0)
  await rm(home, { recursive: true, force: true })
})

test('a stream aborted while queued ends with an aborted error and frees nothing', async () => {
  const limiter = new ProviderLimiter({ 'cirthan-dev': 1 })
  const provided = gate()
  const running = limited(provided.stream, limiter, 'cirthan-dev')
  const runningDone = consume(running(model, context))
  await tick()
  assert.equal(limiter.active('cirthan-dev'), 1)

  const controller = new AbortController()
  const queued = limited(provided.stream, limiter, 'cirthan-dev')(model, context, {
    signal: controller.signal,
  })
  const queuedEvents = consume(queued)
  await tick()
  assert.equal(limiter.queued('cirthan-dev'), 1)
  controller.abort(new Error('cancelled'))

  const events = await queuedEvents
  assert.equal(events.at(-1)?.type, 'error')
  assert.equal((events.at(-1) as { reason: string }).reason, 'aborted')
  assert.equal(limiter.active('cirthan-dev'), 1, 'the running request keeps its slot')
  assert.equal(limiter.queued('cirthan-dev'), 0)

  provided.open()
  await runningDone
  assert.equal(limiter.active('cirthan-dev'), 0, 'the running slot comes back')
})
