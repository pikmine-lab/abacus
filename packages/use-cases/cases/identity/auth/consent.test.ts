import assert from 'node:assert/strict'
import { useCase } from '../../../src/play.ts'

// Refused first: a consent given is remembered for that client, so a later
// request for it gets its token without asking again.
useCase(
  'identity.auth.consent-refused-then-granted',
  async ({ act }) => {
    assert.equal(await act.answerAccessRequest('refuse'), 'no-token')
    assert.equal(await act.answerAccessRequest('accept'), 'reaches-data')
  },
  { gesture: 'auth.consent' },
)
