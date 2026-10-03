import assert from 'node:assert/strict'
import test from 'node:test'
import { flowBandWindow } from '../src/lib/flow-band.ts'

/**
 * The flow band pilots Analyse: a month clicked in it reframes the screen, so
 * the band itself must not move under the click. On a single month it shows
 * the fixed twelve-month block the month falls in.
 */

const month = (ref: string, from: string, to: string) => ({ preset: 'month', ref, from, to })

test('the current month shows the last twelve months', () => {
  assert.deepEqual(flowBandWindow(month('2026-10', '2026-10-01', '2026-10-31'), '2020-01-15', '2026-10'), {
    from: '2025-11-01',
    to: '2026-10-31',
  })
})

test('any month of the current block shows that same block', () => {
  assert.deepEqual(flowBandWindow(month('2025-11', '2025-11-01', '2025-11-30'), '2020-01-15', '2026-10'), {
    from: '2025-11-01',
    to: '2026-10-31',
  })
})

test('a month older than the block shows the twelve months before it', () => {
  assert.deepEqual(flowBandWindow(month('2025-10', '2025-10-01', '2025-10-31'), '2020-01-15', '2026-10'), {
    from: '2024-11-01',
    to: '2025-10-31',
  })
})

test('the block ends on the last day of a short month', () => {
  assert.deepEqual(flowBandWindow(month('2026-02', '2026-02-01', '2026-02-28'), '2020-01-15', '2026-02'), {
    from: '2025-03-01',
    to: '2026-02-28',
  })
})

test('months before the first declaration are left out', () => {
  assert.deepEqual(flowBandWindow(month('2026-10', '2026-10-01', '2026-10-31'), '2026-07-12', '2026-10'), {
    from: '2026-07-12',
    to: '2026-10-31',
  })
})

test('a month after the current one ends its own block', () => {
  assert.deepEqual(flowBandWindow(month('2027-01', '2027-01-01', '2027-01-31'), '2020-01-15', '2026-10'), {
    from: '2026-02-01',
    to: '2027-01-31',
  })
})

test('a period of several months is shown whole, from the first declaration', () => {
  const year = { preset: 'year', ref: '2026', from: '2026-01-01', to: '2026-12-31' }
  assert.deepEqual(flowBandWindow(year, '2026-03-04', '2026-10'), { from: '2026-03-04', to: '2026-12-31' })
})

test('nothing to draw without a declaration, or before the first one', () => {
  assert.equal(flowBandWindow(month('2026-10', '2026-10-01', '2026-10-31'), null, '2026-10'), null)
  const year = { preset: 'year', ref: '2024', from: '2024-01-01', to: '2024-12-31' }
  assert.equal(flowBandWindow(year, '2026-03-04', '2026-10'), null)
})
