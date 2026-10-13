'use client'

import type { Judgment } from '@abacus/core/domain'
import { useTranslations } from 'next-intl'
import { useOptimistic, useState, useTransition } from 'react'
import { type ShareDraft, ShareLinks } from '@/components/advance-links'
import { AmountInput } from '@/components/amount-input'
import { type CardChoice, CardSelect } from '@/components/card-forms'
import { CurrencySelect } from '@/components/currency-select'
import { FinancingAmountFields } from '@/components/financing-fields'
import { ActionForm, DateField, Field, FormSelect, SubmitButton, TextField } from '@/components/forms'
import { PeriodField } from '@/components/period-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  changeCommitmentAccountAction,
  createFinancingAction,
  createSubscriptionAction,
  editCommitmentAction,
  setJudgmentAction,
} from '@/lib/actions'
import { cn } from '@/lib/utils'

/** The judgments a subscription can carry, in the order they are offered. */
export const JUDGMENTS: Judgment[] = ['essential', 'reducible', 'to_cancel']

export interface Option {
  id: string
  name: string
}

/** The references a commitment can point at, for the forms that let it move. */
export interface CommitmentOptions {
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  activities: Option[]
  /** The cards an outgoing subscription or a financing can be billed to. */
  cards?: CardChoice[]
}

/**
 * Recurring commitments, one form per direction. Money going out and money
 * coming in are not two settings of one thing: an outgoing one can be a
 * financing plan and carries a judgment ("what do I cut?"), an incoming one
 * can be neither.
 */
/**
 * What a commitment says about itself: who bills it, which account it hits,
 * how it is filed. Shared by declaration and correction, because two copies of
 * these fields would drift, and the second one would be the one nobody
 * remembers to fix.
 */
function CommitmentIdentityFields({
  outgoing,
  accounts,
  actors,
  categories,
  activities,
  defaults,
  beforeCategory,
  afterActivity,
  /** The account has its own dated gesture, so correction leaves it out. */
  withAccount = true,
  onAccountChange,
}: {
  outgoing: boolean
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  activities: Option[]
  defaults?: { actor?: string; accountId?: string; categoryId?: string; activityId?: string }
  /** Sits next to the category, on the row where the first due date belongs. */
  beforeCategory?: React.ReactNode
  /** Sits next to the activity: a lock-in date, where one can exist. */
  afterActivity?: React.ReactNode
  withAccount?: boolean
  /** For a form offering what depends on the account, such as its cards. */
  onAccountChange?: (accountId: string) => void
}) {
  const t = useTranslations('recurring.form')
  return (
    <>
      <datalist id="commitment-actors">
        {actors.map((a) => (
          <option key={a.id} value={a.name} />
        ))}
      </datalist>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          name="actor"
          label={outgoing ? t('actorOutgoing') : t('actorIncoming')}
          defaultValue={defaults?.actor ?? ''}
          list="commitment-actors"
          placeholder={outgoing ? t('actorPlaceholderOutgoing') : t('actorPlaceholderIncoming')}
          autoComplete="off"
        />
        {withAccount && (
          <Field label={outgoing ? t('accountOutgoing') : t('accountIncoming')} name="accountId">
            <FormSelect
              name="accountId"
              required
              placeholder={t('choose')}
              defaultValue={defaults?.accountId}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              onValueChange={onAccountChange}
            />
          </Field>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {beforeCategory}
        <Field label={t('category')}>
          <FormSelect
            name="categoryId"
            noneLabel={t('noCategory')}
            defaultValue={defaults?.categoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('activity')}>
          <FormSelect
            name="activityId"
            noneLabel={t('personal')}
            defaultValue={defaults?.activityId}
            options={activities.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
        {afterActivity}
      </div>
    </>
  )
}

/**
 * Who pays part of it back, one box per person: an employer covering half a
 * transport pass, flatmates sharing a box, someone a purchase was financed
 * for. The same block as on an expense, because each confirmed occurrence
 * becomes an advance on these shares; on a financing, a share can instead be
 * owed on the total and paid back on its own rhythm.
 */
function RefundFields({
  kind,
  amount,
  total,
  shares,
}: {
  kind: 'subscription' | 'financing'
  /** One occurrence, which a share per occurrence is a part of. */
  amount: number
  /** A financing's total, which a share on the total is a part of. */
  total?: number
  shares?: ShareDraft[]
}) {
  const t = useTranslations('recurring.form')
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-muted-foreground">{t('refundedInPart')}</p>
      <ShareLinks
        initial={shares}
        cost={amount}
        totalCost={total}
        kind={kind}
        actorsListId="commitment-actors"
      />
      <p className="text-[11.5px] text-faint">
        {t(kind === 'financing' ? 'refundNoteFinancing' : 'refundNote')}
      </p>
    </div>
  )
}

export function NewCommitmentForm({
  direction,
  accounts,
  actors,
  categories,
  activities,
  cards = [],
  today,
}: {
  direction: 'outgoing' | 'incoming'
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  activities: Option[]
  /** Outgoing only: the cards a subscription or a financing can be billed to. */
  cards?: CardChoice[]
  today: string
}) {
  const [kind, setKind] = useState<'subscription' | 'financing'>('subscription')
  // Watched so an expense is offered the cards of the account it hits.
  const [accountId, setAccountId] = useState('')
  // Watched because a refunded share reads as a percentage of it, live.
  const [amount, setAmount] = useState('')
  // A financing's plan, for the same reason: a share is a part of an
  // installment, or of the total.
  const [plan, setPlan] = useState({ total: Number.NaN, count: Number.NaN })
  const outgoing = direction === 'outgoing'
  const t = useTranslations('recurring')

  const shared = (options: { withFirstDue: boolean; withLockIn?: boolean }) => (
    <CommitmentIdentityFields
      outgoing={outgoing}
      accounts={accounts}
      actors={actors}
      categories={categories}
      activities={activities}
      onAccountChange={setAccountId}
      beforeCategory={
        options.withFirstDue ? (
          <Field label={t('form.firstDue')} name="firstDueOn">
            <DateField name="firstDueOn" defaultValue={today} />
          </Field>
        ) : undefined
      }
      afterActivity={
        options.withLockIn ? (
          <Field label={t('form.engagedUntil')}>
            <DateField name="engagedUntil" />
          </Field>
        ) : undefined
      }
    />
  )

  if (!outgoing)
    return (
      <ActionForm action={createSubscriptionAction} successLabel={t('form.incomeCreated')}>
        <input type="hidden" name="direction" value="incoming" />
        <TextField name="label" label={t('name')} placeholder={t('form.incomeNamePlaceholder')} />
        {shared({ withFirstDue: true })}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('form.amountPerPeriod')} name="amount">
            <div className="flex gap-2">
              <AmountInput name="amount" placeholder={t('form.incomeAmountPlaceholder')} />
              <CurrencySelect />
            </div>
          </Field>
          <PeriodField defaultValue="month:1" />
        </div>
        <SubmitButton className="self-start">{t('form.create')}</SubmitButton>
      </ActionForm>
    )

  return (
    <div>
      <Tabs
        value={kind}
        onValueChange={(v) => {
          setKind(v as typeof kind)
          // The other tab mounts its own form, with no account chosen yet.
          setAccountId('')
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="subscription">{t('form.subscription')}</TabsTrigger>
          <TabsTrigger value="financing">{t('form.financing')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {kind === 'subscription' ? (
        <ActionForm
          action={createSubscriptionAction}
          className="mt-3"
          successLabel={t('form.subscriptionCreated')}
          onSuccess={() => {
            setAccountId('')
            setAmount('')
          }}
        >
          <input type="hidden" name="direction" value="outgoing" />
          <TextField name="label" label={t('name')} placeholder={t('form.subscriptionNamePlaceholder')} />
          {shared({ withFirstDue: true, withLockIn: true })}
          <CardSelect
            cards={cards}
            accountId={accountId}
            label={t('form.paidWith')}
            noneLabel={t('form.noCard')}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('form.amountPerPeriod')} name="amount">
              <div className="flex gap-2">
                <AmountInput
                  name="amount"
                  placeholder={t('form.subscriptionAmountPlaceholder')}
                  onValueChange={setAmount}
                />
                <CurrencySelect />
              </div>
            </Field>
            <PeriodField defaultValue="month:1" />
          </div>
          {outgoing && <RefundFields kind="subscription" amount={Number(amount)} />}
          <Field label={t('judgment')}>
            <FormSelect
              name="judgment"
              noneLabel={t('form.judgeLater')}
              options={JUDGMENTS.map((value) => ({ value, label: t(`judgments.${value}`) }))}
            />
          </Field>
          <SubmitButton className="self-start">{t('form.createSubscription')}</SubmitButton>
        </ActionForm>
      ) : (
        <ActionForm
          action={createFinancingAction}
          className="mt-3"
          successLabel={t('form.financingCreated')}
          onSuccess={() => setAccountId('')}
        >
          <TextField name="label" label={t('form.financed')} placeholder={t('form.financedPlaceholder')} />
          {shared({ withFirstDue: false })}
          <CardSelect
            cards={cards}
            accountId={accountId}
            label={t('form.paidWith')}
            noneLabel={t('form.noCard')}
          />
          <FinancingAmountFields today={today} onPlanChange={setPlan} />
          <RefundFields kind="financing" amount={plan.total / plan.count} total={plan.total} />
          <SubmitButton className="self-start">{t('form.createFinancing')}</SubmitButton>
        </ActionForm>
      )}
    </div>
  )
}

/**
 * Corrects an existing commitment. The amount is deliberately absent: a price
 * change is dated history and has its own panel, and a financing's installment
 * amount comes from its schedule.
 *
 * The movements already declared are not rewritten: they say what happened, on
 * the account it happened on. The panel says so rather than letting someone
 * discover it afterwards.
 */
export function EditCommitmentForm({
  commitmentId,
  kind,
  incoming,
  defaults,
  options,
  onDone,
}: {
  commitmentId: string
  kind: 'subscription' | 'financing'
  incoming: boolean
  defaults: {
    label: string
    actor: string
    categoryId: string
    activityId: string
    period: string
    engagedUntil: string
    /** The account it hits today, whose cards it can be billed to. */
    accountId?: string
    cardId?: string
    /** Outgoing only: the price of one occurrence, and who pays part of it back. */
    amount?: number
    /** A financing's total. */
    total?: number
    shares?: ShareDraft[]
  }
  options: CommitmentOptions
  onDone?: () => void
}) {
  // Only an expense is billed to a card: an outgoing subscription or a financing.
  const billable = !incoming && defaults.accountId !== undefined
  const t = useTranslations('recurring')
  return (
    <ActionForm action={editCommitmentAction} onSuccess={onDone} successLabel={t('form.edited')}>
      <input type="hidden" name="commitmentId" value={commitmentId} />
      <TextField name="label" label={t('name')} defaultValue={defaults.label} />
      <CommitmentIdentityFields
        outgoing={!incoming}
        withAccount={false}
        accounts={options.accounts}
        actors={options.actors}
        categories={options.categories}
        activities={options.activities}
        defaults={defaults}
        afterActivity={
          // A financing ends at its last installment: it has no lock-in to end.
          kind === 'subscription' ? (
            <Field label={t('form.engagedUntil')}>
              <DateField name="engagedUntil" defaultValue={defaults.engagedUntil || undefined} />
            </Field>
          ) : undefined
        }
      />
      <PeriodField defaultValue={defaults.period} />
      {billable && (
        <>
          {/* Says the field was offered, so an empty choice clears the card. */}
          <input type="hidden" name="cardField" value="1" />
          <CardSelect
            cards={options.cards ?? []}
            accountId={defaults.accountId!}
            label={t('form.paidWith')}
            noneLabel={t('form.noCard')}
            defaultValue={defaults.cardId}
          />
        </>
      )}
      {!incoming && defaults.amount !== undefined && (
        <RefundFields kind={kind} amount={defaults.amount} total={defaults.total} shares={defaults.shares} />
      )}
      <p className="text-[11.5px] text-faint">{t('form.editNote')}</p>
      <SubmitButton className="self-start">{t('form.save')}</SubmitButton>
    </ActionForm>
  )
}

/**
 * Moves the debit (or credit) to another account, from a date. Dated because a
 * move is usually known before it takes effect, and because an occurrence
 * confirmed after it must still land on the account the money really left.
 */
export function MoveAccountForm({
  commitmentId,
  incoming,
  accounts,
  currentAccountId,
  today,
  onDone,
}: {
  commitmentId: string
  incoming: boolean
  accounts: Option[]
  currentAccountId: string
  today: string
  onDone?: () => void
}) {
  const t = useTranslations('recurring.form')
  return (
    <ActionForm action={changeCommitmentAccountAction} onSuccess={onDone} successLabel={t('accountChanged')}>
      <input type="hidden" name="commitmentId" value={commitmentId} />
      <Field label={incoming ? t('newAccountIncoming') : t('newAccountOutgoing')} name="accountId">
        <FormSelect
          name="accountId"
          required
          placeholder={t('choose')}
          defaultValue={currentAccountId}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
      </Field>
      <Field label={t('effectiveOn')} name="effectiveOn">
        <DateField name="effectiveOn" defaultValue={today} />
      </Field>
      <SubmitButton className="self-start">{t('save')}</SubmitButton>
    </ActionForm>
  )
}

/**
 * The judgment of a subscription, changed in one gesture from its row.
 *
 * The action is called straight from the change, without a form around it:
 * React resets a form once its action returns, Radix restores on that reset
 * the value the select had at mount, and the resubmit that followed wrote the
 * old judgment back over the new one. Nothing here needs a form anyway, there
 * is no submit button and Radix needs its script either way.
 */
export function JudgmentSelect({ commitmentId, value }: { commitmentId: string; value: string | null }) {
  const [pending, startTransition] = useTransition()
  const [failed, setFailed] = useState<string | null>(null)
  // The pill says the new judgment while the write travels, and falls back to
  // the stored one on its own: on success that is the same value, on failure
  // it is the truth the message next to it explains.
  const [judgment, showJudgment] = useOptimistic(value ?? '')
  const t = useTranslations('recurring')

  return (
    <div className="flex items-center gap-2">
      {failed && <span className="text-[11px] text-destructive">{failed}</span>}
      <Select
        value={judgment}
        disabled={pending}
        onValueChange={(chosen) =>
          startTransition(async () => {
            showJudgment(chosen)
            setFailed(await setJudgmentAction(commitmentId, chosen as Judgment))
          })
        }
      >
        {/* "À résilier" carries the accent: it is the one judgment that asks for a gesture. */}
        <SelectTrigger
          size="sm"
          className={cn(
            'h-7 rounded-full px-2.5 text-[11px]',
            judgment === 'to_cancel' && 'border-primary/60 text-primary',
          )}
          aria-label={t('judgment')}
        >
          <SelectValue placeholder={t('form.toJudge')} />
        </SelectTrigger>
        <SelectContent>
          {JUDGMENTS.map((value) => (
            <SelectItem key={value} value={value}>
              {t(`judgments.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
