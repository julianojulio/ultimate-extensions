# rate-limiter — teto de chamadas simultâneas por provedor

Segura a quantidade de pedidos **em voo ao mesmo tempo** num provedor: 3 em `cirthan-dev` e em
`cirthan` (ou o que o `settings.json` desta máquina disser), o resto espera numa fila que anda por
ordem de chegada. Nasceu do patch que vivia em
`server/tool-arguments.ts` no clone do Ultimate (commit `38932639`, guardado na branch
`local/limiter-2026-11-08`), agora fora do clone: aqui recarrega a quente e vale para todos os
projetos desta máquina.

O motivo: o provedor devolve `error 429` quando recebe muitos pedidos de uma vez. No trace deste
projeto são 19 falhas com 429, 12 delas em cinco minutos de 04/11 (contagem piso: o trace guarda 7
dias).

## O que ele faz

1. pede ao runtime o provedor inteiro (`host.modelRuntime.getProvider(id)`);
2. guarda o `streamSimple` **do provedor** (o fluxo de antes de embrulhar);
3. registra de volta o mesmo provedor com um `streamSimple` que espera uma vaga, roda o fluxo
   original e devolve a vaga quando o stream acaba — inclusive quando ele falha ou é abortado.

Se o provedor não existir nesta máquina, nada acontece com ele (`cirthan` existe na `auth.json`
daqui mas não em `models.json`, então fica de fora e o `status` mostra isso). Se existir e não
tiver `streamSimple`, **não registra nada** e avisa numa notificação: um provedor quebrado quebraria
toda conversa da máquina.

Provedor fora do teto (`Infinity`) recebe uma vaga que não conta nada e nunca entra na fila.

## O teto

O teto vem de duas camadas: o padrão no código (`limiter.ts`) e este arquivo, o **da máquina**,
`~/.ultimate/settings.json`:

```json
{
  "rateLimiter": { "limits": { "cirthan-dev": 3, "cirthan": 3 } }
}
```

O que o arquivo diz vale **por cima** do padrão, e vale na hora: salvar o arquivo reinstala a
extensão (`reloadOnSettings`, sem reiniciar o Ultimate). O semáforo continua sendo o mesmo — as
vagas em voo e a fila não se perdem na recarga, e quem já espera mantém a ordem.

**O teto é por provedor e por máquina**: três `cirthan-dev` em qualquer combinação de conversas,
subagentes e automações desta máquina, e o quarto pedido espera.

O padrão do código, que vale quando o arquivo não diz nada:

```ts
export const LIMITS: Limits = {
  'cirthan-dev': 3,
  cirthan: 3,
}
```

As quatro regras:

- **Só o arquivo do usuário conta.** O `.ultimate/settings.json` do projeto é ignorado de propósito:
  o teto é da conta no provedor, desta máquina, e um projeto não pode subir o teto dos outros.
- **Provedor fora do mapa não é limitado** (`Infinity`): recebe a vaga na hora e nunca entra na
  fila. É o que vale também sem a chave, sem o bloco `rateLimiter` e sem o arquivo.
- **Valor inválido é recusado com uma notificação**, e vale o **padrão** do código (não o valor
  anterior): tem de ser inteiro e ≥ 1. `0`, negativo, `1.5` e `"3"` não passam:

  ```text
  rate-limiter: rateLimiter.limits.cirthan-dev must be a whole number of at least 1, not 0: it stays at 3
  ```

  `0` não é um teto, é um apagão: travaria toda chamada desta máquina para sempre.
- **Arquivo ilegível ou com JSON inválido**: os padrões valem, com uma notificação
  (`rate-limiter: could not read ~/.ultimate/settings.json (…); keeping the defaults`). A extensão
  não quebra, e um erro de digitação não deixa a máquina sem teto em silêncio.

Ao reler os tetos a extensão só troca `shared.limits`: o objeto de estado e o `ProviderLimiter` do
recurso `rate-limiter.slots` são os mesmos, e por isso nada do que está em voo ou na fila se perde.
Nenhum método é chamado na instância que o módulo anterior criou (o prototype dela é o antigo): o
limiter lê os tetos pela closure `() => shared.limits`.

## As três armadilhas, e como cada uma está resolvida

- **Recarga dupla.** Uma recarga instala a facet nova antes de fechar a anterior, e o
  `getProvider` nesse momento devolve **o embrulho da facet anterior**. Embrulhar de novo faria
  cada pedido pegar duas vagas, e com teto 3 tudo travaria. O fluxo original e o semáforo moram num
  `host.resource('rate-limiter.slots', …)`, que sobrevive à recarga: embrulha-se sempre **aquele**
  fluxo, e o semáforo é o mesmo de antes. Prova em `limiter.test.ts` ("two loads over the same
  host…"): duas cargas sobre o mesmo host, um pedido, `active === 1`; trocar o recurso pelo
  `getProvider` atual faz o teste falhar com `active === 2`.
- **Fechar não desregistra.** `unregisterProvider` apagaria a camada de extensão de um provedor que
  existe sem ela. O `onClose` não toca no registro; desligar a extensão (tirar a pasta) só solta o
  teto depois de reiniciar o processo, e nada mais quebra por isso.
- **Vaga órfã.** A vaga é devolvida no `finally` do relay do stream, então um stream que termina com
  erro, um aborto no meio e uma exceção do provedor passam todos por lá. Um pedido abortado **na
  fila** sai da fila e rejeita sem nunca ter pego vaga; um aborto que chega junto com a entrega da
  vaga é pulado na hora de entregar (`#slot`). Se o consumidor nunca ler o stream, o pedido já
  começou (o embrulho é ansioso, como o patch original) e termina quando o provedor responder.

## Status

A ação `status`, sem argumentos:

```sh
ultimate.action('rate-limiter', 'status')
# { wrapped: ['cirthan-dev'], limits: { 'cirthan-dev': 3, cirthan: 3 },
#   active: { 'cirthan-dev': 0 }, queued: { 'cirthan-dev': 0 } }
```

`wrapped` é o que está mesmo embrulhado; `active` e `queued` são as vagas em voo e na fila.

## Testes

```sh
cd ~/src/ultimate-extensions/rate-limiter
node --test limiter.test.ts
```

`node_modules` aqui é **symlink para `~/src/ultimate/node_modules`** (criado pelo `install.sh` do
repositório: é o truque das outras extensões desta máquina, e os testes resolvem
`@earendil-works/pi-ai` e `@earendil-works/pi-durable` do clone). Symlink de máquina, não entra em
repositório nenhum; se o clone mudar de lugar, basta rodar o `install.sh` de novo.

O teste do semáforo é puro (sem host): teto, fila FIFO, liberação idempotente, aborto na fila, teto
infinito. Os da leitura dos tetos usam um `HOME` temporário: teto vindo do `settings.json`, chave
ausente → padrão, JSON inválido → padrão **e** notificação, `0`/negativo/não-inteiro recusado com
notificação, e o arquivo salvo de novo aplicando no **mesmo** semáforo com a fila na mesma ordem. Os
dois últimos usam um host falso: as duas cargas (recarga sem embrulhar duas vezes) e o stream
abortado na fila (termina com evento `error` de motivo `aborted` e não prende vaga).

## Pressupostos sobre a API do pi

- `host.modelRuntime.getProvider(id)` devolve o provedor **composto** — a camada da extensão por
  cima da base —, e `registerProvider(id, config)` compõe por cima da base, não substitui.
- `registerProvider` com `streamSimple` **exige** `api` (`"api" is required when registering
  streamSimple`), e o runtime só usa a camada da extensão quando `model.api === config.api`; por
  isso a `api` sai de `getProvider(id).getModels()[0].api` e é guardada junto com o fluxo.
- O registro do provedor sobrevive à recarga e à troca de facet: só `unregisterProvider` o tira.
- `streamSimple` recebe `(model, context, options)` já com a autenticação preparada pelo runtime
  (`prepareRequest`), e devolve um `AssistantMessageEventStream` que pode ser iterado com
  `for await`; `result()` dá a mensagem final.
- `defineExtension({ name })` precisa do mesmo nome da pasta (`rate-limiter`), e a factory recebe o
  `ExtensionHost`.

Se algum desses deixar de valer numa atualização do Ultimate, o sintoma é o `status` não listar o
provedor em `wrapped` (e uma notificação dizendo por quê). Nesse caso a saída é tirar a pasta e
**reiniciar o Ultimate**: o registro que a extensão deixou no runtime sobrevive à recarga, então
só o processo novo volta a ter o provedor sem embrulho.

O host precisa de `userHome` (a extensão lê `$HOME/.ultimate/settings.json`), e `install` é assíncrono
por causa dessa leitura; `reloadOnSettings` faz o host reinstalar a extensão quando o arquivo muda.
A facet antiga só é fechada depois que a nova carregou, então um `server.ts` com erro de sintaxe
deixa a anterior no ar — e um valor de teto recusado nunca derruba a extensão.
