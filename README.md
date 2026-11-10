# ultimate-extensions

As extensões de **máquina** do [Ultimate](https://github.com/HazAT/ultimate): moram em
`~/.ultimate/extensions/` e valem para **todos** os projetos desta máquina.

## O que é uma extensão de máquina

O Ultimate descobre extensões em três camadas:

| Camada | Onde | Vale para |
| --- | --- | --- |
| `builtin` | `extensions/` do clone do Ultimate | tudo, e é da máquina |
| `project` | `<projeto>/.ultimate/extensions/` | aquele projeto |
| `user` | `~/.ultimate/extensions/` | **todos os projetos desta máquina** |

Este repositório é o que mora na terceira linha: as extensões que não pertencem a nenhum projeto de
produto, mas mudam como a máquina trabalha — quantos pedidos simultâneos cada provedor aceita, e
onde está acontecendo algo em cada projeto aberto. Elas carregam a quente, ao lado de qualquer projeto,
e valem também para as conversas de automação e para os subagentes.

O que **entra** aqui: extensão que fala da máquina (processos, tetos de provedor, portas, homes de
outros projetos) e não do produto de ninguém. O que **não** entra: UI ou regra de um projeto — isso é
`<projeto>/.ultimate/extensions/`.

## As extensões

### `projetos` — o rail dos projetos da máquina

**O que resolve:** com mais de um projeto aberto nesta máquina, trocar de um para outro e responder «onde
está acontecendo algo agora» sem janela nem terminal: um **rail** de 48px na borda esquerda da janela,
presente em todas as superfícies, com um tile de iniciais por projeto — os hosts de pé em cima, os
parados embaixo —, o bloco inteiro como alvo do clique e o número da porta fora da tela. Um projeto de
pé abre naquele projeto nesta aba; um parado sobe; o painel do tile (hover ou foco) diz a porta, o estado
escrito, quantas conversas daquele projeto estão trabalhando e quantas perguntas esperam resposta,
medido na hora em que o painel abre, com a hora; e o `+` cria um projeto a partir de uma pasta. No
celular não há rail: a gaveta da sidebar continua com a lista compacta, com as medidas.

**O que não faz:** não mede nada sem o painel abrir (e nunca inventa um zero), não mostra a porta no
tile, não agenda nada, não faz poll, não mata processo que não subiu sem perguntar (e nunca por porta,
nome ou grupo), não esconde nem move projeto, não decide onboarding nem confiança por um projeto novo e
não alcança outra máquina. Detalhe em [`projetos/README.md`](projetos/README.md).

### `rate-limiter` — teto de pedidos simultâneos por provedor

**O que resolve:** o provedor devolve `error 429` quando recebe muitos pedidos de uma vez. A extensão
segura quantos pedidos ficam **em voo ao mesmo tempo** em cada provedor (3 em `cirthan-dev` e em
`cirthan`, ou o que o `~/.ultimate/settings.json` desta máquina disser) e põe o resto numa fila por
ordem de chegada. O teto é por provedor e por máquina: vale para conversas, subagentes e automações
juntas, e muda ao salvar o arquivo, sem reiniciar.

**O que não faz:** não mexe em provedor que não existe aqui, não limita provedor fora do mapa
(`Infinity`), não lê o `settings.json` de projeto nenhum (um projeto não pode subir o teto dos
outros) e não conta tokens nem custo. Detalhe em [`rate-limiter/README.md`](rate-limiter/README.md).

## Instalar

```sh
sh ~/src/ultimate-extensions/install.sh
```

O script é idempotente — rodar de novo não muda nada — e faz duas coisas, para cada pasta deste
repositório que seja uma extensão (`server.ts` ou `web.tsx`):

1. liga `~/.ultimate/extensions/<nome>` como **symlink** para a pasta daqui;
2. liga `<nome>/node_modules` no `node_modules` do clone do Ultimate, que é de onde os testes
   resolvem `@earendil-works/*`. O clone sai de `$ULTIMATE_ROOT`, por omissão `~/src/ultimate`.

Uma pasta de verdade em `~/.ultimate/extensions/<nome>` **não** é substituída: o script avisa e segue
(nada de apagar conteúdo alheio). Um `node_modules` que não seja link também fica como está.

**Nada disso pede reiniciar o Ultimate**: as extensões recarregam a quente. A prova, em qualquer
conversa:

```ts
ultimate.action('projetos', 'listar', {})              // os projetos da máquina, com estado e medidas
ultimate.action('projetos', 'listar', { medir: false }) // a leitura barata do rail, sem medida
ultimate.action('rate-limiter', 'status', {})          // { wrapped, limits, active, queued }
```

E `ultimate.extensions()` mostra as duas com `server.loadedAt` e sem `server.error`.

## A recarga a quente sobrevive ao symlink — medido

O host carrega a extensão pelo **alvo** do link (`realpath`, em `server/discovery.ts`) e o watcher
reporta o arquivo **pelo link**; `server/extensions.ts` já resolve um pelo outro antes de invalidar o
módulo. Medição feita nesta máquina, com as duas extensões vivas:

| | `projetos` `loadedAt` | `rate-limiter` `loadedAt` |
| --- | --- | --- |
| antes de editar `projetos/server.ts` no repositório | `2026-11-10T01:16:39.746Z` | `2026-11-10T01:16:40.111Z` |
| depois de salvar | `2026-11-10T01:17:27.808Z` | `2026-11-10T01:16:40.111Z` (intocada) |

E não foi só o `loadedAt`: a edição de prova somou um campo temporário ao retorno de `listar`
(`sonda: 'symlink-reload'`), que a ação devolveu em seguida. Ou seja, o módulo relido era **o do
alvo do link**, com o conteúdo novo — não um cache, nem o arquivo do link. Removida a sonda, a ação
voltou a devolver `{ projetos, at }`. A `rate-limiter` respondeu `status` normalmente o tempo todo, e
**o host não foi reiniciado**.

Por isso a instalação é por symlink: edita-se aqui, e o Ultimate recarrega sozinho.

## Editar e testar

O código é **daqui**; `~/.ultimate/extensions/<nome>` é só o link que o Ultimate lê. Depois de
`git pull` (ou de mover o clone), rode o `install.sh` de novo.

```sh
cd ~/src/ultimate-extensions/projetos     && node --test projetos.test.ts   # 18 testes
cd ~/src/ultimate-extensions/rate-limiter && node --test limiter.test.ts    # 12 testes
```

Os dois conjuntos são puros (fixtures, `HOME` temporário e um host falso): nenhum teste lê a máquina,
abre processo ou fala com provedor de verdade. O que é de máquina — o link, a recarga, a seção na
barra — prova-se ao vivo, com o Ultimate aberto.

## Estrutura

```
ultimate-extensions/
├── install.sh          # liga cada extensão em ~/.ultimate/extensions/<nome>
├── LICENSE             # MIT
├── projetos/           # o rail de projetos na borda esquerda
│   ├── README.md
│   ├── server.ts        # ações: listar, medir, estado, iniciar, criar, parar
│   ├── projetos.ts      # as contas puras (iniciais, grupos, caminho, porta, decisão de parada)
│   ├── tipos.ts         # o que as ações devolvem
│   ├── web.tsx          # o rail, o painel do tile, o diálogo do + e a lista do celular
│   ├── projetos.test.ts
│   └── screenshots/     # rail, painel e diálogo de um projeto novo
└── rate-limiter/       # teto de pedidos simultâneos por provedor
    ├── README.md
    ├── server.ts        # embrulha o stream do provedor; ação: status
    ├── limiter.ts       # o semáforo e a leitura dos tetos
    └── limiter.test.ts
```

## Licença

MIT — © 2026 Juliano Julio Costa. Ver [`LICENSE`](LICENSE).
