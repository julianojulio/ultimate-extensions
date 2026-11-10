#!/bin/sh
# Setup for a new worktree of this repository: there is no node_modules here.
#
# Each extension's node_modules is a symlink to the Ultimate clone's (`install.sh` creates it in the
# main checkout, and .gitignore keeps it out of git). A new checkout has no such link, and
# `node --test` does not resolve `@earendil-works/*` until it exists. This script remakes the link for
# each extension folder **of this checkout** — what needs a link is decided here, and the source
# checkout only says where the modules are, so a folder renamed in the branch being set up (or in the
# source, which is one landing behind) does not stop it.
#
# Safe to repeat: a node_modules that already exists, link or folder, is left as it is.
set -eu

origem=${ULTIMATE_SOURCE:?ULTIMATE_SOURCE must point at the source checkout}

# Where the modules are: the first extension of the source checkout whose link resolves. Every
# extension there points at the same clone's node_modules — `install.sh` makes them all the same —, so
# one is enough, whatever this branch calls the folders.
modulos=
for pasta in "$origem"/*/; do
  if [ ! -f "$pasta/server.ts" ] && [ ! -f "$pasta/web.tsx" ]; then
    continue
  fi
  # `cd` follows the link: what it printed is the modules' real place, wherever this checkout will be.
  if resolvido=$(cd "$pasta/node_modules" 2>/dev/null && pwd -P); then
    modulos=$resolvido
    break
  fi
done

if [ -z "$modulos" ]; then
  echo "note  no extension in $origem has a node_modules — run install.sh in the source checkout" >&2
  exit 0
fi

for pasta in */; do
  nome=$(basename "$pasta")
  # Only a folder that is a real extension: one with server.ts or web.tsx.
  if [ ! -f "$pasta/server.ts" ] && [ ! -f "$pasta/web.tsx" ]; then
    continue
  fi
  if [ -e "$nome/node_modules" ] || [ -L "$nome/node_modules" ]; then
    continue
  fi
  ln -s "$modulos" "$nome/node_modules"
  echo "link  $nome/node_modules -> $modulos"
done
