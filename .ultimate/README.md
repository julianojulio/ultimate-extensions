# `.ultimate/` — what this project asks of Ultimate

This repository's extensions do not live here: they live at the first level (`projects/`,
`rate-limiter/`) and are linked into the machine by `install.sh`. This folder is the configuration
Ultimate works with **in this repository**, and it applies to anyone who runs `ultimate` in this
folder.

## What is here

| File | What it does |
| --- | --- |
| `settings.json` | A landing's checks (`lander.checks`, both `node --test`), its push to `origin` (`lander.push`), and `isolates.worktree.setup`, which calls the script below in every new checkout. None of it applies until this project's setup card is accepted: until then a landing merges and fast-forwards locally, with no checks and nothing pushed. |
| `worktree-setup.sh` | Links each extension's `node_modules` inside the worktree: git ignores it, so a new checkout has nothing to import `@earendil-works/*` from without that link. Same target as `install.sh` (the Ultimate clone's `node_modules`), and it does not touch the machine's symlinks. The folders of the checkout being set up decide what gets a link — the source checkout only says where the modules are —, so an extension renamed in a branch is set up without waiting for the source to catch up. |
| `agents/reviewer-extension.md` | One more reviewer on the team: it checks the change against Ultimate's extension guide (the `@/sdk` contract, honesty of what the UI shows, pure testable logic, README) instead of looking only at the behaviour. The built-in `reviewer` starts it along with the others and joins the reports. |

## Trust decision

Nothing in this folder replaces what already exists until you **trust the project**: Ultimate shows
the project's setup card and, only after you accept it, settings, agents, skills and extensions from
here take effect. The `README.md` you are reading is what that card shows.

## What is not here

No project extension: what this repository publishes is machine-level and applies in every project,
so it lives in the `user` layer (`~/.ultimate/extensions/`). A UI or a rule of a product project
would go in `<project>/.ultimate/extensions/`.
