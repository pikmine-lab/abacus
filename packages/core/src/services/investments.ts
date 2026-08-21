import { db, type Executor } from '../db/client.ts'
import { getAccount, listAccountsWithBalance } from '../db/datasources/accounts.ts'
import {
  getAsset,
  heldQuantity,
  insertAsset,
  insertOperation,
  listAssets as listAssetsDs,
  listInstruments,
  listOperations as listOperationsDs,
  type NewInstrument,
  positions as positionsDs,
  updateAssetRow,
  upsertInstrument,
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

export interface PortfolioAccount {
  account: Account
  /**
   * The cash sitting on the account: what movements brought in and out, plus
   * what operations moved inside it. No holding is valued here, so this is not
   * the account's worth.
   */
  cash: string
  positions: Position[]
  /** What the holdings of this account cost, order fees included. */
  costBasis: string
}

/**
 * What is held, account by account. Nothing is valued: there is no price in the
 * model yet, so a position says its quantity and what it cost, and says only
 * that.
 */
export async function portfolio(userId: string): Promise<PortfolioAccount[]> {
  const sql = db()
  const accounts = (await listAccountsWithBalance(sql, userId)).filter((a) => a.behavior === 'investment')
  return await Promise.all(
    accounts.map(async (account) => {
      const held = await positionsDs(sql, userId, account.id)
      return {
        account,
        cash: account.balance,
        positions: held,
        costBasis: held.reduce((sum, p) => sum + Number(p.costBasis), 0).toFixed(2),
      }
    }),
  )
}

export async function positions(userId: string, accountId?: string): Promise<Position[]> {
  return await positionsDs(db(), userId, accountId)
}
