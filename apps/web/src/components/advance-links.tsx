'use client'

import { MinusIcon, PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useRef, useState, useTransition } from 'react'
import { Field, FormSelect, TextField } from '@/components/forms'
import { RefundShare } from '@/components/refund-share'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { removeShareAction, unlinkRefundAction } from '@/lib/actions'
import { useFormat } from '@/lib/format'

/** A share as a panel shows it: who, how much, and what already came back on it. */
export interface ShareDraft {
  /** Absent on a share stated in this panel and not saved yet. */
  id?: string
  debtor: string
  amount: number
  /** On a commitment: owed on every occurrence, rather than on a financing's total. */
  perOccurrence?: boolean
  refunded?: number
  lastRefundedOn?: string
}

/** A choice in a list of things to link to: an income to an expense, or the reverse. */
export interface LinkChoice {
  value: string
  label: string
}

type Row = ShareDraft & { key: string }

/**
 * Who owes what back of something paid for others, one box per person.
 *
 * Each link is an object of its own: a person and their share, with what came
 * back on it, and a [−] at its end. Under the boxes, the ways to add one:
 * someone who will pay back, or an income that already came in (paid back
 * before the expense was declared). Expenses, subscriptions and financings
 * state their shares through this one block, because the mechanism behind
 * them is one.
 *
 * Removing a share that nothing came back on is part of the form, saved with
 * it. Removing one with refunds is its own gesture, confirmed first because it
 * turns those refunds back into incomes, and done at once: no list restated by
 * the form may drop it.
 */
export function ShareLinks({
  initial = [],
  cost,
  totalCost,
  kind,
  actorsListId,
  incomes = [],
  withRefundedNow,
}: {
  initial?: ShareDraft[]
  /** What a share is a part of, for its percentage: the expense, or one occurrence. */
  cost: number
  /** A financing's total, for a share owed on it. */
  totalCost?: number
  kind: 'movement' | 'subscription' | 'financing'
  /** The datalist of actor names the debtor field completes on. */
  actorsListId: string
  /** Incomes already declared that this expense may be linked to. */
  incomes?: LinkChoice[]
  /** Declaration only: write the refunds in the same go. */
  withRefundedNow?: boolean
}) {
  const t = useTranslations('movements.links')
  const base = useId()
  const [rows, setRows] = useState<Row[]>(
    initial.map((share, index) => ({ ...share, key: `${base}-${index}` })),
  )
  const [links, setLinks] = useState<string[]>([])
  const added = useRef(0)
  const nextKey = () => `${base}-new-${added.current++}`

  return (
    <div className="flex flex-col gap-2">
      {/* Says the block was offered: the rows sent are then every share. */}
      <input type="hidden" name="sharesField" value="1" />
      {rows.map((row, index) => (
        <ShareBox
          key={row.key}
          row={row}
          // The first share of a single bill is usually all of it; the next
          // ones are parts.
          blank={row.id === undefined && index > 0}
          cost={cost}
          totalCost={totalCost}
          kind={kind}
          actorsListId={actorsListId}
          onChange={(next) => setRows(rows.map((r) => (r.key === row.key ? { ...r, ...next } : r)))}
          onRemove={() => setRows(rows.filter((r) => r.key !== row.key))}
        />
      ))}
      {links.map((key) => (
        <LinkBox key={key} incomes={incomes} onRemove={() => setLinks(links.filter((k) => k !== key))} />
      ))}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <AddButton
          onClick={() =>
            setRows([
              ...rows,
              {
                key: nextKey(),
                debtor: '',
                amount: Number.NaN,
                perOccurrence: kind !== 'financing' || undefined,
              },
            ])
          }
        >
          {t('addShare')}
        </AddButton>
        {kind === 'movement' && incomes.length > 0 && (
          <AddButton onClick={() => setLinks([...links, nextKey()])}>{t('linkIncome')}</AddButton>
        )}
      </div>
      {withRefundedNow && rows.length > 0 && (
        <Label className="flex items-center gap-2 text-[11.5px] font-normal text-muted-foreground">
          <Checkbox name="refundedNow" />
          <span>{t('refundedNow')}</span>
        </Label>
      )}
    </div>
  )
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
    >
      <PlusIcon className="size-3" />
      {children}
    </button>
  )
}

/** The [−] at the end of a link: an icon button that names what it removes. */
function RemoveButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 text-faint hover:text-foreground"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <MinusIcon className="size-4" />
    </Button>
  )
}

function ShareBox({
  row,
  blank,
  cost,
  totalCost,
  kind,
  actorsListId,
  onChange,
  onRemove,
}: {
  row: Row
  blank: boolean
  cost: number
  totalCost?: number
  kind: 'movement' | 'subscription' | 'financing'
  actorsListId: string
  onChange: (next: Partial<Row>) => void
  onRemove: () => void
}) {
  const t = useTranslations('movements.links')
  const format = useFormat()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const refunded = row.refunded ?? 0
  // A saved share keeps its person: someone else owing is another share.
  const saved = row.id !== undefined
  const onTotal = kind === 'financing' && row.perOccurrence === false

  const remove = () => {
    if (!(saved && refunded > 0)) return onRemove()
    setConfirming(true)
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5">
      <input type="hidden" name="shareOnTotal" value={onTotal ? '1' : ''} />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {saved ? (
            <>
              <input type="hidden" name="shareDebtor" value={row.debtor} />
              <p className="pt-1 text-[13px] font-medium">{row.debtor}</p>
            </>
          ) : (
            <TextField
              name="shareDebtor"
              label={t('who')}
              list={actorsListId}
              placeholder={t('whoPlaceholder')}
              autoComplete="off"
              defaultValue={row.debtor}
              onValueChange={(debtor) => onChange({ debtor })}
            />
          )}
        </div>
        <RemoveButton
          label={row.debtor ? t('remove', { debtor: row.debtor }) : t('removeNew')}
          onClick={remove}
          disabled={pending}
        />
      </div>

      {kind === 'financing' && (
        <Tabs
          value={onTotal ? 'total' : 'each'}
          onValueChange={(v) => onChange({ perOccurrence: v !== 'total' })}
        >
          <TabsList className="w-full">
            <TabsTrigger value="each">{t('eachOccurrence')}</TabsTrigger>
            <TabsTrigger value="total">{t('onTotal')}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <RefundShare
        // The percentage reads against what the share is a part of.
        key={onTotal ? 'total' : 'each'}
        name="shareAmount"
        label={t('share')}
        expense={onTotal ? (totalCost ?? Number.NaN) : cost}
        defaultAmount={Number.isFinite(row.amount) ? row.amount : undefined}
        blank={blank}
      />

      {/* A share per occurrence is a rule: what comes back lands on each
          occurrence's own share, never on it. */}
      {saved && !row.perOccurrence && (
        <p className="text-[11.5px] text-faint">
          {refunded > 0 && row.lastRefundedOn
            ? t.rich('back', {
                amount: format.eur(refunded, 2),
                date: format.date(row.lastRefundedOn),
                mono: (chunks) => <span className="font-mono tabular">{chunks}</span>,
              })
            : t('nothingBack')}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeTitle', { debtor: row.debtor })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('removeDescription', { amount: format.eur(refunded, 2) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await removeShareAction(row.id!)
                  setConfirming(false)
                  if (result.error) setError(result.error)
                  else onRemove()
                })
              }
            >
              {pending ? '…' : t('removeConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** An income already received, linked to the expense on save. */
function LinkBox({ incomes, onRemove }: { incomes: LinkChoice[]; onRemove: () => void }) {
  const t = useTranslations('movements.links')
  return (
    <div className="flex items-end gap-2 rounded-md border border-border px-3 py-2.5">
      <Field label={t('income')} className="min-w-0 flex-1">
        <FormSelect name="refundedBy" placeholder={t('chooseIncome')} options={incomes} />
      </Field>
      <RemoveButton label={t('removeLink')} onClick={onRemove} />
    </div>
  )
}

/**
 * What an income pays back, from the income's side. Linked, it reads in its
 * box with a [−] that detaches it, after saying what that does: the money
 * stays, and counts as income again. Not linked, a link opens a choice among
 * the claims awaited and the recent expenses, the share of the person it came
 * from being created on an expense that did not have one.
 */
export function RefundLink({
  movementId,
  current,
  claims,
  expenses,
  onLinkedChange,
}: {
  /** The income being corrected; absent on a declaration. */
  movementId?: string
  /** What it pays back now, named. */
  current?: string
  claims: LinkChoice[]
  expenses: LinkChoice[]
  /** A refund is never paid to a card: the panel hides its card choice while linked. */
  onLinkedChange?: (linked: boolean) => void
}) {
  const t = useTranslations('movements.links')
  const [linked, setLinked] = useState(current)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (linked && movementId)
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-2 rounded-md border border-border px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] text-muted-foreground">{t('refunds')}</p>
            <p className="text-[13px]">{linked}</p>
          </div>
          <RemoveButton label={t('unlink')} onClick={() => setConfirming(true)} disabled={pending} />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('unlinkTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('unlinkDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await unlinkRefundAction(movementId)
                    setConfirming(false)
                    if (result.error) setError(result.error)
                    else {
                      setLinked(undefined)
                      onLinkedChange?.(false)
                    }
                  })
                }
              >
                {pending ? '…' : t('unlinkConfirm')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )

  if (claims.length === 0 && expenses.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {movementId && open && <input type="hidden" name="refundTargetField" value="1" />}
      {open ? (
        <div className="flex items-end gap-2 rounded-md border border-border px-3 py-2.5">
          <Field label={t('refunds')} className="min-w-0 flex-1">
            <FormSelect
              name="refundTarget"
              placeholder={t('chooseExpense')}
              options={[]}
              groups={[
                ...(claims.length > 0 ? [{ label: t('groupClaims'), options: claims }] : []),
                ...(expenses.length > 0 ? [{ label: t('groupExpenses'), options: expenses }] : []),
              ]}
              onValueChange={(value) => onLinkedChange?.(value !== '')}
            />
          </Field>
          <RemoveButton
            label={t('removeLink')}
            onClick={() => {
              setOpen(false)
              onLinkedChange?.(false)
            }}
          />
        </div>
      ) : (
        <div>
          <AddButton onClick={() => setOpen(true)}>{t('linkExpense')}</AddButton>
        </div>
      )}
    </div>
  )
}
