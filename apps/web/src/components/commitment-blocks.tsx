import type { Commitment, PeriodUnit } from '@abacus/core/domain'
import type { FinancingProgress, PendingOccurrence } from '@abacus/core/services/commitments'
import { monthlyEquivalent } from '@abacus/core/services/commitments'
import { AmountInput } from '@/components/amount-input'
import { JudgmentSelect } from '@/components/commitment-forms'
import { Rows } from '@/components/page-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  cancelCommitmentAction,
  changePriceAction,
  confirmOccurrenceAction,
  skipOccurrenceAction,
} from '@/lib/actions'
import { cn, eur, frDate } from '@/lib/utils'

const UNIT: Record<PeriodUnit, string> = { week: 'semaine', month: 'mois', year: 'an' }

const JUDGMENT = {
  essential: { label: 'essentiel', variant: 'secondary' as const },
  reducible: { label: 'réductible', variant: 'outline' as const },
  to_cancel: { label: 'à résilier', variant: 'default' as const },
}

export type CommitmentWithProgress = Commitment & { progress: FinancingProgress | null }

/**
 * Expected occurrences awaiting a decision. Confirming writes the real
 * movement and moves the commitment forward; the amount stays editable
 * because a silent price rise is exactly what this screen is here to catch.
 */
export function PendingOccurrences({
  pending,
  retour,
}: {
  pending: PendingOccurrence[]
  /** Where a failed action should come back to, with its message. */
  retour: string
}) {
  return (
    <Rows>
      {pending.map((p) => (
        <div key={`${p.commitment.id}-${p.dueOn}`} className="flex flex-wrap items-center gap-2 py-2.5">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">{p.commitment.label}</p>
            <p className="text-[11px] text-faint">
              attendu le {frDate(p.dueOn)} ·{' '}
              {p.commitment.direction === 'incoming' ? 'entrée' : 'prélèvement'} de{' '}
              {eur(Number(p.commitment.amount), 2)}
            </p>
          </div>
          <form action={confirmOccurrenceAction} className="ml-auto flex items-center gap-2">
            <input type="hidden" name="commitmentId" value={p.commitment.id} />
            <input type="hidden" name="retour" value={retour} />
            <AmountInput
              name="amount"
              defaultValue={Number(p.commitment.amount).toFixed(2)}
              className="h-7 w-24 text-[12.5px]"
              aria-label="Montant réel"
            />
            <Button size="sm" type="submit" className="h-7">
              Confirmer
            </Button>
          </form>
          <form action={skipOccurrenceAction}>
            <input type="hidden" name="commitmentId" value={p.commitment.id} />
            <input type="hidden" name="retour" value={retour} />
            <Button variant="ghost" size="sm" type="submit" className="h-7 text-muted-foreground">
              Passer
            </Button>
          </form>
        </div>
      ))}
    </Rows>
  )
}

/** One recurring commitment, with the actions that change its life cycle. */
export function CommitmentRow({
  commitment: c,
  retour,
  showJudgment,
}: {
  commitment: CommitmentWithProgress
  retour: string
  showJudgment: boolean
}) {
  const incoming = c.direction === 'incoming'
  const financing = c.kind === 'financing'
  return (
    <div className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-[13px] font-medium">{c.label}</p>
        {showJudgment && c.judgment && (
          <Badge variant={JUDGMENT[c.judgment].variant}>{JUDGMENT[c.judgment].label}</Badge>
        )}
        <span
          className={`ml-auto font-mono text-[13px] font-semibold tabular ${incoming ? 'text-good' : ''}`}
        >
          {incoming ? '+' : '−'}
          {eur(Number(c.amount), 2)}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11.5px] text-faint">
        <span>
          par {c.periodCount > 1 ? `${c.periodCount} ` : ''}
          {UNIT[c.periodUnit]}
          {c.periodUnit !== 'month' && ` · ≈ ${eur(monthlyEquivalent(c), 2)}/mois`}
        </span>
        <span>prochaine le {frDate(c.nextDueOn)}</span>
        {financing && c.progress && (
          <span>
            {c.progress.paidInstallments}/{c.installmentsTotal} échéances · reste{' '}
            <span className="font-mono text-muted-foreground tabular">{eur(c.progress.remainingDue)}</span>
          </span>
        )}
      </div>

      <div className={cn('flex flex-wrap items-center gap-2', financing && '-mt-7 justify-end')}>
        {showJudgment && <JudgmentSelect commitmentId={c.id} value={c.judgment} />}
        {!financing && (
          <form action={changePriceAction} className="flex items-center gap-1.5">
            <input type="hidden" name="commitmentId" value={c.id} />
            <input type="hidden" name="retour" value={retour} />
            <AmountInput
              name="amount"
              placeholder={incoming ? 'Nouveau montant' : 'Nouveau prix'}
              className="h-7 w-32 text-[12px]"
              aria-label="Nouveau montant"
            />
            <Button variant="outline" size="sm" type="submit" className="h-7 text-[12px]">
              Changer
            </Button>
            <span className="text-[10.5px] text-faint">historisé, pour voir les hausses</span>
          </form>
        )}
        <form action={cancelCommitmentAction} className="ml-auto">
          <input type="hidden" name="commitmentId" value={c.id} />
          <input type="hidden" name="retour" value={retour} />
          <Button
            variant="ghost"
            size="sm"
            type="submit"
            className="h-7 text-[12px] text-muted-foreground hover:text-destructive"
          >
            {financing ? 'Clore' : incoming ? 'Arrêter' : 'Résilier'}
          </Button>
        </form>
      </div>
    </div>
  )
}
