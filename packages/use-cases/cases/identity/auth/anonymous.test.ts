import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase('identity.auth.anonymous-refused', async ({ act }) => {
  assert.equal(await act.comeAnonymously(), 'refused')
})
