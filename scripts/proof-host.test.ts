/**
 * `node --test proof-host.test.ts` — the parts of `proof-host.sh` that can be pinned without starting
 * an Ultimate: how it refuses arguments, and that `stop` ends the pid written in the lock and nothing
 * else. No clone and no `node_modules` are needed, so a clean checkout runs this like the machine does.
 *
 * What matters to pin down:
 *
 * - `stop` kills the pid in `<home>/ultimate.lock` — not a name, not a port: that pid is the one thing
 *   a proof host can be recognised by, and the reason this script exists;
 * - a lock whose pid is already gone, a home with no lock, a state dir already removed: none of them
 *   is a host, so nothing is signalled and nothing fails — a `trap` that runs `stop` twice, or after
 *   the state dir is gone, leaves its shell at status 0;
 * - a start it cannot even begin (no directory, no clone, not a port) fails before it makes anything.
 */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const script = fileURLToPath(new URL('./proof-host.sh', import.meta.url))

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), 'proof-host-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  const project = join(root, 'project')
  await mkdir(home)
  await mkdir(project)
  return { root, home, project }
}

function proofHost(args, env = {}) {
  return run('sh', [script, ...args], { env: { ...process.env, ...env } })
}

async function refused(args, env) {
  return proofHost(args, env).then(
    () => assert.fail(`sh ${args.join(' ')} should have failed`),
    (error) => ({ code: error.code, stderr: error.stderr }),
  )
}

test('stop ends the pid in the lock, and only it', async (t) => {
  const { home } = await sandbox(t)
  const host = spawn('sleep', ['60'], { stdio: 'ignore' })
  t.after(() => host.kill('SIGKILL'))
  await writeFile(join(home, 'ultimate.lock'), JSON.stringify({ pid: host.pid, port: 4747 }))

  const { stdout } = await proofHost(['stop', home])
  assert.match(stdout, new RegExp(`stopped pid=${host.pid} home=`))
  assert.equal(host.exitCode === null && host.signalCode === null, false, 'that pid is gone')

  // The lock stays where it was — a host removes its own — so a second stop reports it and succeeds.
  assert.match((await proofHost(['stop', home])).stderr, /already gone/)
})

test('a home without a lock, or without a home, is not a host: stop is quiet and succeeds', async (t) => {
  const { root, home } = await sandbox(t)
  const { stdout, stderr } = await proofHost(['stop', home])
  assert.equal(stdout, '')
  assert.match(stderr, /nothing to stop/)

  const gone = await proofHost(['stop', join(root, 'never-started')])
  assert.match(gone.stderr, /nothing to stop: no home/)
})

test('a start it cannot begin fails before it makes anything', async (t) => {
  const { root, project } = await sandbox(t)

  const missing = await refused(['start', join(root, 'missing')])
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /no such directory/)

  assert.equal((await refused(['start', project, '47x4'])).code, 2)
  const outOfRange = await refused(['start', project, '70000'])
  assert.equal(outOfRange.code, 2)
  assert.match(outOfRange.stderr, /not a port/)

  const noClone = await refused(['start', project], { ULTIMATE_ROOT: join(root, 'missing') })
  assert.equal(noClone.code, 2)
  assert.match(noClone.stderr, /no Ultimate clone/)

  assert.equal((await refused(['nonsense'])).code, 2)
  // Nothing was made on the way: the sandbox holds the two folders it started with, and no state dir.
  assert.deepEqual((await readdir(root)).sort(), ['home', 'project'])
})
