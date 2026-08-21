import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import {
  assetPrices,
  listAssets,
  listOperations,
  portfolio,
  refreshQuotes,
} from '@abacus/core/services/investments'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { EntrySheet } from '@/components/entry-sheet'
import {
  type AssetEntry,
  AssetMenu,
  AssetRows,
  FollowForm,
  OperationForm,
} from '@/components/investment-forms'
import { EmptyLine, PageBody, PageHeader, Rows, Section } from '@/components/page-shell'
import { StatRow, StatTile } from '@/components/stats'
import { eur, eurSigned, frDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Placements' }

const OPERATIONS = {
  buy: 'Achat',
  sell: 'Vente',
  dividend: 'Dividende',
  fee: 'Frais',
} as const

/** Quantities are not money: they keep their own precision, trailing zeros cut. */
function quantity(value: string): string {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 8 })
}

/**
 * When the price was made, to the minute. Euronext is 15 minutes delayed at
 * best, imposed by its licence, so freshness cannot be gained: it is declared
 * instead, and a number without its hour would be read as "now".
 */
function priceStamp(at: Date | null, manual: boolean): string | null {
  if (!at) return null
  const day = at.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  if (manual) return `saisi le ${day}`
  // Bare day and hour: it sits under the name, beside the Cours column, so the
  // word "cours" would only cost the room the hour needs.
  return `${day} ${at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

export default async function InvestmentsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id

  // Prices come from the read, never from a scheduler: whoever opens this page
  // gets them as fresh as the sources allow. It never throws, and a source that
  // is down leaves the stored price in place.
  await refreshQuotes(userId)

  const [accounts, held, assets, operations, quotes] = await Promise.all([
    listAccounts(userId),
    portfolio(userId),
    listAssets(userId),
    listOperations(userId),
    assetPrices(userId),
  ])
  const investmentAccounts = accounts.filter((a) => a.behavior === 'investment' && !a.closedOn)
  const assetNames = new Map(assets.map((a) => [a.id, a.name]))

  const value = held.reduce((sum, h) => sum + Number(h.value), 0)
  const cash = held.reduce((sum, h) => sum + Number(h.cash), 0)
  const costBasis = held.reduce((sum, h) => sum + Number(h.costBasis), 0)
  const unpriced = held.reduce((sum, h) => sum + h.unpriced, 0)
  const positionCount = held.reduce((sum, h) => sum + h.positions.length, 0)
  // Only whole when every position has a price: a partial one would understate
  // the account, which is worse than saying nothing.
  const complete = held.every((h) => h.totalReturn !== null)
  const totalReturn = complete ? held.reduce((sum, h) => sum + Number(h.totalReturn), 0) : null
  const contributions = held.reduce((sum, h) => sum + Number(h.netContributions), 0)
  const unrealized = value - cash - costBasis

  // Followed, not held: an asset with no position is one being watched. That is
  // the whole mechanism, and it needs no flag of its own.
  const holdingIds = new Set(held.flatMap((h) => h.positions.map((p) => p.assetId)))
  const assetEntries: AssetEntry[] = assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    pricing: asset.instrument ? `${asset.instrument.priceSource} · ${asset.instrument.priceSourceRef}` : null,
    isin: asset.instrument?.isin ?? null,
    followed: !holdingIds.has(asset.id),
  }))
  const followed = assetEntries
    .filter((a) => a.followed)
    .map((a) => ({ ...a, price: quotes.get(a.id) ?? null }))

  const entry = (
    <>
      <EntrySheet
        label="Suivre"
        title="Suivre un actif"
        description="Sans le détenir : son cours s’affichera, et le jour où tu en achètes il devient une position."
        variant="outline"
      >
        <FollowForm />
      </EntrySheet>
      <EntrySheet
        label="Déclarer une opération"
        title="Opération"
        description="Ce qui se passe dans le compte. Alimenter le compte ou en sortir de l’argent est un virement, à déclarer dans les mouvements."
      >
        <OperationForm
          accounts={investmentAccounts.map((a) => ({ id: a.id, name: a.name }))}
          assets={assetEntries}
          today={today()}
        />
      </EntrySheet>
    </>
  )

  return (
    <>
      <PageHeader title="Placements" description="ce que tu détiens, et ce que ça vaut">
        {investmentAccounts.length > 0 && entry}
      </PageHeader>

      <PageBody>
        {investmentAccounts.length === 0 ? (
          <EmptyLine>
            Aucun compte d’investissement. Crée-le dans{' '}
            <Link href="/accounts" className="text-primary hover:underline">
              Comptes
            </Link>
            , puis déclare ici ce que tu y détiens.
          </EmptyLine>
        ) : operations.length === 0 && assets.length === 0 ? (
          // One line, and the two panels the header already carries: a title, a
          // description and a sentence all saying "nothing yet" said it thrice.
          <EmptyLine>
            Déclare ton premier achat : le panneau cherche l’ETF, l’action ou la crypto par son nom, son ISIN
            ou son fournisseur.
          </EmptyLine>
        ) : (
          <>
            <StatRow>
              <StatTile
                hero
                label="Valorisation"
                value={eur(value)}
                hint={
                  unpriced > 0
                    ? `espèces + positions cotées ; ${unpriced} sans cours`
                    : 'espèces + positions au dernier cours'
                }
                delta={positionCount > 0 ? { value: unrealized, label: 'de plus-value latente' } : undefined}
              />
              <StatTile
                label="Performance"
                value={totalReturn === null ? '—' : eurSigned(totalReturn)}
                // The method is the number: what it includes, and what it is
                // measured against. Naming the contributions is what makes it
                // checkable by hand.
                hint={
                  totalReturn === null
                    ? 'un cours manque : le calcul serait sous-estimé'
                    : `dividendes et frais compris, contre ${eur(contributions)} d’apports`
                }
              />
            </StatRow>

            {held.map(({ account, positions, cash: accountCash, value: accountValue }) => (
              <Section
                key={account.id}
                title={account.name}
                description={`${eur(Number(accountValue), 2)} · ${
                  Number(accountCash) < 0
                    ? `${eur(-Number(accountCash), 2)} à alimenter`
                    : `${eur(Number(accountCash), 2)} en espèces`
                }`}
              >
                {positions.length === 0 ? (
                  <EmptyLine>Aucune position : rien n’a encore été acheté sur ce compte.</EmptyLine>
                ) : (
                  <div className="overflow-x-auto">
                    {/* Five columns, not six: the average cost and the hour of
                        the price ride under the name, so the two numbers being
                        looked for (what it is worth, what it made) are the ones
                        that always fit. */}
                    <Rows className="min-w-[30rem]">
                      <div className="flex items-center gap-3 py-1.5 text-[11px] text-faint">
                        <span className="min-w-0 flex-1">Actif</span>
                        <span className="w-14 text-right">Quantité</span>
                        <span className="w-[4.5rem] text-right">Cours</span>
                        <span className="w-[5.5rem] text-right">Valorisation</span>
                        <span className="w-[5.5rem] text-right">+/− value</span>
                        <span className="w-7" />
                      </div>
                      {positions.map((position) => {
                        const stamp = priceStamp(position.pricedAt, position.manualPrice)
                        const gain = position.gain === null ? null : Number(position.gain)
                        return (
                          <div key={position.assetId} className="flex items-center gap-3 py-2">
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="truncate text-[12.5px]">{position.assetName}</span>
                              <span className="truncate text-[11px] text-faint">
                                PRU {eur(Number(position.averageCost), 2)}
                                {stamp ? ` · ${stamp}` : ' · aucun cours connu'}
                              </span>
                            </span>
                            <span className="tabular w-14 text-right text-[12.5px]">
                              {quantity(position.quantity)}
                            </span>
                            <span className="tabular w-[4.5rem] text-right text-[12.5px] text-muted-foreground">
                              {position.price === null ? '—' : eur(Number(position.price), 2)}
                            </span>
                            <span className="tabular w-[5.5rem] text-right text-[12.5px]">
                              {position.value === null ? '—' : eur(Number(position.value), 2)}
                            </span>
                            <span
                              className={`tabular w-[5.5rem] text-right text-[12.5px] ${
                                gain === null ? 'text-faint' : gain >= 0 ? 'text-good' : 'text-destructive'
                              }`}
                            >
                              {/* The arrow carries the direction; color reinforces it. */}
                              {gain === null ? '—' : `${gain >= 0 ? '↑' : '↓'} ${eurSigned(gain, 2)}`}
                            </span>
                            <AssetMenu id={position.assetId} name={position.assetName} />
                          </div>
                        )
                      })}
                    </Rows>
                  </div>
                )}
              </Section>
            ))}

            {followed.length > 0 && (
              <Section title="Suivis" description="pas encore détenus">
                <AssetRows assets={followed} />
              </Section>
            )}

            <Section title="Opérations" description="les 30 dernières">
              {operations.length === 0 ? (
                <EmptyLine>Rien de déclaré pour l’instant.</EmptyLine>
              ) : (
                <Rows>
                  {operations.slice(0, 30).map((operation) => (
                    <div key={operation.id} className="flex items-center gap-3 py-2">
                      <span className="tabular w-20 shrink-0 text-[11.5px] text-faint">
                        {frDate(operation.operatedOn)}
                      </span>
                      <span className="w-20 shrink-0 text-[12px] text-muted-foreground">
                        {OPERATIONS[operation.type]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">
                        {operation.assetId ? assetNames.get(operation.assetId) : 'frais de compte'}
                        {operation.note && <span className="text-faint"> · {operation.note}</span>}
                      </span>
                      {operation.quantity && (
                        <span className="tabular w-20 text-right text-[11.5px] text-faint">
                          {quantity(operation.quantity)}
                        </span>
                      )}
                      <span className="tabular w-[5.5rem] text-right text-[12.5px]">
                        {eur(Number(operation.amount), 2)}
                      </span>
                    </div>
                  ))}
                </Rows>
              )}
            </Section>
          </>
        )}
      </PageBody>
    </>
  )
}
