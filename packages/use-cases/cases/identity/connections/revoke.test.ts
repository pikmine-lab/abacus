import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

// The application the case signed in with is the one cut off. What it already
// holds keeps working until it runs out; it can no longer renew it.
useCase(
  'identity.connections.revoke',
  async ({ arrange, act }) => {
    assert.deepEqual(await act.readConnectedApps(), [{ name: 'Cursor', domain: 'cursor.com' }])
    assert.equal(await arrange.connectedAppRenews(), 'renews')
    await act.revokeConnectedApp('Cursor')
    assert.deepEqual(await arrange.readConnectedApps(), [])
    assert.equal(await arrange.connectedAppReaches(), 'reaches')
    assert.equal(await arrange.connectedAppRenews(), 'refused')
  },
  { gesture: 'connection.revoke' },
)
