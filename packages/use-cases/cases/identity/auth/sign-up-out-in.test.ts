import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase(
  'identity.auth.sign-up-out-in',
  async ({ act }) => {
    const person = {
      name: 'Alix',
      email: `alix-${Date.now()}@example.test`,
      password: 'un-mot-de-passe-long',
    }
    await act.signUp(person)
    assert.equal(await act.reachesTheApp(), true)
    await act.signOut()
    assert.equal(await act.reachesTheApp(), false)
    assert.equal(await act.signIn(person), 'signed-in')
    assert.equal(await act.reachesTheApp(), true)
  },
  { gesture: 'auth.sign-up' },
)
