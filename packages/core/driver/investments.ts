import { eur, type OperationRef, type Steps } from '@abacus/use-case-language'
import { searchInstruments } from '../src/prices/search.ts'
import { createAccount } from '../src/services/accounts.ts'
import {
  assetPrices,
  correctOperation,
  declareAsset,
  deleteOperation,
  editAsset,
  listAssets,
  listOperations,
  portfolio,
  positions,
  recordOperations,
  refreshQuotes,
  setManualPrice,
  stopFollowing,
  valuationHistory,
} from '../src/services/investments.ts'
import { amountOf, type PreparationContext } from './context.ts'

const money = (value: string | number) => eur(Number(value).toFixed(2))
const decimal = (value: string | number) => String(Number(value))

export function investmentsSteps({ user, accountId }: PreparationContext): Partial<Steps> {
  async function assetId(name: string): Promise<string> {
    const asset = (await listAssets(user.id)).find((a) => a.name === name)
    if (!asset) throw new Error(`no asset named "${name}"`)
    return asset.id
  }

  async function operationId(ref: OperationRef): Promise<string> {
    const wanted = ref.asset ? await assetId(ref.asset) : null
    const found = (await listOperations(user.id)).find(
      (o) => o.type === ref.type && o.operatedOn === ref.on && o.assetId === wanted,
    )
    if (!found) throw new Error(`no ${ref.type} of ${ref.asset ?? 'the account'} on ${ref.on}`)
    return found.id
  }

  return {
    async createInvestmentAccount({ name, opening, openedOn }) {
      await createAccount({
        userId: user.id,
        name,
        behavior: 'investment',
        openingBalance: opening ? amountOf(opening) : undefined,
        openedOn: opening ? (openedOn ?? '2026-01-01') : openedOn,
      })
    },
    async searchInstruments(query) {
      return (await searchInstruments(query)).map((hit) => ({
        name: hit.name,
        ticker: hit.reference,
        price: { amount: Number(hit.price).toFixed(2), currency: hit.currency ?? 'EUR' },
      }))
    },
    async followInstrument({ query, ticker, as }) {
      const hit = (await searchInstruments(query)).find((h) => h.reference === ticker)
      if (!hit) throw new Error(`no instrument ${ticker} found for "${query}"`)
      await declareAsset(user.id, {
        name: as,
        instrument: {
          kind: hit.kind,
          priceSource: hit.source,
          priceSourceRef: hit.reference,
          name: hit.name,
          isin: hit.isin,
        },
      })
    },
    async followUnquotedAsset({ name, nature }) {
      await declareAsset(user.id, { name, nature })
    },
    async setAssetPrice({ asset, price, on }) {
      await setManualPrice(user.id, await assetId(asset), amountOf(price), on)
    },
    async renameAsset({ asset, to }) {
      await editAsset(user.id, await assetId(asset), to)
    },
    async stopFollowing(asset) {
      await stopFollowing(user.id, await assetId(asset))
    },
    async refreshPrices() {
      await refreshQuotes(user.id)
    },
    async readFollowedAssets() {
      const held = new Set((await positions(user.id)).map((p) => p.assetId))
      const prices = await assetPrices(user.id)
      return (await listAssets(user.id))
        .filter((a) => !held.has(a.id))
        .map((a) => {
          const price = prices.get(a.id)
          return { name: a.name, price: price ? money(price) : null }
        })
    },
    async recordOperation({ account, type, asset, quantity, amount, on }) {
      await recordOperations(user.id, [
        {
          accountId: await accountId(account),
          assetId: asset ? await assetId(asset) : undefined,
          type,
          quantity: quantity === undefined ? undefined : Number(quantity),
          amount: amountOf(amount),
          operatedOn: on,
        },
      ])
    },
    async correctOperation(ref, { amount, quantity, on }) {
      await correctOperation(user.id, await operationId(ref), {
        amount: amount ? amountOf(amount) : undefined,
        quantity: quantity === undefined ? undefined : Number(quantity),
        operatedOn: on,
      })
    },
    async deleteOperation(ref) {
      await deleteOperation(user.id, await operationId(ref))
    },
    async readOperations() {
      const assets = new Map((await listAssets(user.id)).map((a) => [a.id, a.name]))
      return (await listOperations(user.id)).map((o) => ({
        type: o.type,
        ...(o.assetId ? { asset: assets.get(o.assetId) } : {}),
        ...(o.quantity ? { quantity: decimal(o.quantity) } : {}),
        amount: money(o.amount),
        on: o.operatedOn,
      }))
    },
    async readPositions() {
      return (await portfolio(user.id)).flatMap((account) =>
        account.positions.map((p) => ({
          asset: p.assetName,
          quantity: decimal(p.quantity),
          averageCost: money(p.averageCost),
          price: p.price === null ? null : money(p.price),
          value: p.value === null ? null : money(p.value),
          gain: p.gain === null ? null : money(p.gain),
        })),
      )
    },
    async readInvestmentAccounts() {
      return (await portfolio(user.id)).map((h) => ({
        account: h.account.name,
        cash: money(h.cash),
        value: money(h.value),
      }))
    },
    async readValuationHistory() {
      const history = await valuationHistory(user.id)
      if (!history) throw new Error('no valuation history: nothing was ever bought')
      const day = (d: typeof history.start) => ({
        on: d.day,
        value: money(d.value),
        contributions: money(d.contributions),
        performance: money(d.performance),
      })
      return { first: day(history.start), last: day(history.end) }
    },
  }
}
