O rail dos projetos desta máquina: uma coluna de 48px na borda esquerda da janela com um tile por
projeto — os hosts de pé em cima, os parados embaixo —, onde o bloco inteiro é o clique. Tocar num
projeto de pé abre aquele projeto nesta aba; tocar num parado sobe o host; e o painel do tile diz o
que o tile não cabe: a porta, o estado escrito, quantas conversas daquele projeto estão trabalhando e
quantas perguntas esperam resposta, medido na hora em que o painel abre.

Cada tile carrega o **ponto de presença** do app: cinza parado, verde ocioso, pulsando quando trabalha,
e o número em âmbar quando há pergunta sem resposta. No pé da coluna ficam o ⟳ (medir de novo), o `+`
(criar um projeto) e o interruptor da **animação do splash** — que escreve só a entrada `splash` dos
settings desta máquina.

![O rail na borda esquerda: os projetos de pé em cima, com o ponto de presença e o número de perguntas, uma linha, os parados abaixo, e o pé com ⟳, + e o interruptor do splash](screenshots/rail.png)

**Extensão de máquina**: mora em `~/.ultimate/extensions/projetos/` — um symlink para `projetos/` no
repositório `ultimate-extensions` —, vale em todos os projetos desta máquina e não pertence a nenhum
deles. Ela usa o slot `shell.rail`, que é uma coluna de altura inteira ao lado da barra de título e de
todas as superfícies (agent, system, review, memory); dentro de um frame, o Ultimate não desenha o
rail e a extensão não aparece.

## O rail

```
┌──┐
│AE●│  ← esta janela: text-brand, ponto verde (ocioso), e o clique só abre o painel
│GL●│  ← de pé e trabalhando: o ponto pulsa (brand); o ① no canto de cima é uma pergunta
│RO●│  ← de pé e ocioso: ponto verde
│SA○│  ← de pé e sem resposta: ponto vazado, sem pulso e sem amarelo
│──│  ← uma linha fina separa os de pé dos parados
│NO●│  ← parado, mais apagado: ponto cinza, e o clique sobe o host
│  │
│⟳ │  ← medir de novo (o title diz a hora da última leitura)
│+ │  ← criar um projeto
│◑ │  ← a animação do splash: interruptor à direita = ligado (o title diz o resto)
└──┘
```

- **As iniciais, não o nome.** Duas letras por projeto: `app_evangelho` → `AE`, `robsoncosta` → `RO`,
  `gta2xlwifi-lineage` → `GL` (duas palavras dão a primeira letra de cada uma; uma só dá as duas
  primeiras letras). Dois projetos podem coincidir nas iniciais — o painel diz nome e caminho inteiros,
  e o `title` do tile também.
- **O bloco inteiro é o alvo do clique**, e **a porta não aparece no tile**: ela é o endereço do link
  (`http://127.0.0.1:<porta>`), não informação da tela. `:porta` se lê no painel, onde é diagnóstico.
- **Ordem**: o projeto desta janela abre a coluna; os outros de pé vêm por nome; a linha fina; os
  parados por nome. A mesma ordem em cada abertura, para um tile não pular de lugar.
- **De pé e não é esta janela** → o tile é um `<a href>`: um clique abre aquele projeto **nesta aba**
  (é um trocador de projeto, não um espiador; ⌘/Ctrl+clique abre em aba nova, como qualquer link).
- **Parado** → o tile é um `<button>`: um clique sobe o host (o mesmo spawn do `iniciar`), e o tile
  mostra um giro enquanto ele sobe. Não subiu? O tile ganha um anel vermelho com o erro no `title`, e
  o painel diz o erro — a última linha `Error:` do log do processo.
- **Esta janela** → `text-brand`, com o fundo tingido de brand e nenhuma ação de troca: um clique abre
  o painel. Quem serve a tela em que se clica não se troca por ela mesma.
- **Estado escrito, nunca só na cor**: o tile é pequeno demais para a palavra, então ela está no painel
  (`running` / `stopped`, e `stopping` enquanto o `stop` trabalha), na ordem da coluna — os de pé em
  cima, os parados embaixo — e no `title`/`aria-label` de cada tile, que dizem a frase inteira. A cor
  do ponto é reforço.

## O estado no tile

![Os tiles de perto: AE com ponto verde, GL com o ponto pulsando e o número 1 em âmbar, RO com ponto verde, SA com o ponto vazado, SI com o ponto verde e o 9+ em âmbar, e NO com o ponto cinza](screenshots/estado.png)

O ponto de 6px do canto é o **mesmo esquema de presença do app** (o `AgentMark` das conversas):
`size-1.5 rounded-full`, com o anel da cor do rail por cima, e `data-presence` no elemento. As classes
são copiadas de `extensions/conversations/marks.tsx` — esta extensão não importa de lá —, então o rail e
a sidebar falam a mesma língua visual.

| O que se vê | Quando |
| --- | --- |
| ponto **cinza** (`muted-foreground/60`) | o projeto está parado; o tile também fica mais apagado |
| ponto **verde** (`success`) | de pé e ocioso: `0 working` medido |
| ponto **pulsando** (`animate-pulse-dot bg-brand`) | de pé e com conversa trabalhando agora |
| ponto **vazado** (só o anel) | de pé e **sem resposta** no prazo de 3 s: o tile diz `unavailable` com o motivo |
| **número em âmbar** no canto de cima | há pergunta sem resposta; `1`..`9`, e `9+` de dez para cima. Em zero não aparece |

- **O número não cobre as iniciais.** Ele fica no canto de cima à direita, no vão entre os tiles — que
  por isso são espaçados de 8px —, com o anel da cor do rail separando ele do fundo. Um `9+` acima de
  dez é o limite: o número exato de 42 perguntas não muda a decisão de quem olha o rail, e um número
  largo demais esconderia o nome do projeto.
- **Sem resposta não é ocioso.** Um host de pé que não respondeu dentro do prazo fica sem pulso e sem
  amarelo, com o ponto vazado — o silêncio de um host travado não pode ser lido como calma.
- **Zero é medida.** `0 working` é uma resposta, e é ela que deixa o ponto verde. O que não se mediu
  ainda (a onda não voltou) também não é zero: o ponto fica vazado e o `title` diz `not measured yet`.
- **O `title` e o `aria-label` do tile dizem a frase inteira**, com a hora da medida:
  `gta2xlwifi-lineage — running · 2 working · 1 unanswered question · measured at 21:53 — open it in this tab`. Um
  indicador que envelhece é aceitável; um que mente não é — por isso ele carrega de quando é.
- **Quando se mede:** ao montar o rail, ao entrar com o ponteiro no rail (**no máximo uma vez a cada
  15 s**), no `⟳`, e depois de cada ação que muda a máquina (`iniciar`, `parar`, `criar`). O painel
  continua medindo quando abre, e a medida dele vale para aquele tile — ela vence a da onda.
- **Não há timer.** A leitura é a ação `listar` completa (o `estado` de cada host de pé, em paralelo,
  com o prazo de 3 s que já existia): uma foto, com hora, e não um relógio.

## O painel do tile

![O painel do tile: nome, caminho, running :4811, 2 working · 1 question, a hora da medida, e os botões de copiar o comando e parar](screenshots/painel.png)

Abre no **hover** e no **foco** (Tab até o tile), e fecha quando o ponteiro ou o foco sai, ou com
`Esc`. Ele é `position: fixed`: não é recortado quando a coluna rola, e continua filho do tile na
ordem do DOM, que é o que deixa o teclado chegar aos botões dele. Conteúdo, de cima para baixo:

| O que | De onde |
| --- | --- |
| o nome e o caminho | `host.projects()` (o `project.json` do home do projeto) |
| `running` / `stopped`, e `:porta` | o lock daquele projeto, relido a cada leitura |
| `this window` | o projeto que serve esta janela |
| `1 working · 1 question` | a ação `medir`, perguntada **quando o painel abre**, com a hora ao lado |
| `command` | copia `ultimate <caminho>`, com aspas simples quando o caminho pede |
| `stop` | só num projeto de pé que não é esta janela |

- **A medida é do instante em que o painel abre**, e o painel escreve a hora dela (`measured at
  21:53`). Fechado, ninguém mede nada: não há poll, e o número nunca aparece no tile. A medida que o
  painel faz vale também para o ponto e o número daquele tile no rail: enquanto o painel está aberto,
  ela vence a da onda.
- **Zero inventado é o pior erro possível aqui**: um host que não responde em 3 s mostra
  **`unavailable` com o motivo** (`no answer in 3s`, `HTTP 404`, …), nunca `0`. É justamente o zero
  falso que faria ignorar o projeto travado.
- **Um projeto parado não mostra medida**: não há a quem perguntar. O painel diz `stopped · click to
  start` e oferece o comando a copiar.
- **Parar** mata só o pid do lock daquele projeto (ver as regras abaixo). Um host **que esta extensão
  não subiu** — nascido num terminal, num supervisor, por outra pessoa — só para depois de o painel
  perguntar, com a porta e o pid no texto: `Stop the host on :4803 (pid 1234)? It was not started from
  here.` → `stop it` / `keep it`. A resposta chega à ação como `confirm: true`; sem ela, a ação devolve
  `precisaConfirmar` e não toca em nada.
- Um erro de ação aparece no próprio painel, em uma a três linhas (o texto inteiro no `title`).

## O `+`: criar um projeto

![O diálogo de um projeto novo: um campo de caminho, com ~/src/my-project de exemplo](screenshots/novo-projeto.png)

Um campo de caminho e um botão. O caminho aceita `~` (o home de quem usa) e tem de ser **absoluto**:
vazio, relativo ao acaso e `~outro` são recusados com uma frase, não com uma pasta adivinhada. O
servidor confere que a pasta existe e é um diretório (`No such folder: …`, `Not a folder: …`) e então
sobe o host como o `iniciar` sobe: `ultimate <caminho>` na primeira porta livre a partir de **4747**,
destacado (`detached`, sem tty), **sem janela** (`--no-open`), com a saúde sendo `GET /` naquela porta
em **20 s** (não subiu no prazo? o processo é encerrado e o diálogo mostra a última linha de erro do
log dele).

- **O tile aparece** sozinho quando o host responde, e o diálogo troca o formulário por um cartão:
  `novo is running :4750`, com `Open it` (abre aquela janela) e `Done` (fica aqui). Criar não troca de
  janela por você: **a primeira execução daquele projeto, o onboarding e a decisão de confiança
  daquela pasta acontecem na janela dele** — esta extensão não decide nada por ele.
- **Um caminho que já é um projeto da lista é selecionado, não duplicado**: de pé, o cartão diz
  `app_evangelho is running :4801` e `No second host was started for that folder.`; parado, esta
  extensão sobe aquele host; e o caminho desta própria janela diz `is this window`. Em nenhum desses
  casos nasce um segundo host para a mesma raiz.
- **Duas pastas com o mesmo nome de projeto não se distinguem aqui**, porque as ações falam por nome: um
  segundo `app` faria o tile do primeiro responder pelo segundo (e pará-lo no lugar dele). Então o `+`
  **recusa** a segunda com todas as letras, nomeando o projeto que já existe.
- **Um projeto novo não se registra à mão**: o home central (`~/.ultimate/projects/<nome>-<8 hex do
  caminho>`) nasce com o host que roda naquela pasta, e é por isso que `listar` já o encontra na
  leitura seguinte. A extensão calcula esse home para passar `ULTIMATE_HOME` ao processo — é o mesmo
  cálculo de `server/project.ts:projectHome`, e é o único ponto desta extensão que depende de um
  detalhe do Ultimate; se ele mudar lá, o que quebra é o tile do projeto novo aparecer (e o conserto é
  manter os dois iguais).

## A animação do splash

![O pé do rail de perto: o ⟳, o + e o interruptor do splash, à direita quando ele está ligado](screenshots/splash.png)

O Ultimate abre com o wordmark se desenhando por cima da janela enquanto o app carrega. Esse é o
splash, e ao trocar de projeto ele aparece de novo. O último ícone do pé do rail liga e desliga ele
com um clique:

- **interruptor à direita** = ligado; **à esquerda** = desligado. O `title` e o `aria-label` dizem as
duas coisas: `Splash on project switch: on — turn it off` / `Splash on project switch: off — turn it on`.
  Antes da primeira leitura da coluna o estado não se sabe, e a frase diz `unknown`.
- **Um clique é reversível**, então não pergunta nada: ele pede à ação `splash` o contrário do que a
  coluna leu.
- **Onde ele escreve**: `~/.ultimate/settings.json`, a camada de quem usa — o **único** lugar em que
  esta extensão escreve fora do home de um projeto que ela mesma subiu. O arquivo é lido antes e
  reescrito por um temporário ao lado e um `rename`, com **todas as outras chaves preservadas**
  (`modelFamilies`, `lander`, o que houver).
- **O que ele muda**: só a entrada `splash` de `extensions.disable` — desligar acrescenta o nome uma vez
  só, ligar tira. `extensions.enable` **não é tocado** (`disable` vence `enable` na mesma camada, então
  desligar funciona mesmo com `splash` lá), e o settings de projeto nunca é escrito.
- **O arquivo é reescrito em JSON normalizado** (duas casas de indentação, uma linha no fim): a
  formatação de antes, e só ela, se perde.
- **O que ele recusa, sem escrever nada**: JSON inválido, um arquivo que não é um objeto, um
  `extensions` que não é objeto, uma `disable` que não é lista de nomes — o core jogaria o arquivo
  inteiro fora, e o usuário perderia todas as outras chaves. A frase do erro (com o caminho e o motivo,
  mais `Nothing was written`) aparece no `title` do botão, que vira um `!` vermelho; o arquivo continua
  exatamente como estava. Arquivo ausente não é erro: desligar cria o arquivo, ligar não cria nada.
- **O limite, escrito**: um `<projeto>/.ultimate/settings.json` pode desligar ou ligar o splash **por
  cima** disso, porque a camada do projeto vence a do usuário. Este botão fala da camada desta máquina:
  com um projeto dizendo o contrário, ele muda o que está escrito no seu arquivo e o efeito naquele
  projeto continua sendo o do projeto.
- **A extensão recarrega a quente**: o estado que o botão mostra vem da leitura da coluna (`listar`
  devolve `splash`), nunca de uma variável de módulo — e o `splash.enabled` da lista de extensões do
  host muda **sem reiniciar**.

## As quatro regras de subir, parar e criar

São todas obrigatórias, e cada uma nasceu de um jeito de mentir:

1. **A guarda é o pid vivo, nunca o arquivo.** Um `ultimate.lock` cujo pid não existe mais é um projeto
   parado — o tile diz `stopped` e o clique sobe. Um lock de pid vivo é «já roda em :N» e o clique de
   subir não faz nada. O lock é relido do disco a cada ação: a extensão recarrega entre uma e outra, e
   uma lista em memória envelheceria.
2. **O host nasce destacado.** `spawn` com `detached` (o `setsid` do sistema), sem tty, com a saída num
   arquivo — um filho do host que o subiu morreria no reinício deste.
3. **A porta é a primeira livre a partir de 4747, e a resposta é a saúde.** Sobe-se em `--port <N>` (o
   primeiro em que se consegue abrir um listener em loopback), e só se devolve o link quando `GET /`
   naquela porta responde: **20 s** de prazo. Não subiu no prazo, o processo que se subiu é encerrado e
   o erro vai para o painel — a última linha `Error:` do log dele —, nunca um verde mentiroso.
4. **Parar mata só o pid do lock daquele projeto** (`SIGTERM`, e `SIGKILL` depois de 8 s) e confere que
   o lock sumiu. Nada de `pkill`, nada de matar por porta, nada de grupo de processos — e um host que
   esta extensão não subiu pede confirmação, como o painel mostra acima.

## O celular, e a sidebar no desktop

- **No celular não há rail**: uma coluna de 48px ao lado de uma conversa de 390px é roubo de espaço. A
  sidebar — que no celular é uma gaveta — continua com a **lista compacta de antes**: o ponto, o nome,
  o estado escrito, `:porta` (link para a mesma aba) com `1 working · 1 question` ao lado, o comando a
  copiar quando o projeto está parado, e o botão de subir e parar, visível ao toque
  (`pointer-coarse`), porque num toque não há hover para revelá-lo.
- **No desktop e no tablet a seção Projects da sidebar deixa de existir**: quem troca de projeto é o
  rail, um só. Com isso a sidebar volta a começar em @ultimate, sem a seção acima.
- A divisão é pelo `useViewport()` do SDK: `phone` para a lista, `desktop` e `tablet` para o rail.

## De onde vêm os dados, e quando se mede

| O que | De onde | Quando |
| --- | --- | --- |
| os projetos, a raiz, o pid e a URL | `host.projects()`: os homes de `~/.ultimate/projects`, com `running` só para quem tem **pid vivo** no lock | ao abrir a janela, depois de cada ação, e no botão de atualizar |
| as conversas trabalhando **deste** projeto | `host.conversations()`, o `busy` do grafo de tarefas deste host | na onda do rail, e quando o painel deste tile abre |
| as perguntas sem resposta **deste** projeto | o serviço `messages` (`openQuestions`), a mesma conta do painel de perguntas | na onda do rail, e quando o painel deste tile abre |
| o mesmo, **em outro** projeto | `POST <url do outro host>/api/extensions/projetos/actions/estado`, em loopback, com a `Origin` do alvo — o mesmo caminho que `lib/remote.ts` usa para falar com outra instância | na onda do rail, e quando o painel daquele tile abre |

Nem o `busy` nem as perguntas de outro projeto estão em lugar nenhum do disco: o `conversations.json`
que cada host publica não guarda o grafo de tarefas nem a caixa de perguntas (de propósito). Então a
pergunta vai ao próprio host daquele projeto, que responde de si mesmo (`estado`) e **não repassa a
pergunta a mais ninguém**.

O rail abre com `listar({ medir: false })`: a leitura barata, sem viagem a outro host, que só diz quem
está de pé (é ela que desenha os tiles). A **onda** é `listar()` completo, e é ela que acende o ponto e
o número: sai ao montar o rail, ao entrar com o ponteiro no rail (no máximo uma vez a cada 15 s), no
`⟳` e depois de cada ação que muda a máquina. `listar()` sem argumento continua medindo todo mundo (é o
que a lista do celular mostra, e o que qualquer chamador de fora recebe), agora com `splash` entre os
campos.

## O que a extensão escreve no disco

No home de um projeto que ela mesma subiu:

- `<home do projeto>/projetos-started.json` — `{ pid, port, at }`: o pid que esta extensão subiu. É o
  que deixa o `stop` saber que aquele host é dela, inclusive depois de a própria extensão recarregar.
  Um pid que não bate com o do lock é lido como «não fui eu» e o painel pergunta. O arquivo é apagado
  quando o host para.
- `<home do projeto>/projetos-start.log` — a saída do processo que se subiu (o supervisor escreve o
  resto em `supervisor.log`); é dele que sai a linha de erro no painel.

E, para um projeto **novo**, um diretório temporário do sistema (`ultimate-projetos-…` no diretório de
temporários) com o log da primeira subida, apagado assim que a ação termina — porque um projeto novo
ainda não tem home. Se o processo morrer antes de escrever o `project.json` (uma porta tomada no meio,
um `.ultimate/` quebrado, um reset interrompido), a extensão **apaga o home que ele criou**, e `listar`
também ignora um home sem `project.json`: uma subida morta nunca vira um tile sem caminho.

E **um** arquivo fora desses homes: o `~/.ultimate/settings.json` desta máquina, escrito pelo
interruptor do splash (a seção acima). É o único, e ele é reescrito inteiro em JSON normalizado — duas
casas de indentação e uma linha no fim, então a formatação de antes se perde, mas nenhuma chave se
perde. O `<projeto>/.ultimate/settings.json` **nunca** é tocado.

**Os dois limites conhecidos, nomeados:**

- Entre o `spawn` e a escrita do `projetos-started.json` há uma janela de milissegundos. Se a extensão
  reiniciar ali, o processo que ela subiu fica vivo e sem registo — e o pior caso é **um clique de
  confirmação a mais**, não um processo perdido.
- Para um projeto novo o registo só é escrito **depois** que o host responde (antes disso não há home
  para escrever), então a mesma janela vale para toda a primeira subida, que dura até 20 s. O custo
  continua sendo um clique de confirmação a mais.

Nada em `content/`, nada em projeto nenhum, e do home do usuário só aquele arquivo de settings: nunca se
escreve no `~/.ultimate` de quem usa fora dos homes dos projetos que esta extensão subiu — e do
`settings.json` da máquina, só a entrada `splash` de `extensions.disable`.

## Sem poll

Abrir a janela lê uma vez; trocar a conversa mostrada é outra leitura (o SDK indexa a leitura de uma
ação pela conversa em que ela é feita); a **onda** de presença sai ao montar, ao entrar com o ponteiro
no rail (no máximo uma vez a cada 15 s), no botão de atualizar (o `⟳` do pé do rail, cujo `title` diz a
hora da última leitura) e depois de cada ação que muda a máquina. Não há timer periódico, nem
assinatura de evento de outro host: **um indicador que envelhece é aceitável; um que mente não é** — e
por isso cada tile diz, no `title`, de quando é a medida que ele mostra.

## As ações

- `listar` — `{}` (ou sem argumento): os projetos da máquina com estado, porta e comando, medindo cada
  host de pé. `{ medir: false }`: a mesma lista **sem** medida e sem viagem a outro host — é a leitura
  do rail.
- `medir` — `{ name }`. O que se mediu naquele projeto agora: `{ working, perguntasAbertas, motivo?, at }`.
  É o que o painel do tile pede quando abre.
- `estado` — sem argumentos. Só este host: `{ working, perguntasAbertas, at }`. É o que outro host
  pergunta; nunca sai daqui para perguntar a mais ninguém.
- `iniciar` — `{ name }`. Sobe o host daquele projeto e só volta quando a porta responde; devolve a
  linha nova. Um projeto que já roda volta como está.
- `criar` — `{ caminho }`. Expande `~`, confere a pasta e sobe o host dela; devolve
  `{ criado, projeto }`. Um projeto que já é aquela pasta é selecionado (ou subido, se estava parado),
  nunca duplicado.
- `parar` — `{ name, confirm? }`. Deita o host daquele projeto e confere que o lock sumiu; devolve
  `{ parado: true, projeto }`, ou `{ parado: false, precisaConfirmar: true, pid, url }` quando o host
  não foi esta extensão que subiu e ainda falta o `confirm: true`.
- `splash` — `{ enabled: boolean }`. Liga ou desliga a animação do splash nas settings desta máquina e
  devolve `{ splash }`; o `listar` também devolve `splash`, que é de onde o botão do pé lê o estado.
  Recusa, sem escrever, o arquivo que o core recusaria inteiro.

`estado`, `iniciar` e `parar` continuam exatamente como eram: são a API que outro host desta máquina
chama, e o rail apenas passou a usar `listar` com `medir: false`, a ação `medir` e a ação `splash`.

## O que continua fora

- **Não mede o host a cada instante.** O ponto e o número são de uma leitura, com hora: eles envelhecem
  até a próxima onda, e é o `title` que diz de quando são. Não há timer, e nada pisca por conta própria
  além do pulso de «está trabalhando».
- **Não mostra o número da porta no rail**, de propósito: ele é endereço, não informação. Está no
  painel, para diagnóstico.
- **Não tem rail no celular**, e não troca de projeto por ele lá: no celular, a gaveta da sidebar é o
  trocador.
- **Não decide nada por um projeto novo**: criar sobe o host e mostra o tile; onboarding, confiança e a
  primeira execução daquela pasta acontecem na janela dele. E criar não troca de janela sozinho.
- **Não age sobre host que a extensão não subiu** sem perguntar — e nunca mata por porta, por nome nem
  por grupo.
- **Não agenda nada.** Subir, parar e criar são cliques; não há horário, gatilho nem supervisor próprio.
- **Não faz poll nem acompanha em tempo real**: para ver de novo, o ponteiro no rail (a cada 15 s), o
  painel do tile ou o `⟳`.
- **Não esconde, move nem apaga projeto.** A lista é a que o Ultimate tem; home fora de
  `~/.ultimate/projects` (uma prévia, um servidor de rascunho) não aparece nela — e um projeto assim
  pode ser criado de novo pelo `+` como se fosse novo, porque para esta extensão ele é.
- **Não distingue dois projetos com o mesmo nome de pasta.** As ações falam por nome de projeto: com
  dois `app` na máquina, o primeiro (por home) é quem responde ao `iniciar`, ao `parar` e ao `medir` —
  inclusive quando o tile e o painel em que se clica são do segundo. O `+` recusa criar o segundo, e o
  painel de cada tile mostra o caminho inteiro, para que se saiba qual é qual.
- **Não alcança outra máquina**: só o que roda nesta, em loopback.
- **Não limpa lock órfão**: se um host só parou com `SIGKILL`, o lock dele fica (de pid morto) e o tile
  diz parado; quem o substitui é o próprio `ultimate`, ao subir de novo.
- **Não troca de projeto num frame**: o Ultimate não desenha o slot `shell.rail` dentro de um frame, e a
  extensão respeita isso.
- **Não é um interruptor de extensões**: o botão do pé mexe só no splash, e só na camada desta máquina.
  Quem liga e desliga extensão em geral é o painel de setup do Ultimate.

## Idiomas

A interface fala **inglês**, como o resto do Ultimate (`New project`, `running`, `stopped`,
`0 questions`, `stop it`, `Splash on project switch: on — turn it off`), porque o rail mora ao lado de
`Conversations` e `Automations`. Este README fala português, como o da outra extensão desta máquina.

## Testes

```sh
cd ~/src/ultimate-extensions/projetos
node --test projetos.test.ts
```

26 testes puros, com fixtures: as palavras do estado; a porta do link (e a URL sem porta); a contagem e
o contador de perguntas, incluindo o que não se mediu e o **zero que é medida**; o ponto de presença do
tile (trabalhando, ocioso, parado e sem resposta) e o número do canto (1..9, `9+`, nada em zero); a
frase do tile, com a hora da medida; a onda que separa os projetos de pé dos parados; o `argv` com que se
sobe um host; a escolha da primeira porta livre (e o intervalo esgotado); a decisão de parar — inclusive
o lock de pid morto e o projeto desta janela, que não tem o que parar; as iniciais do tile e o tile que
não carrega porta; os dois grupos do rail (o desta janela primeiro, e um projeto só com medida contando
como parado); a expansão e a recusa de caminho do diálogo; o home que um projeto novo vai ocupar; e o
splash — ligar e desligar preservando as outras chaves, sem duplicar a entrada, e recusando o que o core
recusaria inteiro. Nenhum teste lê a máquina, abre processo ou faz requisição.

O `node_modules` de cada extensão é um **symlink para `~/src/ultimate/node_modules`**, criado pelo
`install.sh` do repositório (o truque das extensões desta máquina). A leitura da máquina, a viagem ao
outro host, o `splash.enabled` mudando sem reiniciar, o subir/parar e o criar de verdade se provam ao
vivo — com uma instância isolada (`ULTIMATE_USER_HOME` e `ULTIMATE_HOME` temporários, a extensão ligada
por symlink ao checkout em que se trabalha), um projeto de verdade criado pelo `+` e hosts de mentira
para os quatro estados do ponto: é assim que as cinco imagens acima foram feitas. O pulso não aparece
num PNG — as imagens mostram o ponto de trabalho parado num quadro.
