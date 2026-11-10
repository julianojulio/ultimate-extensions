#!/bin/sh
# Setup de um worktree novo deste repositório: aqui não existe node_modules.
#
# O node_modules de cada extensão é um symlink para o do clone do Ultimate (`install.sh` o cria no
# checkout principal, e o .gitignore o mantém fora do git). Num checkout novo não há esse link, e
# `node --test` não resolve `@earendil-works/*` até ele existir. Este script refaz o link para cada
# pasta do checkout de origem que seja uma extensão — uma extensão nova aqui não pede mudança nele.
#
# Seguro de repetir: um node_modules que já existe, link ou pasta, é deixado como está.
set -eu

origem=${ULTIMATE_SOURCE:?ULTIMATE_SOURCE precisa apontar para o checkout de origem}

for pasta in "$origem"/*/; do
  nome=$(basename "$pasta")
  # Só pasta que é extensão de verdade: uma com server.ts ou web.tsx.
  if [ ! -f "$pasta/server.ts" ] && [ ! -f "$pasta/web.tsx" ]; then
    continue
  fi
  modulos=$(cd "$pasta/node_modules" 2>/dev/null && pwd -P) || {
    echo "note  $nome: $pasta/node_modules não existe — rode install.sh no checkout de origem" >&2
    continue
  }
  if [ -e "$nome/node_modules" ] || [ -L "$nome/node_modules" ]; then
    continue
  fi
  ln -s "$modulos" "$nome/node_modules"
  echo "link  $nome/node_modules -> $modulos"
done
