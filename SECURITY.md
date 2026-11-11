# Security

## Report it in private

Open a [private security advisory](https://github.com/julianojulio/ultimate-extensions/security/advisories/new)
on this repository. Please do not open a public issue for a vulnerability, and there is no e-mail
address published for this.

A vulnerability in Ultimate itself, rather than in one of these extensions, belongs to
[Ultimate's repository](https://github.com/HazAT/ultimate).

## What matters here

These extensions run inside Ultimate, on the machine that runs it, so a bug can reach further than a
wrong screen:

- they start and stop processes, including a detached Ultimate host, and read `ultimate.lock` to know
  which host is running;
- they write `~/.ultimate/settings.json`, the file that decides which extensions load on this machine;
- they speak HTTP over loopback to other hosts here;
- `rate-limiter` wraps the stream every model request goes through.

`install.sh` is in scope too: it links folders into `~/.ultimate/extensions/`, and a link that escapes
the repository is a way in. A useful report says which extension and commit, what the code can do that
it should not, and the steps that get there.

## Versions

Only `main`, before 1.0: there are no releases to support and no backports. A fix lands on `main`, and
reaches you with a `git pull`. The commit you run is the one to name in the report (`git log -1`).

## How long an answer takes

Best effort. This repository is maintained in spare time, so no response time is promised; a private
advisory is read as soon as someone is at it, and replies stay inside it until a fix is out.
