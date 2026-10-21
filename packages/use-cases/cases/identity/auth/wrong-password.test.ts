import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

useCase(
  'identity.auth.wrong-password',
  async ({ act }) => {
    const person = {
      name: 'Sacha',
      email: `sacha-${Date.now()}@example.test`,
      password: 'le-bon-mot-de-passe',
    }
    await act.signUp(person)
    await act.signOut()
    assert.equal(await act.signIn({ ...person, password: 'un-autre-mot-de-passe' }), 'refused')
    assert.equal(await act.reachesTheApp(), false)
    assert.equal(await act.signIn({ ...person, email: `inconnu-${Date.now()}@example.test` }), 'refused')
    assert.equal(await act.reachesTheApp(), false)
  },
  { gesture: 'auth.sign-in' },
)
