import assert from 'node:assert/strict'
import test from 'node:test'
import { paceMonths } from '../src/lib/pace.ts'

/**
 * The monthly pace of Analyse divides what was spent by the months it was
 * spent over. Counting the calendar months a window touches made « 12
 * derniers mois » a thirteen-month average and « Tout » a 681-month one.
 */

const near = (actual: number | null, expected: number) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 0.01, `${actual} is not ${expected}`)

test('twelve rolling months spread over twelve months, not the thirteen they touch', () => {
  near(paceMonths({ from: '2025-10-04', to: '2026-10-03' }, '2020-01-01', '2026-10-03', 'cash'), 11.99)
})

test('ninety days spread over about three months', () => {
  near(paceMonths({ from: '2026-07-06', to: '2026-10-03' }, '2020-01-01', '2026-10-03', 'cash'), 2.96)
})

test('everything starts at the first declaration, not in 1970', () => {
  near(paceMonths({ from: '1970-01-01', to: '2026-10-03' }, '2024-10-04', '2026-10-03', 'cash'), 23.98)
})

test('the running year counts the months lived so far', () => {
  near(paceMonths({ from: '2026-01-01', to: '2026-12-31' }, '2020-01-01', '2026-07-01', 'cash'), 5.98)
})

test('by attachment, the whole months covered, which is what was summed', () => {
  assert.equal(
    paceMonths({ from: '2025-01-01', to: '2025-12-31' }, '2020-01-01', '2026-10-03', 'accrual'),
    12,
  )
})

test('by attachment, the running month counts for the part already lived', () => {
  // July, August and September whole, then 3 days of October's 31.
  near(paceMonths({ from: '2026-07-06', to: '2026-10-03' }, '2020-01-01', '2026-10-03', 'accrual'), 3.1)
})

test('a single month has no pace but its total, whatever its length', () => {
  assert.equal(paceMonths({ from: '2026-08-01', to: '2026-08-31' }, '2020-01-01', '2026-10-03', 'cash'), null)
  assert.equal(
    paceMonths({ from: '2026-08-01', to: '2026-08-31' }, '2020-01-01', '2026-10-03', 'accrual'),
    null,
  )
})

test('no pace without a declaration, or before the first one', () => {
  assert.equal(paceMonths({ from: '2026-01-01', to: '2026-12-31' }, null, '2026-10-03', 'cash'), null)
  assert.equal(paceMonths({ from: '2024-01-01', to: '2024-12-31' }, '2025-03-01', '2026-10-03', 'cash'), null)
})
