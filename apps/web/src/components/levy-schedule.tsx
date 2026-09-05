'use client'

import { CalendarIcon } from 'lucide-react'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { FoldSection } from '@/components/fold-section'
import { DateField, FormSelect } from '@/components/forms'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { confirmLevyPaymentAction } from '@/lib/actions'
import { daysBetween, eur, eurSigned, frDate } from '@/lib/utils'

interface Option {
  id: string
  name: string
}

export interface DueEntry {
  /** Stable across renders: a rule settles one period once. */
  key: string
  levyId: string
  levyName: string
  /** First day of the period being settled, which is what the service settles by. */
  periodStart: string
  /** What the entry is about: "août 2026", "régularisation de 2026". */
  what: string
  /** When the return is filed: "dépôt du 01/09 au 30/09". */
  window: string
  /** First day the return may be filed: before it, nothing is owed yet. */
  opensOn: string
  /** Last day the money may leave. */
  dueOn: string
  /** Estimated and signed: below zero the rule gives money back. */
  amount: number
  status: 'paid' | 'upcoming' | 'overdue'
  /** Files no return of its own: it rides in another one. */
  absorbed: boolean
  /** "2 sur 4" when a period is paid in instalments. */
  instalment?: string
  paidOn: string | null
  paidAmount: number | null
}

/**
 * What the regime asks for and when: the returns to file and the money to
 * send, overdue first, because that is the one that costs. "Payé" writes the
 * settlement as an expense in the rule's category, which is what makes its
 * reserve fall; the amount is editable there, an assessment differing from the
 * estimate being the normal case.
 *
 * Two entries carry no gesture. An absorbed period files nothing of its own,
 * so paying it would settle a return that does not exist; and an entry the
 * rule owes back is an income, which is declared where incomes are.
 *
 * Two things fold away, for the same reason: what is settled is history, and
 * a window that has not opened yet is a date to know, not work to do. A year
 * of rules is a dozen such windows, and listing them all beside the two that
 * are actually due would bury them.
 */
export function LevySchedule({
  entries,
  accounts,
  actors,
  today,
  back,
}: {
  entries: DueEntry[]
  /** Where the money leaves: the activity's own accounts. */
  accounts: Option[]
  actors: Option[]
  today: string
  /** Where a failed action comes back to, with its message. */
  back: string
}) {
  const paid = entries.filter((e) => e.status === 'paid')
  const open = entries.filter((e) => e.status !== 'paid' && e.opensOn <= today)
  const ahead = entries.filter((e) => e.status !== 'paid' && e.opensOn > today)
  const overdue = open.filter((e) => e.status === 'overdue')
  const upcoming = open.filter((e) => e.status !== 'overdue')

  return (
    <>
      <datalist id="levy-actors-list">
        {actors.map((a) => (
          <option key={a.id} value={a.name} />
        ))}
      </datalist>

      {open.length === 0 ? (
        <p className="py-3 text-[13px] text-faint">Rien à déclarer ni à payer aujourd’hui.</p>
      ) : (
        <Rows>
          {[...overdue, ...upcoming].map((entry) => (
            // Keyed on what a settlement changes, so a row that has just been
            // answered remounts and states the figures it now expects instead
            // of the ones that were typed into it.
            <DueRow
              key={`${entry.key}-${entry.status}-${entry.paidAmount ?? ''}`}
              entry={entry}
              accounts={accounts}
              today={today}
              back={back}
            />
          ))}
        </Rows>
      )}

      {ahead.length > 0 && (
        <FoldSection title="À venir" description="dont la fenêtre de dépôt n’est pas ouverte">
          <Rows>
            {ahead.map((entry) => (
              <DueRow key={entry.key} entry={entry} accounts={accounts} today={today} back={back} />
            ))}
          </Rows>
        </FoldSection>
      )}

      {paid.length > 0 && (
        <FoldSection
          title="Déjà réglées"
          description={`${paid.length} échéance${paid.length > 1 ? 's' : ''}`}
        >
          <Rows>
            {paid.map((entry) => (
              <div key={entry.key} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px]">
                    {entry.levyName} · {entry.what}
                  </p>
                  <p className="text-[11px] text-faint">
                    payée le {entry.paidOn ? frDate(entry.paidOn) : '?'} · estimée à {eur(entry.amount, 2)}
                  </p>
                </div>
                <span className="ml-auto font-mono text-[12.5px] tabular">
                  {eur(entry.paidAmount ?? 0, 2)}
                </span>
              </div>
            ))}
          </Rows>
        </FoldSection>
      )}
    </>
  )
}

function DueRow({
  entry,
  accounts,
  today,
  back,
}: {
  entry: DueEntry
  accounts: Option[]
  today: string
  back: string
}) {
  const [dateOpen, setDateOpen] = useState(false)
  // Who was paid is the one thing nothing here can infer, so the gesture waits
  // for it rather than inventing an actor out of an empty field.
  const [actor, setActor] = useState('')
  const late = daysBetween(entry.dueOn, today)
  const refund = entry.amount < 0
  // Nothing to send: an absorbed period rides in another return, and a
  // negative entry is money coming back, declared as an income.
  const payable = !entry.absorbed && !refund

  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium">
          {entry.levyName} · {entry.what}
        </p>
        <p className="text-[11px] text-faint">
          {entry.window} · à payer avant le {frDate(entry.dueOn)}
          {entry.instalment && ` · échéance ${entry.instalment}`}
          {entry.absorbed && ' · rattachée à une autre déclaration'}
        </p>
      </div>

      {/* The state carries its own words: a colour alone would say nothing to
          whoever does not see it. */}
      <span
        className={`shrink-0 text-[11px] ${entry.status === 'overdue' ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {entry.status === 'overdue'
          ? `en retard de ${late} jour${late > 1 ? 's' : ''}`
          : late === 0
            ? 'à payer aujourd’hui'
            : `dans ${-late} jour${-late > 1 ? 's' : ''}`}
      </span>

      <span className="ml-auto font-mono text-[13px] tabular">
        {refund ? eurSigned(entry.amount, 2) : eur(entry.amount, 2)}
      </span>

      {payable ? (
        <>
          <form action={confirmLevyPaymentAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="levyId" value={entry.levyId} />
            <input type="hidden" name="periodStart" value={entry.periodStart} />
            <input type="hidden" name="back" value={back} />
            {!dateOpen && <input type="hidden" name="date" value={today} />}
            <AmountInput
              name="amount"
              defaultValue={entry.amount.toFixed(2)}
              className="h-7 w-28 text-[12.5px]"
              aria-label={`Montant réellement payé pour ${entry.levyName}`}
            />
            <div className="w-40">
              <FormSelect
                name="accountId"
                placeholder="Depuis quel compte"
                ariaLabel={`Compte débité pour ${entry.levyName}`}
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                defaultValue={accounts[0]?.id ?? ''}
              />
            </div>
            <Input
              name="actor"
              list="levy-actors-list"
              placeholder="Payé à"
              autoComplete="off"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              className="h-7 w-36 text-[12.5px]"
              aria-label={`Organisme payé pour ${entry.levyName}`}
            />
            {dateOpen && (
              <div className="w-40">
                <DateField name="date" defaultValue={today} />
              </div>
            )}
            <Button size="sm" type="submit" className="h-7" disabled={actor.trim() === ''}>
              Payé
            </Button>
          </form>

          <RowMenu label={`${entry.levyName} ${entry.what}`}>
            <DropdownMenuItem onSelect={() => setDateOpen((v) => !v)}>
              <CalendarIcon />
              {dateOpen ? 'Payé aujourd’hui' : 'Payé à une autre date…'}
            </DropdownMenuItem>
          </RowMenu>
        </>
      ) : (
        <span className="text-[11.5px] text-faint">
          {refund ? 'à recevoir : déclare le revenu' : 'rien à payer de son côté'}
        </span>
      )}
    </div>
  )
}
