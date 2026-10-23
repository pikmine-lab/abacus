import { eur, type OperationRef, type OperationType, type Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

const money = (value: number) => eur(value.toFixed(2))
// A quantity comes back as a number from the portfolio and as a decimal
// string from the operations list: both read the same once normalized.
const decimal = (value: number | string) => String(Number(value))

interface Hit {
  source: string
  reference: string
  name: string
  kind: string
  isin?: string
  price?: number
  currency?: string
}

interface ListedOperation {
  id: string
  date: string
  type: OperationType
  asset?: string
  quantity?: number | string
  amount: number
}

interface Milestone {
  day: string
  value: number
  contributions: number
  performance: number
}

interface PortfolioAccount {
  account: string
  cash: number
  value: number
  positions: {
    asset: string
    quantity: number
    averageCost: number
    price: number | null
    value: number | null
    unrealizedGain: number | null
  }[]
}

export function investmentsSteps({ call }: McpContext): Partial<Steps> {
  // Nothing found is a refusal on this interface, worded for the AI: it is
  // the same answer the web gives as an empty list.
  async function search(query: string): Promise<Hit[]> {
    try {
      return await call<Hit[]>('search_instruments', { query })
    } catch (error) {
      if ((error as Error).message.startsWith('Nothing found')) return []
      throw error
    }
  }

  async function operations(): Promise<ListedOperation[]> {
    return (await call<{ operations: ListedOperation[] }>('list_investment_operations', {})).operations
  }

  async function operationId(ref: OperationRef): Promise<string> {
    const found = (await operations()).find(
      (o) => o.type === ref.type && o.date === ref.on && o.asset === ref.asset,
    )
    if (!found) throw new Error(`no ${ref.type} of ${ref.asset ?? 'the account'} on ${ref.on}`)
    return found.id
  }

  async function portfolio(): Promise<PortfolioAccount[]> {
    return (await call<{ accounts: PortfolioAccount[] }>('get_portfolio', {})).accounts
  }

  return {
    async searchInstruments(query) {
      return (await search(query)).map((hit) => ({
        name: hit.name,
        ticker: hit.reference,
        price: { amount: (hit.price ?? 0).toFixed(2), currency: hit.currency ?? 'EUR' },
      }))
    },
    async followInstrument({ query, ticker, as }) {
      const hit = (await search(query)).find((h) => h.reference === ticker)
      if (!hit) throw new Error(`no instrument ${ticker} found for "${query}"`)
      await call('manage_assets', {
        action: 'create',
        name: as,
        source: hit.source,
        reference: hit.reference,
        kind: hit.kind,
        description: hit.name,
        isin: hit.isin,
      })
    },
    async followUnquotedAsset({ name, nature }) {
      await call('manage_assets', { action: 'create', name, nature })
    },
    async setAssetPrice({ asset, price, on }) {
      await call('manage_assets', {
        action: 'set_price',
        name: asset,
        price: Number(price.amount),
        pricedOn: on,
      })
    },
    async renameAsset({ asset, to }) {
      await call('manage_assets', { action: 'rename', name: asset, newName: to })
    },
    async stopFollowing(asset) {
      await call('manage_assets', { action: 'unfollow', name: asset })
    },
    async refreshPrices() {
      // Prices are refreshed as the portfolio is read: there is no other way
      // to ask for it on this interface.
      await call('get_portfolio', {})
    },
    async readFollowedAssets() {
      const assets = await call<{ name: string; status: string; price?: number }[]>('manage_assets', {
        action: 'list',
      })
      return assets
        .filter((a) => a.status === 'followed')
        .map((a) => ({ name: a.name, price: a.price === undefined ? null : money(a.price) }))
    },
    async recordOperation({ account, type, asset, quantity, amount, on }) {
      await call('record_investment_operations', {
        operations: [
          {
            date: on,
            account,
            type,
            asset,
            quantity: quantity === undefined ? undefined : Number(quantity),
            amount: Number(amount.amount),
          },
        ],
      })
    },
    async correctOperation(ref, { amount, quantity, on }) {
      await call('fix_investment_operation', {
        operationId: await operationId(ref),
        action: 'correct',
        amount: amount ? Number(amount.amount) : undefined,
        quantity: quantity === undefined ? undefined : Number(quantity),
        date: on,
      })
    },
    async deleteOperation(ref) {
      await call('fix_investment_operation', { operationId: await operationId(ref), action: 'delete' })
    },
    async readOperations() {
      return (await operations()).map((o) => ({
        type: o.type,
        ...(o.asset ? { asset: o.asset } : {}),
        ...(o.quantity !== undefined ? { quantity: decimal(o.quantity) } : {}),
        amount: money(o.amount),
        on: o.date,
      }))
    },
    async readPositions() {
      return (await portfolio()).flatMap((account) =>
        account.positions.map((p) => ({
          asset: p.asset,
          quantity: decimal(p.quantity),
          averageCost: money(p.averageCost),
          price: p.price === null ? null : money(p.price),
          value: p.value === null ? null : money(p.value),
          gain: p.unrealizedGain === null ? null : money(p.unrealizedGain),
        })),
      )
    },
    async readInvestmentAccounts() {
      return (await portfolio()).map((a) => ({
        account: a.account,
        cash: money(a.cash),
        value: money(a.value),
      }))
    },
    async readValuationHistory() {
      const { start, end } = await call<{ start: Milestone; end: Milestone }>('get_portfolio_history', {})
      const day = (m: Milestone) => ({
        on: m.day,
        value: money(m.value),
        contributions: money(m.contributions),
        performance: money(m.performance),
      })
      return { first: day(start), last: day(end) }
    },
    async readPriceHistory(asset) {
      const { days } = await call<{ days: { day: string; price: string }[] }>('manage_assets', {
        action: 'history',
        name: asset,
      })
      const point = (p: { day: string; price: string } | undefined) => {
        if (!p) throw new Error(`no price known for "${asset}"`)
        return { on: p.day, price: money(Number(p.price)) }
      }
      return { days: days.length, first: point(days[0]), last: point(days.at(-1)) }
    },
  }
}
