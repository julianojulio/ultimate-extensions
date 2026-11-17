/**
 * What a published repository must never carry, checked against the files git tracks — a clean clone
 * runs this suite, so `git ls-files` is exactly what a reader of the repository sees.
 *
 * Three rules, each one a mistake made here more than once:
 *
 * 1. **The text is English.** No Portuguese diacritics in the prose, the code or the scripts. The
 *    rule is about Portuguese words, not about ASCII: other languages' accents fall in the same
 *    short class of letters, while an em dash, a curly quote, an arrow or a `→` are all welcome.
 * 2. **No private name of this machine.** The user's project folders and the provider this machine
 *    uses stay out of a repository anyone reads.
 * 3. **The READMEs stay short.** The root's page and each extension's page are a way in, not the
 *    documentation: the code is the documentation.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, extname, join, posix } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Every file git tracks, relative to the root: no `node_modules`, no ignored scratch file. */
const tracked = (): string[] =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '')

/** The files that hold text someone reads, by extension. */
const TEXT = ['.md', '.ts', '.tsx', '.sh', '.yml', '.yaml', '.json', '.txt', '.html', '.css']

/** The files that hold prose, code or scripts: everything the language rule covers. */
const PROSE = ['.md', '.ts', '.tsx', '.sh']

const text = (file: string): string => readFileSync(join(root, file), 'utf8')

/** The lines of a file, without a trailing newline counted as an empty last line. */
const lines = (file: string): string[] => text(file).replace(/\n+$/, '').split('\n')

/** Every tracked file with one of these extensions. */
const withExtension = (extensions: string[]): string[] =>
  tracked().filter((file) => extensions.includes(extname(file)))

/** `file:line` of every place a pattern matches, for a message that points at the text. */
const hits = (pattern: RegExp, files: string[]): string[] => {
  const found: string[] = []
  for (const file of files)
    lines(file).forEach((line, index) => {
      for (const match of line.matchAll(pattern))
        found.push(`${file}:${index + 1}: ${match[0]}`)
    })
  return found
}

/**
 * Portuguese diacritics, written as escapes so this file keeps its own rule. Other languages' accents
 * are in the same class, so what this catches is accented European text — read as "a Portuguese
 * word slipped in", which is exactly the mistake it is there for.
 */
const PORTUGUESE = /[\u00c0\u00c1\u00c2\u00c3\u00c7\u00c9\u00ca\u00cd\u00d3\u00d4\u00d5\u00da\u00dc\u00e0\u00e1\u00e2\u00e3\u00e7\u00e9\u00ea\u00ed\u00f3\u00f4\u00f5\u00fa\u00fc]/g

test('the text is English: no Portuguese diacritics in the tracked prose, code or scripts', () => {
  const found = hits(PORTUGUESE, withExtension(PROSE))
  assert.equal(
    found.length,
    0,
    `Portuguese text in a repository written in English:\n${found.join('\n')}`,
  )
})

/**
 * The private names of this machine: the folders its projects live in and the provider they run on.
 * Each is spelled in two parts so that this file, which is tracked like any other, does not carry it.
 * The list grows when another name turns up; nothing else may name them.
 */
const PRIVATE = [
  ['cir', 'than'].join(''), // the provider this machine runs on
  ['app', 'evangelho'].join('_'), // a project folder
  ['gta2xlwifi', 'lineage'].join('-'), // a project folder
  ['robson', 'costa'].join(''), // a person's project folder
]

test('no private name of this machine appears in a tracked file', () => {
  const pattern = new RegExp(PRIVATE.join('|'), 'gi')
  const found = hits(pattern, withExtension(TEXT))
  assert.equal(
    found.length,
    0,
    `A private name of this machine in a published file — use a neutral one:\n${found.join('\n')}`,
  )
})

/** How long a README may be: the way in, not the documentation. */
const BUDGET = { root: 60, extension: 120 }

test(`the READMEs stay short: ${BUDGET.root} lines at the root, ${BUDGET.extension} per extension`, () => {
  const files = tracked()
  // An extension is a top-level folder with a `server.ts`: its README is the page read before
  // installing it.
  const extensions = files
    .filter((file) => /^[^/]+\/server\.ts$/.test(file))
    .map((file) => posix.dirname(file))
  const pages = [
    { file: 'README.md', limit: BUDGET.root },
    ...extensions.map((folder) => ({ file: `${folder}/README.md`, limit: BUDGET.extension })),
  ].filter((page) => files.includes(page.file))
  const over = pages
    .map((page) => ({ ...page, lines: lines(page.file).length }))
    .filter((page) => page.lines > page.limit)
    .map((page) => `${page.file} has ${page.lines} lines, the budget is ${page.limit}`)
  assert.equal(over.length, 0, `A README grew past its budget:\n${over.join('\n')}`)
})
