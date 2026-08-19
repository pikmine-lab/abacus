import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { userIdOf, verifyApiKeyToken } from './auth.ts'
import { buildServer } from './server.ts'

const handler = createMcpHandler(({ authInfo }) => buildServer(userIdOf(authInfo)))

const gate = requireBearerAuth({ verifier: { verifyAccessToken: verifyApiKeyToken } })

const app = createMcpExpressApp()
const node = toNodeHandler(handler)
app.all('/mcp', gate, (req, res) => void node(req, res, req.body))

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => {
  console.log(`abacus MCP server listening on :${port}/mcp`)
})
