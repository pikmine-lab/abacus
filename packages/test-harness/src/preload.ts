// Preloaded into every test process: by `--import` in the `test` scripts, and by `NODE_OPTIONS` in the
// servers the suite starts. A test that reaches the internet depends on a third party being up and on
// what it answers that day, so here any connection to a host that is not local is refused at once,
// with `outside_network_blocked` naming the host and the port.
//
// `http`, `https`, `tls` and `fetch` all open their sockets through `net.Socket.prototype.connect`,
// which is wrapped. The host is judged on its name, before any lookup: a public name that resolves to
// the loopback is still refused. The list is exact and compared without case; no other loopback
// address, nor `0.0.0.0`, is local here. Not covered: UDP, DNS resolution, and a process started
// without this module.

import net from 'node:net'

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

function isLocal(host: string): boolean {
  const name = host.toLowerCase()
  return LOCAL_HOSTS.has(name) || name.endsWith('.localhost')
}

// The forms `connect` accepts: the arguments `net.connect` already normalised, an options object, a
// Unix socket path, or a port followed by a host.
function connectOptions(args: unknown[]): { host?: string | null; port?: unknown; path?: string } {
  const [first, second] = args
  if (Array.isArray(first)) return first[0]
  if (typeof first === 'object' && first !== null)
    return first as { host?: string; port?: unknown; path?: string }
  if (typeof first === 'string' && Number.isNaN(Number(first))) return { path: first }
  return { port: first, host: typeof second === 'string' ? second : undefined }
}

const connect = net.Socket.prototype.connect as (this: net.Socket, ...args: unknown[]) => net.Socket

net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const options = connectOptions(args)
  // Read as Node reads them: any path set is a Unix socket, an empty host is `localhost`.
  const host = options.host || 'localhost'
  const port = options.port
  if (options.path || isLocal(host)) return connect.apply(this, args)
  const error = Object.assign(new Error(`outside_network_blocked: ${host}:${port} is not a local host`), {
    code: 'outside_network_blocked',
  })
  // Raised the way Node raises a failed lookup: on a later tick, once the caller listens for errors.
  process.nextTick(() => this.destroy(error))
  return this
} as typeof net.Socket.prototype.connect

// The clock. With `ABACUS_TEST_TODAY` set, the process sees that date as today: what a test reads
// stays the same whatever day the suite runs, the end of a month included. The clock is shifted, not
// frozen: it starts at 12:00 local on that day and keeps flowing, so durations and timeouts measured
// through `Date` still hold. The day and the noon are local; noon keeps the same day for code that
// reads it in UTC instead, from UTC-11 to UTC+12. Only the readings of the current time are shifted:
// `Date.now()`, `new Date()` without argument, and `Date()` called as a function, which returns its
// string. A date built from a value is that value. The replacement is a function sharing the real
// prototype rather than a subclass, so that the dates Node builds itself (`fs.stat`,
// `structuredClone`) are still instances of `Date`. The real time is read through the `Date` found
// in place at load. An empty value is no value; any other value that is not a canonical YYYY-MM-DD
// calendar date stops the process here, before the code under test runs on the real day.

const TEST_TODAY = process.env.ABACUS_TEST_TODAY

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number]
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return day >= 1 && day <= (days ?? 0)
}

if (TEST_TODAY) {
  if (!isCalendarDate(TEST_TODAY)) {
    throw Object.assign(
      new Error(
        `invalid_test_today: ABACUS_TEST_TODAY=${JSON.stringify(TEST_TODAY)} is not a YYYY-MM-DD calendar date`,
      ),
      { code: 'invalid_test_today' },
    )
  }
  const RealDate = globalThis.Date
  const [year, month, day] = TEST_TODAY.split('-').map(Number) as [number, number, number]
  // `setFullYear` rather than the constructor, which reads the years 0 to 99 as 1900 to 1999.
  const noon = new RealDate(0)
  noon.setFullYear(year, month - 1, day)
  noon.setHours(12, 0, 0, 0)
  const offset = noon.getTime() - RealDate.now()
  const now = () => RealDate.now() + offset

  function ShiftedDate(...args: unknown[]) {
    if (new.target === undefined) return new RealDate(now()).toString()
    return Reflect.construct(RealDate, args.length === 0 ? [now()] : args, new.target as DateConstructor)
  }
  ShiftedDate.prototype = RealDate.prototype
  ShiftedDate.now = now
  ShiftedDate.parse = RealDate.parse
  ShiftedDate.UTC = RealDate.UTC
  globalThis.Date = ShiftedDate as unknown as DateConstructor
}
