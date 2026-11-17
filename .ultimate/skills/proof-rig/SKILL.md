---
name: proof-rig
description: Start and stop throwaway Ultimate hosts for a proof — several of them at once, each with its own home, its own port and its own lock. Use before any proof that needs a host that is not the user's: measuring a rail, a poll, a port, a restart, an extension against several projects, or anything that must run the machine without touching ~/.ultimate.
---

# The proof rig

A proof that needs a host gets a **fake** one: a real Ultimate on a throwaway home, pointed at a
disposable project folder. `scripts/proof-host.sh` starts and stops them and prints one line per host.
It needs `node` and the Ultimate clone (`$ULTIMATE_ROOT`, `~/src/ultimate` by default, as in
`install.sh`).

## Start

```sh
line=$(sh scripts/proof-host.sh start /tmp/proof-x/project [port])   # port defaults to 4747
# home=/tmp/proof-host.Ab12cd/home port=4754 pid=1234567
```

It picks the first free port at or after the one you ask for (4747 upward), gives the host a home and
a user home of its own inside `${TMPDIR:-/tmp}`, starts it detached with its output in
`$(dirname "$home")/host.log`, then waits until the lock names the pid it started **and** the host
answers HTTP 200. Everything else — the log path, a port it had to move to — goes to stderr, so
`$( )` gives you that single line.

The project is marked trusted in that throwaway user home, so a fixture's `.ultimate/settings.json`,
extensions and agents actually apply; in an untrusted project they are silently ignored.

A start that cannot get there kills what it started, removes what it made and exits 1 with the last
line of the log. `PROOF_HOST_TIMEOUT=120` (seconds) is how long it waits.

## The trap is not optional

```sh
home=$(sh scripts/proof-host.sh start /tmp/proof-x/project | sed 's/^home=\([^ ]*\).*/\1/')
trap 'sh scripts/proof-host.sh stop "$home"' EXIT INT TERM
```

Without that line a proof that fails, a conversation that is steered, a shell that is closed — each
leaves a host running, which is how six hand-built host farms leaked. For several hosts keep them in
one list and stop them in one trap: `stop` on an already stopped host, on a home with no lock or on a
state dir that is already gone exits 0, so running it twice is free.

## Stop

```sh
sh scripts/proof-host.sh stop "$home"     # stopped pid=1234567 home=/tmp/proof-host.Ab12cd/home
```

It reads the pid from `<home>/ultimate.lock`, sends `TERM`, waits up to 8 s and then `KILL`, and
confirms the pid is gone. `rm -rf "$(dirname "$home")"` when the proof is done removes the state and
the log with it — **after** the stop: the dir holds the lock, and a host whose state dir is gone can
only be found by its pid in `ps`, which is the failure this script exists to prevent.

## Rules that came from real failures

- **Stop by the pid in the lock.** Never by port, never by name:
  `pkill -f ultimate` matches the very `bash -c` line that runs it, kills your own shell, and leaves
  the host running — it happened twelve times in eight conversations, and one host survived on port
  4753 for a week. `pgrep -af` to **look** is fine; to kill, never.
- **Check before acting on a host.** The line's port was free when it was printed and its pid must
  still answer `kill -0`; a lock naming another pid, or a port with no listener, is not the host you
  started — say so instead of killing something else.
- **Everything proof-side lives in `/tmp`.** `ULTIMATE_HOME` and `ULTIMATE_USER_HOME` point under
  `$TMPDIR`; the user's `~/.ultimate` is not a place to prove things in, and a proof must never write
  to the user's settings, homes or installed extensions.
- **Nothing stays up when you conclude a branch.** Before reporting done: every host stopped, every
  state dir removed, and `pgrep -af bin/ultimate.ts` showing only the hosts that were already there.
