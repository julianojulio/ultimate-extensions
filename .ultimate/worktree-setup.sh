#!/bin/sh
# Setup for a new worktree of this repository: there is no node_modules here.
#
# Each extension's node_modules is a symlink to the Ultimate clone's (`install.sh` creates it in the
# main checkout, and .gitignore keeps it out of git). A new checkout has no such link, and
# `node --test` does not resolve `@earendil-works/*` until it exists. This script remakes the link for
# each folder of the source checkout that is an extension — a new extension here asks for no change
# in it.
#
# Safe to repeat: a node_modules that already exists, link or folder, is left as it is.
set -eu

origem=${ULTIMATE_SOURCE:?ULTIMATE_SOURCE must point at the source checkout}

for pasta in "$origem"/*/; do
  nome=$(basename "$pasta")
  # Only a folder that is a real extension: one with server.ts or web.tsx.
  if [ ! -f "$pasta/server.ts" ] && [ ! -f "$pasta/web.tsx" ]; then
    continue
  fi
  modulos=$(cd "$pasta/node_modules" 2>/dev/null && pwd -P) || {
    echo "note  $nome: $pasta/node_modules does not exist — run install.sh in the source checkout" >&2
    continue
  }
  if [ -e "$nome/node_modules" ] || [ -L "$nome/node_modules" ]; then
    continue
  fi
  ln -s "$modulos" "$nome/node_modules"
  echo "link  $nome/node_modules -> $modulos"
done
