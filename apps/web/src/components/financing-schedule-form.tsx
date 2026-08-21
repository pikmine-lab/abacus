'use client'

import { PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { ActionForm, DateField, SubmitButton } from '@/components/forms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { reviseScheduleAction } from '@/lib/actions'
import { addMonths, eur } from '@/lib/utils'

/** One installment as the panel edits it: existing (an id) or added (none). */
interface Line {
  key: string
  id: string | null
  dueOn: string
  amount: string
  paid: boolean
}

export interface ScheduleLine {
  id: string
  dueOn: string
  amount: string
  paid: boolean
}

/**
 * The plan of a financing, revised after the fact: a date pushed back, an
 * amount renegotiated, an installment added or dropped. A plan written once
 * and never correctable is worse than no plan, because the remaining due
 * derives from it.
 *
 * The whole plan is sent, not the lines that changed: the order of the rows is
 * the contractual order, and the total owed is simply their sum, which is what
 * makes a settlement or a commercial gesture expressible here.
 *
 * A paid installment stays editable, because it carries what really left the
 * account: correcting its amount corrects its movement, and removing the row
 * removes that movement. The panel says so rather than hiding the line.
 */
export function FinancingScheduleForm({
  commitmentId,
  installments,
  today,
  onDone,
}: {
  commitmentId: string
  installments: ScheduleLine[]
  /** Fallback date for a line added to an emptied plan. */
  today: string
  onDone?: () => void
}) {
  const [lines, setLines] = useState<Line[]>(() =>
    installments.map((i) => ({ key: i.id, id: i.id, dueOn: i.dueOn, amount: i.amount, paid: i.paid })),
  )
  const [added, setAdded] = useState(0)

  const update = (key: string, patch: Partial<Line>) =>
    setLines(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const cents = (amount: string) => Math.round((Number(amount) || 0) * 100)
  const total = lines.reduce((sum, line) => sum + cents(line.amount), 0)
  const remaining = lines.reduce((sum, line) => (line.paid ? sum : sum + cents(line.amount)), 0)
  const kept = new Set(lines.map((line) => line.id))
  const droppedPaid = installments.filter((i) => i.paid && !kept.has(i.id)).length

  return (
    <ActionForm action={reviseScheduleAction} onSuccess={onDone} successLabel="Échéancier révisé">
      <input type="hidden" name="commitmentId" value={commitmentId} />

      <div className="flex flex-col divide-y divide-border/70 border-y border-border">
        {lines.map((line, index) => (
          <div key={line.key} className="flex items-center gap-2 py-1.5">
            <span className="w-5 shrink-0 font-mono text-[11px] text-faint tabular">{index + 1}</span>
            <input type="hidden" name="installmentId" value={line.id ?? ''} />
            <div className="w-40 shrink-0">
              <DateField
                name="installmentDueOn"
                defaultValue={line.dueOn}
                onValueChange={(day) => update(line.key, { dueOn: day })}
              />
            </div>
            {line.paid && <Badge variant="secondary">payée</Badge>}
            <AmountInput
              name="installmentAmount"
              defaultValue={line.amount}
              aria-label={`Montant de l’échéance ${index + 1}`}
              className="ml-auto h-7 w-24 text-[12.5px]"
              onValueChange={(value) => update(line.key, { amount: value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-faint hover:text-destructive"
              aria-label={`Retirer l’échéance ${index + 1}`}
              onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-faint">
          Total du plan <span className="font-mono text-muted-foreground tabular">{eur(total / 100, 2)}</span>
          {' · reste dû '}
          <span className="font-mono text-muted-foreground tabular">{eur(remaining / 100, 2)}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-[12px]"
          onClick={() => {
            const last = lines[lines.length - 1]
            setLines([
              ...lines,
              {
                key: `ajout-${added}`,
                id: null,
                dueOn: last ? addMonths(last.dueOn, 1) : today,
                amount: last?.amount ?? '',
                paid: false,
              },
            ])
            setAdded(added + 1)
          }}
        >
          <PlusIcon className="size-3.5" />
          Ajouter une échéance
        </Button>
      </div>

      {droppedPaid > 0 && (
        <p className="text-[11.5px] text-destructive">
          {droppedPaid === 1
            ? 'Une échéance déjà payée est retirée : son mouvement sera supprimé.'
            : `${droppedPaid} échéances déjà payées sont retirées : leurs mouvements seront supprimés.`}
        </p>
      )}

      <SubmitButton className="self-start">Enregistrer l’échéancier</SubmitButton>
    </ActionForm>
  )
}
