import type { Executor } from '../db/client.ts'
import {
  closeOnOrBefore,
  hasPriceHistory,
  insertPriceHistory,
  listCloses,
  upsertInstrument,
} from '../db/datasources/investments.ts'
import { DomainError } from '../domain/errors.ts'
import { today } from '../domain/period.ts'
import { fetchHistory, type HistoricalPrice, type HistoryFetcher } from '../prices/sources.ts'

/**
 * FX pairs quote Monday to Friday, so a close up to three days old still is
 * "the rate of that day" (a Sunday reads Friday's close) without asking the
 * source again.
 */
const WEEKEND_GAP_DAYS = 3

/**
 * Past that, the stored history simply does not cover the asked day. One
 * refetch is attempted; a close still further away than this is not that
 * day's rate, and writing a movement with it would be a silent lie.
 */
const MAX_GAP_DAYS = 7

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

/**
 * The EUR rate of one foreign currency on one day, from the same machinery
 * that prices securities: a pair is one more quoted thing nobody owns
 * ('yahoo', 'USDEUR=X'), backfilled with a year of daily closes on first use
 * and looked up locally after that. The rate of a non-trading day is the last
 * close before it.
 *
 * Unlike a portfolio read, this feeds a declaration: a movement written with a
 * rate from another month would be a silent lie, so no rate is an error here,
 * with the way out (declare the euro amount directly) in the message.
 */
/** The shared instrument behind one pair: one more quoted thing nobody owns. */
async function pairInstrument(tx: Executor, currency: string) {
  const code = currency.toUpperCase()
  if (!/^[A-Z]{3}$/.test(code) || code === 'EUR')
    throw new DomainError(
      'bad_currency',
      `"${currency}" is not a foreign currency code (three letters, not EUR)`,
    )
  return await upsertInstrument(tx, {
    kind: 'currency',
    priceSource: 'yahoo',
    priceSourceRef: `${code}EUR=X`,
    name: `${code}/EUR`,
    symbol: code,
    currency: 'EUR',
  })
}

export async function eurRateOn(
  tx: Executor,
  currency: string,
  on: string,
  history: HistoryFetcher = fetchHistory,
): Promise<string> {
  const code = currency.toUpperCase()
  const instrument = await pairInstrument(tx, code)
  let close = await closeOnOrBefore(tx, instrument.id, on)
  if (!close || daysBetween(close.quotedOn, on) > WEEKEND_GAP_DAYS) {
    try {
      await insertPriceHistory(tx, instrument.id, await history('yahoo', instrument.priceSourceRef))
    } catch {
      // The stored history gets its say below; only a gap too wide fails.
    }
    close = await closeOnOrBefore(tx, instrument.id, on)
  }
  if (!close || daysBetween(close.quotedOn, on) > MAX_GAP_DAYS)
    throw new DomainError(
      'no_exchange_rate',
      `No ${code}/EUR rate is known for ${on}: check the currency code, or give the euro amount directly`,
    )
  return close.price
}

/** Euros of a foreign amount at a given rate, rounded to the cent like any movement. */
export function toEur(amount: number, rate: string): number {
  return Math.round(amount * Number(rate) * 100) / 100
}

/**
 * The latest known rate, for forecast sums (committed monthly cost, what a
 * recurring line is worth per month). A forecast re-evaluates with the market,
 * unlike a movement which freezes; and it feeds a read, so a stale rate shown
 * beats a broken page: this falls back to whatever close is stored, and only
 * answers null when nothing was ever fetched for the pair.
 */
/**
 * Every stored close of one pair, backfilled on first use: what a whole price
 * history converts against, one lookup instead of one query per day.
 */
export async function eurRatesFor(
  tx: Executor,
  currency: string,
  history: HistoryFetcher = fetchHistory,
): Promise<HistoricalPrice[]> {
  const instrument = await pairInstrument(tx, currency)
  if (!(await hasPriceHistory(tx, instrument.id)))
    await insertPriceHistory(tx, instrument.id, await history('yahoo', instrument.priceSourceRef))
  return await listCloses(tx, instrument.id)
}

/**
 * A foreign price series converted close by close: each day at its own rate
 * (the last pair close at or before it, weekend bound included), because a
 * year of USD closes at today's rate would draw the dollar's curve, not the
 * holding's. A day without a rate is skipped: a missing point beats a wrong
 * one.
 */
export function toEurSeries(closes: HistoricalPrice[], rates: HistoricalPrice[]): HistoricalPrice[] {
  const byDay = [...rates].sort((a, b) => (a.quotedOn < b.quotedOn ? -1 : 1))
  const series: HistoricalPrice[] = []
  let at = -1
  for (const close of [...closes].sort((a, b) => (a.quotedOn < b.quotedOn ? -1 : 1))) {
    while (at + 1 < byDay.length && byDay[at + 1]!.quotedOn <= close.quotedOn) at++
    if (at < 0) continue
    const rate = byDay[at]!
    if (daysBetween(rate.quotedOn, close.quotedOn) > WEEKEND_GAP_DAYS) continue
    series.push({ quotedOn: close.quotedOn, price: String(Number(close.price) * Number(rate.price)) })
  }
  return series
}

export async function eurRateLatest(
  tx: Executor,
  currency: string,
  history: HistoryFetcher = fetchHistory,
): Promise<string | null> {
  const now = today()
  try {
    return await eurRateOn(tx, currency, now, history)
  } catch (e) {
    if (!(e instanceof DomainError)) throw e
    const instrument = await pairInstrument(tx, currency)
    return (await closeOnOrBefore(tx, instrument.id, now))?.price ?? null
  }
}
