import type { Asset, Instrument, InvestmentOperation, Position } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

export interface NewInstrument {
  kind: Instrument['kind']
  priceSource: Instrument['priceSource']
  priceSourceRef: string
  name: string
  symbol?: string | null
  isin?: string | null
  currency?: string
}

/**
 * Finds the shared instrument by its identity, or creates it. Two users holding
 * the same ETF must land on the same row: that is the whole point of the table,
 * and what makes a price read once serve everyone.
 */
export async function upsertInstrument(tx: Executor, row: NewInstrument): Promise<Instrument> {
  const [instrument] = await tx<Instrument[]>`
    insert into instrument ${tx(compact(row))}
    on conflict (price_source, price_source_ref) do update
      -- Touch nothing: the first declaration wins, so a second user holding it
      -- cannot rename or reclassify what others already read.
      set price_source_ref = instrument.price_source_ref
    returning id, kind, price_source, price_source_ref, name, symbol, isin, currency
  `
  return instrument!
}

export async function listInstruments(tx: Executor, ids: string[]): Promise<Instrument[]> {
  if (ids.length === 0) return []
  return await tx<Instrument[]>`
    select id, kind, price_source, price_source_ref, name, symbol, isin, currency
    from instrument where id in ${tx(ids)}
  `
}

export async function insertAsset(
  tx: Executor,
  userId: string,
  name: string,
  instrumentId: string | null,
): Promise<Asset> {
  const [asset] = await tx<Asset[]>`
    insert into asset (user_id, name, instrument_id)
    values (${userId}, ${name}, ${instrumentId})
    returning id, user_id, name, instrument_id, manual_price, manual_priced_on
  `
  return asset!
}

export async function getAsset(tx: Executor, userId: string, id: string): Promise<Asset | undefined> {
  const [asset] = await tx<Asset[]>`
    select id, user_id, name, instrument_id, manual_price, manual_priced_on from asset
    where user_id = ${userId} and id = ${id}
  `
  return asset
}

/** What this user already holds or follows on that instrument, if anything. */
export async function findAssetByInstrument(
  tx: Executor,
  userId: string,
  instrumentId: string,
): Promise<Asset | undefined> {
  const [asset] = await tx<Asset[]>`
    select id, user_id, name, instrument_id, manual_price, manual_priced_on from asset
    where user_id = ${userId} and instrument_id = ${instrumentId}
  `
  return asset
}

export async function listAssets(tx: Executor, userId: string): Promise<Asset[]> {
  return await tx<Asset[]>`
    select id, user_id, name, instrument_id, manual_price, manual_priced_on from asset
    where user_id = ${userId} order by name
  `
}

export async function updateAssetRow(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Asset | undefined> {
  const [asset] = await tx<Asset[]>`
    update asset set ${tx(patch)}, updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning id, user_id, name, instrument_id, manual_price, manual_priced_on
  `
  return asset
}

export interface NewOperation {
  userId: string
  accountId: string
  assetId?: string | null
  type: InvestmentOperation['type']
  quantity?: string | null
  amount: string
  currency?: string
  operatedOn: string
  note?: string | null
}

export async function insertOperation(tx: Executor, row: NewOperation): Promise<InvestmentOperation> {
  const [operation] = await tx<InvestmentOperation[]>`
    insert into investment_operation ${tx(compact(row))}
    -- Every column but account_behavior, which only exists to carry a foreign key.
    returning id, user_id, account_id, asset_id, type, quantity, amount, currency, operated_on, note
  `
  return operation!
}

export async function listOperations(
  tx: Executor,
  userId: string,
  accountId?: string,
): Promise<InvestmentOperation[]> {
  return await tx<InvestmentOperation[]>`
    select id, user_id, account_id, asset_id, type, quantity, amount, currency, operated_on, note
    from investment_operation
    where user_id = ${userId}
      ${accountId ? tx`and account_id = ${accountId}` : tx``}
    order by operated_on desc, created_at desc
  `
}

/**
 * What the operations did to an investment account's cash: buying and paying
 * fees take money out, selling and dividends put it back in. Money reaching the
 * account or leaving it is a movement, and counted elsewhere.
 */
export async function operationsCashDelta(tx: Executor, userId: string): Promise<Map<string, string>> {
  const rows = await tx<{ accountId: string; delta: string }[]>`
    select account_id,
           sum(case when type in ('sell', 'dividend') then amount else -amount end)::numeric(14,2) as delta
    from investment_operation
    where user_id = ${userId}
    group by account_id
  `
  return new Map(rows.map((r) => [r.accountId, r.delta]))
}

/**
 * Positions from the operations alone: quantity held, weighted average cost of
 * what is still held, and the money still committed to it.
 *
 * The average cost (PMP, the French tax rule, so it matches what the broker
 * shows) cannot be a plain division of totals: it is sequential. Buy 10 at 100,
 * sell 5, buy 5 at 200 and the answer is 25 a unit, where dividing the totals
 * would say 20. So the operations are walked in order, carrying two numbers:
 * the quantity held and what it cost. A buy adds both; a sell keeps the average
 * untouched and takes its share out of the cost, which is what makes the walk
 * necessary and the arithmetic exact.
 */
export async function positions(tx: Executor, userId: string, accountId?: string): Promise<Position[]> {
  return await tx<Position[]>`
    with recursive trades as (
      select o.asset_id,
             o.type,
             o.quantity,
             o.amount,
             row_number() over (
               partition by o.asset_id order by o.operated_on, o.created_at, o.id
             ) as seq
      from investment_operation o
      where o.user_id = ${userId}
        and o.type in ('buy', 'sell')
        ${accountId ? tx`and o.account_id = ${accountId}` : tx``}
    ),
    walk (asset_id, seq, quantity, cost) as (
      select asset_id, seq,
             case when type = 'buy' then quantity else -quantity end,
             case when type = 'buy' then amount else 0 end
      from trades where seq = 1
      union all
      select t.asset_id,
             t.seq,
             w.quantity + case when t.type = 'buy' then t.quantity else -t.quantity end,
             case
               when t.type = 'buy' then w.cost + t.amount
               -- Selling everything (or, on inconsistent data, more) leaves
               -- nothing committed rather than dividing by zero.
               when t.quantity >= w.quantity then 0
               else w.cost * (1 - t.quantity / w.quantity)
             end
      from walk w
      join trades t on t.asset_id = w.asset_id and t.seq = w.seq + 1
    ),
    held as (
      select w.asset_id, w.quantity, w.cost
      from walk w
      where w.seq = (select max(t.seq) from trades t where t.asset_id = w.asset_id)
        and w.quantity > 0
    )
    select h.asset_id,
           a.name as asset_name,
           a.instrument_id,
           h.quantity::numeric(20,8) as quantity,
           (h.cost / h.quantity)::numeric(18,8) as average_cost,
           h.cost::numeric(14,2) as cost_basis,
           -- A listed asset takes the shared quote, a hand-priced one its own.
           -- Both stay null when nothing is known: a position is never valued
           -- by guesswork, and the caller says "no price" instead.
           coalesce(q.price, a.manual_price) as price,
           coalesce(q.quoted_at, a.manual_priced_on::timestamptz) as priced_at,
           (a.manual_price is not null) as manual_price,
           (h.quantity * coalesce(q.price, a.manual_price))::numeric(14,2) as value,
           (h.quantity * coalesce(q.price, a.manual_price) - h.cost)::numeric(14,2) as gain
    from held h
    join asset a on a.id = h.asset_id
    left join instrument_quote q on q.instrument_id = a.instrument_id
    order by a.name
  `
}

export interface QuoteRow {
  price: string
  currency: string
  quotedAt: Date
  marketOpen: boolean
}

/** One row per instrument, overwritten: only the latest known price is kept. */
export async function upsertQuote(tx: Executor, instrumentId: string, quote: QuoteRow): Promise<void> {
  await tx`
    insert into instrument_quote (instrument_id, price, currency, quoted_at, fetched_at, market_open)
    values (${instrumentId}, ${quote.price}, ${quote.currency}, ${quote.quotedAt}, now(), ${quote.marketOpen})
    on conflict (instrument_id) do update
      set price = excluded.price,
          currency = excluded.currency,
          quoted_at = excluded.quoted_at,
          fetched_at = excluded.fetched_at,
          market_open = excluded.market_open
  `
}

/** What movements put into an investment account, net of what they took out. */
export async function movementsNetPerAccount(tx: Executor, userId: string): Promise<Map<string, string>> {
  const rows = await tx<{ accountId: string; net: string }[]>`
    select a.id as account_id,
           coalesce(
             sum(case when m.target_account_id = a.id then m.amount else -m.amount end), 0
           )::numeric(14,2) as net
    from account a
    left join movement m on m.source_account_id = a.id or m.target_account_id = a.id
    where a.user_id = ${userId} and a.behavior = 'investment'
    group by a.id
  `
  return new Map(rows.map((r) => [r.accountId, r.net]))
}

/**
 * The last known price of every asset this user has, held or merely followed.
 * A followed asset has no position, so the positions query never sees it, and
 * its price is exactly what makes following useful.
 */
export async function assetPrices(tx: Executor, userId: string): Promise<Map<string, string | null>> {
  const rows = await tx<{ assetId: string; price: string | null }[]>`
    select a.id as asset_id, coalesce(q.price, a.manual_price) as price
    from asset a
    left join instrument_quote q on q.instrument_id = a.instrument_id
    where a.user_id = ${userId}
  `
  return new Map(rows.map((r) => [r.assetId, r.price]))
}

export interface RefreshCandidate {
  instrumentId: string
  priceSource: Instrument['priceSource']
  priceSourceRef: string
  /** When we last asked, which is what the freshness bound reads. */
  fetchedAt: Date | null
  /** Null when never fetched; false buys the longer closed-market bound. */
  marketOpen: boolean | null
}

/**
 * The instruments worth a network call: those this user actually holds. An
 * instrument nobody holds any more is left alone, and the shared table is never
 * refreshed wholesale on someone's behalf.
 */
export async function instrumentsToRefresh(tx: Executor, userId: string): Promise<RefreshCandidate[]> {
  return await tx<RefreshCandidate[]>`
    select distinct i.id as instrument_id, i.price_source, i.price_source_ref,
           q.fetched_at, q.market_open
    from asset a
    join instrument i on i.id = a.instrument_id
    left join instrument_quote q on q.instrument_id = i.id
    where a.user_id = ${userId}
  `
}

/** How much of an asset an account still holds, to refuse selling more than that. */
export async function heldQuantity(
  tx: Executor,
  userId: string,
  accountId: string,
  assetId: string,
): Promise<string> {
  const [row] = await tx<{ quantity: string }[]>`
    select coalesce(sum(case when type = 'buy' then quantity else -quantity end), 0)::numeric(20,8) as quantity
    from investment_operation
    where user_id = ${userId} and account_id = ${accountId} and asset_id = ${assetId}
      and type in ('buy', 'sell')
  `
  return row!.quantity
}

export interface ValuationPoint {
  day: string
  /** What the holdings were worth that day, at the last close known by then. */
  holdings: string
  /** Cash on the investment accounts that day. */
  cash: string
  /** What movements had put in, net of what they had taken out, by that day. */
  contributions: string
}

/**
 * The daily worth of everything held, and the money put in to get there. Two
 * series rather than one, because the gap between them *is* the performance:
 * drawn together, a portfolio says whether it is going anywhere, which no
 * single number does.
 *
 * A day's quantity comes from the operations dated up to it, and its price from
 * the last close known by then, carried forward: a market shut on Sunday has
 * not lost its value, it simply did not trade. An asset with no price at all
 * counts as nothing rather than guessed, exactly as it does elsewhere.
 */
export async function valuationSeries(
  tx: Executor,
  userId: string,
  from: string,
  to: string,
): Promise<ValuationPoint[]> {
  return await tx<ValuationPoint[]>`
    with days as (
      select generate_series(${from}::date, ${to}::date, interval '1 day')::date as day
    ),
    trades as (
      select o.asset_id, a.instrument_id, o.operated_on,
             sum(case when o.type = 'buy' then o.quantity else -o.quantity end) as delta
      from investment_operation o
      join asset a on a.id = o.asset_id
      where o.user_id = ${userId} and o.type in ('buy', 'sell')
      group by o.asset_id, a.instrument_id, o.operated_on
    ),
    held as (
      select d.day, t.asset_id, t.instrument_id, sum(t.delta) as quantity
      from days d
      join trades t on t.operated_on <= d.day
      group by d.day, t.asset_id, t.instrument_id
    ),
    valued as (
      select h.day,
             h.quantity * coalesce(
               (select p.price from instrument_price p
                 where p.instrument_id = h.instrument_id and p.quoted_on <= h.day
                 order by p.quoted_on desc limit 1),
               (select ap.price from asset_price ap
                 where ap.asset_id = h.asset_id and ap.quoted_on <= h.day
                 order by ap.quoted_on desc limit 1),
               -- Nothing known by that day: the oldest price there is, carried
               -- backwards. A holding bought before its history starts was not
               -- worth zero, and drawing it as such would show a climb that
               -- never happened. Its own manual price is the last resort, for
               -- what was priced by hand after the fact.
               (select p.price from instrument_price p
                 where p.instrument_id = h.instrument_id
                 order by p.quoted_on limit 1),
               (select ap.price from asset_price ap
                 where ap.asset_id = h.asset_id
                 order by ap.quoted_on limit 1),
               (select a.manual_price from asset a where a.id = h.asset_id),
               0
             ) as value
      from held h
      where h.quantity > 0
    ),
    -- Cash and contributions both walk the same movements; operations move the
    -- cash inside the account and never touch what was contributed.
    flows as (
      select d.day,
             coalesce(sum(case when m.target_account_id = a.id then m.amount else -m.amount end), 0) as net
      from days d
      cross join account a
      left join movement m
        on (m.source_account_id = a.id or m.target_account_id = a.id) and m.happened_on <= d.day
      where a.user_id = ${userId} and a.behavior = 'investment'
      group by d.day
    ),
    inside as (
      select d.day,
             coalesce(sum(case when o.type in ('sell', 'dividend') then o.amount else -o.amount end), 0) as net
      from days d
      left join investment_operation o on o.user_id = ${userId} and o.operated_on <= d.day
      group by d.day
    )
    select d.day,
           coalesce((select sum(v.value) from valued v where v.day = d.day), 0)::numeric(14,2) as holdings,
           (f.net + i.net)::numeric(14,2) as cash,
           f.net::numeric(14,2) as contributions
    from days d
    join flows f on f.day = d.day
    join inside i on i.day = d.day
    order by d.day
  `
}

/**
 * Whether the shared history behind that instrument goes back far enough to be
 * one. Existence is the wrong question: every refresh writes the close of the
 * day it read, so a single row would pass for a year of history and the
 * backfill would never run.
 */
export async function hasPriceHistory(tx: Executor, instrumentId: string): Promise<boolean> {
  const [row] = await tx<{ deep: boolean }[]>`
    select exists (
      select 1 from instrument_price
      where instrument_id = ${instrumentId} and quoted_on < current_date - 30
    ) as deep
  `
  return row!.deep
}

/** A whole series at once: one statement per instrument, not one per day. */
export async function insertPriceHistory(
  tx: Executor,
  instrumentId: string,
  history: { quotedOn: string; price: string }[],
): Promise<void> {
  if (history.length === 0) return
  const rows = history.map((h) => ({ instrumentId, quotedOn: h.quotedOn, price: h.price }))
  await tx`
    insert into instrument_price ${tx(rows, 'instrumentId', 'quotedOn', 'price')}
    on conflict (instrument_id, quoted_on) do update set price = excluded.price
  `
}

/** The close of one day, written as the spot price is read. */
export async function upsertClose(
  tx: Executor,
  instrumentId: string,
  quotedOn: string,
  price: string,
): Promise<void> {
  await tx`
    insert into instrument_price (instrument_id, quoted_on, price)
    values (${instrumentId}, ${quotedOn}, ${price})
    on conflict (instrument_id, quoted_on) do update set price = excluded.price
  `
}

/** A hand-typed price keeps its own dated history, private to its holder. */
export async function upsertAssetPrice(
  tx: Executor,
  assetId: string,
  quotedOn: string,
  price: string,
): Promise<void> {
  await tx`
    insert into asset_price (asset_id, quoted_on, price)
    values (${assetId}, ${quotedOn}, ${price})
    on conflict (asset_id, quoted_on) do update set price = excluded.price
  `
}

/** The price history of one asset, for its own detail view. */
export async function assetHistory(
  tx: Executor,
  userId: string,
  assetId: string,
): Promise<{ quotedOn: string; price: string }[]> {
  return await tx<{ quotedOn: string; price: string }[]>`
    select coalesce(p.quoted_on, ap.quoted_on) as quoted_on,
           coalesce(p.price, ap.price) as price
    from asset a
    left join instrument_price p on p.instrument_id = a.instrument_id
    left join asset_price ap on ap.asset_id = a.id
    where a.user_id = ${userId} and a.id = ${assetId}
      and coalesce(p.quoted_on, ap.quoted_on) is not null
    order by 1
  `
}

export async function getOperation(
  tx: Executor,
  userId: string,
  id: string,
): Promise<InvestmentOperation | undefined> {
  const [operation] = await tx<InvestmentOperation[]>`
    select id, user_id, account_id, asset_id, type, quantity, amount, currency, operated_on, note
    from investment_operation where user_id = ${userId} and id = ${id}
  `
  return operation
}

export async function updateOperationRow(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<InvestmentOperation | undefined> {
  const [operation] = await tx<InvestmentOperation[]>`
    update investment_operation set ${tx(patch)}, updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning id, user_id, account_id, asset_id, type, quantity, amount, currency, operated_on, note
  `
  return operation
}

export async function deleteOperationRow(tx: Executor, userId: string, id: string): Promise<number> {
  const rows = await tx`delete from investment_operation where user_id = ${userId} and id = ${id}`
  return rows.count
}

/**
 * The lowest the running quantity of a holding ever gets, walking its trades in
 * order. Checking the final quantity is not enough: correcting a purchase down
 * can leave a later sale selling what was never held, and the average cost of
 * every operation after it would be nonsense.
 */
export async function lowestRunningQuantity(
  tx: Executor,
  userId: string,
  accountId: string,
  assetId: string,
): Promise<string> {
  const [row] = await tx<{ lowest: string }[]>`
    select coalesce(min(running), 0)::numeric(20,8) as lowest
    from (
      select sum(case when type = 'buy' then quantity else -quantity end)
               over (order by operated_on, created_at, id) as running
      from investment_operation
      where user_id = ${userId} and account_id = ${accountId} and asset_id = ${assetId}
        and type in ('buy', 'sell')
    ) walked
  `
  return row!.lowest
}
