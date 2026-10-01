import { createMcpExpressApp } from '@modelcontextprotocol/express'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { protect, protectedResourceMetadata, protectedResourceMetadataPath, userIdOf } from './auth.ts'
import { buildServer } from './server.ts'

// Both protocol eras are served: most clients (Cursor, VS Code, Codex by
// default) still open with the 2025 `initialize` handshake, and the token
// check in front of the handler is the same for either.
const handler = createMcpHandler(({ authInfo }) => buildServer(userIdOf(authInfo)))

export function createApp() {
  // Behind Traefik the Host header is the public domain: without it in the
  // allowed list, the built-in DNS-rebinding protection answers 403 to everyone.
  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
  const app =
    allowedHosts.length > 0 ? createMcpExpressApp({ host: '0.0.0.0', allowedHosts }) : createMcpExpressApp()

  // Served at the path the 401 challenge names and at the origin root, the
  // fallback a client probes when it does not read the challenge. Public and
  // static, so any origin may read it.
  app.get([protectedResourceMetadataPath, '/.well-known/oauth-protected-resource'], (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*').json(protectedResourceMetadata)
  })

  // The JSON body is already parsed by the Express app, so it travels beside
  // the request rather than in it; the token check needs only the headers.
  const node = toNodeHandler({
    fetch: (request, options) =>
      protect((req, authInfo) => handler.fetch(req, { ...options, authInfo }))(request),
  })
  app.all('/mcp', (req, res) => void node(req, res, req.body))
  return app
}
