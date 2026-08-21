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
    returning id, user_id, name, instrument_id
  `
  return asset!
}

export async function getAsset(tx: Executor, userId: string, id: string): Promise<Asset | undefined> {
  const [asset] = await tx<Asset[]>`
    select id, user_id, name, instrument_id from asset
    where user_id = ${userId} and id = ${id}
  `
  return asset
}

export async function listAssets(tx: Executor, userId: string): Promise<Asset[]> {
  return await tx<Asset[]>`
    select id, user_id, name, instrument_id from asset
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
    returning id, user_id, name, instrument_id
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
           h.cost::numeric(14,2) as cost_basis
    from held h
    join asset a on a.id = h.asset_id
    order by a.name
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
