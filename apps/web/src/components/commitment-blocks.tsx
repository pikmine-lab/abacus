import type { CommitmentReserve } from '@abacus/core/domain'
import type { CommitmentWithEur, FinancingProgress } from '@abacus/core/services/commitments'
import { monthlyEquivalentEur } from '@abacus/core/services/commitments'
import { useTranslations } from 'next-intl'
import { type CommitmentOptions, JudgmentSelect } from '@/components/commitment-forms'
import { CommitmentRowActions } from '@/components/commitment-row-actions'
import type { ScheduleLine } from '@/components/financing-schedule-form'
import type { PlacementOptions } from '@/components/investment-plan-forms'
import { ProgressRing } from '@/components/progress-ring'
import { Badge } from '@/components/ui/badge'
import { useFormat } from '@/lib/format'

const JUDGMENT_VARIANT = {
  essential: 'secondary' as const,
  reducible: 'outline' as const,
  to_cancel: 'default' as const,
}

export type CommitmentWithProgress = CommitmentWithEur & {
  progress: FinancingProgress | null
  /** Money received for it, and what its occurrences drew. */
  reserve: CommitmentReserve | null
}

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
  const t = useTranslations('recurring')
  const format = useFormat()
  const incoming = c.direction === 'incoming'
  const financing = c.kind === 'financing'
  const plan = c.kind === 'investment_plan'
  const foreign = c.currency !== 'EUR'
  // Amounts read in the billing currency; only the monthly hint converts.
  const inCurrency = (value: number, decimals = 0) =>
    foreign ? format.money(value, c.currency, decimals) : format.eur(value, decimals)
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
    accountId: c.accountId,
    cardId: c.cardId ?? undefined,
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
            <Badge variant={JUDGMENT_VARIANT[c.judgment]}>{t(`judgments.${c.judgment}`)}</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px] text-faint">
          <span>
            {t('row.perPeriod', { unit: c.periodUnit, count: c.periodCount })}
            {(c.periodUnit !== 'month' || foreign) &&
              c.amountEur !== null &&
              ` · ${t('monthlyApprox', { amount: format.eur(monthlyEquivalentEur(c), 2) })}`}
          </span>
          <span>{t('nextOn', { date: format.date(c.nextDueOn) })}</span>
          {/* A move already declared: the only place it shows before its date. */}
          {c.nextAccountMove && (
            <span>
              {t('movesTo', {
                account: accountName(c.nextAccountMove.accountId),
                date: format.date(c.nextAccountMove.effectiveOn),
              })}
            </span>
          )}
          {financing && c.progress && (
            <span>
              {t.rich('row.progress', {
                paid: c.progress.paidInstallments,
                count: c.installmentsTotal ?? 0,
                remaining: inCurrency(c.progress.remainingDue),
                total: inCurrency(Number(c.totalAmount)),
                amount: (chunks) => <span className="font-mono text-muted-foreground tabular">{chunks}</span>,
              })}
            </span>
          )}
          {/* Where the money goes and what it buys: the two facts that make a
              placement readable, and that no amount can say. */}
          {plan && placement && (
            <span>
              {t('row.placement', {
                account: accountName(c.targetAccountId ?? ''),
                asset: placement.assetName,
              })}
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
