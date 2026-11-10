# rate-limiter — a ceiling on simultaneous requests per provider

It holds how many requests are **in flight at the same time** on a provider — 3 on `anthropic`, say, or
whatever this machine's `settings.json` says — and the rest wait in a queue that moves in arrival order.
**Nothing is limited until you name a provider**: the code ships no ceiling, because a default here would
throttle a stranger's subscription before they asked for it. It was born from the patch that lived in
`server/tool-arguments.ts` in the Ultimate clone (commit `38932639`, kept on the branch
`local/limiter-2026-11-08`), now outside the clone: here it hot-loads and holds for every project on this
machine.

The reason: the provider returns `error 429` when it receives too many requests at once. In this
project's trace there are 19 failures with 429, 12 of them in five minutes on 04/11 (a floor count: the
trace keeps 7 days).

## What it does

1. asks the runtime for the whole provider (`host.modelRuntime.getProvider(id)`);
2. keeps the **provider's** `streamSimple` (the flow from before wrapping);
3. registers the same provider back with a `streamSimple` that waits for a slot, runs the original flow
   and gives the slot back when the stream ends — including when it fails or is aborted.

If the provider does not exist on this machine, nothing happens to it (one listed in the `auth.json`
here but not in `models.json` stays out, and the `status` shows that). If it exists and
has no `streamSimple`, **it registers nothing** and warns in a notification: a broken provider would
break every conversation on the machine.

A provider outside the ceiling (`Infinity`) gets a slot that counts for nothing and never enters the
queue.

## The ceiling

The ceiling comes from this machine's `~/.ultimate/settings.json`. The code ships none (`LIMITS`, in
`limiter.ts`, is empty), so a provider nobody named is not limited. A starting map, the providers most
people have, is this one (three on Claude, three on GPT); it is a choice, not a default:

```json
{
  "rateLimiter": { "limits": { "anthropic": 3, "openai": 3 } }
}
```

What the file says holds at once: saving the file reinstalls the extension (`reloadOnSettings`, without
restarting Ultimate). The semaphore stays the same one — the slots in flight and the queue are not lost in
the reload, and whoever already waits keeps the order.

**The ceiling is per provider and per machine**: three `anthropic` in any combination of conversations,
subagents and automations on this machine, and the fourth request waits.

The code's own map, which is what applies when the file names no provider:

```ts
export const LIMITS: Limits = {}
```

The four rules:

- **Only the machine's file counts.** The project's `.ultimate/settings.json` is deliberately ignored:
  the ceiling belongs to the account at the provider, on this machine, and one project cannot raise the
  ceiling of the others.
- **A provider outside the map is not limited** (`Infinity`): it gets the slot at once and never enters
  the queue. That is what holds also with no key, no `rateLimiter` block and no file.
- **An invalid value is refused with a notification**, and the ceiling in force holds (not the new
  value): it has to be a whole number of at least 1. `0`, negative, `1.5` and `"3"` do not pass:

  ```text
  rate-limiter: rateLimiter.limits.anthropic must be a whole number of at least 1, not 0: it stays unlimited
  ```

  `0` is not a ceiling, it is an outage: it would hold back every call on this machine for good.
- **An unreadable file or invalid JSON**: the code's defaults hold (nothing, today), with a notification
  (`rate-limiter: could not read ~/.ultimate/settings.json (…); keeping the defaults`). The extension
  does not break, and a typo does not leave the machine without a ceiling in silence.

When it re-reads the ceilings the extension only swaps `shared.limits`: the state object and the
`ProviderLimiter` of the `rate-limiter.slots` resource are the same ones, and that is why nothing in
flight or in the queue is lost. No method is called on the instance the previous module created (its
prototype is the old one): the limiter reads the ceilings through the closure `() => shared.limits`.

## The three traps, and how each one is solved

- **Double load.** A reload installs the new facet before closing the previous one, and `getProvider` at
  that moment returns **the previous facet's wrapper**. Wrapping again would make each request take two
  slots, and with a ceiling of 3 everything would lock up. The original flow and the semaphore live in a
  `host.resource('rate-limiter.slots', …)`, which survives the reload: **that** flow is the one always
  wrapped, and the semaphore is the one from before. Proof in `limiter.test.ts` ("two loads over the
  same host…"): two loads over the same host, one request, `active === 1`; swapping the resource for the
  current `getProvider` makes the test fail with `active === 2`.
- **Closing does not unregister.** `unregisterProvider` would wipe the extension's layer from a provider
  that exists without it. `onClose` does not touch the registration; turning the extension off
  (removing the folder) only releases the ceiling after restarting the process, and nothing else breaks
  because of it.
- **An orphan slot.** The slot comes back in the `finally` of the stream relay, so a stream that ends
  with an error, an abort in the middle and an exception from the provider all pass through there. A
  request aborted **in the queue** leaves the queue and rejects without ever having taken a slot; an
  abort that arrives together with the slot's hand-over is skipped at hand-over time (`#slot`). If the
  consumer never reads the stream, the request has already started (the wrapper is eager, like the
  original patch) and ends when the provider answers.

## Status

The `status` action, with no arguments:

```sh
ultimate.action('rate-limiter', 'status')
# { wrapped: ['anthropic'], limits: { anthropic: 3 },
#   active: { anthropic: 0 }, queued: { anthropic: 0 } }
```

`wrapped` is what is really wrapped; `active` and `queued` are the slots in flight and in the queue.

## Tests

```sh
cd ~/src/ultimate-extensions/rate-limiter
node --test limiter.test.ts
```

`node_modules` here is a **symlink to `~/src/ultimate/node_modules`** (created by the repository's
`install.sh`: it is this machine's extensions trick, and the tests resolve `@earendil-works/pi-ai` and
`@earendil-works/pi-durable` from the clone). A machine symlink, it enters no repository; if the clone
moves, running `install.sh` again is enough.

The semaphore's test is pure (no host): ceiling, FIFO queue, idempotent release, abort in the queue,
infinite ceiling. The ones reading the ceilings use a temporary `HOME`: ceiling coming from the
`settings.json`, missing key → not limited, invalid JSON → not limited **and** a notification,
`0`/negative/non-whole refused with a notification, and the file saved again applying on the **same**
semaphore with the queue in the same order. The last two use a fake host: the two loads (a reload
without wrapping twice) and the stream aborted in the queue (it ends with an `error` event of reason
`aborted` and holds no slot).

## Assumptions about the pi API

- `host.modelRuntime.getProvider(id)` returns the **composed** provider — the extension's layer over
  the base —, and `registerProvider(id, config)` composes over the base, it does not replace.
- `registerProvider` with `streamSimple` **requires** `api` (`"api" is required when registering
  streamSimple`), and the runtime only uses the extension's layer when `model.api === config.api`; that
  is why `api` comes from `getProvider(id).getModels()[0].api` and is kept together with the flow.
- The provider registration survives the reload and the facet swap: only `unregisterProvider` takes it
  away.
- `streamSimple` receives `(model, context, options)` already with authentication prepared by the
  runtime (`prepareRequest`), and returns an `AssistantMessageEventStream` that can be iterated with
  `for await`; `result()` gives the final message.
- `defineExtension({ name })` needs the same name as the folder (`rate-limiter`), and the factory
  receives the `ExtensionHost`.

If any of these stops holding in an Ultimate update, the symptom is `status` not listing the provider
in `wrapped` (and a notification saying why). In that case the way out is to remove the folder and
**restart Ultimate**: the registration the extension left in the runtime survives the reload, so only
the new process gets the provider unwrapped again.

The host needs `userHome` (the extension reads `$HOME/.ultimate/settings.json`), and `install` is
asynchronous because of that read; `reloadOnSettings` makes the host reinstall the extension when the
file changes. The old facet is only closed after the new one has loaded, so a `server.ts` with a syntax
error leaves the previous one up — and a refused ceiling value never takes the extension down.
