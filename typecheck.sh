#!/bin/sh
# The local type check: `tsconfig.json`, run by the `tsc` of the Ultimate clone.
#
# It is local because it needs the machine. `install.sh` links each extension's `node_modules` to the
# clone, which is where `@earendil-works/*` and React's types come from, and the app's own types
# (`@/sdk`, `@/components/ui/*`) and `@types` live in the clone itself. Neither is in a clean clone or
# in a checkout whose setup has not run, and a check that cannot run must say so and pass, not look
# like a broken landing: it exits 0 with one line naming what is missing and what fixes it.
#
# The clone is found through that link — so this checks as well in a worktree or a landing checkout as
# in the standard setup — and `tsc` is told where it is by a config that extends `tsconfig.json`, which
# keeps the paths an editor needs. Nothing is written into the repository.
set -eu

repo=$(cd -P "$(dirname "$0")" && pwd)

# The clone: the first extension's `node_modules`. Without the link nothing here imports
# `@earendil-works/*`, and there is no `tsc` to run either.
clone=
for path in "$repo"/*/; do
  name=${path%/}
  # Only a folder that is a real extension: one with server.ts or web.tsx.
  if [ ! -f "$name/server.ts" ] && [ ! -f "$name/web.tsx" ]; then
    continue
  fi
  if [ ! -L "$name/node_modules" ]; then
    echo "skip  typecheck: ${name##*/}/node_modules is not a link to the clone — run install.sh, nothing was checked"
    exit 0
  fi
  if [ -z "$clone" ]; then
    clone=$(dirname "$(cd -P "$name/node_modules" && pwd)")
  fi
done

if [ -z "$clone" ] || [ ! -x "$clone/node_modules/.bin/tsc" ]; then
  echo "skip  typecheck: there is no tsc in the clone's node_modules — nothing was checked"
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

cat > "$tmp/tsconfig.json" <<EOF
{
  "extends": "$repo/tsconfig.json",
  "compilerOptions": {
    "paths": { "@/*": ["$clone/web/src/*"] },
    "typeRoots": ["$clone/node_modules/@types"]
  }
}
EOF

"$clone/node_modules/.bin/tsc" -p "$tmp/tsconfig.json"
