'use client'

import { CalendarIcon, Undo2Icon } from 'lucide-react'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { FoldSection } from '@/components/fold-section'
import { DateField, FormSelect } from '@/components/forms'
import { Rows } from '@/components/page-shell'
import { RowMenu } from '@/components/row-menu'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { confirmLevyPaymentAction, confirmNilReturnAction, withdrawNilReturnAction } from '@/lib/actions'
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
  /** First day of the period being settled; with the entry and the instalment, what names the due date. */
  periodStart: string
  entry: 'period' | 'regularization'
  /** Which instalment of the period this due date is, 1 when it is paid at once. */
  instalmentNumber: number
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
  status: 'paid' | 'nil_return' | 'nothing_due' | 'upcoming' | 'overdue'
  /** Files no return of its own: it rides in another one. */
  absorbed: boolean
  /** "2 sur 4" when a period is paid in instalments. */
  instalment?: string
  paidOn: string | null
  paidAmount: number | null
  /** Stated figures its amount rests on and that were never given: the amount is unknown. */
  missingInputs: string[]
  /** Said filed at zero; still owed when a receipt has come in since. */
  nilReturn: boolean
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
 * A period with nothing in it owes its return all the same, and no payment of
 * zero exists: "Déclarée à 0" stands in for the pay form, and is what answers
 * it. A row whose amount rests on a figure never stated names that figure and
 * shows a dash, where a zero would read as known.
 *
 * Two things fold away, for the same reason: what is settled is history, and
 * a window that has not opened yet is a date to know, not work to do. A year
 * of rules is a dozen such windows, and listing them all beside the two that
 * are actually due would bury them. What comes to zero and files nothing of
 * its own asks for nothing, so it is settled as soon as its window opens.
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
  const settled = entries.filter(
    (e) =>
      e.status === 'paid' || e.status === 'nil_return' || (e.status === 'nothing_due' && e.opensOn <= today),
  )
  const withdrawable = settled.some((e) => e.status === 'nil_return')
  const pending = entries.filter((e) => !settled.includes(e))
  const open = pending.filter((e) => e.opensOn <= today)
  const ahead = pending.filter((e) => e.opensOn > today)
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

      {settled.length > 0 && (
        <FoldSection
          title="Déjà réglées"
          description={`${settled.length} échéance${settled.length > 1 ? 's' : ''}`}
        >
          <Rows>
            {settled.map((entry) => (
              <div key={entry.key} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px]">
                    {entry.levyName} · {entry.what}
                  </p>
                  <p className="text-[11px] text-faint">
                    {entry.status === 'paid'
                      ? `payée le ${entry.paidOn ? frDate(entry.paidOn) : '?'} · estimée à ${eur(entry.amount, 2)}`
                      : entry.status === 'nil_return'
                        ? 'déclarée à 0'
                        : 'rien à déclarer ni à payer'}
                  </p>
                </div>
                <span className="ml-auto font-mono text-[12.5px] tabular">
                  {eur(entry.paidAmount ?? 0, 2)}
                </span>
                {entry.status === 'nil_return' ? (
                  <WithdrawMenu entry={entry} back={back} />
                ) : (
                  // Keeps the amounts in one column when another row carries a menu.
                  withdrawable && <span aria-hidden className="size-7 shrink-0" />
                )}
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
  const unknown = entry.missingInputs.length > 0
  // Nothing to send: an absorbed period rides in another return, a negative
  // entry is money coming back, declared as an income, and what files nothing
  // of its own at zero needs nothing at all.
  const payable = !entry.absorbed && !refund && entry.status !== 'nothing_due'
  // A known zero is answered by its return filed at zero, never by a payment,
  // and that return is filed once its window has opened, not before.
  const zero = payable && entry.amount === 0 && !unknown
  const nil = zero && entry.opensOn <= today

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
          {nil && ' · rien à payer, la déclaration reste due'}
          {unknown && ` · montant inconnu : ${entry.missingInputs.join(', ')} non renseigné dans Réglages`}
          {entry.nilReturn && ' · déclarée à 0, mais une recette est arrivée depuis'}
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
        {unknown ? '—' : refund ? eurSigned(entry.amount, 2) : eur(entry.amount, 2)}
      </span>

      {nil ? (
        <form action={confirmNilReturnAction}>
          <DueFields entry={entry} back={back} />
          <Button size="sm" type="submit" variant="outline" className="h-7">
            Déclarée à 0
          </Button>
        </form>
      ) : payable && !zero ? (
        <>
          <form action={confirmLevyPaymentAction} className="flex flex-wrap items-center gap-2">
            <DueFields entry={entry} back={back} />
            {!dateOpen && <input type="hidden" name="date" value={today} />}
            <AmountInput
              name="amount"
              defaultValue={unknown ? '' : entry.amount.toFixed(2)}
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
            {entry.nilReturn && <WithdrawItem entry={entry} back={back} />}
          </RowMenu>
        </>
      ) : (
        <span className="text-[11.5px] text-faint">
          {refund
            ? 'à recevoir : déclare le revenu'
            : entry.status === 'nothing_due'
              ? 'rien à déclarer ni à payer'
              : zero
                ? 'rien à payer pour l’instant'
                : 'rien à payer de son côté'}
        </span>
      )}
    </div>
  )
}

/** What names the due date a gesture answers: the rule, the period, the instalment. */
function DueFields({ entry, back }: { entry: DueEntry; back: string }) {
  return (
    <>
      <input type="hidden" name="levyId" value={entry.levyId} />
      <input type="hidden" name="periodStart" value={entry.periodStart} />
      <input type="hidden" name="entry" value={entry.entry} />
      <input type="hidden" name="instalment" value={entry.instalmentNumber} />
      <input type="hidden" name="back" value={back} />
    </>
  )
}

function WithdrawItem({ entry, back }: { entry: DueEntry; back: string }) {
  return (
    <DropdownMenuItem asChild>
      <form action={withdrawNilReturnAction}>
        <DueFields entry={entry} back={back} />
        <button type="submit" className="flex w-full items-center gap-2">
          <Undo2Icon />
          Retirer la déclaration à 0
        </button>
      </form>
    </DropdownMenuItem>
  )
}

function WithdrawMenu({ entry, back }: { entry: DueEntry; back: string }) {
  return (
    <RowMenu label={`${entry.levyName} ${entry.what}`}>
      <WithdrawItem entry={entry} back={back} />
    </RowMenu>
  )
}
