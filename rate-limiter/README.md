# rate-limiter — a ceiling on simultaneous requests per provider

Holds how many requests a provider has in flight at once and queues the rest in arrival order, because
a provider answers `429` when too much arrives at the same time.

It has no interface: what you see is the `status` action.

```json
{ "wrapped": ["anthropic", "openai", "opencode"],
  "unknown": [],
  "limits": { "anthropic": 3, "openai": 3, "opencode": 4 },
  "active": { "anthropic": 1, "openai": 0, "opencode": 0 },
  "queued": { "anthropic": 0, "openai": 0, "opencode": 0 } }
```

## How it works

For each provider named in this machine's settings, N requests run at once; the rest queue in arrival
order, and a slot comes back when the stream ends, fails or is aborted. A provider nobody named is not
limited at all: the code ships no ceiling, because a default would throttle somebody's subscription
before they asked for it.

The ceiling is for the whole machine — every conversation, subagent and automation together — and it
survives reloading the extension: the requests in flight and the queue are kept, and whoever was waiting
keeps their place.

## Configuration

This machine's `~/.ultimate/settings.json`:

```json
{ "rateLimiter": { "limits": { "anthropic": 3, "openai": 3, "opencode": 4 } } }
```

Save it and it takes effect: the extension reloads itself from that file, without restarting Ultimate.

- A value that is not a whole number of at least 1 is refused with a notification, and the ceiling in
  force before it stays: `1.5`, `"3"`, `-1` and `0` do not pass.
- `0` is a refusal, not a ceiling: it would hold back every call on this machine for good, which is an
  outage.
- A name this machine has no provider for is not silent: it appears as `unknown` in `status`, with one
  notification naming it, so a misspelled name does not pass in silence.
- A provider left out of the map is not limited.

## Using it

`status`, with no arguments:

- `wrapped` — the providers held to a ceiling right now.
- `unknown` — names in the limits this machine has no provider for, sorted.
- `limits` — the ceilings in force.
- `active` — requests in flight right now, per wrapped provider.
- `queued` — requests waiting, per wrapped provider.

## What it does not do

- It does not count tokens or cost, only requests in flight.
- It does not limit a provider outside the map.
- It does not read a project's `.ultimate/settings.json`: the ceiling belongs to the account at the
  provider, on this machine, and one project cannot raise it for the others.
