import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { checkImage } from './image-content.mjs'

/** A tree of files laid out as an image's /app would be. */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'image-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

const clean = {
  'apps/mcp/src/main.ts': 'listen()',
  'packages/core/src/services/accounts.ts': 'export {}',
  'node_modules/some-lib/test/fixture.js': 'a dependency ships its own tests: not ours',
}

const findings = (root) => checkImage(root).map(({ code, path }) => `${code} ${path}`)

test('a clean image tree passes', () => {
  assert.deepEqual(findings(tree(clean)), [])
})

test('a test file, a test folder or a driver folder in the image is refused, naming it', () => {
  const root = tree({
    ...clean,
    'apps/mcp/src/server.test.ts': 'test()',
    'packages/core/test/helpers.ts': 'truncate',
    'apps/mcp/driver/index.ts': 'export {}',
    'apps/web/src/lib/x.spec.tsx': 'test()',
  })
  assert.deepEqual(findings(root).sort(), [
    'driver_folder apps/mcp/driver',
    'test_file apps/mcp/src/server.test.ts',
    'test_file apps/web/src/lib/x.spec.tsx',
    'test_folder packages/core/test',
  ])
})

test('a file carrying the use case suite marker is refused, wherever it sits outside dependencies', () => {
  const root = tree({ ...clean, 'apps/web/server-chunk.js': 'const e="abacus-use-case-suite-shortcut"' })
  assert.deepEqual(findings(root), ['suite_marker apps/web/server-chunk.js'])
})

test('the marker searched is the one the suite carries', async () => {
  const { SUITE_MARKER } = await import('./image-content.mjs')
  const { SUITE_MARKER: carried } = await import('../../packages/use-cases/src/environment/accounts.ts')
  assert.equal(SUITE_MARKER, carried)
})
