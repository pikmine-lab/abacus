import type { PeriodUnit } from '@abacus/core/domain'
import type { CommitmentWithEur, FinancingProgress } from '@abacus/core/services/commitments'
import { monthlyEquivalentEur } from '@abacus/core/services/commitments'
import { type CommitmentOptions, JudgmentSelect } from '@/components/commitment-forms'
import { CommitmentRowActions } from '@/components/commitment-row-actions'
import type { ScheduleLine } from '@/components/financing-schedule-form'
import type { PlacementOptions } from '@/components/investment-plan-forms'
import { ProgressRing } from '@/components/progress-ring'
import { Badge } from '@/components/ui/badge'
import { eur, frDate, money } from '@/lib/utils'

const UNIT: Record<PeriodUnit, string> = { week: 'semaine', month: 'mois', year: 'an' }

const JUDGMENT = {
  essential: { label: 'essentiel', variant: 'secondary' as const },
  reducible: { label: 'réductible', variant: 'outline' as const },
  to_cancel: { label: 'à résilier', variant: 'default' as const },
}

export type CommitmentWithProgress = CommitmentWithEur & { progress: FinancingProgress | null }

/**
 * One recurring commitment. The row is something to read: what it costs, when
 * it falls next, how far a plan has run, and its actions live in the menu at
 * the end rather than spread across it.
 *
 * The judgment stays in the row because it is an attribute, not an action, and
 * changing it in one gesture is the whole point of the "what do I cut?" review.
 */
export function CommitmentRow({
  commitment: c,
  showJudgment,
  schedule,
  today,
  options,
  placement,
}: {
  commitment: CommitmentWithProgress
  showJudgment: boolean
  /** Financings only: the written plan, revised from the row's menu. */
  schedule?: ScheduleLine[]
  today?: string
  /** References the row's correction panel offers; without them, no panel. */
  options?: CommitmentOptions
  /**
   * Investment plans only: what the row says beyond the amount (where it goes,
   * what it buys) and what its own correction panel needs.
   */
  placement?: { options: PlacementOptions; assetName: string }
}) {
  const incoming = c.direction === 'incoming'
  const financing = c.kind === 'financing'
  const plan = c.kind === 'investment_plan'
  const foreign = c.currency !== 'EUR'
  // Amounts read in the billing currency; only the monthly hint converts.
  const inCurrency = (value: number, decimals = 0) =>
    foreign ? money(value, c.currency, decimals) : eur(value, decimals)
  const accountName = (id: string) => options?.accounts.find((a) => a.id === id)?.name ?? ''
  // The actor field is a name (it autocompletes on existing ones), so the row
  // resolves it from the list it was handed.
  const defaults = options && {
    actor: options.actors.find((a) => a.id === c.actorId)?.name ?? '',
    categoryId: c.categoryId ?? '',
    activityId: c.activityId ?? '',
    // The periodicity is asked as one question, so it travels as one value.
    period: `${c.periodUnit}:${c.periodCount}`,
    engagedUntil: c.engagedUntil ?? '',
  }
  return (
    <div className="flex items-center gap-3 py-3">
      {financing && c.progress && (
        <ProgressRing done={c.progress.paidInstallments} total={c.installmentsTotal ?? 0} />
      )}

      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="text-[13px] font-medium">{c.label}</p>
          {showJudgment && c.judgment && (
            <Badge variant={JUDGMENT[c.judgment].variant}>{JUDGMENT[c.judgment].label}</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px] text-faint">
          <span>
            par {c.periodCount > 1 ? `${c.periodCount} ` : ''}
            {UNIT[c.periodUnit]}
            {(c.periodUnit !== 'month' || foreign) &&
              c.amountEur !== null &&
              ` · ≈ ${eur(monthlyEquivalentEur(c), 2)}/mois`}
          </span>
          <span>prochaine le {frDate(c.nextDueOn)}</span>
          {/* A move already declared: the only place it shows before its date. */}
          {c.nextAccountMove && (
            <span>
              passe sur {accountName(c.nextAccountMove.accountId)} le {frDate(c.nextAccountMove.effectiveOn)}
            </span>
          )}
          {financing && c.progress && (
            <span>
              {c.progress.paidInstallments}/{c.installmentsTotal} payées · reste{' '}
              <span className="font-mono text-muted-foreground tabular">
                {inCurrency(c.progress.remainingDue)}
              </span>{' '}
              sur {inCurrency(Number(c.totalAmount))}
            </span>
          )}
          {/* Where the money goes and what it buys: the two facts that make a
              placement readable, and that no amount can say. */}
          {plan && placement && (
            <span>
              vers {accountName(c.targetAccountId ?? '')} · achète {placement.assetName}
            </span>
          )}
        </div>
      </div>

      <span
        className={`ml-auto shrink-0 font-mono text-[13px] font-semibold tabular ${
          incoming ? 'text-good' : ''
        }`}
      >
        {incoming ? '+' : '−'}
        {inCurrency(Number(c.amount), 2)}
      </span>

      {showJudgment && <JudgmentSelect commitmentId={c.id} value={c.judgment} />}

      <CommitmentRowActions
        commitmentId={c.id}
        label={c.label}
        amount={Number(c.amount)}
        currency={c.currency}
        kind={c.kind}
        incoming={incoming}
        accountId={c.accountId}
        accountName={accountName(c.accountId)}
        schedule={schedule}
        today={today}
        options={options}
        defaults={defaults}
        placement={
          placement && c.targetAccountId && c.assetId
            ? {
                options: placement.options,
                targetAccountId: c.targetAccountId,
                assetId: c.assetId,
              }
            : undefined
        }
      />
    </div>
  )
}
