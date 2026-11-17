#!/bin/sh
# One throwaway Ultimate host for a machine proof, and the way to stop it again.
#
# The rule this file exists for: a proof host is stopped by the pid in its own `ultimate.lock`, never
# by port and never by name. `pkill -f ultimate` matches the very `bash -c` line that runs it, so the
# cleanup kills its own shell and leaves the host behind — twelve times in eight conversations, and one
# of those hosts was still on port 4753 a week later.
#
# Each host gets a home and a user home of its own under ${TMPDIR:-/tmp}: the user's ~/.ultimate is
# not a place to prove things in. The Ultimate clone comes from $ULTIMATE_ROOT, ~/src/ultimate by
# default, as in install.sh.
set -eu

ultimate=${ULTIMATE_ROOT:-$HOME/src/ultimate}

usage() {
  cat >&2 <<'USAGE'
usage: proof-host.sh start <dir> [port]   one throwaway host for <dir>: prints home= port= pid=
       proof-host.sh stop <home>          stops that host by the pid in <home>/ultimate.lock
USAGE
  exit 2
}

alive() { # is $1 a live process: a child that has finished still answers kill -0 until it is reaped
  kill -0 "$1" 2>/dev/null || return 1
  case $(ps -o stat= -p "$1" 2>/dev/null) in
    Z*) return 1 ;;
  esac
  return 0
}

lock_pid() { # the pid written in <home>/ultimate.lock, empty when there is no readable lock
  node -e '
    const fs = require("node:fs")
    try {
      const owner = JSON.parse(fs.readFileSync(process.argv[1] + "/ultimate.lock", "utf8"))
      if (Number.isSafeInteger(owner.pid)) process.stdout.write(String(owner.pid))
    } catch {}
  ' "$1"
}

free_port() { # the first port at or after $1 that can be bound here, nothing when there is none
  node -e '
    const net = require("node:net")
    const free = (port) =>
      new Promise((done) => {
        const probe = net.createServer()
        probe.once("error", () => done(false))
        probe.listen(port, "127.0.0.1", () => probe.close(() => done(true)))
      })
    ;(async () => {
      for (let port = Number(process.argv[1]); port < 65536; port++)
        if (await free(port)) return process.stdout.write(String(port))
      process.exit(1)
    })()
  ' "$1"
}

answers() { # does the host at $1 answer 200 within two seconds
  node -e 'fetch(process.argv[1], { signal: AbortSignal.timeout(2000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' "$1"
}

terminate() { # TERM $1, wait up to 8 s, then KILL; nonzero when the pid outlives both
  target=$1
  if ! alive "$target"; then
    return 0
  fi
  kill -TERM "$target" 2>/dev/null || true
  waited=0
  while alive "$target" && [ "$waited" -lt 8 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if alive "$target"; then
    echo "wait  pid $target ignored TERM for 8 s; sending KILL" >&2
    kill -KILL "$target" 2>/dev/null || true
    sleep 1
  fi
  if alive "$target"; then
    return 1
  fi
  return 0
}

abandon() { # a start that cannot finish: stop what it spawned, drop what it made, say why
  reason=$1
  last=$(tail -n 1 "$log" 2>/dev/null || true)
  terminate "$spawned" || true
  rm -rf "$base"
  echo "fail  $reason" >&2
  if [ -n "$last" ]; then
    echo "fail  last line of the log: $last" >&2
  fi
  exit 1
}

bring_up() { # spawn the host on $port and wait for it: 0 ready, 1 it exited, 2 it never answered
  ULTIMATE_HOME=$home ULTIMATE_USER_HOME=$base/user \
    node "$ultimate/bin/ultimate.ts" "$dir" --port "$port" --no-open </dev/null >"$log" 2>&1 &
  spawned=$!
  deadline=$(($(date +%s) + ${PROOF_HOST_TIMEOUT:-120}))
  while :; do
    owner=$(lock_pid "$home")
    if [ "$owner" = "$spawned" ] && answers "http://127.0.0.1:$port/"; then
      return 0
    fi
    alive "$spawned" || return 1
    if [ "$(date +%s)" -ge "$deadline" ]; then
      return 2
    fi
    sleep 1
  done
}

start() {
  [ $# -ge 1 ] || usage
  dir=$1
  first=4747
  if [ $# -ge 2 ]; then
    first=$2
    case $first in
      '' | *[!0-9]*) echo "fail  not a port: '$first'" >&2; exit 2 ;;
    esac
    if [ "$first" -gt 65535 ]; then
      echo "fail  not a port: $first" >&2
      exit 2
    fi
  fi
  if [ ! -d "$dir" ]; then
    echo "fail  no such directory: $dir" >&2
    exit 2
  fi
  if [ ! -f "$ultimate/bin/ultimate.ts" ]; then
    echo "fail  no Ultimate clone at $ultimate (set ULTIMATE_ROOT)" >&2
    exit 2
  fi
  # The physical path, which is the one the host records in its lock and its settings.
  dir=$(cd -P "$dir" && pwd)

  # A fixture counts only once its project is trusted, and the decision lives in the user home. pi's
  # own store writes the key Ultimate reads, worktree roots included. Its own state dir comes first:
  # everything this start makes lives under it, so nothing is left when it fails.
  base=$(mktemp -d "${TMPDIR:-/tmp}/proof-host.XXXXXX")
  if ! (cd "$ultimate" && node --input-type=module -e '
    const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent")
    new ProjectTrustStore(process.argv[1] + "/.ultimate").set(process.argv[2], true)
  ' "$base/user" "$dir"); then
    rm -rf "$base"
    echo "fail  cannot mark $dir trusted in the throwaway user home" >&2
    exit 1
  fi

  home=$base/home
  log=$base/host.log
  mkdir -p "$home"
  if ! requested=$(free_port "$first"); then
    rm -rf "$base"
    echo "fail  no free port from $first" >&2
    exit 1
  fi
  port=$requested
  if [ "$port" != "$first" ]; then
    echo "note  port $first is taken; using $port" >&2
  fi

  # No inherited ULTIMATE_*: this host must not join, or write into, the instance the proof runs in.
  for name in $(env | sed -n 's/^\(ULTIMATE_[A-Za-z0-9_]*\)=.*/\1/p'); do
    unset "$name"
  done

  # Two starts that run at once can pick the same free port; the loser says so in its log and exits, so
  # take the next port and try again instead of leaving the proof with one host fewer than it asked for.
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    # Interrupted while it comes up: the same clean-up as a start that never gets there.
    trap 'abandon "interrupted while the host was starting"' INT TERM
    status=0
    bring_up || status=$?
    trap - INT TERM
    if [ "$status" = 0 ]; then
      break
    fi
    if [ "$status" = 1 ] && [ "$attempt" -lt 6 ] && grep -q 'is in use' "$log"; then
      echo "note  port $port was taken first; trying again" >&2
      rm -rf "$home"
      mkdir -p "$home"
      # Starts that begin together stay in step and reach for the same ports; each one steps by its own
      # pid so a farm of them spreads out instead of colliding again and again.
      if ! port=$(free_port $((port + 1 + ($$ % 5)))); then
        abandon "no free port after $port"
      fi
      continue
    fi
    if [ "$status" = 1 ]; then
      abandon "the host exited before it answered at http://127.0.0.1:$port/"
    fi
    abandon "the host did not answer at http://127.0.0.1:$port/ within ${PROOF_HOST_TIMEOUT:-120} s"
  done

  echo "home=$home port=$port pid=$owner"
  echo "note  log $log" >&2
  echo "note  stop it: sh scripts/proof-host.sh stop $home" >&2
}

stop() {
  [ $# -ge 1 ] || usage
  home=$1
  if [ ! -d "$home" ]; then
    echo "note  nothing to stop: no home at $home" >&2
    exit 0
  fi
  pid=$(lock_pid "$home")
  if [ -z "$pid" ]; then
    echo "note  nothing to stop: no pid in $home/ultimate.lock" >&2
    exit 0
  fi
  if ! alive "$pid"; then
    echo "note  pid $pid is already gone; $home/ultimate.lock is left as it is" >&2
    exit 0
  fi
  if ! terminate "$pid"; then
    echo "fail  pid $pid is still alive after KILL" >&2
    exit 1
  fi
  if [ -e "$home/ultimate.lock" ]; then
    echo "note  pid $pid is gone but $home/ultimate.lock is still there" >&2
  fi
  echo "stopped pid=$pid home=$home"
  echo "note  its state is in $(dirname "$home"): rm -rf it once the proof is done" >&2
}

[ $# -ge 1 ] || usage
command=$1
shift
case $command in
  start) start "$@" ;;
  stop) stop "$@" ;;
  *) usage ;;
esac
