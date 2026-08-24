import { listVenues, searchInstruments } from '@abacus/core/prices/search'
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
} from '@abacus/core/services/investments'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { requireAccountByName, requireAssetByName } from '../resolve.ts'
import { clearable, fail, isoDate, ok, run } from './shared.ts'

export function registerInvestmentTools(server: McpServer, userId: string): void {
  server.registerTool(
    'manage_assets',
    {
      description:
        "Manages what the user holds on their investment accounts: a listed asset (an ETF, a share, a crypto) or one priced by hand (unlisted shares, an SCPI, a property). Take the source and reference of a listed one from search_instruments, never from memory: an invented ticker produces a holding whose price never updates. That instrument is shared with the other users of this application, and keeps the description of whoever declared it first. Actions: list, create, rename, set_price (a hand-typed price, and only for an asset with no source, since a listed one takes the market's). Omit the source at creation for whatever no source quotes. One instrument can only be held under one name: a second name for it would split the position in half.",
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'rename', 'set_price', 'unfollow']),
        name: z
          .string()
          .optional()
          .describe('create: the name to hold it under; rename/set_price: the asset concerned'),
        newName: z.string().optional().describe('rename: the corrected name'),
        price: z.number().nonnegative().optional().describe('set_price: what one unit is worth'),
        pricedOn: isoDate.optional().describe('set_price: the day that price is from'),
        source: z
          .enum(['yahoo', 'coingecko'])
          .optional()
          .describe('create: where its price comes from. Omit for an asset priced by hand'),
        reference: z
          .string()
          .optional()
          .describe(
            'create: its reference at that source: a Yahoo symbol ("CW8.PA") or a CoinGecko id ("bitcoin")',
          ),
        kind: z
          .enum(['security', 'crypto'])
          .optional()
          .describe('create: what it is, required as soon as a source is given'),
        description: z
          .string()
          .optional()
          .describe('create: the instrument\'s own name ("Amundi MSCI World"). Defaults to name'),
        isin: z
          .string()
          .optional()
          .describe(
            'create: its ISIN when known, the one unambiguous identifier of a fund. Pass what search_instruments returned, or what the user read in their bank',
          ),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const assets = await listAssets(userId)
          const [held, prices] = await Promise.all([positions(userId), assetPrices(userId)])
          const holding = new Set(held.map((p) => p.assetId))
          return ok(
            assets.map((asset) => ({
              name: asset.name,
              // Held or merely followed, and what it is worth: an AI could see
              // neither, so it could not tell a watchlist from a portfolio.
              status: holding.has(asset.id) ? 'held' : 'followed',
              price: prices.get(asset.id) ? Number(prices.get(asset.id)) : undefined,
              pricing: asset.instrument
                ? {
                    source: asset.instrument.priceSource,
                    reference: asset.instrument.priceSourceRef,
                    description: asset.instrument.name,
                    isin: asset.instrument.isin ?? undefined,
                  }
                : asset.manualPrice
                  ? `priced by hand: ${asset.manualPrice} on ${asset.manualPricedOn}`
                  : 'priced by hand, no price given yet',
            })),
          )
        }
        if (!a.name) return fail(`${a.action} requires name.`)
        if (a.action === 'rename') {
          if (!a.newName) return fail('rename requires newName: the corrected name.')
          const target = await requireAssetByName(userId, a.name)
          const renamed = await editAsset(userId, target.id, a.newName)
          return ok({ assetId: renamed.id, name: renamed.name })
        }
        if (a.action === 'unfollow') {
          const target = await requireAssetByName(userId, a.name)
          await stopFollowing(userId, target.id)
          return ok({ unfollowed: target.name })
        }
        if (a.action === 'set_price') {
          if (a.price === undefined || !a.pricedOn)
            return fail('set_price requires price and pricedOn: a price is always dated.')
          const target = await requireAssetByName(userId, a.name)
          const priced = await setManualPrice(userId, target.id, a.price, a.pricedOn)
          return ok({ name: priced.name, price: Number(priced.manualPrice), on: priced.manualPricedOn })
        }
        if (a.source && !a.reference)
          return fail(
            `create with source ${a.source} requires reference: its symbol or id at that source. Omit both for an asset priced by hand.`,
          )
        if (a.source && !a.kind) return fail('create with a source requires kind: security or crypto.')
        const asset = await declareAsset(userId, {
          name: a.name,
          instrument: a.source
            ? {
                kind: a.kind!,
                priceSource: a.source,
                priceSourceRef: a.reference!,
                name: a.description ?? a.name,
                isin: a.isin,
              }
            : undefined,
        })
        return ok({ assetId: asset.id, name: asset.name, pricedByHand: asset.instrumentId === null })
      }),
  )

  server.registerTool(
    'record_investment_operations',
    {
      description:
        "Records what happens inside an investment account: a purchase, a sale, a dividend received, account fees. Not for moving money in or out of that account: funding a PEA or taking cash back out is a plain internal transfer (declare_movements), and buying inside it is an operation. That separation is the model, not a detail: a purchase is not an expense, it changes the form of the money. Amounts are always positive and are what really left or entered the account, order fees included, so the average cost matches the broker's. When the user gives a price a share rather than a total (which is what a broker shows, as the average acquisition price), pass unitPrice and let the total be computed: never derive a total from a valuation minus a gain, because the valuation uses our price and the gain theirs, and the difference would settle into the cost basis for good. Assets are named, and must exist (manage_assets). Unlike declare_movements, the batch is one declaration: if a line is refused nothing is recorded, because a purchase and the fee that came with it are one event.",
      inputSchema: z.object({
        operations: z
          .array(
            z.object({
              date: isoDate,
              account: z
                .string()
                .describe('Investment account name (a PEA, a securities account, a crypto account)'),
              type: z
                .enum(['buy', 'sell', 'dividend', 'fee'])
                .describe(
                  'buy/sell: moves a quantity of an asset; dividend: cash paid by an asset; fee: account fees (custody), not order fees, which belong in the buy amount',
                ),
              asset: z
                .string()
                .optional()
                .describe('Asset name. Required for buy, sell and dividend; omit on account fees'),
              quantity: z.number().positive().optional().describe('buy/sell only: how many units moved'),
              amount: z
                .number()
                .positive()
                .optional()
                .describe(
                  'What left or entered the account, order fees included, always positive. Give this or unitPrice, never both',
                ),
              unitPrice: z
                .number()
                .positive()
                .optional()
                .describe(
                  'buy/sell: the price of one unit, which is what a broker displays as the average acquisition price. The total is computed from the quantity. Use it whenever the user gives a price a share, and never multiply it yourself',
                ),
              note: z.string().optional(),
            }),
          )
          .min(1),
      }),
    },
    async (a) =>
      run(async () => {
        const resolved = await Promise.all(
          a.operations.map(async (o) => {
            const account = await requireAccountByName(userId, o.account)
            const asset = o.asset ? await requireAssetByName(userId, o.asset) : undefined
            return {
              accountId: account.id,
              assetId: asset?.id,
              type: o.type,
              quantity: o.quantity,
              amount: o.amount,
              unitPrice: o.unitPrice,
              operatedOn: o.date,
              note: o.note,
            }
          }),
        )
        const recorded = await recordOperations(userId, resolved)
        return ok({
          recorded: recorded.length,
          operations: recorded.map((o) => ({
            id: o.id,
            date: o.operatedOn,
            type: o.type,
            quantity: o.quantity ?? undefined,
            amount: Number(o.amount),
          })),
        })
      }),
  )

  server.registerTool(
    'search_instruments',
    {
      description:
        'Finds a listed instrument by anything the user knows it as: a name ("msci world"), a provider ("amundi", "ishares"), a ticker ("CW8.PA"), an ISIN ("FR0010315770"), or a coin name. Always search before declaring a holding with manage_assets: the reference has to be the source\'s exact one, and guessing a ticker creates an asset whose price will never update. Several listings of the same fund exist across venues, so use the venue and the price to pick the one the user actually holds, and ask them when it is not obvious. Each result is one fund rather than one quotation line, with a venue quoting it in euros when there is one: the issuer and the payout policy (accumulating or distributing) are what tell two trackers of the same index apart, and the ISIN is what the user can check against their bank. A venue quoting in another currency is fine: its price converts to euros at the day\'s rate, like a foreign movement. Only a result whose price could not be read at all is marked unavailable. When the retained venue has to be checked or changed, list_instrument_venues gives every venue of one fund.',
      inputSchema: z.object({
        query: z.string().min(2).describe('Name, provider, ticker, ISIN or coin name'),
      }),
    },
    async (a) =>
      run(async () => {
        const hits = await searchInstruments(a.query)
        if (hits.length === 0)
          return fail(
            `Nothing found for "${a.query}". Try the provider and the index ("amundi msci world"), the ISIN, or the exact ticker.`,
          )
        return ok(
          hits.map((hit) => ({
            source: hit.source,
            reference: hit.reference,
            name: hit.name,
            kind: hit.kind,
            // What actually tells two trackers of one index apart, and what the
            // user can check against their bank: the web shows all three, so an
            // AI has to see them too or it cannot help choose.
            isin: hit.isin ?? undefined,
            issuer: hit.issuer ?? undefined,
            payout: hit.payout ?? undefined,
            venue: hit.venue ?? undefined,
            otherVenues: hit.otherVenues > 0 ? hit.otherVenues : undefined,
            price: hit.price ? Number(hit.price) : undefined,
            currency: hit.currency ?? undefined,
            unavailable: hit.available ? undefined : `priced in ${hit.currency}, not holdable yet`,
          })),
        )
      }),
  )

  server.registerTool(
    'get_portfolio',
    {
      description:
        'What the user holds, account by account: the cash on each investment account, and every position with its quantity, its weighted average cost per unit (PMP, order fees included), what it cost, the last known price with the moment the market made it, what it is worth now and its unrealized gain. Two figures per account state their own method, and reading them any other way makes them wrong: `unrealizedGain` excludes dividends and fees, `totalReturn` includes both and is measured against `netContributions`, what movements put in net of what they took out. A position with no price is valued at nothing rather than estimated, and `totalReturn` then comes back null rather than understated. Prices are refreshed as this tool runs, within what each source allows: Euronext is 15 minutes delayed by licence, so never present a price as live, present it with its hour.',
      inputSchema: z.object({
        account: z.string().optional().describe('Restrict to one investment account, by name'),
      }),
    },
    async (a) =>
      run(async () => {
        const wanted = a.account ? await requireAccountByName(userId, a.account) : null
        await refreshQuotes(userId)
        const held = await portfolio(userId)
        const accounts = wanted ? held.filter((h) => h.account.id === wanted.id) : held
        return ok({
          accounts: accounts.map((h) => ({
            account: h.account.name,
            cash: Number(h.cash),
            value: Number(h.value),
            costBasis: Number(h.costBasis),
            netContributions: Number(h.netContributions),
            totalReturn: h.totalReturn === null ? null : Number(h.totalReturn),
            unpricedPositions: h.unpriced === 0 ? undefined : h.unpriced,
            positions: h.positions.map((p) => ({
              asset: p.assetName,
              quantity: Number(p.quantity),
              averageCost: Number(p.averageCost),
              costBasis: Number(p.costBasis),
              price: p.price === null ? null : Number(p.price),
              pricedAt: p.pricedAt?.toISOString() ?? null,
              pricedByHand: p.manualPrice ? true : undefined,
              value: p.value === null ? null : Number(p.value),
              unrealizedGain: p.gain === null ? null : Number(p.gain),
            })),
          })),
        })
      }),
  )

  server.registerTool(
    'get_portfolio_history',
    {
      description:
        'How the portfolio moved over a window, already totalled: where it started, where it ended, its best and worst day, and milestones in between. Use it for anything about evolution ("what has it made since March", "is it going up") — `get_portfolio` only knows the present. `performance` is the whole point: it is the value minus the net contributions, dividends and fees included, the same figure `get_portfolio` returns as `totalReturn`. Read it rather than the valuation, which jumps every time money comes in without anything having been earned. `step` says what one milestone covers: a day on a short window, the last known day of each month beyond, so a milestone is always a closing figure and never an average. `high` and `low` are measured on every day of the window, not on the milestones. Everything comes back in euros, for all investment accounts together. Two limits worth stating when you report: a position with no price counts as nothing, so the performance is understated rather than wrong, and the window never reaches back before the first operation.',
      inputSchema: z.object({
        from: isoDate.optional().describe('Start of the window; defaults to the first operation ever'),
        to: isoDate.optional().describe('End of the window; defaults to today'),
      }),
    },
    async (a) =>
      run(async () => {
        await refreshQuotes(userId)
        const history = await valuationHistory(userId, a.from, a.to)
        if (!history) return ok({ history: null, note: 'Nothing has been bought yet: no history to read.' })
        return ok(history)
      }),
  )

  server.registerTool(
    'list_investment_operations',
    {
      description:
        'The operations declared on the investment accounts, most recent first: what was bought, sold, received as a dividend or paid in fees. Read it to check what is already recorded before declaring more, or to find the operation behind a position.',
      inputSchema: z.object({
        account: z.string().optional().describe('Restrict to one investment account, by name'),
      }),
    },
    async (a) =>
      run(async () => {
        const account = a.account ? await requireAccountByName(userId, a.account) : undefined
        const operations = await listOperations(userId, account?.id)
        const assets = new Map((await listAssets(userId)).map((as) => [as.id, as.name]))
        return ok(
          operations.map((o) => ({
            id: o.id,
            date: o.operatedOn,
            type: o.type,
            asset: o.assetId ? assets.get(o.assetId) : undefined,
            quantity: o.quantity ?? undefined,
            amount: Number(o.amount),
            note: o.note ?? undefined,
          })),
        )
      }),
  )

  server.registerTool(
    'fix_investment_operation',
    {
      description:
        'Corrects or deletes an operation already declared: a mistyped amount, a wrong quantity, the wrong date or the wrong account. This matters more than it looks: the amount feeds the weighted average cost, so a wrong one misstates the holding for as long as it is held. What cannot be corrected is the type (a purchase is not a sale) and the asset: those are a deletion and a new declaration, because that is what happened. Get the id from list_investment_operations, never from an older answer. A change that would leave a sale selling more than was held at the time is refused: correct the sale first.',
      inputSchema: z.object({
        operationId: z.string().describe('Id from list_investment_operations'),
        action: z.enum(['correct', 'delete']),
        account: z.string().optional().describe('correct: move it to another investment account, by name'),
        date: isoDate.optional().describe('correct: the day it really happened'),
        quantity: z.number().positive().optional().describe('correct: buy/sell only'),
        amount: z
          .number()
          .positive()
          .optional()
          .describe('correct: what really left or entered the account. This or unitPrice, never both'),
        unitPrice: z
          .number()
          .positive()
          .optional()
          .describe(
            "correct: the price of one unit, a broker's average acquisition price. The total is recomputed from the quantity, so this is the field to use when the user corrects a price a share",
          ),
        note: z.string().optional().describe('correct: "none" clears it'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'delete') {
          await deleteOperation(userId, a.operationId)
          return ok({ deleted: a.operationId })
        }
        const account = a.account ? await requireAccountByName(userId, a.account) : undefined
        const corrected = await correctOperation(userId, a.operationId, {
          accountId: account?.id,
          quantity: a.quantity,
          amount: a.amount,
          unitPrice: a.unitPrice,
          operatedOn: a.date,
          note: clearable(a.note),
        })
        return ok({
          id: corrected.id,
          date: corrected.operatedOn,
          type: corrected.type,
          quantity: corrected.quantity ?? undefined,
          amount: Number(corrected.amount),
        })
      }),
  )

  server.registerTool(
    'list_instrument_venues',
    {
      description:
        "Every venue quoting one fund, with its ticker, its place, its currency and its price. search_instruments returns one entry per fund and picks a euro line itself, which is right almost always: the same ETF quoted in Amsterdam, Milan and Frankfurt differs by about 0,01 %. Use this when that choice has to be checked or changed: the user reads a price that does not match, names a ticker that is not the one retained, or holds the line of a venue quoting in another currency. Pass the fund's exact name as search_instruments returned it. A foreign venue is holdable (its price converts to euros); only a venue whose price could not be read is marked unavailable.",
      inputSchema: z.object({
        fund: z.string().describe("The fund's exact name, as search_instruments returned it"),
      }),
    },
    async (a) =>
      run(async () => {
        const venues = await listVenues(a.fund)
        if (venues.length === 0)
          return fail(
            `No venue found for "${a.fund}". The name has to be the exact one search_instruments returned, not a shortened version.`,
          )
        return ok(
          venues.map((venue) => ({
            reference: venue.reference,
            venue: venue.venue ?? undefined,
            price: venue.price ? Number(venue.price) : undefined,
            currency: venue.currency ?? undefined,
            unavailable: venue.available ? undefined : `priced in ${venue.currency}, not holdable yet`,
          })),
        )
      }),
  )
}
