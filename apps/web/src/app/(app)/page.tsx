import { auth } from '@abacus/core/auth'
import { listAccounts } from '@abacus/core/services/accounts'
import { latestCheck } from '@abacus/core/services/balanceChecks'
import {
  listCommitmentsWithProgress,
  monthlyEquivalent,
  pendingOccurrences,
} from '@abacus/core/services/commitments'
import { outstandingAdvances } from '@abacus/core/services/movements'
import { balanceSeries, spendingBreakdown } from '@abacus/core/services/reports'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { BalanceChart } from '@/components/balance-chart'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { eur } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const CAT_COLORS = ['--cat0', '--cat1', '--cat2', '--cat3', '--cat4', '--cat5', '--cat6']
function frDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y!.slice(2)}`
}

const JUDGMENT = {
  essential: { label: 'essentiel', variant: 'secondary' as const },
  reducible: { label: 'réductible', variant: 'outline' as const },
  to_cancel: { label: 'à résilier', variant: 'default' as const },
}

function monthRange(): { from: string; to: string; label: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const label = now.toLocaleDateString('fr-FR', { month: 'long' })
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}`, label }
}

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id

  const { from, to, label: monthLabel } = monthRange()
  const yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10)
  const [accounts, pending, advances, commitments, breakdown, series] = await Promise.all([
    listAccounts(userId),
    pendingOccurrences(userId),
    outstandingAdvances(userId),
    listCommitmentsWithProgress(userId),
    spendingBreakdown(userId, from, to, 'category'),
    balanceSeries(userId, yearAgo, to),
  ])

  const patrimoine = accounts.reduce((sum, a) => sum + Number(a.balance), 0)
  const spentGross = breakdown.reduce((sum, r) => sum + Number(r.gross), 0)
  const spentNet = breakdown.reduce((sum, r) => sum + Number(r.net), 0)
  const active = commitments.filter((c) => !c.cancelledOn)
  const monthlyCost = active
    .filter((c) => c.direction === 'outgoing')
    .reduce((sum, c) => sum + monthlyEquivalent(c), 0)
  const claims = advances.reduce((sum, a) => sum + Number(a.amount) - Number(a.refunded), 0)
  const checks = await Promise.all(accounts.map((a) => latestCheck(userId, a.id)))
  const maxGross = Math.max(...breakdown.map((r) => Number(r.gross)), 1)
  const subscriptions = active.filter((c) => c.kind === 'subscription' && c.direction === 'outgoing')
  const financings = active.filter((c) => c.kind === 'financing')

  if (accounts.length === 0) {
    return (
      <main className="mx-auto mt-16 max-w-md text-center">
        <p className="font-mono text-2xl">🧮</p>
        <h1 className="mt-3 text-lg font-semibold">Bienvenue sur abacus</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tout commence par tes comptes bancaires. Déclare-les via l’interface MCP (Claude), ou attends
          l’écran de gestion des comptes, qui arrive bientôt ici.
        </p>
      </main>
    )
  }

  return (
    <main className="flex flex-col gap-3">
      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">Patrimoine total</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">{eur(patrimoine)}</p>
            <p className="mt-1 text-xs text-faint">{accounts.length} comptes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">Dépensé en {monthLabel}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">{eur(spentNet)}</p>
            <p className="mt-1 text-xs text-faint">
              {spentNet !== spentGross ? `brut ${eur(spentGross)}` : 'net = brut'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">Récurrent mensuel</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">{eur(monthlyCost, 2)}</p>
            <p className="mt-1 text-xs text-faint">
              {subscriptions.length} abonnement{subscriptions.length > 1 ? 's' : ''}
              {financings.length > 0
                ? ` + ${financings.length} financement${financings.length > 1 ? 's' : ''}`
                : ''}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs text-muted-foreground">Créances en cours</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">{eur(claims)}</p>
            <p className="mt-1 text-xs text-faint">
              {advances.length > 0
                ? `${advances.length} avance${advances.length > 1 ? 's' : ''}`
                : 'rien à réclamer'}
            </p>
          </CardContent>
        </Card>
      </section>

      <BalanceChart
        accounts={accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name }))}
        rows={series.map((r) => ({ day: r.day, accountId: r.accountId, balance: Number(r.balance) }))}
      />

      {/* Accounts + pending occurrences */}
      <section className="grid gap-3 lg:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Comptes</CardTitle>
            <CardDescription>solde calculé · fraîcheur du dernier pointage</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col">
            {accounts.map((account, i) => {
              const check = checks[i]
              return (
                <div
                  key={account.id}
                  className="flex items-baseline gap-3 border-b border-grid py-2.5 last:border-b-0"
                >
                  <span className="text-sm font-medium">{account.name}</span>
                  <span className="hidden text-xs text-faint sm:inline">
                    {check
                      ? check.gap === 0
                        ? `pointé le ${frDate(check.check.checkedOn)}`
                        : `écart de ${eur(check.gap, 2)} au ${frDate(check.check.checkedOn)}`
                      : 'jamais pointé'}
                  </span>
                  <span className="ml-auto font-mono text-sm font-semibold tabular-nums">
                    {eur(Number(account.balance), 2)}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Échéances à confirmer</CardTitle>
            <CardDescription>attendues à ce jour</CardDescription>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <p className="mt-1 text-sm text-faint">Rien en attente : tout est à jour.</p>
            ) : (
              <div className="flex flex-col">
                {pending.map((p) => (
                  <div
                    key={`${p.commitment.id}-${p.dueOn}`}
                    className="flex items-baseline gap-3 border-b border-grid py-2.5 last:border-b-0"
                  >
                    <span className="text-sm">{p.commitment.label}</span>
                    <span className="text-xs text-faint">{frDate(p.dueOn)}</span>
                    <span className="ml-auto font-mono text-sm tabular-nums">
                      {p.commitment.direction === 'incoming' ? '+' : '−'}
                      {eur(Number(p.commitment.amount), 2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Spending by category + subscriptions */}
      <section className="grid gap-3 lg:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Dépenses par catégorie</CardTitle>
            <CardDescription>
              {monthLabel} · brut {eur(spentGross)}
              {spentNet !== spentGross ? ` · net ${eur(spentNet)} après remboursements` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {breakdown.length === 0 ? (
              <p className="mt-1 text-sm text-faint">Aucune dépense déclarée ce mois-ci.</p>
            ) : (
              <div className="mt-1 flex flex-col gap-2.5">
                {breakdown.map((row, i) => (
                  <div
                    key={row.label ?? 'none'}
                    className="grid grid-cols-[88px_1fr_72px] items-center gap-2 sm:grid-cols-[112px_1fr_84px] sm:gap-3"
                  >
                    <span className="truncate text-right text-xs text-muted-foreground sm:text-[12.5px]">
                      {row.label ?? '(sans)'}
                    </span>
                    <span className="relative flex h-5 items-center border-l border-border">
                      <span
                        className="h-3.5 min-w-0.5 rounded-r"
                        style={{
                          width: `${(Number(row.gross) / maxGross) * 100}%`,
                          background: `var(${CAT_COLORS[i % CAT_COLORS.length]})`,
                        }}
                      />
                    </span>
                    <span className="text-right font-mono text-xs font-semibold tabular-nums">
                      {eur(Number(row.gross))}
                      {row.net !== row.gross && (
                        <span className="block font-normal text-faint">net {eur(Number(row.net))}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Abonnements</CardTitle>
            <CardDescription>
              {subscriptions.length} actif{subscriptions.length > 1 ? 's' : ''}
              {financings.length > 0
                ? ` · ${financings.length} financement${financings.length > 1 ? 's' : ''} en cours`
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col">
            {subscriptions.length === 0 && financings.length === 0 && (
              <p className="mt-1 text-sm text-faint">Aucun engagement déclaré.</p>
            )}
            {subscriptions.map((sub) => (
              <div
                key={sub.id}
                className="flex items-center gap-2 border-b border-grid py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{sub.label}</p>
                  <p className="text-[11px] text-faint">échéance {frDate(sub.nextDueOn)}</p>
                </div>
                {sub.judgment && (
                  <Badge variant={JUDGMENT[sub.judgment].variant}>{JUDGMENT[sub.judgment].label}</Badge>
                )}
                <span className="ml-auto font-mono text-sm font-semibold tabular-nums">
                  {eur(Number(sub.amount), 2)}
                </span>
              </div>
            ))}
            {financings.map((fin) => (
              <div
                key={fin.id}
                className="flex items-center gap-2 border-b border-grid py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{fin.label}</p>
                  <p className="text-[11px] text-faint">
                    {fin.progress?.paidInstallments}/{fin.installmentsTotal} · reste{' '}
                    {eur(fin.progress?.remainingDue ?? 0)}
                  </p>
                </div>
                <span className="ml-auto font-mono text-sm font-semibold tabular-nums">
                  {eur(Number(fin.amount), 2)}
                </span>
              </div>
            ))}
            {(subscriptions.length > 0 || financings.length > 0) && (
              <div className="flex pt-3 text-xs text-muted-foreground">
                Coût récurrent mensuel engagé
                <span className="ml-auto font-mono font-semibold text-foreground tabular-nums">
                  {eur(monthlyCost, 2)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
