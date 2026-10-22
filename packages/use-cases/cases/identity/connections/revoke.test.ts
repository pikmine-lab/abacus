import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

// The application the case signed in with is the one cut off, the one acting
// for the person where an application acts. Its access is checked from
// outside once it is gone.
useCase('identity.connections.revoke', async ({ arrange, act }) => {
  assert.deepEqual(await act.readConnectedApps(), [{ name: 'Cursor', domain: 'cursor.com' }])
  assert.equal(await arrange.connectedAppReaches(), 'reaches')
  await act.revokeConnectedApp('Cursor')
  assert.deepEqual(await arrange.readConnectedApps(), [])
  assert.equal(await arrange.connectedAppReaches(), 'sent-to-sign-in')
})
