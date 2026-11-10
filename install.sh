#!/bin/sh
# Liga cada extensão deste repositório em ~/.ultimate/extensions/<nome>, que é de onde o Ultimate as
# carrega, e aponta o node_modules delas para o clone do Ultimate. Idempotente: rodar de novo não
# muda nada; uma extensão nova aqui é instalada por uma linha a mais na próxima execução.
#
# O clone do Ultimate sai de $ULTIMATE_ROOT, e por omissão de ~/src/ultimate: é dele que vêm os
# pacotes @earendil-works/* de que os testes de cada extensão precisam.
set -eu

repo=$(cd "$(dirname "$0")" && pwd)
dest="$HOME/.ultimate/extensions"
ultimate=${ULTIMATE_ROOT:-$HOME/src/ultimate}
modules="$ultimate/node_modules"

mkdir -p "$dest"

for path in "$repo"/*/; do
  name=${path%/}
  name=${name##*/}
  # Só pasta que é extensão de verdade: node_modules não está aqui, e .git não casa com este glob.
  if [ ! -f "$repo/$name/server.ts" ] && [ ! -f "$repo/$name/web.tsx" ]; then
    continue
  fi

  link="$dest/$name"
  if [ -d "$link" ] && [ ! -L "$link" ]; then
    echo "skip  $name: $link é uma pasta de verdade, não um link — remova-a à mão" >&2
    continue
  fi
  if [ -L "$link" ] && [ "$(readlink "$link")" = "$repo/$name" ]; then
    echo "ok    $name -> $repo/$name"
  else
    ln -sfn "$repo/$name" "$link"
    echo "link  $name -> $repo/$name"
  fi

  if [ ! -d "$modules" ]; then
    echo "note  $name: sem $modules — os testes não resolvem @earendil-works/*. Aponte ULTIMATE_ROOT para o clone" >&2
  elif [ -L "$repo/$name/node_modules" ]; then
    # Um link para outro sítio se refaz; um node_modules de verdade (instalado à mão) fica como está.
    [ "$(readlink "$repo/$name/node_modules")" = "$modules" ] || ln -sfn "$modules" "$repo/$name/node_modules"
  elif [ -e "$repo/$name/node_modules" ]; then
    echo "note  $name: $repo/$name/node_modules existe e não é link — deixado como está" >&2
  else
    ln -s "$modules" "$repo/$name/node_modules"
    echo "link  $name/node_modules -> $modules"
  fi
done

# A recarga é a quente: nada aqui pede reiniciar o Ultimate. A prova são as duas ações, em qualquer
# conversa: `projetos` → `listar` e `rate-limiter` → `status`.
