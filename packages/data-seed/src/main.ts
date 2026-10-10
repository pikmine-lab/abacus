import { closeDb } from '@abacus/core/db'
import { seedDemo } from './seed.ts'
import { closeAuth, DEMO_EMAIL, DEMO_PASSWORD } from './user.ts'

try {
  await seedDemo()
  console.log(`demo data written: sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
} finally {
  await closeDb()
  await closeAuth()
}
