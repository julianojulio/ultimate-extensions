# `.ultimate/` — o que este projeto pede ao Ultimate

As extensões deste repositório não moram aqui: moram no primeiro nível (`projetos/`, `rate-limiter/`)
e são ligadas na máquina pelo `install.sh`. Esta pasta é a configuração com que o Ultimate trabalha
**neste repositório**, e vale para qualquer pessoa que rode `ultimate` nesta pasta.

## O que tem aqui

| Arquivo | O que faz |
| --- | --- |
| `settings.json` | Os dois `node --test` rodam como check de cada landing (`lander.checks`), e `isolates.worktree.setup` chama o script abaixo em todo checkout novo. Sem push configurado: o landing faz merge e fast-forward, nada sai da máquina. |
| `worktree-setup.sh` | Liga o `node_modules` de cada extensão dentro do worktree: ele é ignorado pelo git, então um checkout novo não consegue rodar os testes sem esse link. Mesmo alvo do `install.sh` (o `node_modules` do clone do Ultimate), e não mexe nos symlinks da máquina. |
| `agents/reviewer-extension.md` | Um revisor a mais no time: confere a mudança contra o guia de extensões do Ultimate (contrato do `@/sdk`, honestidade do que a UI mostra, lógica pura testável, README) em vez de olhar só o comportamento. O `reviewer` de fábrica o inicia junto com os outros e junta os relatórios. |

## Decisão de confiança

Nada desta pasta substitui o que já existe até você **confiar no projeto**: o Ultimate mostra o cartão
de setup do projeto e, só depois do seu aceite, settings, agentes, skills e extensões daqui passam a
valer. O `README.md` que você está lendo é o que aquele cartão mostra.

## O que não tem aqui

Nenhuma extensão de projeto: o que este repositório publica é de máquina e vale em todos os projetos,
por isso vive na camada `user` (`~/.ultimate/extensions/`). UI ou regra de um projeto de produto iria
em `<projeto>/.ultimate/extensions/`.
