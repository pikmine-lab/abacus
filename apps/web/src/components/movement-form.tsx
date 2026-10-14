'use client'

import { MinusIcon, PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { type LinkChoice, RefundLink, type ShareDraft, ShareLinks } from '@/components/advance-links'
import { AmountInput } from '@/components/amount-input'
import { type CardChoice, CardSelect, debitDayFor } from '@/components/card-forms'
import { CurrencySelect } from '@/components/currency-select'
import {
  ActionForm,
  DateField,
  Field,
  FormSelect,
  MonthField,
  SubmitButton,
  TextField,
} from '@/components/forms'
import { useMovementOpener } from '@/components/movement-opener'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { correctMovementAction, declareMovementAction } from '@/lib/actions'
import { useFormat } from '@/lib/format'

interface Option {
  id: string
  name: string
}
/**
 * An activity, with what its regime does to an expense filed under it: only a
 * business activity registered for VAT reclaims any, so only one of them lets
 * an expense say how much of it was VAT.
 */
export interface ActivityOption extends Option {
  vatRegistered?: boolean
  /** The rate its purchases usually bear, as a percentage, when it has one. */
  defaultVatRate?: number
}
/** An invoice still awaiting payment, offered to an income from its client. */
export interface OpenInvoiceOption {
  id: string
  client: string
  label: string
}

const TYPES = ['expense', 'income', 'transfer'] as const

/** An existing movement being corrected, flattened for the form fields. */
export interface MovementDraft {
  id: string
  type: 'expense' | 'income' | 'transfer'
  happenedOn: string
  amount: string
  /** Declared in a foreign currency: amount above is its EUR counter-value. */
  originalAmount?: string
  originalCurrency?: string
  accountId: string
  toAccountId?: string
  actorName?: string
  categoryId?: string
  activityId?: string
  note?: string
  /** "YYYY-MM" when this movement is about a month other than its date's. */
  accrualMonth?: string
  /** Left out of every analysis, while still counted in the balances. */
  ghost?: boolean
  /** Advance carried by this expense: who owes what of it, and what came back. */
  shares?: ShareDraft[]
  /** Refund of an advance: what it pays back, named. */
  refundsLabel?: string
  /** Received for a commitment: the one whose reserve it feeds, named. */
  reserveLabel?: string
  /** The VAT stated inside the amount, when the activity reclaims it. */
  vatAmount?: string
  /** The card that paid it; with a deferred card, happenedOn above is the purchase day. */
  cardId?: string
  /** Origin the form must not silently break: a confirmed due payment, a balance check adjustment. */
  origin?: 'commitment' | 'balanceCheck'
}

export function MovementForm({
  accounts,
  actors,
  categories,
  activities,
  links = { claims: [], expenses: [], commitments: [], incomes: [] },
  invoices = [],
  cards = [],
  today,
  draft,
  onSaved,
  onCancel,
}: {
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  activities: ActivityOption[]
  /**
   * What an advance link can point at: the claims awaited and the recent
   * expenses an income may pay back, the plain incomes an expense may be
   * paid back by.
   */
  links?: { claims: LinkChoice[]; expenses: LinkChoice[]; commitments: LinkChoice[]; incomes: LinkChoice[] }
  /** Open invoices, so an income from a client can say which one it pays. */
  invoices?: OpenInvoiceOption[]
  /** The cards of the open accounts, offered on the account they debit. */
  cards?: CardChoice[]
  today: string
  /** Present when correcting an existing movement instead of declaring one. */
  draft?: MovementDraft
  /** A correction saved: its panel goes back to reading the movement. */
  onSaved?: () => void
  /** Leaves a correction without saving it. */
  onCancel?: () => void
}) {
  const t = useTranslations('movements')
  const format = useFormat()
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>(draft?.type ?? 'expense')
  // The counterparty, watched so an income from a client with open invoices
  // is offered the one it pays.
  const [actorName, setActorName] = useState(draft?.actorName ?? '')
  const payable = invoices.filter((i) => i.client.toLowerCase() === actorName.trim().toLowerCase())
  // The activity is watched because its regime decides whether an expense
  // says how much of it was VAT: only one registered for VAT reclaims any.
  const [activityId, setActivityId] = useState(draft?.activityId ?? '')
  const vatActivity = activities.find((a) => a.id === activityId && a.vatRegistered)
  const [monthOpen, setMonthOpen] = useState(draft?.accrualMonth !== undefined)
  // The month the movement is about is stated against the month of its date,
  // so the date is watched here: moving the date moves what "no attachment"
  // means, and an attached month stays where it was put.
  const [day, setDay] = useState(draft?.happenedOn ?? today)
  const [month, setMonth] = useState<string | null>(draft?.accrualMonth ?? null)
  // The expense amount, watched because the expected share reads as a
  // percentage of it, live.
  const [amount, setAmount] = useState(draft?.originalAmount ?? draft?.amount ?? '')
  const [currency, setCurrency] = useState(draft?.originalCurrency ?? 'EUR')
  // What hit the account when the statement says it; the share reads on it.
  const [eurAmount, setEurAmount] = useState(draft?.originalCurrency ? (draft?.amount ?? '') : '')
  // Editing the paid amount voids the prefilled statement euros.
  const [eurCleared, setEurCleared] = useState(false)
  // The account and the card, watched because a deferred card turns the date
  // into a purchase day and says the day it will be debited.
  const [accountId, setAccountId] = useState(draft?.accountId ?? '')
  const [cardId, setCardId] = useState(draft?.cardId ?? '')
  // The refund of an advance comes back to the account, never to a card.
  const [refunding, setRefunding] = useState(
    draft?.refundsLabel !== undefined || draft?.reserveLabel !== undefined,
  )
  const card = cards.find((c) => c.id === cardId && c.accountId === accountId)
  const withCard = type !== 'transfer' && !refunding
  const debitOn = withCard ? debitDayFor(card, day) : null

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }))
  const editing = draft !== undefined
  const foreign = type !== 'transfer' && currency !== 'EUR'
  // On a screen that reads movements, what was just declared opens from its
  // acknowledgement rather than having to be found again in the list.
  const opener = useMovementOpener()

  return (
    <ActionForm
      action={editing ? correctMovementAction : declareMovementAction}
      successLabel={editing ? t('form.corrected') : t('form.declared')}
      onSuccessOpen={!editing && opener ? (state) => state.id && opener.open(state.id) : undefined}
      onSuccess={() => {
        if (onSaved) return onSaved()
        // A success remounts the fields (they clear), but this state lives
        // above the remount: left alone it would keep showing the euros field
        // while the cleared select says EUR.
        setActorName('')
        setActivityId('')
        setAmount('')
        setCurrency('EUR')
        setEurAmount('')
        setEurCleared(false)
        setMonthOpen(false)
        setDay(today)
        setMonth(null)
        setAccountId(draft?.accountId ?? '')
        setCardId(draft?.cardId ?? '')
        setRefunding(false)
      }}
    >
      <input type="hidden" name="type" value={type} />
      {draft && <input type="hidden" name="movementId" value={draft.id} />}
      {draft?.origin && (
        <p className="rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-[11.5px] text-muted-foreground">
          {t(`form.origin.${draft.origin}`)} {t('form.originKept')}
        </p>
      )}
      <Tabs
        value={type}
        onValueChange={(v) => {
          const next = v as typeof type
          setType(next)
          // A transfer moves euros: editing a foreign movement, the amount
          // field flips to the EUR counter-value (and back to the paid amount).
          if (editing && draft?.originalCurrency)
            setAmount(next === 'transfer' ? draft.amount : (draft.originalAmount ?? draft.amount))
        }}
      >
        <TabsList className="w-full">
          {TYPES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`form.types.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-2 gap-3">
        <Field label={debitOn ? t('form.purchaseDate') : t('fields.date')} name="date">
          <DateField name="date" defaultValue={draft?.happenedOn ?? today} onValueChange={setDay} />
          {/* The day the balance moves, which is not the day of the purchase. */}
          {debitOn && (
            <span className="text-[11px] text-muted-foreground">
              {t.rich('form.debitOn', {
                date: format.date(debitOn),
                mono: (chunks) => <span className="font-mono tabular">{chunks}</span>,
              })}
            </span>
          )}
        </Field>
        <Field label={t('fields.amount')} name="amount">
          <div className="flex gap-2">
            <AmountInput
              // The key remounts the field when the unit it shows changes.
              key={
                editing && draft?.originalCurrency
                  ? `amount-${type === 'transfer' ? 'eur' : 'paid'}`
                  : 'amount'
              }
              name="amount"
              placeholder={format.number(12.5, 2, 2)}
              defaultValue={
                type === 'transfer' ? (draft?.amount ?? '') : (draft?.originalAmount ?? draft?.amount ?? '')
              }
              onValueChange={(value) => {
                setAmount(value)
                // The paid amount moved: the prefilled euros stop applying,
                // the day's rate takes over unless retyped from the statement.
                if (editing && draft?.originalCurrency && Number(value) !== Number(draft.originalAmount)) {
                  setEurCleared(true)
                  setEurAmount('')
                }
              }}
            />
            {type !== 'transfer' && (
              <CurrencySelect value={currency} onValueChange={(v) => setCurrency(v || 'EUR')} />
            )}
          </div>
        </Field>
      </div>

      {foreign && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={type === 'income' ? t('form.eurCredited') : t('form.eurDebited')} name="eurAmount">
            <AmountInput
              key={eurCleared ? 'eur-cleared' : 'eur'}
              name="eurAmount"
              placeholder={t('form.dayRate')}
              defaultValue={!eurCleared && draft?.originalCurrency ? (draft?.amount ?? '') : ''}
              onValueChange={setEurAmount}
            />
          </Field>
        </div>
      )}

      {type !== 'transfer' && (
        <div>
          <button
            type="button"
            onClick={() => setMonthOpen((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
            aria-expanded={monthOpen}
          >
            {monthOpen ? <MinusIcon className="size-3" /> : <PlusIcon className="size-3" />}
            {t('form.attachMonth')}
          </button>
          {/* Closing the block detaches the movement: the field stops being
              submitted, and the action reads an absent month as "none". The
              open state is the attachment, exactly as it is for an advance. */}
          {monthOpen && (
            <Field className="mt-2" label={t('form.accrualMonth')} name="accrualMonth">
              <MonthField name="accrualMonth" anchor={day} value={month} onValueChange={setMonth} />
            </Field>
          )}
        </div>
      )}

      <Field
        label={type === 'income' ? t('form.accountCredited') : t('form.accountDebited')}
        name="accountId"
      >
        <FormSelect
          name="accountId"
          placeholder={t('form.chooseAccount')}
          options={accountOptions}
          defaultValue={draft?.accountId ?? ''}
          onValueChange={setAccountId}
        />
      </Field>

      {/* No card is the ordinary case: the account was debited directly. */}
      {withCard && (
        <CardSelect
          cards={cards}
          accountId={accountId}
          label={type === 'income' ? t('form.refundedOnCard') : t('form.paidWith')}
          noneLabel={type === 'income' ? t('form.noCard') : t('form.noCardDirectDebit')}
          defaultValue={draft?.cardId}
          onValueChange={setCardId}
        />
      )}

      {type === 'transfer' ? (
        <Field label={t('form.toAccount')} name="toAccountId">
          <FormSelect
            name="toAccountId"
            required
            placeholder={t('form.chooseAccount')}
            options={accountOptions}
            defaultValue={draft?.toAccountId ?? ''}
          />
        </Field>
      ) : (
        <>
          <TextField
            name="actor"
            label={type === 'expense' ? t('form.paidTo') : t('form.receivedFrom')}
            list="actors-list"
            placeholder={t('form.actorPlaceholder')}
            autoComplete="off"
            defaultValue={draft?.actorName ?? ''}
            onValueChange={setActorName}
          />
          <datalist id="actors-list">
            {actors.map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fields.category')}>
              <FormSelect
                name="categoryId"
                noneLabel={t('form.none')}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                defaultValue={draft?.categoryId ?? ''}
              />
            </Field>
            <Field label={t('fields.activity')}>
              <FormSelect
                name="activityId"
                noneLabel={editing ? t('form.none') : t('form.inheritedFromActor')}
                options={activities.map((a) => ({ value: a.id, label: a.name }))}
                defaultValue={draft?.activityId ?? ''}
                onValueChange={setActivityId}
              />
            </Field>
          </div>

          {/* Only on an expense of an activity that reclaims VAT: what a
              purchase bore comes off what was collected, and nowhere else does
              anything ever read it. An activity left to the actor shows no
              field, because nothing here knows yet which one it will be. */}
          {type === 'expense' && vatActivity && (
            <VatField
              amount={Number(foreign ? eurAmount : amount)}
              // A correction shows what was declared and proposes nothing: the
              // panel rebuilds the movement whole, so a proposal here would
              // write a VAT the receipt never stated.
              rate={editing ? undefined : vatActivity.defaultVatRate}
              defaultValue={draft?.vatAmount}
            />
          )}
        </>
      )}

      <TextField name="note" label={t('form.note')} defaultValue={draft?.note ?? ''} />

      {/* A binary attribute, so a checkbox rather than a foldable block: there
          is nothing to fill in behind it. Absent on a transfer, which counts
          in no total to begin with and which the service refuses to mark. */}
      {type !== 'transfer' && (
        <Label className="flex items-start gap-2 text-[11.5px] font-normal text-muted-foreground">
          <Checkbox name="ghost" defaultChecked={draft?.ghost} className="mt-px" />
          <span>{t('form.ghost')}</span>
        </Label>
      )}

      {/* Who owes what back of it, one box per person, and the incomes that
          already paid it back. */}
      {type === 'expense' && (
        <ShareLinks
          // A new type or a fresh declaration starts from what is stored.
          key={draft?.id ?? 'new'}
          initial={draft?.shares}
          cost={Number(foreign ? eurAmount : amount)}
          kind="movement"
          actorsListId="actors-list"
          incomes={links.incomes}
          withRefundedNow={!editing}
        />
      )}

      {/* Declaration only: a correction never touches the link an income has
          with the invoice it paid, as it never touches the other origins. */}
      {type === 'income' && !editing && payable.length > 0 && (
        <Field label={t('form.settlesInvoice')}>
          <FormSelect
            name="invoiceId"
            noneLabel={t('form.no')}
            options={payable.map((invoice) => ({ value: invoice.id, label: invoice.label }))}
          />
        </Field>
      )}

      {type === 'income' && (
        <RefundLink
          movementId={draft?.id}
          current={draft?.refundsLabel}
          reserve={draft?.reserveLabel}
          claims={links.claims}
          expenses={links.expenses}
          commitments={links.commitments}
          onLinkedChange={setRefunding}
        />
      )}

      <div className="flex items-center gap-2">
        <SubmitButton>{editing ? t('form.save') : t('declare')}</SubmitButton>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('form.cancel')}
          </Button>
        )}
      </div>
    </ActionForm>
  )
}

/**
 * The VAT inside an expense of a registered activity: an amount, because that
 * is the figure a receipt prints and the figure a return deducts, proposed
 * from the rate the activity's purchases usually bear.
 *
 * The proposal follows the amount as long as nothing has been typed here; the
 * first keystroke makes the field the truth, and emptying it says this
 * purchase bore none. A receipt that departs from the usual rate is the
 * ordinary case, not the exception, so what is typed is never rewritten.
 */
function VatField({ amount, rate, defaultValue }: { amount: number; rate?: number; defaultValue?: string }) {
  const t = useTranslations('movements.form')
  const format = useFormat()
  // The stored VAT arrives as a machine value ("2.00") and is shown in the language's marks.
  const [typed, setTyped] = useState<string | null>(
    defaultValue === undefined ? null : format.editable(Number(defaultValue), 2),
  )
  // The rate applies to the amount before VAT, and the amount here includes it.
  const proposed =
    rate !== undefined && rate > 0 && Number.isFinite(amount) && amount > 0
      ? Math.round(((amount * rate) / (100 + rate)) * 100) / 100
      : null
  const value = typed === null ? proposed : typed.trim() === '' ? null : format.parse(typed)

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('vat')} name="vatAmount">
        <input type="hidden" name="vatAmount" value={value !== null && Number.isFinite(value) ? value : ''} />
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="text-right font-mono tabular"
          value={typed ?? (proposed === null ? '' : format.editable(proposed, 2))}
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>
    </div>
  )
}
