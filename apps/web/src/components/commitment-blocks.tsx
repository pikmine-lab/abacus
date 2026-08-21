import type { Commitment, PeriodUnit } from '@abacus/core/domain'
import type { FinancingProgress } from '@abacus/core/services/commitments'
import { monthlyEquivalent } from '@abacus/core/services/commitments'
import { type CommitmentOptions, JudgmentSelect } from '@/components/commitment-forms'
import { CommitmentRowActions } from '@/components/commitment-row-actions'
import type { ScheduleLine } from '@/components/financing-schedule-form'
import { ProgressRing } from '@/components/progress-ring'
import { Badge } from '@/components/ui/badge'
import { eur, frDate } from '@/lib/utils'

const UNIT: Record<PeriodUnit, string> = { week: 'semaine', month: 'mois', year: 'an' }

const JUDGMENT = {
  essential: { label: 'essentiel', variant: 'secondary' as const },
  reducible: { label: 'réductible', variant: 'outline' as const },
  to_cancel: { label: 'à résilier', variant: 'default' as const },
}

export type CommitmentWithProgress = Commitment & { progress: FinancingProgress | null }

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
}: {
  commitment: CommitmentWithProgress
  showJudgment: boolean
  /** Financings only: the written plan, revised from the row's menu. */
  schedule?: ScheduleLine[]
  today?: string
  /** References the row's correction panel offers; without them, no panel. */
  options?: CommitmentOptions
}) {
  const incoming = c.direction === 'incoming'
  const financing = c.kind === 'financing'
  // The actor field is a name (it autocompletes on existing ones), so the row
  // resolves it from the list it was handed.
  const defaults = options && {
    actor: options.actors.find((a) => a.id === c.actorId)?.name ?? '',
    accountId: c.accountId,
    categoryId: c.categoryId ?? '',
    periodUnit: c.periodUnit,
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
            {c.periodUnit !== 'month' && ` · ≈ ${eur(monthlyEquivalent(c), 2)}/mois`}
          </span>
          <span>prochaine le {frDate(c.nextDueOn)}</span>
          {financing && c.progress && (
            <span>
              {c.progress.paidInstallments}/{c.installmentsTotal} payées · reste{' '}
              <span className="font-mono text-muted-foreground tabular">{eur(c.progress.remainingDue)}</span>{' '}
              sur {eur(Number(c.totalAmount))}
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
        {eur(Number(c.amount), 2)}
      </span>

      {showJudgment && <JudgmentSelect commitmentId={c.id} value={c.judgment} />}

      <CommitmentRowActions
        commitmentId={c.id}
        label={c.label}
        amount={Number(c.amount)}
        kind={c.kind}
        incoming={incoming}
        schedule={schedule}
        today={today}
        options={options}
        defaults={defaults}
      />
    </div>
  )
}
