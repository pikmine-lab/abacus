import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

// The application the case signed in with is the one revoked: on the MCP, the
// one making the call. Its access is checked from outside once it is gone.
useCase('identity.connections.revoke', async ({ arrange, act }) => {
  assert.deepEqual(await act.readConnectedApps(), [{ name: 'Cursor', domain: 'cursor.com' }])
  assert.equal(await arrange.connectedAppReaches(), true)
  await act.revokeConnectedApp('Cursor')
  assert.deepEqual(await arrange.readConnectedApps(), [])
  assert.equal(await arrange.connectedAppReaches(), false)
})
