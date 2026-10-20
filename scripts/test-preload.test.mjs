import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// These tests exercise the preloaded module in real child processes, started the two ways the suite
// starts them: `--import` for test files, `NODE_OPTIONS` for the servers it launches. Importing the
// module here would make the result depend on the load order of this process.

const root = fileURLToPath(new URL('..', import.meta.url))
const preload = join(root, 'scripts', 'test-preload.mjs')
const run = promisify(execFile)

const OUTSIDE = 'query1.finance.yahoo.com'

// Runs in the child. Each probe makes one call and reports whether it reached its target or was
// refused, with the error chain and the time the refusal took. Every name resolves to 127.0.0.1:
// `dns.lookup` is replaced for `fetch`, which takes no lookup option, and `loopback` passes the same
// resolver to the other calls. A name the module should refuse thus lands on a local trap instead
// of the internet, and a name it should permit reaches the local server whatever the machine's
// resolver does. Nothing a probe does leaves the machine, with or without the module.
const PROBE = `
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

const toLoopback = (_hostname, options, callback) =>
  options && options.all
    ? callback(null, [{ address: '127.0.0.1', family: 4 }])
    : callback(null, '127.0.0.1', 4)
dns.lookup = toLoopback

const withLookup = (target) => {
  const { loopback, ...options } = target
  return loopback ? { ...options, lookup: toLoopback } : options
}

const request = (client, target) =>
  new Promise((resolve, reject) => {
    const req = client.get(withLookup(target), (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve(body))
    })
    req.on('error', reject)
    req.setTimeout(5000, () => req.destroy(new Error('probe_timeout')))
  })

const calls = {
  fetch: (target) => fetch(target.url, { signal: AbortSignal.timeout(5000) }).then((response) => response.text()),
  'http.get': (target) => request(http, target),
  'https.get': (target) => request(https, target),
  'net.connect': (target) => awaitConnect(net.connect(withLookup(target))),
  // The positional form, as pg calls it: this.stream.connect(port, host).
  'socket.connect': (target) => awaitConnect(new net.Socket().connect(target.port, target.host)),
}

function awaitConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => {
      socket.destroy()
      resolve('connected')
    })
    socket.once('error', reject)
    socket.setTimeout(5000, () => socket.destroy(new Error('probe_timeout')))
  })
}

const errorChain = (error) => {
  const chain = []
  for (let e = error; e && chain.length < 5; e = e.cause) {
    chain.push({ code: e.code === undefined ? null : String(e.code), message: String(e.message ?? e) })
  }
  return chain
}

const results = []
for (const probe of JSON.parse(process.env.ABACUS_PROBES)) {
  const start = performance.now()
  try {
    const value = await calls[probe.call](probe.target)
    results.push({ call: probe.call, outcome: 'reached', value })
  } catch (error) {
    results.push({ call: probe.call, outcome: 'refused', errors: errorChain(error), ms: performance.now() - start })
  }
}
process.stdout.write(JSON.stringify(results))
`

// Runs the probes in a child and returns their results, with the number of connections the trap
// accepted meanwhile. The child has exited when `run` resolves, but the trap may not have handled
// the accept yet: a short wait lets it.
async function probe(probes, { via = 'import' } = {}) {
  const before = trap.connections
  const env = { ...process.env, ABACUS_PROBES: JSON.stringify(probes) }
  delete env.NODE_OPTIONS
  const args = ['--input-type=module', '-e', PROBE]
  if (via === 'import') args.unshift('--import', preload)
  else env.NODE_OPTIONS = `--import=${preload}`
  const { stdout } = await run(process.execPath, args, { env, timeout: 30_000 })
  await delay(50)
  return { results: JSON.parse(stdout), trapHits: trap.connections - before }
}

function assertTrapUntouched(trapHits) {
  assert.equal(trapHits, 0, 'a refused connection reached the local trap')
}

function assertBlocked(result, host, port) {
  assert.equal(result.outcome, 'refused', `${result.call} to ${host}:${port} went through`)
  const refusal = result.errors.find(
    (e) => e.code === 'outside_network_blocked' || e.message.includes('outside_network_blocked'),
  )
  assert.ok(
    refusal,
    `${result.call} to ${host}:${port} failed without outside_network_blocked: ${JSON.stringify(result.errors)}`,
  )
  assert.ok(refusal.message.includes(host), `the refusal names the host ${host}: ${refusal.message}`)
  assert.ok(refusal.message.includes(String(port)), `the refusal names the port ${port}: ${refusal.message}`)
  assert.ok(result.ms < 1000, `${result.call} was refused after ${Math.round(result.ms)} ms, not at once`)
}

function assertReached(result, expected) {
  assert.equal(result.outcome, 'reached', `${result.call} was refused: ${JSON.stringify(result.errors)}`)
  assert.equal(result.value, expected)
}

// A local TCP server that counts connections: a refused name resolved to loopback must never reach it.
const trap = { server: net.createServer((socket) => socket.destroy()), connections: 0, port: 0 }
// Two HTTP servers on the same port, one per loopback family, so `localhost` lands whichever it resolves to.
const ipv4 = http.createServer((_req, res) => res.end('local'))
const ipv6 = http.createServer((_req, res) => res.end('local'))
const unix = http.createServer((_req, res) => res.end('local unix'))
const socketDir = mkdtempSync(join(tmpdir(), 'abacus-preload-'))
const socketPath = join(socketDir, 'server.sock')
let port = 0

const listen = (server, ...args) =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(...args, resolve)
  })

before(async () => {
  trap.server.on('connection', () => {
    trap.connections += 1
  })
  await listen(trap.server, 0, '127.0.0.1')
  trap.port = trap.server.address().port
  await listen(ipv4, 0, '127.0.0.1')
  port = ipv4.address().port
  await listen(ipv6, port, '::1')
  await listen(unix, socketPath)
})

after(() => {
  for (const server of [trap.server, ipv4, ipv6, unix]) server.close()
  rmSync(socketDir, { recursive: true, force: true })
})

// Sent first in every run that expects a call to go through: the permitted call only proves
// something if, in the same process, an outside one is refused.
const sentinel = () => ({ call: 'net.connect', target: { host: OUTSIDE, port: trap.port, loopback: true } })

function assertGuardActive({ results: [guard], trapHits }) {
  assertBlocked(guard, OUTSIDE, trap.port)
  assertTrapUntouched(trapHits)
}

// C1: an outside address is refused at once, naming it.

test('fetch to an outside host is refused at once with outside_network_blocked, naming host and port', async () => {
  const { results, trapHits } = await probe([
    { call: 'fetch', target: { url: `https://${OUTSIDE}:${trap.port}/v8/finance/chart/AAPL` } },
  ])
  assertBlocked(results[0], OUTSIDE, trap.port)
  assertTrapUntouched(trapHits)
})

test('http.get to an outside host is refused at once with outside_network_blocked, naming host and port', async () => {
  const { results, trapHits } = await probe([
    { call: 'http.get', target: { host: OUTSIDE, port: trap.port, path: '/', loopback: true } },
  ])
  assertBlocked(results[0], OUTSIDE, trap.port)
  assertTrapUntouched(trapHits)
})

test('https.get to an outside host is refused at once with outside_network_blocked, naming host and port', async () => {
  const { results, trapHits } = await probe([
    { call: 'https.get', target: { host: OUTSIDE, port: trap.port, path: '/', loopback: true } },
  ])
  assertBlocked(results[0], OUTSIDE, trap.port)
  assertTrapUntouched(trapHits)
})

test('net.connect to an outside host is refused on its name, even when it resolves to the loopback', async () => {
  assertGuardActive(await probe([sentinel()]))
})

test('a process started with NODE_OPTIONS, as the suite starts its servers, refuses an outside fetch', async () => {
  const { results, trapHits } = await probe(
    [{ call: 'fetch', target: { url: `https://${OUTSIDE}:${trap.port}/v8/finance/chart/AAPL` } }],
    { via: 'NODE_OPTIONS' },
  )
  assertBlocked(results[0], OUTSIDE, trap.port)
  assertTrapUntouched(trapHits)
})

test('the refusal carries the code outside_network_blocked on the error itself', async () => {
  const { results } = await probe([sentinel()])
  assert.equal(results[0].outcome, 'refused', 'the connection went through')
  assert.equal(results[0].errors[0].code, 'outside_network_blocked')
})

test('a positional connect(port, host) to an outside host is refused, as pg opens its socket', async () => {
  const { results, trapHits } = await probe([
    { call: 'socket.connect', target: { port: trap.port, host: OUTSIDE } },
  ])
  assertBlocked(results[0], OUTSIDE, trap.port)
  assertTrapUntouched(trapHits)
})

// C2: local addresses are permitted. Each run sends the sentinel first.

async function assertPermitted(call, target, expected) {
  const outcome = await probe([sentinel(), { call, target }])
  assertGuardActive(outcome)
  assertReached(outcome.results[1], expected)
}

test('a call to 127.0.0.1 goes through', async () => {
  await assertPermitted('fetch', { url: `http://127.0.0.1:${port}/` }, 'local')
})

test('a call to ::1 goes through', async () => {
  await assertPermitted('fetch', { url: `http://[::1]:${port}/` }, 'local')
})

test('a call to localhost goes through', async () => {
  await assertPermitted('fetch', { url: `http://localhost:${port}/` }, 'local')
})

// `fetch` lowercases the host of its URL, `http.get` passes it as written.
test('a call to LOCALHOST goes through: the host is compared without case', async () => {
  await assertPermitted('http.get', { host: 'LOCALHOST', port, path: '/', loopback: true }, 'local')
})

test('a connection without a host goes through: Node opens it to localhost', async () => {
  await assertPermitted('net.connect', { port }, 'connected')
})

test('a call over a Unix socket goes through', async () => {
  await assertPermitted('http.get', { socketPath, path: '/' }, 'local unix')
})

// C3: boundary, a subdomain of localhost is permitted.

test('a call to x.abacus.localhost goes through', async () => {
  await assertPermitted('http.get', { host: 'x.abacus.localhost', port, path: '/', loopback: true }, 'local')
})

test('a call to X.Abacus.LocalHost goes through: the host is compared without case', async () => {
  await assertPermitted('http.get', { host: 'X.Abacus.LocalHost', port, path: '/', loopback: true }, 'local')
})

// C4: boundary, anything outside the exact list is refused.

async function assertRefused(host) {
  const { results, trapHits } = await probe([
    { call: 'net.connect', target: { host, port: trap.port, loopback: true } },
  ])
  assertBlocked(results[0], host, trap.port)
  assertTrapUntouched(trapHits)
}

test('a call to localhost.example.com is refused with outside_network_blocked', async () => {
  await assertRefused('localhost.example.com')
})

test('a name that ends in localhost without the dot is refused with outside_network_blocked', async () => {
  await assertRefused('abacuslocalhost')
})

test('a name that only contains .localhost is refused with outside_network_blocked', async () => {
  await assertRefused('x.localhost.example.com')
})

test('a call to 0.0.0.0 is refused with outside_network_blocked', async () => {
  await assertRefused('0.0.0.0')
})

test('a loopback address other than 127.0.0.1 is refused with outside_network_blocked', async () => {
  await assertRefused('127.0.0.2')
})

// The test files get the module through the `test` scripts: every script that runs `node --test`
// preloads it, wherever the scripts end up living.

test('every package script that runs node --test preloads scripts/test-preload.mjs', () => {
  const manifests = ['package.json']
  for (const dir of ['apps', 'packages']) {
    for (const name of readdirSync(join(root, dir))) manifests.push(join(dir, name, 'package.json'))
  }
  const runners = []
  for (const manifest of manifests) {
    let scripts
    try {
      scripts = JSON.parse(readFileSync(join(root, manifest), 'utf8')).scripts ?? {}
    } catch {
      continue
    }
    for (const [name, command] of Object.entries(scripts)) {
      if (/\bnode\b[^&|;]*\s--test(\s|$)/.test(command)) runners.push({ manifest, name, command })
    }
  }
  assert.ok(runners.length > 0, 'at least one script runs node --test')
  for (const { manifest, name, command } of runners) {
    assert.match(
      command,
      /--import[= ]\S*scripts\/test-preload\.mjs/,
      `${manifest} script "${name}" runs node --test without preloading scripts/test-preload.mjs`,
    )
  }
})
