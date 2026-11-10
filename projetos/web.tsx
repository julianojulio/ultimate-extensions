/**
 * A seção “Projetos” da barra da esquerda: os projetos desta máquina, o estado de cada host, quantas
 * conversas estão trabalhando e quantas perguntas esperam resposta em cada um — a resposta a «onde
 * está acontecendo algo».
 *
 * Ela lê uma vez ao abrir e de novo no botão de atualizar: não há poll. Um projeto de pé abre nesta
 * mesma aba pelo link da porta (é um trocador de projeto, não um espiador; ⌘/Ctrl+clique continua
 * abrindo em aba nova, como qualquer link). Um projeto parado sobe pelo botão da linha; um de pé
 * desce pelo mesmo lugar, e um host que esta extensão não subiu pede confirmação com todas as letras.
 *
 * Com menos de dois projetos não há entre o que saltar: a seção não aparece.
 */
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  LoaderCircleIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  actionRef,
  api,
  cn,
  defineWebExtension,
  formatTime,
  useAction,
  useCopy,
} from '@/sdk'
import { contagem, medido, palavra, perguntas, portaDo, tituloDasPerguntas } from './projetos.ts'
import type { Projeto, ResultadoDaParada, Secao } from './tipos.ts'

/** Sem argumentos → os projetos da máquina, medidos agora. */
const SecaoAction = actionRef<null, Secao>('projetos', 'listar')

/** `{ name }` → sobe o host daquele projeto e só volta quando a porta responde. */
const IniciarAction = actionRef<{ name: string }, Projeto>('projetos', 'iniciar')

/** `{ name, confirm? }` → deita o host daquele projeto, ou diz que ele pede confirmação. */
const PararAction = actionRef<{ name: string; confirm?: boolean }, ResultadoDaParada>('projetos', 'parar')

export default defineWebExtension({
  slots: {
    // Acima da lista de conversas: o projeto em que se está vem antes do que se faz nele.
    sidebar: { component: Projetos, order: -10 },
  },
})

function Projetos() {
  const { data, error, loading, refetch } = useAction(SecaoAction)
  const [aberta, setAberta] = useState(true)
  // Um botão que muda a máquina mede de novo a seção inteira: o que mudou aparece sem poll.
  const atualizar = () => refetch().then(() => {})
  // Enquanto só se sabe de um projeto não há entre o que saltar, e a seção seria enfeite.
  if (!error && (!data || data.projetos.length < 2)) return null
  return (
    <Collapsible
      aria-label="Projects"
      className="mb-1 flex flex-col gap-px border-b border-border/60 pb-1"
      data-sidebar-section="projects"
      onOpenChange={setAberta}
      open={aberta}
    >
      <div className="mx-2 flex h-6 items-center gap-1">
        <CollapsibleTrigger className="group/projects flex h-6 cursor-pointer items-center gap-1 rounded-md px-1 section-label outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
          <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/projects:rotate-90" />
          Projects
        </CollapsibleTrigger>
        {data && (
          <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums">
            {data.projetos.length}
          </span>
        )}
        <button
          aria-label="Measure the projects again"
          className="ml-auto flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => void atualizar()}
          title={data ? `Measured at ${formatTime(data.at)} · measure again` : 'Measure again'}
          type="button"
        >
          <RotateCwIcon className={cn('size-3', loading && 'animate-spin')} />
        </button>
      </div>
      <CollapsibleContent className="flex flex-col gap-px">
        {error ? (
          <div className="mx-2 flex flex-col gap-1 rounded-md px-1 py-1">
            <p className="font-mono text-[10px] leading-relaxed break-words text-error">
              {error.message}
            </p>
            <button
              className="cursor-pointer text-left font-mono text-[10px] text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => void atualizar()}
              type="button"
            >
              try again
            </button>
          </div>
        ) : (
          data?.projetos.map((projeto) => (
            <Linha key={projeto.name} onChanged={atualizar} projeto={projeto} />
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Uma linha de projeto: o ponto e o nome, o estado escrito ao lado, e embaixo a porta (link para a
 * mesma aba) com a medida, ou o comando a copiar quando o host está parado. O botão da ponta sobe o
 * projeto parado e deita o que está de pé.
 */
function Linha({ projeto, onChanged }: { projeto: Projeto; onChanged: () => Promise<unknown> }) {
  const { copied, copy } = useCopy()
  const [pendente, setPendente] = useState<'start' | 'stop'>()
  const [confirmar, setConfirmar] = useState<{ pid: number; url?: string }>()
  const [erro, setErro] = useState<string>()
  const depe = projeto.running !== undefined
  // O que se disse de um estado não vale para o outro: uma medida nova apaga o aviso e a pergunta.
  useEffect(() => {
    setErro(undefined)
    setConfirmar(undefined)
  }, [depe])
  const porta = portaDo(projeto.running?.url)
  const copiavel = projeto.comando
  const caminho = projeto.current ? `${projeto.root} — this window` : projeto.root
  const estado =
    pendente === 'start' ? 'starting' : pendente === 'stop' ? 'stopping' : palavra(projeto)

  const falhou = (causa: unknown) =>
    setErro(causa instanceof Error ? causa.message : String(causa))

  const iniciar = async () => {
    setErro(undefined)
    setConfirmar(undefined)
    setPendente('start')
    try {
      await api.action(IniciarAction, { name: projeto.name })
      await onChanged()
    } catch (causa) {
      falhou(causa)
    } finally {
      setPendente(undefined)
    }
  }

  const parar = async (confirm = false) => {
    setErro(undefined)
    setPendente('stop')
    try {
      const resultado = await api.action(PararAction, {
        name: projeto.name,
        ...(confirm ? { confirm: true } : {}),
      })
      if (resultado.parado) {
        setConfirmar(undefined)
        await onChanged()
      } else
        setConfirmar({
          pid: resultado.pid,
          ...(resultado.url ? { url: resultado.url } : {}),
        })
    } catch (causa) {
      falhou(causa)
    } finally {
      setPendente(undefined)
    }
  }

  const acao = projeto.current ? undefined : depe ? (
    <Botao
      label={`Stop ${projeto.name}`}
      onClick={() => void parar()}
      pending={pendente === 'stop'}
      title={`Stop the host${porta ? ` on ${porta}` : ''}${projeto.running ? ` (pid ${projeto.running.pid})` : ''}`}
    >
      <SquareIcon className="size-2.5 fill-current" />
    </Botao>
  ) : (
    <Botao
      label={`Start ${projeto.name}`}
      onClick={() => void iniciar()}
      pending={pendente === 'start'}
      title={copiavel ? `${copiavel} — started detached, no window` : 'Start the host'}
    >
      <PlayIcon className="size-2.5 fill-current" />
    </Botao>
  )

  return (
    <div
      className="group/project mx-2 flex min-w-0 flex-col gap-px rounded-md py-1 pr-2 pl-2.5"
      data-current={projeto.current ? '' : undefined}
      data-project={projeto.name}
    >
      <div className="flex min-w-0 items-center gap-2" title={caminho}>
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-1.5 shrink-0 rounded-full',
            depe ? 'bg-success' : 'bg-muted-foreground/40',
          )}
          data-status={depe ? 'done' : 'idle'}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[12.5px]',
            projeto.current ? 'text-brand' : 'text-foreground/85',
          )}
        >
          {projeto.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{estado}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1 pl-[14px] font-mono text-[10px] text-muted-foreground">
        {depe ? (
          <>
            {porta &&
              (projeto.current ? (
                <span className="shrink-0" title={`${projeto.running?.url} — this window`}>
                  {porta}
                </span>
              ) : (
                <a
                  aria-label={`Open ${projeto.name} at ${projeto.running?.url}`}
                  className="shrink-0 outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                  href={projeto.running?.url}
                  title={`Open ${projeto.running?.url} in this tab`}
                >
                  {porta}
                </a>
              ))}
            {porta && <span aria-hidden="true">·</span>}
            <Medida projeto={projeto} />
          </>
        ) : copiavel ? (
          <button
            className="group/copy flex min-w-0 cursor-pointer items-center gap-1 text-left outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => copy(copiavel)}
            title={`${copiavel}\nclick to copy`}
            type="button"
          >
            <span className="truncate">{copiavel}</span>
            {copied ? (
              <CheckIcon className="size-3 shrink-0 text-success" />
            ) : (
              <CopyIcon className="size-3 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-50" />
            )}
          </button>
        ) : (
          <span>path unknown</span>
        )}
        {acao && (
          <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity pointer-coarse:opacity-100 group-hover/project:opacity-100 focus-within:opacity-100">
            {acao}
          </span>
        )}
      </div>
      {confirmar && (
        <div className="mt-1 flex flex-col gap-1 rounded-md bg-muted/50 px-2 py-1.5">
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Stop the host{porta ? ` on ${porta}` : ''} (pid {confirmar.pid})? It was not started from
            here.
          </p>
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <button
              className="cursor-pointer text-error outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => void parar(true)}
              type="button"
            >
              stop it
            </button>
            <button
              className="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setConfirmar(undefined)}
              type="button"
            >
              keep it
            </button>
          </div>
        </div>
      )}
      {erro && (
        <p
          className="mt-1 line-clamp-3 font-mono text-[10px] leading-relaxed break-words text-error"
          title={erro}
        >
          {erro}
        </p>
      )}
    </div>
  )
}

/**
 * O que se mediu no host: `1 working · 1 question`, ou `unavailable` quando ele está de pé e não
 * respondeu — nunca um zero inventado, que faria ignorar justamente o projeto travado. O número das
 * perguntas é o sinal; a frase inteira fica no `title`.
 */
function Medida({ projeto }: { projeto: Projeto }) {
  if (projeto.perguntasAbertas === null && projeto.working === null)
    return (
      <span className="min-w-0 truncate" title={projeto.motivo ?? 'no measurement'}>
        unavailable
      </span>
    )
  return (
    <>
      <span className="shrink-0">{contagem(projeto.working)}</span>
      <span aria-hidden="true">·</span>
      <span
        className={cn(
          'min-w-0 truncate',
          (medido(projeto.perguntasAbertas) ?? 0) > 0 && 'text-foreground/80',
        )}
        title={tituloDasPerguntas(projeto.perguntasAbertas, projeto.motivo)}
      >
        {perguntas(projeto.perguntasAbertas)}
      </span>
    </>
  )
}

/** O botão de subir e deitar um host: pequeno, na ponta da linha, e visível ao passar por cima. */
function Botao({
  label,
  title,
  pending,
  onClick,
  children,
}: {
  label: string
  title: string
  pending: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      aria-busy={pending || undefined}
      aria-label={label}
      className="flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default"
      disabled={pending}
      onClick={onClick}
      title={title}
      type="button"
    >
      {pending ? <LoaderCircleIcon className="size-3 animate-spin" /> : children}
    </button>
  )
}
