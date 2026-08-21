import { db, type Executor } from '../db/client.ts'
import { getAccount, listAccountsWithBalance } from '../db/datasources/accounts.ts'
import {
  getAsset,
  heldQuantity,
  insertAsset,
  insertOperation,
  instrumentsToRefresh,
  listAssets as listAssetsDs,
  listInstruments,
  listOperations as listOperationsDs,
  movementsNetPerAccount,
  type NewInstrument,
  positions as positionsDs,
  updateAssetRow,
  upsertInstrument,
  upsertQuote,
} from '../db/datasources/investments.ts'
import { DomainError, rethrowUnique } from '../domain/errors.ts'
import type {
  Account,
  Asset,
  Instrument,
  InvestmentOperation,
  InvestmentOperationType,
  Position,
} from '../domain/types.ts'
import { CLOSED_FRESHNESS_MS, type Fetcher, FRESHNESS_MS, fetchQuote } from '../prices/sources.ts'

export interface DeclareAssetInput {
  name: string
  /** Absent for something priced by hand: unlisted shares, an SCPI, a property. */
  instrument?: NewInstrument
}

/**
 * Declares what the user holds. The instrument behind it is shared with every
 * other user, so it is looked up by its identity before being created: holding
 * the same ETF as someone else must not duplicate the thing whose price we read.
 */
export async function declareAsset(userId: string, input: DeclareAssetInput): Promise<Asset> {
  const sql = db()
  return await sql.begin(async (tx) => {
    const instrument = input.instrument ? await upsertInstrument(tx, input.instrument) : null
    try {
      return await insertAsset(tx, userId, input.name, instrument?.id ?? null)
    } catch (e) {
      rethrowUnique(
        e,
        'asset_exists',
        `You already hold "${input.name}", or that instrument under another name`,
      )
    }
  })
}

export async function listAssets(userId: string): Promise<(Asset & { instrument: Instrument | null })[]> {
  const sql = db()
  const assets = await listAssetsDs(sql, userId)
  const instruments = await listInstruments(sql, [
    ...new Set(assets.map((a) => a.instrumentId).filter((id): id is string => id !== null)),
  ])
  const byId = new Map(instruments.map((i) => [i.id, i]))
  return assets.map((a) => ({ ...a, instrument: a.instrumentId ? (byId.get(a.instrumentId) ?? null) : null }))
}

/**
 * Renames a holding. Only its name: the instrument behind it is what it is, and
 * pointing an asset at another instrument would make its whole history describe
 * something else.
 */
export async function editAsset(userId: string, id: string, name: string): Promise<Asset> {
  try {
    const asset = await updateAssetRow(db(), userId, id, { name })
    if (!asset) throw new DomainError('asset_not_found', `No asset ${id} for this user`)
    return asset
  } catch (e) {
    rethrowUnique(e, 'asset_exists', `You already hold something named "${name}"`)
  }
}

export interface RecordOperationInput {
  accountId: string
  assetId?: string
  type: InvestmentOperationType
  quantity?: number
  amount: number
  operatedOn: string
  note?: string
}

/**
 * Records what happened inside investment accounts, as a batch and in one
 * transaction: a buy and the fee that came with it are one declaration, and half
 * of it landing would leave a position that never existed.
 */
export async function recordOperations(
  userId: string,
  inputs: RecordOperationInput[],
): Promise<InvestmentOperation[]> {
  if (inputs.length === 0)
    throw new DomainError('no_operations', 'There is nothing to record: pass at least one operation')
  const sql = db()
  return await sql.begin(async (tx) => {
    const recorded: InvestmentOperation[] = []
    for (const input of inputs) recorded.push(await recordOperationIn(tx, userId, input))
    return recorded
  })
}

async function recordOperationIn(
  tx: Executor,
  userId: string,
  input: RecordOperationInput,
): Promise<InvestmentOperation> {
  const account = await getAccount(tx, userId, input.accountId)
  if (!account) throw new DomainError('account_not_found', `No account ${input.accountId} for this user`)
  if (account.behavior !== 'investment')
    throw new DomainError(
      'not_an_investment_account',
      `"${account.name}" is not an investment account: only those carry operations`,
    )
  if (account.closedOn)
    throw new DomainError('account_closed', `"${account.name}" is closed: reopen it before writing to it`)
  if (!(input.amount > 0)) throw new DomainError('bad_amount', 'An amount is always positive')

  const trade = input.type === 'buy' || input.type === 'sell'
  if (trade && !(input.quantity && input.quantity > 0))
    throw new DomainError('needs_quantity', 'A buy or a sell needs the quantity it moved')
  if (!trade && input.quantity !== undefined)
    throw new DomainError('unexpected_quantity', 'Only a buy or a sell moves a quantity')
  if ((trade || input.type === 'dividend') && !input.assetId)
    throw new DomainError('needs_asset', `A ${input.type} needs the asset it is about`)

  if (input.assetId) {
    const asset = await getAsset(tx, userId, input.assetId)
    if (!asset) throw new DomainError('asset_not_found', `No asset ${input.assetId} for this user`)
  }
  // Selling more than the account holds would leave a negative position, which
  // is not something that happens: it is a typo in the quantity or the account.
  if (input.type === 'sell') {
    const held = Number(await heldQuantity(tx, userId, input.accountId, input.assetId!))
    if (input.quantity! > held)
      throw new DomainError(
        'oversold',
        `"${account.name}" holds ${held} of that asset, less than the ${input.quantity} being sold`,
      )
  }

  return await insertOperation(tx, {
    userId,
    accountId: input.accountId,
    assetId: input.assetId ?? null,
    type: input.type,
    quantity: trade ? String(input.quantity) : null,
    amount: String(input.amount),
    operatedOn: input.operatedOn,
    note: input.note ?? null,
  })
}

export async function listOperations(userId: string, accountId?: string): Promise<InvestmentOperation[]> {
  return await listOperationsDs(db(), userId, accountId)
}

/**
 * Brings the prices of what this user holds up to date, within the freshness
 * bound of each source, and never gets in the way of the read that called it:
 * a network failure, a rate limit or a source changing its shape all leave the
 * stored price in place. A stale price shown with its hour beats a page that
 * fails, so this function does not throw.
 *
 * There is no scheduler anywhere, on purpose. An hourly job would refresh at
 * night and be an hour stale exactly when a screen opens; refreshing on read
 * is fresh precisely when someone is looking.
 */
export async function refreshQuotes(userId: string, fetcher: Fetcher = fetchQuote): Promise<void> {
  const sql = db()
  const candidates = await instrumentsToRefresh(sql, userId)
  const now = Date.now()
  await Promise.all(
    candidates.map(async (candidate) => {
      const bound = candidate.marketOpen === false ? CLOSED_FRESHNESS_MS : FRESHNESS_MS[candidate.priceSource]
      if (candidate.fetchedAt && now - candidate.fetchedAt.getTime() < bound) return
      try {
        const quote = await fetcher(candidate.priceSource, candidate.priceSourceRef)
        // A price in another currency cannot be added to euros, and converting
        // it is issue #10, not this one: leave the position unpriced and say so
        // rather than mixing units.
        if (quote.currency !== 'EUR') return
        await upsertQuote(sql, candidate.instrumentId, quote)
      } catch {
        // Deliberately silent: the caller is a read, and the stored price stands.
      }
    }),
  )
}

/** A hand-typed price, for what no source quotes. Dated, because a price is. */
export async function setManualPrice(
  userId: string,
  assetId: string,
  price: number,
  pricedOn: string,
): Promise<Asset> {
  if (!(price >= 0)) throw new DomainError('bad_amount', 'A price cannot be negative')
  const asset = await getAsset(db(), userId, assetId)
  if (!asset) throw new DomainError('asset_not_found', `No asset ${assetId} for this user`)
  if (asset.instrumentId)
    throw new DomainError(
      'asset_is_quoted',
      `"${asset.name}" takes its price from its source: a hand-typed one would be a second answer`,
    )
  const updated = await updateAssetRow(db(), userId, assetId, {
    manualPrice: String(price),
    manualPricedOn: pricedOn,
  })
  return updated!
}

export interface PortfolioAccount {
  account: Account
  /**
   * The cash sitting on the account: what movements brought in and out, plus
   * what operations moved inside it. Not the account's worth, which is this
   * plus what the holdings are worth.
   */
  cash: string
  positions: Position[]
  /** What the holdings of this account cost, order fees included. */
  costBasis: string
  /** Cash plus every position that has a price. */
  value: string
  /** How many positions carry no price, so the value above says how partial it is. */
  unpriced: number
  /**
   * What movements put in, net of what they took out. The reference the whole
   * account is judged against: everything else that happened (dividends in,
   * fees out, purchases, sales) stayed inside the account.
   */
  netContributions: string
  /**
   * `value - netContributions`: what the account made, dividends received and
   * fees paid included, because both went through its cash. Null while any
   * position lacks a price, since a partial value would understate it.
   */
  totalReturn: string | null
}

/**
 * What is held, account by account, valued at the last known price. Prices are
 * refreshed by `refreshQuotes`, which the interfaces call before reading: this
 * function only reads, so it never depends on the network.
 */
export async function portfolio(userId: string): Promise<PortfolioAccount[]> {
  const sql = db()
  const accounts = (await listAccountsWithBalance(sql, userId)).filter((a) => a.behavior === 'investment')
  const contributions = await movementsNetPerAccount(sql, userId)
  return await Promise.all(
    accounts.map(async (account) => {
      const held = await positionsDs(sql, userId, account.id)
      const priced = held.filter((p) => p.value !== null)
      const value = Number(account.balance) + priced.reduce((sum, p) => sum + Number(p.value), 0)
      const net = Number(contributions.get(account.id) ?? 0)
      return {
        account,
        cash: account.balance,
        positions: held,
        costBasis: held.reduce((sum, p) => sum + Number(p.costBasis), 0).toFixed(2),
        value: value.toFixed(2),
        unpriced: held.length - priced.length,
        netContributions: net.toFixed(2),
        totalReturn: held.length === priced.length ? (value - net).toFixed(2) : null,
      }
    }),
  )
}

export async function positions(userId: string, accountId?: string): Promise<Position[]> {
  return await positionsDs(db(), userId, accountId)
}

/**
 * What the holdings are worth, on top of the account balances. Everywhere else
 * wealth is the sum of balances, and an investment account's balance is its
 * cash: without this the total ignores the holdings entirely, which is exactly
 * what made the dashboard wrong as soon as a placement moved.
 *
 * `unpriced` is what the figure cannot include, so a screen can say the total
 * is partial rather than passing it off as whole.
 */
export async function holdingsValue(userId: string): Promise<{ value: number; unpriced: number }> {
  const held = await positionsDs(db(), userId)
  return {
    value: held.reduce((sum, p) => sum + Number(p.value ?? 0), 0),
    unpriced: held.filter((p) => p.value === null).length,
  }
}
