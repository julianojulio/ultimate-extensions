#!/bin/sh
# Links each extension of this repository into ~/.ultimate/extensions/<name>, which is where Ultimate
# loads them from, and points their node_modules at the Ultimate clone. Idempotent: running it again
# changes nothing; a new extension here is installed by one more line on the next run.
#
# The Ultimate clone comes from $ULTIMATE_ROOT, and by default from ~/src/ultimate: it is where the
# @earendil-works/* packages each extension imports resolve from, inside Ultimate. The tests also run
# without it, on their own fixtures.
set -eu

# The physical path, even when this is reached through a symlink (`~/src/ultimate-extensions` pointing
# elsewhere): the links then always name the same folder, and a second run through another path says "ok".
repo=$(cd -P "$(dirname "$0")" && pwd)
dest="$HOME/.ultimate/extensions"
ultimate=${ULTIMATE_ROOT:-$HOME/src/ultimate}
modules="$ultimate/node_modules"

mkdir -p "$dest"

# A renamed extension leaves a dead link behind: a link here that points into this repository, at a
# folder that no longer exists, is removed — never a real folder, and never a link that points
# anywhere else. Nothing else in the destination is read or removed.
for link in "$dest"/*; do
  if [ ! -L "$link" ]; then
    continue
  fi
  target=$(readlink "$link")
  case "$target" in
    "$repo"/*) ;;
    *) continue ;;
  esac
  if [ -e "$target" ]; then
    continue
  fi
  rm "$link"
  echo "rm    ${link##*/}: its target $target is gone"
done

for path in "$repo"/*/; do
  name=${path%/}
  name=${name##*/}
  # Only a folder that is a real extension: node_modules is not here, and .git does not match this glob.
  if [ ! -f "$repo/$name/server.ts" ] && [ ! -f "$repo/$name/web.tsx" ]; then
    continue
  fi

  link="$dest/$name"
  if [ -d "$link" ] && [ ! -L "$link" ]; then
    echo "skip  $name: $link is a real folder, not a link — remove it by hand" >&2
    continue
  fi
  if [ -L "$link" ] && [ "$(readlink "$link")" = "$repo/$name" ]; then
    echo "ok    $name -> $repo/$name"
  else
    ln -sfn "$repo/$name" "$link"
    echo "link  $name -> $repo/$name"
  fi

  if [ ! -d "$modules" ]; then
    echo "note  $name: without $modules — this extension cannot load inside Ultimate. Point ULTIMATE_ROOT at the clone" >&2
  elif [ -L "$repo/$name/node_modules" ]; then
    # A link to another place is remade; a real node_modules (installed by hand) stays as it is.
    [ "$(readlink "$repo/$name/node_modules")" = "$modules" ] || ln -sfn "$modules" "$repo/$name/node_modules"
  elif [ -e "$repo/$name/node_modules" ]; then
    echo "note  $name: $repo/$name/node_modules exists and is not a link — left as it is" >&2
  else
    ln -s "$modules" "$repo/$name/node_modules"
    echo "link  $name/node_modules -> $modules"
  fi
done

# Reload is hot: nothing here asks for an Ultimate restart. The proof is the two actions, in any
# conversation: `projects` → `list` and `rate-limiter` → `status`.
