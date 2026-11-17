---
name: open-pr
description: Open, retitle or edit a pull request from this project to the upstream Ultimate repository (HazAT/ultimate) — the only route to one, with the user's ok on the title and body before anything is pushed. Use when a change here should go upstream as a pull request, or the user asks to open or edit one.
---

# Open a pull request

A pull request puts the user's name on someone else's repository. Two were opened in two days without the user seeing
the title or the body. This is the route; the policy is `CONTRIBUTING.md` of `HazAT/ultimate`, read once, not per PR.

## 1. Prepare on `origin/main`

Work in a worktree of the clone (`$ULTIMATE_ROOT`, default `~/src/ultimate`), never in the checkout the host serves:

```bash
git -C "$ULTIMATE_ROOT" fetch origin
git -C "$ULTIMATE_ROOT" worktree add -b <branch> /tmp/pr-<branch> origin/main
cd /tmp/pr-<branch>
pnpm install --frozen-lockfile --prefer-offline
pnpm check
pnpm test
```

Branch from **`origin/main`**, never from the clone's local `main`: that `main` mirrors `origin/main`, and a commit on
it makes every `update` refuse until someone merges by hand — how this machine lost its nightly update.

- **No prose comments.** Upstream's `ultimate/no-comments` rule fails the PR; the `why` belongs in the commit message
  and in a regression test.
- **The test comes with the behaviour,** in the same PR.
- **One PR per idea, a fix before a feature:** a fix merges, a feature stays as a reference.

## 2. The checkpoint — the first step, not the last

Send @ultimate the **title, a three-line summary, the files touched and the tail of `pnpm check` / `pnpm test`**, and
wait. @ultimate takes it to the user. Only the user's ok opens it: not a draft, not a push so it is ready.

If the user rewrites the title or the summary, that wording goes in, unchanged.

## 3. Before creating it

```bash
gh pr list --repo HazAT/ultimate --search "<topic>" --state all      # the same idea, already there?
gh pr list --repo HazAT/ultimate --author julianojulio --state open  # our own queue
```

An idea already open is answered with its number, not with a second PR. With many of ours open, a new one waits.

Upstream's policy: most PRs stay open as references, and merging is the exception. `Feature: …` in the title is their
convention for a feature PR. The `feature` label means "reference, unmerged" and is the maintainer's to apply, never
ours. Never a bare `@name` — `` `@ultimate` `` in backticks, or no @ at all: it notifies the real person, and the GitHub
user `ultimate` has already complained about it.

## 4. Open it, after the ok

```bash
git push fork <branch>          # fork = julianojulio/ultimate
gh pr create --repo HazAT/ultimate --base main --head julianojulio:<branch> \
  --title "<title>" --body-file /tmp/pr-<branch>.md
```

Their template starts the body at `## What and why`: a lead line, three or four bullets, and one line naming what ran —
`pnpm check` and the test paths.

## 5. After it is open

Report the number, the link and the state (`gh pr view <n> --repo HazAT/ultimate --json state,mergeable,files`).
**`gh pr edit` does not work on that repository** (it dies in `Projects (classic)`); edit through the API:

```bash
gh api --method PATCH repos/HazAT/ultimate/pulls/<n> -f title="<title>" -F body=@/tmp/pr-<branch>.md
```

What the maintainer asks for is pushed to the same branch — no force-push, no second PR — and a new title or body goes
through the same checkpoint. Closing is the user's call, never ours.

## 6. Leave the clone alone

Push the branch and stop: no merge into the clone's `main`, no reset, no commit to make the fork current. The clone has
to stay pullable. This project's own work lands with `workspace submit`, not with a pull request.
