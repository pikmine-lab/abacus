import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

// The clock. A child reads it after the module, and reports what it saw. So that what these tests
// prove does not depend on the day they run, most of them also set the time the child takes as real:
// SIMULATED_CLOCK, imported before the module, replaces `Date` with a clock that starts at
// ABACUS_SIMULATED_NOW and flows with `performance.now()`. The module finds it in place of the
// machine's clock, as it would find the real one. It behaves as the real `Date` does: callable
// without `new`, and sharing its prototype, so that a date Node builds itself is an instance of it.

const SIMULATED_CLOCK = `
const Real = Date
const origin = Real.parse(process.env.ABACUS_SIMULATED_NOW)
const start = performance.now()
const now = () => Math.floor(origin + (performance.now() - start))
function SimulatedDate(...args) {
  if (new.target === undefined) return new Real(now()).toString()
  return Reflect.construct(Real, args.length === 0 ? [now()] : args, new.target)
}
SimulatedDate.prototype = Real.prototype
SimulatedDate.now = now
SimulatedDate.parse = Real.parse
SimulatedDate.UTC = Real.UTC
globalThis.Date = SimulatedDate
`

// Runs in the child: `today()` as the code reads it, the current time through `Date.now()` and
// `new Date()`, a second reading 300 ms later, the machine's wall clock through `performance`
// (which neither clock touches), dates built from explicit values, `Date()` called as a function,
// and whether the dates Node builds itself are instances of `Date`.
const CLOCK_PROBE = `
const { statSync } = await import('node:fs')
const { today } = await import(process.env.ABACUS_PERIOD_URL)
const parts = (d) => ({
  year: d.getFullYear(),
  month: d.getMonth() + 1,
  day: d.getDate(),
  hours: d.getHours(),
  minutes: d.getMinutes(),
})
const dateNow = Date.now()
const newDate = new Date()
const monotonic = performance.now()
const reading = {
  dateNow,
  newDate: newDate.getTime(),
  monotonic,
  wallClock: performance.timeOrigin + monotonic,
  local: parts(newDate),
  isDate: newDate instanceof Date,
  nodeDates: {
    stat: statSync(process.execPath).mtime instanceof Date,
    clone: structuredClone(new Date()) instanceof Date,
  },
  today: today(),
}
try {
  reading.asFunction = { value: Date(), asString: new Date().toString() }
} catch (error) {
  reading.asFunction = { error: String(error) }
}
await new Promise((resolve) => setTimeout(resolve, 300))
const later = { dateNow: Date.now(), monotonic: performance.now() }
const explicit = {
  epoch: new Date(0).getTime(),
  iso: new Date('2020-01-01T00:00:00.000Z').toISOString(),
  local: parts(new Date(2020, 0, 1, 8, 30)),
  utc: Date.UTC(2020, 0, 1),
  parse: Date.parse('2020-01-01T00:00:00.000Z'),
}
process.stdout.write(JSON.stringify({ ...reading, later, explicit }))
`

const clockDir = mkdtempSync(join(tmpdir(), 'abacus-clock-'))
const simulatedClock = join(clockDir, 'simulated-clock.mjs')
writeFileSync(simulatedClock, SIMULATED_CLOCK)
const periodUrl = pathToFileURL(join(root, 'packages', 'core', 'src', 'domain', 'period.ts')).href

after(() => rmSync(clockDir, { recursive: true, force: true }))

// Reads the clock in a child, in Paris unless told otherwise. `testToday` is ABACUS_TEST_TODAY, left
// unset when undefined; `realNow` is the time the child takes as real, the machine's when undefined.
async function readClock({ testToday, realNow, tz = 'Europe/Paris', via = 'import' } = {}) {
  const env = { ...process.env, TZ: tz, ABACUS_PERIOD_URL: periodUrl }
  for (const name of ['NODE_OPTIONS', 'ABACUS_TEST_TODAY', 'ABACUS_SIMULATED_NOW']) delete env[name]
  if (testToday !== undefined) env.ABACUS_TEST_TODAY = testToday
  const imports = []
  if (realNow !== undefined) {
    env.ABACUS_SIMULATED_NOW = realNow
    imports.push(simulatedClock)
  }
  imports.push(preload)
  const args = ['--input-type=module', '-e', CLOCK_PROBE]
  if (via === 'import') args.unshift(...imports.flatMap((file) => ['--import', file]))
  else env.NODE_OPTIONS = imports.map((file) => `--import=${file}`).join(' ')
  const { stdout } = await run(process.execPath, args, { env, timeout: 30_000 })
  return JSON.parse(stdout)
}

const TEST_TODAY = '2026-03-31'
// 12:00 in Paris on that day, summer time having started on 29 March.
const NOON = Date.parse('2026-03-31T12:00:00+02:00')
// The real days C22 plays on, before and after the test day, at the edges of the day.
const FIRST_OF_MONTH = '2026-02-01T00:05:00+01:00'
const MIDDLE_OF_MONTH = '2026-06-15T09:30:00+02:00'
const LAST_OF_MONTH = '2026-10-31T23:55:00+01:00'

// Time from the module's load to the first reading: the child imports period.ts in between.
const STARTUP_MS = 10_000

function assertNoonOfTestDay(reading, noon = NOON) {
  assert.deepEqual(reading.local, { year: 2026, month: 3, day: 31, hours: 12, minutes: 0 })
  const elapsed = reading.newDate - noon
  assert.ok(elapsed >= 0 && elapsed < STARTUP_MS, `new Date() is ${elapsed} ms from 12:00 on ${TEST_TODAY}`)
}

// C22: under ABACUS_TEST_TODAY, the day is that date, whatever the real one.

test('today() reads ABACUS_TEST_TODAY when the real clock is on the first of a month', async () => {
  const reading = await readClock({ testToday: TEST_TODAY, realNow: FIRST_OF_MONTH })
  assert.equal(reading.today, TEST_TODAY)
})

test('today() reads ABACUS_TEST_TODAY when the real clock is in the middle of a month', async () => {
  const reading = await readClock({ testToday: TEST_TODAY, realNow: MIDDLE_OF_MONTH })
  assert.equal(reading.today, TEST_TODAY)
})

test('today() reads ABACUS_TEST_TODAY when the real clock is on the last day of a month', async () => {
  const reading = await readClock({ testToday: TEST_TODAY, realNow: LAST_OF_MONTH })
  assert.equal(reading.today, TEST_TODAY)
})

test('the process starts at 12:00 local on ABACUS_TEST_TODAY, whatever the real time of day', async () => {
  for (const realNow of [FIRST_OF_MONTH, MIDDLE_OF_MONTH, LAST_OF_MONTH]) {
    assertNoonOfTestDay(await readClock({ testToday: TEST_TODAY, realNow }))
  }
})

// At UTC+14, 12:00 local on 31 March is still 30 March in UTC: the day set is the local one.
test('the day and the noon are local: at UTC+14, today() still reads ABACUS_TEST_TODAY at 12:00', async () => {
  const reading = await readClock({
    testToday: TEST_TODAY,
    realNow: MIDDLE_OF_MONTH,
    tz: 'Pacific/Kiritimati',
  })
  assert.equal(reading.today, TEST_TODAY)
  assertNoonOfTestDay(reading, Date.parse('2026-03-31T12:00:00+14:00'))
})

test('Date.now() and new Date() without argument read the same shifted time', async () => {
  const reading = await readClock({ testToday: TEST_TODAY, realNow: MIDDLE_OF_MONTH })
  assertNoonOfTestDay(reading)
  const gap = reading.dateNow - reading.newDate
  assert.ok(gap <= 0 && gap > -50, `Date.now() is ${gap} ms from new Date()`)
})

test('time keeps flowing under ABACUS_TEST_TODAY: two readings differ by the time elapsed', async () => {
  const reading = await readClock({ testToday: TEST_TODAY, realNow: MIDDLE_OF_MONTH })
  assert.equal(reading.today, TEST_TODAY, 'the clock is not shifted')
  const shifted = reading.later.dateNow - reading.dateNow
  const elapsed = reading.later.monotonic - reading.monotonic
  assert.ok(shifted >= 290, `the clock moved ${shifted} ms in a 300 ms wait`)
  assert.ok(
    Math.abs(shifted - elapsed) < 50,
    `the clock moved ${shifted} ms while ${Math.round(elapsed)} ms elapsed`,
  )
})

test('a date built from an explicit value is not shifted', async () => {
  const reading = await readClock({ testToday: TEST_TODAY, realNow: MIDDLE_OF_MONTH })
  assert.equal(reading.today, TEST_TODAY, 'the clock is not shifted')
  assert.deepEqual(reading.explicit, {
    epoch: 0,
    iso: '2020-01-01T00:00:00.000Z',
    local: { year: 2020, month: 1, day: 1, hours: 8, minutes: 30 },
    utc: 1577836800000,
    parse: 1577836800000,
  })
})

test('a process started with NODE_OPTIONS, as the suite starts its servers, reads ABACUS_TEST_TODAY', async () => {
  const reading = await readClock({ testToday: TEST_TODAY, realNow: MIDDLE_OF_MONTH, via: 'NODE_OPTIONS' })
  assert.equal(reading.today, TEST_TODAY)
  assertNoonOfTestDay(reading)
})

test('today() reads any calendar date ABACUS_TEST_TODAY names, leap days and the year edges included', async () => {
  for (const testToday of ['2026-02-28', '2028-02-29', '2000-02-29', '2026-12-31', '2027-01-01']) {
    const reading = await readClock({ testToday, realNow: MIDDLE_OF_MONTH })
    assert.equal(reading.today, testToday)
    assert.equal(reading.local.hours, 12, `the process does not start at 12:00 on ${testToday}`)
  }
})

// Without ABACUS_TEST_TODAY the clock is left alone. The absence only proves something if, on the
// same simulated clock, the presence shifts it.
test('without ABACUS_TEST_TODAY, the process reads the real clock', async () => {
  const shifted = await readClock({ testToday: TEST_TODAY, realNow: MIDDLE_OF_MONTH })
  assert.equal(shifted.today, TEST_TODAY, 'the clock is not shifted when ABACUS_TEST_TODAY is set')

  const simulated = await readClock({ realNow: MIDDLE_OF_MONTH })
  assert.equal(simulated.today, '2026-06-15')
  assert.deepEqual(simulated.local, { year: 2026, month: 6, day: 15, hours: 9, minutes: 30 })

  const machine = await readClock()
  const gap = machine.dateNow - machine.wallClock
  assert.ok(Math.abs(gap) < 1000, `Date.now() is ${Math.round(gap)} ms from the machine's clock`)
})

// An empty value counts as an absent one. Same proof as above: the variable, set, shifts this clock.
test('an empty ABACUS_TEST_TODAY counts as absent: the process reads the real clock', async () => {
  const shifted = await readClock({ testToday: TEST_TODAY, realNow: MIDDLE_OF_MONTH })
  assert.equal(shifted.today, TEST_TODAY, 'the clock is not shifted when ABACUS_TEST_TODAY is set')

  const empty = await readClock({ testToday: '', realNow: MIDDLE_OF_MONTH })
  assert.equal(empty.today, '2026-06-15')
  assert.deepEqual(empty.local, { year: 2026, month: 6, day: 15, hours: 9, minutes: 30 })
})

test('Date() called as a function under ABACUS_TEST_TODAY returns the shifted day, as new Date().toString()', async () => {
  const reading = await readClock({ testToday: TEST_TODAY, realNow: MIDDLE_OF_MONTH })
  assert.equal(reading.today, TEST_TODAY, 'the clock is not shifted')
  const { value, asString, error } = reading.asFunction
  assert.equal(error, undefined, `Date() threw: ${error}`)
  assert.equal(typeof value, 'string')
  assert.ok(value.startsWith('Tue Mar 31 2026 '), `Date() names another day: ${value}`)
  const withoutTime = (text) => text.replace(/\d{2}:\d{2}:\d{2}/, '')
  assert.equal(withoutTime(value), withoutTime(asString))
})

test('a date Node builds itself is still an instance of Date under ABACUS_TEST_TODAY', async () => {
  const reading = await readClock({ testToday: TEST_TODAY, realNow: MIDDLE_OF_MONTH })
  assert.equal(reading.today, TEST_TODAY, 'the clock is not shifted')
  assert.deepEqual(reading.nodeDates, { stat: true, clone: true })
})

test('a date read under ABACUS_TEST_TODAY is still an instance of Date', async () => {
  const reading = await readClock({ testToday: TEST_TODAY, realNow: MIDDLE_OF_MONTH })
  assert.equal(reading.today, TEST_TODAY, 'the clock is not shifted')
  assert.equal(reading.isDate, true)
})

// Only the canonical YYYY-MM-DD naming a calendar date is accepted: anything else stops the process
// at start, rather than letting it run on the real day. The child never reads the clock, so a refusal
// deferred to the first reading would let it write; and the line carrying the code must also name
// the variable and the value, since Node prints the source line of the throw as well.
const MALFORMED_TEST_TODAY = [
  '2026-02-29',
  '2100-02-29',
  '2026-13-01',
  '2026-00-10',
  '2026-03-00',
  '2026-03-32',
  '2026-3-31',
  '2026-03-31T12:00',
  '2026-03-31 ',
  '12026-03-31',
  'x2026-03-31',
  '31/03/2026',
  'tomorrow',
]

test('a malformed ABACUS_TEST_TODAY stops the process at start with invalid_test_today, naming the variable and the value', async () => {
  for (const testToday of MALFORMED_TEST_TODAY) {
    const env = { ...process.env, TZ: 'Europe/Paris', ABACUS_TEST_TODAY: testToday }
    delete env.NODE_OPTIONS
    const child = run(process.execPath, ['--import', preload, '-e', "process.stdout.write('ran')"], {
      env,
      timeout: 30_000,
    })
    await assert.rejects(child, (error) => {
      assert.ok(
        typeof error.code === 'number' && error.code !== 0,
        `the process ran with ABACUS_TEST_TODAY=${JSON.stringify(testToday)}: ${error.message}`,
      )
      assert.equal(error.stdout, '', `the process ran before refusing ${JSON.stringify(testToday)}`)
      const refusal = error.stderr
        .split('\n')
        .find(
          (line) =>
            line.includes('invalid_test_today') &&
            line.includes('ABACUS_TEST_TODAY') &&
            line.includes(testToday),
        )
      assert.ok(
        refusal,
        `no line carries invalid_test_today with the variable and the value ${JSON.stringify(testToday)}: ${error.stderr}`,
      )
      // Node prints the own properties of an uncaught error after its stack: the code is on error.code.
      assert.match(
        error.stderr,
        /^\s*code: 'invalid_test_today'/m,
        `the refusal has no error.code: ${error.stderr}`,
      )
      return true
    })
  }
})
