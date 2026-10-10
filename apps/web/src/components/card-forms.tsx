'use client'

import type { DayShift, DebitMode } from '@abacus/core/domain'
import { debitDateOf } from '@abacus/core/domain/card'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useActionState, useEffect, useState } from 'react'
import {
  ActionForm,
  DateField,
  DayOfMonthField,
  Field,
  FormSelect,
  MonthField,
  SubmitButton,
  TextField,
} from '@/components/forms'
import { RowMenu } from '@/components/row-menu'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  confirmStatementAction,
  createCardAction,
  deleteCardAction,
  editCardAction,
  undoStatementAction,
} from '@/lib/actions'
import { useFormat } from '@/lib/format'

/** A card as the forms that pay with it need it: whose account, and when it debits. */
export interface CardChoice {
  id: string
  name: string
  accountId: string
  debitMode: DebitMode
  statementDay: number | null
  statementShift: DayShift | null
  debitDay: number | null
  debitShift: DayShift | null
}

/** The day a purchase made on `day` leaves the account, or null when the card debits it at once. */
export function debitDayFor(card: CardChoice | undefined, day: string): string | null {
  if (card?.debitMode !== 'deferred') return null
  return debitDateOf(card, day)
}

/**
 * What paid a movement, a subscription or a financing, among the cards of the
 * account it touches. Nothing chosen is the ordinary case, the account debited
 * directly (a direct debit, a transfer order), so the empty choice says it.
 * Keyed on the account: a card chosen for another account would be refused
 * anyway.
 */
export function CardSelect({
  cards,
  accountId,
  label,
  noneLabel,
  defaultValue,
  onValueChange,
}: {
  cards: CardChoice[]
  accountId: string
  label: string
  noneLabel: string
  defaultValue?: string
  onValueChange?: (cardId: string) => void
}) {
  const t = useTranslations('accounts.card')
  const own = cards.filter((c) => c.accountId === accountId)
  if (own.length === 0) return null
  return (
    <Field label={label} name="cardId">
      <FormSelect
        key={accountId}
        name="cardId"
        noneLabel={noneLabel}
        defaultValue={own.some((c) => c.id === defaultValue) ? defaultValue : ''}
        options={own.map((c) => ({
          value: c.id,
          label: `${c.name} · ${t(`modesShort.${c.debitMode}`)}`,
        }))}
        onValueChange={onValueChange}
      />
    </Field>
  )
}

/** How a day that falls on a weekend moves, in the order the choice lists them. */
const SHIFTS: DayShift[] = ['none', 'previous', 'next']

/** The two ways a card debits, in the order the tabs show them. */
const MODES: DebitMode[] = ['immediate', 'deferred']

interface CardDefaults {
  name: string
  accountId: string
  /** "YYYY-MM". */
  expiryMonth: string | null
  debitMode: DebitMode
  statementDay?: number
  statementShift?: DayShift
  debitDay?: number
  debitShift?: DayShift
}

/**
 * The fields of a card, shared by declaration and correction. A deferred card
 * states its two days and how each moves off a weekend, the way a bank states
 * them, and the panel shows at once what they give for a purchase made today:
 * a schedule is easier to check on an example than to read.
 */
function CardFields({
  accounts,
  today,
  defaults,
}: {
  accounts: { id: string; name: string }[]
  today: string
  defaults?: CardDefaults
}) {
  const t = useTranslations('accounts')
  const format = useFormat()
  const shifts = SHIFTS.map((value) => ({ value, label: t(`card.shifts.${value}`) }))
  const [mode, setMode] = useState<DebitMode>(defaults?.debitMode ?? 'deferred')
  const [expiry, setExpiry] = useState<string | null>(defaults?.expiryMonth ?? null)
  const [statementDay, setStatementDay] = useState(defaults?.statementDay)
  const [statementShift, setStatementShift] = useState<DayShift>(defaults?.statementShift ?? 'none')
  const [debitDay, setDebitDay] = useState(defaults?.debitDay)
  const [debitShift, setDebitShift] = useState<DayShift>(defaults?.debitShift ?? 'none')
  const example =
    mode === 'deferred' && statementDay && debitDay
      ? debitDateOf({ statementDay, statementShift, debitDay, debitShift }, today)
      : null

  return (
    <>
      <input type="hidden" name="debitMode" value={mode} />
      <TextField
        name="name"
        label={t('fields.name')}
        placeholder={t('cardForm.namePlaceholder')}
        defaultValue={defaults?.name ?? ''}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('cardForm.debitedAccount')} name="accountId">
          <FormSelect
            name="accountId"
            placeholder={t('cardForm.choose')}
            defaultValue={defaults?.accountId ?? ''}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
        <Field label={t('cardForm.expiresEnd')} name="expiryMonth">
          <MonthField name="expiryMonth" value={expiry} onValueChange={setExpiry} />
        </Field>
      </div>
      <Tabs value={mode} onValueChange={(v) => setMode(v as DebitMode)}>
        <TabsList className="w-full">
          {MODES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`card.modes.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {mode === 'deferred' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('cardForm.statementDay')} name="statementDay">
              <DayOfMonthField
                name="statementDay"
                defaultValue={statementDay}
                onValueChange={setStatementDay}
              />
            </Field>
            <Field label={t('cardForm.ifWeekend')}>
              <FormSelect
                name="statementShift"
                defaultValue={statementShift}
                options={shifts}
                onValueChange={(v) => setStatementShift(v as DayShift)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('cardForm.debitDay')} name="debitDay">
              <DayOfMonthField name="debitDay" defaultValue={debitDay} onValueChange={setDebitDay} />
            </Field>
            <Field label={t('cardForm.ifWeekend')}>
              <FormSelect
                name="debitShift"
                defaultValue={debitShift}
                options={shifts}
                onValueChange={(v) => setDebitShift(v as DayShift)}
              />
            </Field>
          </div>
          {example && (
            <p className="text-[11.5px] text-muted-foreground">
              {t.rich('cardForm.example', {
                date: format.date(example),
                day: (chunks) => <span className="font-mono tabular">{chunks}</span>,
              })}
            </p>
          )}
        </>
      )}
    </>
  )
}

/** A new card, opened from the menu of the account it debits, which it starts on. */
export function NewCardForm({
  accounts,
  accountId,
  today,
}: {
  accounts: { id: string; name: string }[]
  accountId: string
  today: string
}) {
  const t = useTranslations('accounts.cardForm')
  return (
    <ActionForm action={createCardAction} successLabel={t('added')}>
      <CardFields
        accounts={accounts}
        today={today}
        defaults={{ name: '', accountId, expiryMonth: null, debitMode: 'deferred' }}
      />
      <SubmitButton className="self-start">{t('submit')}</SubmitButton>
    </ActionForm>
  )
}

/** One cycle of a deferred card, as the panels that validate it need it. */
export interface StatementChoice {
  id: string
  cutOffOn: string
  dueOn: string
  debitedOn: string | null
  amount: number
  purchases: number
}

/**
 * Validates a statement: the day the bank debited it, nothing else. What it
 * took is the sum of the purchases, shown to be compared with the bank, and a
 * disagreement is fixed on the purchase that is wrong. The day opens on the
 * expected one, or on today when that has not come yet, since a statement is
 * validated once debited. Validated already, the same panel corrects the day
 * or takes the validation back. It lives on the card's page, the one place a
 * statement is validated.
 */
export function ValidateStatement({
  cardName,
  statement,
  today,
  urgent,
}: {
  cardName: string
  statement: StatementChoice
  today: string
  /** Past its expected day: the button carries the weight of work to do. */
  urgent?: boolean
}) {
  const t = useTranslations('accounts')
  const format = useFormat()
  const [open, setOpen] = useState(false)
  const [undoState, undo, undoing] = useActionState(undoStatementAction, {})
  const validated = statement.debitedOn !== null
  const day = statement.debitedOn ?? (statement.dueOn <= today ? statement.dueOn : today)

  useEffect(() => {
    if (undoState.ok) setOpen(false)
  }, [undoState.ok])

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={urgent ? 'default' : 'outline'}
        className="h-7 px-2.5 text-[12px]"
        onClick={() => setOpen(true)}
      >
        {validated ? t('actions.correct') : t('statement.validate')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{t('statement.title', { name: cardName })}</DialogTitle>
            <DialogDescription className="text-[12px]">
              {t.rich('statement.description', {
                count: statement.purchases,
                date: format.date(statement.cutOffOn),
                amount: format.eur(statement.amount, 2),
                money: (chunks) => <span className="font-mono text-foreground tabular">{chunks}</span>,
              })}
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={confirmStatementAction} onSuccess={() => setOpen(false)}>
            <input type="hidden" name="statementId" value={statement.id} />
            <Field label={t('statement.debitedOn')} name="debitedOn">
              <DateField name="debitedOn" defaultValue={day} />
            </Field>
            <SubmitButton className="self-start">
              {validated ? t('actions.save') : t('statement.validate')}
            </SubmitButton>
          </ActionForm>
          {validated && (
            <form action={undo} className="flex flex-col gap-1 border-t border-border pt-3">
              <input type="hidden" name="statementId" value={statement.id} />
              <Button type="submit" variant="ghost" size="sm" className="self-start" disabled={undoing}>
                {undoing ? '…' : t('statement.undo')}
              </Button>
              {undoState.error && <p className="text-xs text-destructive">{undoState.error}</p>}
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * A card's menu. Correcting its schedule moves the purchases still waiting
 * for their debit, never those of a validated statement, and the panel says
 * so. It is deleted only while nothing was paid with it: past that, it stays,
 * and its expiry says it no longer works.
 */
export function CardActions({
  cardId,
  accounts,
  today,
  defaults,
  afterDelete,
}: {
  cardId: string
  accounts: { id: string; name: string }[]
  today: string
  defaults: CardDefaults
  /** Where to go once deleted, from a page that was the card's own. */
  afterDelete?: string
}) {
  const t = useTranslations('accounts')
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [state, remove, pending] = useActionState(deleteCardAction, {})

  useEffect(() => {
    if (!state.ok) return
    setConfirming(false)
    if (afterDelete) router.push(afterDelete)
  }, [state.ok, afterDelete, router])

  return (
    <>
      <RowMenu label={defaults.name}>
        <DropdownMenuItem onSelect={() => setEditing(true)}>
          <PencilIcon />
          {t('actions.edit')}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
          <Trash2Icon />
          {t('actions.delete')}
        </DropdownMenuItem>
      </RowMenu>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{defaults.name}</DialogTitle>
            <DialogDescription className="text-[12px]">{t('cardForm.editDescription')}</DialogDescription>
          </DialogHeader>
          <ActionForm action={editCardAction} onSuccess={() => setEditing(false)}>
            <input type="hidden" name="cardId" value={cardId} />
            <CardFields accounts={accounts} today={today} defaults={defaults} />
            <SubmitButton className="self-start">{t('actions.save')}</SubmitButton>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cardForm.deleteTitle', { name: defaults.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('cardForm.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          {state.error && <p className="text-xs text-destructive">{state.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <form action={remove}>
              <input type="hidden" name="cardId" value={cardId} />
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? '…' : t('actions.delete')}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
