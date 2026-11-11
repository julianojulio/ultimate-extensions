/**
 * What the limiter test needs of the host's packages, so the suite runs in a clean clone: a checkout
 * has no `node_modules` until `install.sh` links it, and `server.ts` imports both of these as values.
 *
 * `createAssistantMessageEventStream` copies the shape of the host's: events queue until a consumer
 * iterates them, a `done` or `error` event completes the final result, and `end(result)` closes the
 * stream for good. `defineExtension` types an extension and returns it unchanged.
 *
 * `limiter.test.ts` answers the two packages with this file only where they do not resolve, so a
 * machine with the link tests the host's own code.
 */
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai'

type Step = IteratorResult<AssistantMessageEvent>

/** The event stream one assistant response arrives on. */
export function createAssistantMessageEventStream() {
  const events: AssistantMessageEvent[] = []
  const waiting: ((step: Step) => void)[] = []
  let closed = false
  let resolve!: (message: AssistantMessage) => void
  const result = new Promise<AssistantMessage>((done) => {
    resolve = done
  })

  const deliver = (step: Step) => {
    const waiter = waiting.shift()
    if (waiter) waiter(step)
    else if (!step.done) events.push(step.value)
  }

  return {
    push(event: AssistantMessageEvent) {
      if (closed) return
      if (event.type === 'done' || event.type === 'error') {
        closed = true
        resolve(event.type === 'done' ? event.message : event.error)
      }
      deliver({ value: event, done: false })
    },
    end(message?: AssistantMessage) {
      closed = true
      if (message !== undefined) resolve(message)
      while (waiting.length > 0) waiting.shift()!({ value: undefined, done: true })
    },
    result: () => result,
    async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
      while (true) {
        if (events.length > 0) {
          yield events.shift()!
        } else if (closed) {
          return
        } else {
          const step = await new Promise<Step>((next) => waiting.push(next))
          if (step.done) return
          yield step.value
        }
      }
    },
  }
}

/** The host's `defineExtension`: it types an extension, and nothing else. */
export const defineExtension = <Extension>(extension: Extension): Extension => extension
