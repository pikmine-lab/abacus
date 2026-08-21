import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listAssets, listOperations, portfolio } from '@abacus/core/services/investments'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { EntrySheet } from '@/components/entry-sheet'
import { type AssetEntry, AssetForm, AssetRows, OperationForm } from '@/components/investment-forms'
import { EmptyLine, PageBody, PageHeader, Rows, Section } from '@/components/page-shell'
import { StatRow, StatTile } from '@/components/stats'
import { eur } from '@/lib/utils'

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

export default async function InvestmentsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id

  const [accounts, held, assets, operations] = await Promise.all([
    listAccounts(userId),
    portfolio(userId),
    listAssets(userId),
    listOperations(userId),
  ])
  const investmentAccounts = accounts.filter((a) => a.behavior === 'investment' && !a.closedOn)
  const assetNames = new Map(assets.map((a) => [a.id, a.name]))

  const costBasis = held.reduce((sum, h) => sum + Number(h.costBasis), 0)
  const cash = held.reduce((sum, h) => sum + Number(h.cash), 0)
  const positionCount = held.reduce((sum, h) => sum + h.positions.length, 0)

  const assetEntries: AssetEntry[] = assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    pricing: asset.instrument ? `${asset.instrument.priceSource} · ${asset.instrument.priceSourceRef}` : null,
  }))

  const entry = (
    <>
      <EntrySheet
        label="Actif"
        title="Ce que tu détiens"
        description="Un actif coté porte la référence de sa source de cours. Sans source, son cours se saisit à la main."
        variant="outline"
      >
        <AssetForm />
      </EntrySheet>
      <EntrySheet
        label="Déclarer une opération"
        title="Opération"
        description="Ce qui se passe dans le compte. Alimenter le compte ou en sortir de l’argent est un virement, à déclarer dans les mouvements."
      >
        <OperationForm
          accounts={investmentAccounts.map((a) => ({ id: a.id, name: a.name }))}
          assets={assets.map((a) => ({ id: a.id, name: a.name }))}
          today={today()}
        />
      </EntrySheet>
    </>
  )

  return (
    <>
      <PageHeader
        title="Placements"
        description="quantités et prix de revient ; la valorisation arrive avec les cours"
      >
        {investmentAccounts.length > 0 && assets.length > 0 && entry}
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
        ) : assets.length === 0 ? (
          <Section title="Ce que tu détiens" description="rien encore" action={entry}>
            <EmptyLine>
              Déclare d’abord un actif (un ETF, une action, une crypto), puis les opérations qui l’ont acheté.
            </EmptyLine>
          </Section>
        ) : (
          <>
            <StatRow>
              <StatTile
                hero
                label="Prix de revient"
                value={eur(costBasis)}
                hint={`${positionCount} position${positionCount > 1 ? 's' : ''}, frais d’ordre compris`}
              />
              <StatTile
                label="Espèces"
                value={eur(cash)}
                // Negative cash is not a holding, it is a missing declaration:
                // an operation went in without the transfer that funded it.
                hint={cash < 0 ? 'un virement d’alimentation manque' : 'non investi, sur les comptes'}
              />
            </StatRow>

            {held.map(({ account, positions, cash: accountCash, costBasis: accountCost }) => (
              <Section
                key={account.id}
                title={account.name}
                description={`${eur(Number(accountCost), 2)} investis · ${
                  Number(accountCash) < 0
                    ? `${eur(-Number(accountCash), 2)} à alimenter`
                    : `${eur(Number(accountCash), 2)} en espèces`
                }`}
              >
                {positions.length === 0 ? (
                  <EmptyLine>Aucune position : rien n’a encore été acheté sur ce compte.</EmptyLine>
                ) : (
                  <Rows>
                    <div className="flex items-center gap-3 py-1.5 text-[11px] text-faint">
                      <span className="min-w-0 flex-1">Actif</span>
                      <span className="w-24 text-right">Quantité</span>
                      <span className="w-24 text-right">PRU</span>
                      <span className="w-28 text-right">Prix de revient</span>
                    </div>
                    {positions.map((position) => (
                      <div key={position.assetId} className="flex items-center gap-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">{position.assetName}</span>
                        <span className="tabular w-24 text-right text-[12.5px]">
                          {quantity(position.quantity)}
                        </span>
                        <span className="tabular w-24 text-right text-[12.5px] text-muted-foreground">
                          {eur(Number(position.averageCost), 2)}
                        </span>
                        <span className="tabular w-28 text-right text-[12.5px]">
                          {eur(Number(position.costBasis), 2)}
                        </span>
                      </div>
                    ))}
                  </Rows>
                )}
              </Section>
            ))}

            <Section title="Ce que tu détiens" description="et d’où viendra son cours">
              <AssetRows assets={assetEntries} />
            </Section>

            <Section title="Opérations" description="les 30 dernières">
              {operations.length === 0 ? (
                <EmptyLine>Rien de déclaré pour l’instant.</EmptyLine>
              ) : (
                <Rows>
                  {operations.slice(0, 30).map((operation) => (
                    <div key={operation.id} className="flex items-center gap-3 py-2">
                      <span className="tabular w-20 shrink-0 text-[11.5px] text-faint">
                        {operation.operatedOn.slice(8, 10)}/{operation.operatedOn.slice(5, 7)}/
                        {operation.operatedOn.slice(2, 4)}
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
                      <span className="tabular w-24 text-right text-[12.5px]">
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
