Os projetos desta máquina na barra da esquerda, com o estado de cada host, a porta em que ele atende,
quantas conversas dele estão trabalhando e quantas perguntas esperam resposta — e um botão que sobe
o projeto parado e deita o que está de pé.

**Extensão de máquina**: mora em `~/.ultimate/extensions/projetos/` — um symlink para
`projetos/` no repositório `ultimate-extensions` —, vale em todos os projetos desta máquina e não
pertence a nenhum deles. Ela põe uma seção **Projects** no topo da barra da
esquerda com os projetos de `~/.ultimate/projects` e, em cada linha, a resposta a «onde está
acontecendo algo agora»: o host está de pé ou parado, em que porta atende, quantas conversas dele
estão trabalhando, quantas perguntas do painel estão sem resposta, e — no botão da ponta — subir ou
parar aquele host.

## A linha

```
● app_evangelho                      running
  :4747 · 1 working · 1 question          ■
● gta2xlwifi-lineage                stopped
  ultimate ~/src/gta2x…                   ▶
● robsoncosta                       stopped
  ultimate ~/src/robso…                   ▶
```

- **O estado vem escrito** (`running` / `stopped`, e `starting` / `stopping` enquanto o botão
  trabalha), nunca só na cor do ponto.
- **De pé**: a porta é o **link** que abre aquela janela — na **mesma aba**, porque isto é um trocador
  de projeto, não um espiador (⌘/Ctrl+clique continua abrindo em aba nova, como qualquer link). Ao
  lado, a medida: `1 working` e `1 question`. O projeto desta janela mostra a porta sem link, e não
  tem botão.
- **Parado**: o comando `ultimate <caminho>` num bloco que **copia** ao clicar (com aspas simples
  quando o caminho tem espaço ou aspas), e o botão ▶ para subir.
- **O contador de perguntas**: `0 questions`, `1 question`, `2 questions`, com a frase inteira no
  `title` (`2 unanswered questions`). O número é o sinal, não a cor. Um host de pé que não responde em
  3 s mostra **`unavailable`** — nos dois números de uma vez, com o motivo no `title` —, nunca `0`: o
  zero inventado é o pior erro possível aqui, porque é justamente o que faz ignorar o projeto travado.
  Um projeto **parado** não mostra medida: não há a quem perguntar.
- O caminho completo, o motivo de uma medida indisponível e a frase das perguntas ficam no `title`.
- O nome do projeto desta janela sai em `text-brand`; o resto em `text-foreground/85`.
- **Com menos de dois projetos a seção não aparece**: um seletor com uma opção só é enfeite.

## As quatro regras de subir e parar

São todas obrigatórias, e cada uma nasceu de um jeito de mentir:

1. **A guarda é o pid vivo, nunca o arquivo.** Um `ultimate.lock` cujo pid não existe mais é um
   projeto parado (`gta2xlwifi-lineage` tinha um) — a linha diz `stopped` e o botão sobe. Um lock de
   pid vivo diz `running :N` e o botão de subir não faz nada, porque não há o que subir. O lock é
   relido no disco a cada ação: a extensão recarrega entre uma e outra, e uma lista em memória
   envelheceria.
2. **O host nasce destacado.** `spawn` com `detached` (o `setsid` do sistema), sem tty, com a saída
   num arquivo — um filho do host que o subiu morreria no reinício deste.
3. **A porta é a primeira livre a partir de 4747, e a resposta é a saúde.** Sobe-se em
   `--port <N>` (o primeiro em que se consegue abrir um listener em loopback), e só se devolve o link
   quando `GET /` naquela porta responde: **20 s** de prazo. Não subiu no prazo, o processo que se
   subiu é encerrado e a linha mostra o erro — a última linha `Error:` do log dele —, nunca um verde
   mentiroso.
4. **Parar mata só o pid do lock daquele projeto** (`SIGTERM`, e `SIGKILL` depois de 8 s) e confere
   que o lock sumiu. Nada de `pkill`, nada de matar por porta, nada de grupo de processos. E um host
   **que esta extensão não subiu** — nascido num terminal, num supervisor, por outra pessoa — só para
   depois de a linha perguntar, com o pid e a porta no texto: `Stop the host on :4749 (pid 1234)? It
   was not started from here.` → `stop it` / `keep it`. A resposta chega à ação como
   `confirm: true`; sem ela, a ação devolve `precisaConfirmar` e não toca em nada.

E duas coisas que a v2 **não** faz, de propósito:

- **Não para o projeto desta janela.** O `parar` recusa (`app_evangelho runs this window`) e a linha
  não oferece o botão: quem serve a tela em que se clica não desliga a própria tela.
- **Não sobe um projeto que já roda.** A ação devolve a linha como está, que é o «já roda em :N».

## De onde vêm os dados, e a única viagem

| O que | De onde |
| --- | --- |
| os projetos, a porta e o pid | `host.projects()`: os homes centrais de `~/.ultimate/projects`, com `running: { pid, url }` só para quem tem **pid vivo** no lock |
| as conversas trabalhando **deste** projeto | `host.conversations()`, o `busy` do grafo de tarefas deste host |
| as perguntas sem resposta **deste** projeto | o serviço `messages` (`openQuestions`), a mesma conta do painel de perguntas e do `status` |
| o mesmo, **em outro** projeto | `POST <url do outro host>/api/extensions/projetos/actions/estado`, em loopback, com a `Origin` do alvo — o mesmo caminho que `lib/remote.ts` usa para falar com outra instância |

Nem o `busy` nem as perguntas de outro projeto estão em lugar nenhum do disco: o `conversations.json`
que cada host publica não guarda o grafo de tarefas nem a caixa de perguntas (de propósito). Então a
pergunta vai ao próprio host daquele projeto, que responde de si mesmo (`estado`) e **não repassa a
pergunta a mais ninguém**. Um host que não responde em 3 s, ou que não tem esta extensão ligada,
aparece como `unavailable` com o motivo no `title`. Os outros projetos são perguntados **em paralelo**.

## O que a v2 escreve no disco

Só duas coisas, e só no home do projeto que ela mesma subiu:

- `<home do projeto>/projetos-started.json` — `{ pid, port, at }`: o pid que esta extensão subiu. É
  o que deixa o botão de parar saber que aquele host é dela, inclusive depois de a própria extensão
  recarregar. Um pid que não bate com o do lock é lido como «não fui eu» e o botão pergunta. O
  arquivo é apagado quando o host para.
- `<home do projeto>/projetos-start.log` — a saída do processo que se subiu (o supervisor escreve o
  resto em `supervisor.log`); é dele que sai a linha de erro quando o host não sobe.

Nada em `content/`, nada em settings, nada em projeto nenhum.

**O limite conhecido, nomeado**: entre o `spawn` e a escrita do `projetos-started.json` há uma janela
de milissegundos. Se o host desta extensão reiniciar ali, o processo que ela subiu fica vivo e sem
registo — e o pior caso é **um clique de confirmação a mais**, não um processo perdido: o lock dele o
torna visível na linha como `running :N`, e o ■ pergunta «it was not started from here». Não é
fantasma; é limite conhecido, e custa um clique.

## Sem poll

Abrir a seção mede uma vez; o botão de atualizar (o ícone ao lado do título, cujo `title` diz a hora
da última medida) é a outra leitura. As ações `iniciar` e `parar` medem de novo ao terminar, porque
elas mudaram a máquina. Não há timer, nem assinatura de evento de outro host: **um contador que
envelhece é aceitável; um contador que mente não é**.

## As ações

- `listar` — sem argumentos. Os projetos da máquina com estado, porta, medida e comando.
- `estado` — sem argumentos. Só este host: `{ working, perguntasAbertas, at }`. É o que outro host
  pergunta; nunca sai daqui para perguntar a mais ninguém.
- `iniciar` — `{ name }`. Sobe o host daquele projeto e só volta quando a porta responde; devolve a
  linha nova. Um projeto que já roda volta como está.
- `parar` — `{ name, confirm? }`. Deita o host daquele projeto e confere que o lock sumiu; devolve
  `{ parado: true, projeto }`, ou `{ parado: false, precisaConfirmar: true, pid, url }` quando o host
  não foi esta extensão que subiu e ainda falta o `confirm: true`.

As ações recebem **nome de projeto**, nunca caminho: o root, o home e o lock vêm da lista da máquina.

## O que continua fora

- **Não agenda nada.** Subir e parar é um clique; não há horário, gatilho nem supervisor próprio.
- **Não mata processo que não subiu sem perguntar** — e nunca mata por porta, por nome nem por grupo.
- **Não faz poll nem acompanha em tempo real**: a medida é a do instante; para ver de novo, o botão.
- **Não esconde, move nem apaga projeto.** A lista é a que o Ultimate tem; home fora de
  `~/.ultimate/projects` (uma prévia, um servidor de rascunho) não aparece nela.
- **Não alcança outra máquina**: só o que roda nesta, em loopback.
- **Não limpa lock órfão**: se um host só parou com `SIGKILL`, o lock dele fica (de pid morto) e a
  linha diz isso; quem o substitui é o próprio `ultimate`, ao subir de novo.

## Idiomas

A interface fala **inglês**, como o resto do Ultimate (`Projects`, `running`, `stopped`,
`0 questions`, `stop it`), porque a seção mora ao lado de `Conversations` e `Automations`. Este
README fala português, como o da outra extensão desta máquina.

## Testes

```sh
cd ~/src/ultimate-extensions/projetos
node --test projetos.test.ts
```

Cobrem o que é puro, com fixtures: a palavra do estado, a porta do link, a contagem, o contador de
perguntas e a frase do `title` (incluindo o que não se mediu), o `argv` com que se sobe um host, a
escolha da primeira porta livre (e o intervalo esgotado) e a decisão de parar — inclusive o lock de
pid morto, que não é host. O `node_modules` de cada extensão é um **symlink para
`~/src/ultimate/node_modules`**, criado pelo `install.sh` do repositório (o truque das extensões
desta máquina); a leitura da máquina, a viagem ao outro host e o subir/parar de verdade se provam ao
vivo, com a seção aberta.
