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

function isLocal(host) {
  const name = host.toLowerCase()
  return LOCAL_HOSTS.has(name) || name.endsWith('.localhost')
}

// The forms `connect` accepts: the arguments `net.connect` already normalised, an options object, a
// Unix socket path, or a port followed by a host.
function connectOptions(args) {
  const [first, second] = args
  if (Array.isArray(first)) return first[0]
  if (typeof first === 'object' && first !== null) return first
  if (typeof first === 'string' && Number.isNaN(Number(first))) return { path: first }
  return { port: first, host: typeof second === 'string' ? second : undefined }
}

const connect = net.Socket.prototype.connect

net.Socket.prototype.connect = function (...args) {
  const options = connectOptions(args)
  // Read as Node reads them: any path set is a Unix socket, an empty host is `localhost`.
  const host = options.host || 'localhost'
  const port = options.port
  if (options.path || isLocal(host)) return connect.apply(this, args)
  const error = new Error(`outside_network_blocked: ${host}:${port} is not a local host`)
  error.code = 'outside_network_blocked'
  // Raised the way Node raises a failed lookup: on a later tick, once the caller listens for errors.
  process.nextTick(() => this.destroy(error))
  return this
}
