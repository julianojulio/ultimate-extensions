/**
 * The pure calculations of the Projects rail against fixtures: no test here reads the machine, opens
 * a process or makes a request — they are the functions of `projetos.ts` and what the rail promises to
 * show.
 *
 * What matters to pin down:
 *
 * - the state comes written, not just in the colour: `running` and `stopped` are words in the tile's
 *   panel, and the group is the position in the rail;
 * - the tile does not show a port: the label is letters only (`iniciais`), and the port lives in the
 *   link's href;
 * - the count and the question counter come from a measured number: not measured is not `0`, it is
 *   `unavailable` — the invented zero is the worst possible error, because it makes one ignore the
 *   stuck project;
 * - the host comes up on the first free port from 4747, without opening a window;
 * - the stop button kills only what it started itself; the rest asks for confirmation, and a dead-pid
 *   lock is not a host (there is nothing to stop, and the click brings it up);
 * - the command copied is the command that runs (`ultimate <path>`), with quotes when the path asks
 *   for them — and it is never run by this extension;
 * - the dot of the tile comes from the app's scheme: it pulses when working, green idle, grey stopped —
 *   and a host that did not answer does not become idle;
 * - the question number is the one in the tile's corner (`1`..`9`, `9+`), and zero draws nothing;
 * - the tile's sentence says state, counts and the time of the measurement: the indicator ages, but
 *   does not lie;
 * - the splash button writes only the `splash` entry of `extensions.disable` in the user's settings,
 *   preserving the other keys, without duplicating, and refusing what the core would refuse whole;
 * - the folder of the `+` dialog becomes an absolute path with `~` expanded, and a relative path is
 *   refused instead of becoming some folder at random;
 * - the home of a new project is the same one Ultimate calculates
 *   (`<home>/.ultimate/projects/<name>-<8>`).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ajustarSplash,
  argumentosDeInicio,
  caminhoAbsoluto,
  comando,
  contagem,
  decisaoDeParada,
  escolherPorta,
  grupos,
  homeDoProjeto,
  iniciais,
  linkDo,
  medido,
  numeroDePerguntas,
  ondaDaLeitura,
  palavra,
  perguntas,
  podeParar,
  portaDo,
  PRIMEIRA_PORTA,
  presenca,
  programaDeInicio,
  rotuloDoSplash,
  settingsDoUsuario,
  splashLigado,
  temMedida,
  tituloDasPerguntas,
  tituloDoTile,
} from './projetos.ts'
import type { Alvo } from './projetos.ts'
import type { Medida, Projeto, Secao } from './tipos.ts'

/** A row as the server sends it: up, with so many conversations working and so many questions. */
const depe = (working: number | null, abertas: number | null = 0): Projeto => ({
  name: 'gta2xlwifi-lineage',
  root: '/projects/gta2xlwifi-lineage',
  current: false,
  running: { pid: 4242, url: 'http://127.0.0.1:4748' },
  working,
  perguntasAbertas: abertas,
  ...(working === null ? { motivo: 'no answer in 3s' } : {}),
})

/** The same row with the host stopped: no `running` and with the command to copy. */
const parado: Projeto = {
  name: 'robsoncosta',
  root: '/projects/robsoncosta',
  current: false,
  comando: 'ultimate /projects/robsoncosta',
}

test('the state comes written: the colour is never the only signal', () => {
  assert.equal(palavra(depe(2)), 'running')
  assert.equal(palavra(parado), 'stopped')
  // Without `running` there is no process: a `working: 0` alone does not invent a host that is up.
  assert.equal(palavra({ name: 'x', root: '/x', current: false, working: 0 }), 'stopped')
})

test('the port of the link comes from the URL the host publishes', () => {
  assert.equal(portaDo('http://127.0.0.1:4748'), ':4748')
  assert.equal(portaDo('http://ultimate.localhost:4747'), ':4747')
  // Without a port there is no link: the row stays without an address instead of pointing at the wrong
  // place.
  assert.equal(portaDo('http://127.0.0.1'), undefined)
  assert.equal(portaDo(undefined), undefined)
  assert.equal(portaDo('not a url'), undefined)
})

test('the count is a measured number, and what was not measured does not become zero', () => {
  assert.equal(contagem(0), '0 working')
  assert.equal(contagem(1), '1 working')
  assert.equal(contagem(7), '7 working')
  // `null` is the host that is up and did not answer; `undefined`, the one that is stopped.
  assert.equal(contagem(null), 'count unavailable')
  assert.equal(contagem(undefined), 'count unavailable')
  // A malformed number does not pass as a measurement.
  assert.equal(contagem(Number.NaN), 'count unavailable')
  assert.equal(contagem(-1), 'count unavailable')
  assert.equal(contagem(Number.POSITIVE_INFINITY), 'count unavailable')
})

test('the question counter counts in words, and what was not measured is never zero', () => {
  assert.equal(perguntas(0), '0 questions')
  assert.equal(perguntas(1), '1 question')
  assert.equal(perguntas(2), '2 questions')
  // The silence of a stuck host is not "no questions": it is a missing measurement.
  assert.equal(perguntas(null), 'questions unavailable')
  assert.equal(perguntas(undefined), 'questions unavailable')
  assert.equal(perguntas(Number.NaN), 'questions unavailable')
  assert.equal(perguntas(-2), 'questions unavailable')

  assert.equal(tituloDasPerguntas(0), 'no unanswered questions')
  assert.equal(tituloDasPerguntas(1), '1 unanswered question')
  assert.equal(tituloDasPerguntas(2), '2 unanswered questions')
  assert.equal(tituloDasPerguntas(null, 'no answer in 3s'), 'questions unavailable — no answer in 3s')
  assert.equal(tituloDasPerguntas(undefined), 'questions unavailable')
})

test('medido accepts only a finite, non-negative whole number', () => {
  assert.equal(medido(0), 0)
  assert.equal(medido(3), 3)
  for (const torto of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined])
    assert.equal(medido(torto), undefined)
})

test('a zero is a measurement: only the silence of the host and the stopped project are not', () => {
  // The bug this pins down: treating `0` as absence and writing `unavailable` for a host that answered.
  assert.equal(temMedida(0, 0), true)
  assert.equal(temMedida(0, null), true)
  assert.equal(temMedida(null, 2), true)
  // `null` is the host that is up and did not answer; `undefined` is the stopped project, which nobody
  // asked.
  assert.equal(temMedida(null, null), false)
  assert.equal(temMedida(undefined, undefined), false)
  assert.equal(temMedida(Number.NaN, -1), false)
})

test('only a running project that is not this window has something to stop', () => {
  assert.equal(podeParar(depe(1)), true)
  // A stopped project has no host to bring down: its click brings it up.
  assert.equal(podeParar(parado), false)
  // What serves the screen you are clicking in is not shut down from it.
  assert.equal(podeParar({ ...depe(0), current: true }), false)
})

test('the command copied is the command that runs, with quotes when the path asks for them', () => {
  assert.equal(comando('/projects/robsoncosta'), 'ultimate /projects/robsoncosta')
  assert.equal(comando('/projects/my project'), `ultimate '/projects/my project'`)
  assert.equal(comando("/projects/it's"), `ultimate '/projects/it'\\''s'`)
  // A project without `project.json` has no path: the row says it does not know, it does not guess a
  // directory.
  assert.equal(comando(undefined), undefined)
  assert.equal(comando(''), undefined)
})

test('the row of a stopped project shows the command to copy, and no measurement', () => {
  assert.equal(palavra(parado), 'stopped')
  assert.equal(parado.working, undefined)
  assert.equal(parado.perguntasAbertas, undefined)
  assert.equal(comando(parado.root), parado.comando)
})

test('the tile shows initials, in two letters', () => {
  assert.equal(iniciais('app_evangelho'), 'AE')
  assert.equal(iniciais('gta2xlwifi-lineage'), 'GL')
  assert.equal(iniciais('robsoncosta'), 'RO')
  // Space, full stop and hyphen separate alike: two words give the first letter of each one.
  assert.equal(iniciais('my project'), 'MP')
  assert.equal(iniciais('ultra.js'), 'UJ')
  // A single word gives its first two letters; a single letter is a single letter.
  assert.equal(iniciais('worktrees'), 'WO')
  assert.equal(iniciais('x'), 'X')
  // Empty words (separators only) become no letter at all.
  assert.equal(iniciais('--'), '')
})

test('the tile does not carry the port: the label is letters and the port lives in the href', () => {
  const projeto = depe(1)
  // What is drawn in the block: no number, no address.
  assert.equal(iniciais(projeto.name), 'GL')
  assert.doesNotMatch(iniciais(projeto.name), /\d/)
  // What the click opens: the whole URL, with the port.
  assert.equal(linkDo(projeto), 'http://127.0.0.1:4748')
  assert.match(linkDo(projeto) ?? '', /:4748$/)
  // Stopped has no link: the click is another action (bring it up), not a trip to an address that does
  // not answer.
  assert.equal(linkDo(parado), undefined)
})

test('the rail groups: running on top, stopped below, this window’s first', () => {
  const listar = (projetos: Projeto[]) => grupos(projetos)
  const { rodando, parados } = listar([
    { name: 'zulu', root: '/z', current: false, running: { pid: 1, url: 'http://127.0.0.1:4750' } },
    parado,
    { name: 'alfa', root: '/a', current: false, running: { pid: 2, url: 'http://127.0.0.1:4749' } },
    { name: 'esta-janela', root: '/e', current: true, running: { pid: 3, url: 'http://127.0.0.1:4747' } },
    { name: 'beta', root: '/b', current: false },
  ])
  // This window's project opens the column; the rest of the running ones come by name.
  assert.deepEqual(
    rodando.map((projeto) => projeto.name),
    ['esta-janela', 'alfa', 'zulu'],
  )
  assert.deepEqual(
    parados.map((projeto) => projeto.name),
    ['beta', 'robsoncosta'],
  )
  // A project that only has a measurement is not up: without `running` it is stopped, and the click
  // brings the host up.
  const soMedida = listar([{ name: 'medido', root: '/m', current: false, working: 0 }])
  assert.deepEqual(soMedida.rodando, [])
  assert.deepEqual(
    soMedida.parados.map((projeto) => projeto.name),
    ['medido'],
  )
  // With no project at all the two groups are empty, and the rail still has the `+`.
  assert.deepEqual(listar([]), { rodando: [], parados: [] })
})

test('the dialog’s path expands ~ and refuses what is not absolute', () => {
  const home = '/home/juliano'
  assert.equal(caminhoAbsoluto('~/src/novo', home), '/home/juliano/src/novo')
  assert.equal(caminhoAbsoluto('/srv/app', home), '/srv/app')
  assert.equal(caminhoAbsoluto('~', home), '/home/juliano')
  // Space around it is the user's, not the path's.
  assert.equal(caminhoAbsoluto('  ~/src/novo  ', home), '/home/juliano/src/novo')
  // `.` and `..` resolve: the path that is brought up is the one the dialog shows.
  assert.equal(caminhoAbsoluto('~/src/../outro', home), '/home/juliano/outro')
  // Empty and relative are not a path: the dialog asks for one instead of guessing a folder.
  assert.equal(caminhoAbsoluto('', home), undefined)
  assert.equal(caminhoAbsoluto('   ', home), undefined)
  assert.equal(caminhoAbsoluto('src/novo', home), undefined)
  assert.equal(caminhoAbsoluto('./novo', home), undefined)
  // `~other` is not the home of whoever is typing: never expand someone else's name.
  assert.equal(caminhoAbsoluto('~outro/src', home), undefined)
})

test('the home of a new project is <home>/.ultimate/projects/<name>-<8 hex>', () => {
  assert.equal(
    homeDoProjeto('/home/juliano/src/novo', '/home/juliano'),
    '/home/juliano/.ultimate/projects/novo-3f75ea87',
  )
  // Same folder, same home: it is the calculation that makes the tile appear on its own after coming
  // up.
  assert.equal(
    homeDoProjeto('/home/juliano/src/novo', '/home/juliano'),
    homeDoProjeto('/home/juliano/src/novo', '/home/juliano'),
  )
  // Different folders with the same name do not collide: the hash is of the root.
  assert.notEqual(
    homeDoProjeto('/a/novo', '/home/juliano'),
    homeDoProjeto('/b/novo', '/home/juliano'),
  )
  // The user's home goes in whole, including when it is a test home.
  assert.match(homeDoProjeto('/a/novo', '/tmp/h'), /^\/tmp\/h\/\.ultimate\/projects\/novo-[0-9a-f]{8}$/)
})

test('the host comes up in the project, on the chosen port and without opening a window', () => {
  assert.deepEqual(argumentosDeInicio('/projects/robsoncosta', 4748), [
    '/projects/robsoncosta',
    '--port',
    '4748',
    '--no-open',
  ])
  assert.equal(programaDeInicio('/opt/ultimate'), '/opt/ultimate/bin/ultimate.ts')
})

test('the port is the first free one from 4747', async () => {
  const visto: number[] = []
  const livre = async (port: number) => {
    visto.push(port)
    // 4747 and 4748 taken; the first free one is 4749.
    return port >= 4749
  }
  assert.equal(await escolherPorta(livre), 4749)
  assert.deepEqual(visto, [4747, 4748, 4749])
  assert.equal(PRIMEIRA_PORTA, 4747)

  // With no free port at all in the range, it fails naming the range instead of inventing one.
  await assert.rejects(
    () => escolherPorta(() => false, 4747, 3),
    /No free port from 4747 \(3 tried\)/,
  )
  // The range starts where it was asked: the same probe returns another port.
  assert.equal(await escolherPorta((port) => port === 4800, 4800, 1), 4800)
})

test('the stop button kills only what it started; the rest asks for confirmation', () => {
  const alvo: Alvo = { pid: 48362, url: 'http://127.0.0.1:4748' }
  // The pid the extension recorded is the lock's: it is its own host, and it stops straight away.
  assert.deepEqual(decisaoDeParada(alvo, 48362, false), { acao: 'parar', pid: 48362 })
  // Another live pid (born in a terminal, in a supervisor, by someone else): it asks for confirmation,
  // and the next click, which has already read the question, is the one that orders the stop.
  assert.deepEqual(decisaoDeParada(alvo, undefined, false), { acao: 'confirmar', pid: 48362 })
  assert.deepEqual(decisaoDeParada(alvo, 111, false), { acao: 'confirmar', pid: 48362 })
  assert.deepEqual(decisaoDeParada(alvo, undefined, true), { acao: 'parar', pid: 48362 })
})

test('a dead-pid lock is not a host: there is nothing to stop, and the row says stopped', () => {
  // `host.projects()` only publishes `running` when the lock's pid is alive: a dead-pid lock arrives
  // here as `undefined`, and that is what lets the button bring the project up.
  assert.deepEqual(decisaoDeParada(undefined, undefined, false), { acao: 'nada' })
  assert.deepEqual(decisaoDeParada(undefined, 48362, true), { acao: 'nada' })
  // The dead lock stays on disk, but the row — and the button — read only the live pid.
  assert.equal(palavra({ name: 'gta2xlwifi-lineage', root: '/x', current: false }), 'stopped')
})

/** A measurement of the rail's wave, with the time it was made at. */
const medida = (
  working: number | null,
  abertas: number | null,
  extra: { motivo?: string; at?: string } = {},
): Medida => ({
  working,
  perguntasAbertas: abertas,
  ...(extra.motivo ? { motivo: extra.motivo } : {}),
  at: extra.at ?? '2026-11-10T03:22:43.079Z',
})

test('the dot of the tile: pulses working, green idle, grey stopped, hollow without an answer', () => {
  // Working: it is the app's mark class (`animate-pulse-dot bg-brand`), not a colour invented here.
  assert.equal(presenca(depe(2), medida(2, 0)), 'working')
  // Zero is a measurement: nothing working is idle for real.
  assert.equal(presenca(depe(0), medida(0, 0)), 'idle')
  // Stopped has nothing to measure — and a leftover measurement does not invent a host that is up.
  assert.equal(presenca(parado, medida(3, 1)), 'stopped')
  assert.equal(presenca(parado, undefined), 'stopped')
  // Up and with no reading yet (the wave did not come back): nothing is asserted.
  assert.equal(presenca(depe(1), undefined), 'unavailable')
  // The host that is up and did not answer **is not idle**: it is `unavailable`, with the reason at
  // hand.
  assert.equal(presenca(depe(null), medida(null, null, { motivo: 'no answer in 3s' })), 'unavailable')
  // It works even with a question open: both fit in the tile (the pulse and the number in amber).
  assert.equal(presenca(depe(1), medida(1, 2)), 'working')
  // A malformed number does not become work.
  assert.equal(presenca(depe(Number.NaN), medida(Number.NaN, 0)), 'idle')
})

test('the question number fits in the corner of the tile: 1..9, 9+ above, and nothing at zero', () => {
  assert.equal(numeroDePerguntas(1), '1')
  assert.equal(numeroDePerguntas(9), '9')
  // Above nine it does not fit in the corner: the number becomes a warning, not an exact piece of data.
  assert.equal(numeroDePerguntas(10), '9+')
  assert.equal(numeroDePerguntas(42), '9+')
  // Zero draws no counter at all, and what was not measured does not become a number either.
  assert.equal(numeroDePerguntas(0), undefined)
  assert.equal(numeroDePerguntas(null), undefined)
  assert.equal(numeroDePerguntas(undefined), undefined)
  assert.equal(numeroDePerguntas(Number.NaN), undefined)
  assert.equal(numeroDePerguntas(-1), undefined)
})

test('the tile’s sentence says state, counts and the time of the measurement', () => {
  // Stopped: the usual sentence, because there is no reading at all to quote.
  assert.equal(tituloDoTile(parado, undefined, undefined), 'robsoncosta — stopped, click to start it')
  // Up: the state, the counts as the panel writes them, and **when** the measurement is from.
  assert.equal(
    tituloDoTile(depe(2), medida(2, 1), '21:53'),
    'gta2xlwifi-lineage — running · 2 working · 1 unanswered question · measured at 21:53 — open it in this tab',
  )
  assert.equal(
    tituloDoTile(depe(0), medida(0, 0), '21:53'),
    'gta2xlwifi-lineage — running · 0 working · no unanswered questions · measured at 21:53 — open it in this tab',
  )
  // The wave has not come back yet: the tile says it did not measure, instead of faking an idle.
  assert.equal(
    tituloDoTile(depe(0), undefined, undefined),
    'gta2xlwifi-lineage — running · not measured yet — open it in this tab',
  )
  // No answer: `counts unavailable` with the reason, and never a zero.
  assert.equal(
    tituloDoTile(depe(null), medida(null, null, { motivo: 'no answer in 3s' }), '21:53'),
    'gta2xlwifi-lineage — running · counts unavailable — no answer in 3s · measured at 21:53 — open it in this tab',
  )
  // This window's project: the sentence ends by saying that it is this window.
  assert.equal(
    tituloDoTile({ ...depe(0), current: true }, medida(0, 0), '21:53'),
    'gta2xlwifi-lineage — running · 0 working · no unanswered questions · measured at 21:53 — this window',
  )
})

test('the wave keeps one measurement per project that is up, with the time of the reading', () => {
  const secao: Secao = {
    at: '2026-11-10T03:22:43.079Z',
    splash: true,
    projetos: [
      depe(2, 1),
      { name: 'travado', root: '/t', current: false, running: { pid: 7, url: 'http://127.0.0.1:4751' }, working: null, perguntasAbertas: null, motivo: 'no answer in 3s' },
      parado,
      // A project that is up and only has the question count measured does not lose its entry.
      { name: 'soPerguntas', root: '/s', current: false, running: { pid: 8, url: 'http://127.0.0.1:4752' }, perguntasAbertas: 3 },
    ],
  }
  const medidas = ondaDaLeitura(secao)
  assert.deepEqual(Object.keys(medidas).sort(), ['gta2xlwifi-lineage', 'soPerguntas', 'travado'])
  // The time is the reading's, not now's: the tile shows when the indicator is from.
  assert.equal(medidas['gta2xlwifi-lineage'].at, secao.at)
  assert.equal(medidas['gta2xlwifi-lineage'].working, 2)
  assert.equal(medidas['gta2xlwifi-lineage'].perguntasAbertas, 1)
  // The silence of a stuck host arrives as `null` with the reason, not as zero.
  assert.deepEqual(medidas['travado'], {
    working: null,
    perguntasAbertas: null,
    motivo: 'no answer in 3s',
    at: secao.at,
  })
  // A measured zero stays zero (and not `null`): it is an answer, not an absence.
  assert.deepEqual(ondaDaLeitura({ at: secao.at, splash: true, projetos: [depe(0, 0)] }), {
    'gta2xlwifi-lineage': { working: 0, perguntasAbertas: 0, at: secao.at },
  })
  // No project up: no measurement, and no invented entry.
  assert.deepEqual(ondaDaLeitura({ at: secao.at, splash: true, projetos: [parado] }), {})
})

test('the splash is off when the disable list names it', () => {
  assert.equal(splashLigado({ extensions: { disable: ['splash'] } }), false)
  assert.equal(splashLigado({ extensions: { disable: ['splash', 'rate-limiter'] } }), false)
  // A missing file, without the key, or with something else in the list: nothing turned the splash off.
  assert.equal(splashLigado(undefined), true)
  assert.equal(splashLigado({}), true)
  assert.equal(splashLigado({ extensions: {} }), true)
  assert.equal(splashLigado({ extensions: { disable: ['rate-limiter'] } }), true)
  // What the core ignores whole (broken JSON, an `extensions` that is not an object) is read as on.
  assert.equal(splashLigado([]), true)
  assert.equal(splashLigado({ extensions: [] }), true)
  assert.equal(splashLigado({ extensions: 'splash' }), true)
  assert.equal(splashLigado({ extensions: { disable: 'splash' } }), true)
})

test('turning the splash off puts splash in disable once, and turning it on takes it out', () => {
  // Turning off a file that does not speak of the splash yet: the entry is born once only.
  assert.deepEqual(ajustarSplash({}, false), { extensions: { disable: ['splash'] } })
  // Turning it on takes the name out of the list — and the other entries stay where they were.
  assert.deepEqual(ajustarSplash({ extensions: { disable: ['rate-limiter', 'splash'] } }, true), {
    extensions: { disable: ['rate-limiter'] },
  })
  // No duplicating: turning off what is already off does not touch the object (nor the file).
  const desligado = { extensions: { disable: ['splash'] } }
  assert.equal(ajustarSplash(desligado, false), desligado)
  // And turning on what is already on does not rewrite anything either.
  const ligado = { modelFamilies: { fast: { model: 'cirthan-dev/x' } } }
  assert.equal(ajustarSplash(ligado, true), ligado)
  // The other keys of the file are what the user wrote: they all stay, at any level.
  const cheio = {
    modelFamilies: { default: 'fast' },
    lander: { checks: [['node --test', { timeout: 120 }]] },
    extensions: { enable: ['parallel'], disable: ['rate-limiter'], orphans: 'not mine' },
  }
  assert.deepEqual(ajustarSplash(cheio, false), {
    ...cheio,
    extensions: { ...cheio.extensions, disable: ['rate-limiter', 'splash'] },
  })
  // `extensions.enable` is never touched: `disable` wins over `enable` in the same layer, so turning it
  // off works even with the splash there — and turning it on takes nothing out of it.
  assert.deepEqual(ajustarSplash({ extensions: { enable: ['splash'] } }, false), {
    extensions: { enable: ['splash'], disable: ['splash'] },
  })
  assert.deepEqual(ajustarSplash({ extensions: { enable: ['splash'], disable: ['splash'] } }, true), {
    extensions: { enable: ['splash'], disable: [] },
  })
})

test('the splash refuses, without writing, what the core would refuse whole', () => {
  // An `extensions` that is not an object would make the core throw the whole file away — and the user
  // would lose the other keys. Refusing is the only honest way out.
  for (const torto of [[], 'splash', null, 3]) {
    assert.throws(
      () => ajustarSplash({ extensions: torto }, false),
      /extensions must be a JSON object/,
    )
  }
  // A list that is not a list of names is not rewritten either.
  assert.throws(() => ajustarSplash({ extensions: { disable: 'splash' } }, false), /array of names/)
  assert.throws(() => ajustarSplash({ extensions: { disable: [1] } }, true), /array of names/)
  assert.throws(() => ajustarSplash({ extensions: { disable: {} } }, true), /array of names/)
  // A file that is not an object is no settings at all.
  for (const torto of [[], 'x', null, undefined, 7]) {
    assert.throws(() => ajustarSplash(torto, false), /settings must be a JSON object/)
  }
  assert.equal(settingsDoUsuario('/home/juliano'), '/home/juliano/.ultimate/settings.json')
})

test('the splash button’s sentence says the state and what the click does', () => {
  assert.equal(rotuloDoSplash(true), 'Splash on project switch: on — turn it off')
  assert.equal(rotuloDoSplash(false), 'Splash on project switch: off — turn it on')
  // Before the first reading the button does not guess a state.
  assert.equal(rotuloDoSplash(undefined), 'Splash on project switch: unknown')
})
