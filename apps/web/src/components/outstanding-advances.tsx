'use client'

import { CalendarClockIcon, CalendarIcon, HandCoinsIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { AmountInput } from '@/components/amount-input'
import { FinancingAmountFields } from '@/components/financing-fields'
import { ActionForm, DateField, SubmitButton } from '@/components/forms'
import { RowMenu } from '@/components/row-menu'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { closeShareAction, planShareAction, refundShareAction } from '@/lib/actions'
import { useFormat } from '@/lib/format'

/** One person's claim on one thing advanced, as the action card reads it. */
export interface OpenClaimRow {
  shareId: string
  debtor: string
  /** What was advanced, in a few words: the expense and its day, or the financing. */
  on: string
  /** The account that paid, which is where the refund is written. */
  account: string
  owed: number
  refunded: number
  remaining: number
  /** The debtor's plan, when they gave one. */
  plan: { dueOn: string; amount: number }[]
  nextDueOn: string | null
  nextDueAmount: number | null
  late: number
}

/**
 * Claims still out there, one line per person and per thing advanced, as the
 * lines of the screen's action card. A bill shared by three people is three
 * lines: each pays back on their own, and what is left is read by name.
 *
 * "Remboursé" writes the income, it does not tick a box: the money really
 * landed on the account that paid, and a balance check would catch a claim
 * closed without it. The line names that account, so the income is not
 * declared a second time by hand. The amount stays editable, because a refund
 * arrives partial as often as whole. A debtor who said when they would pay
 * has a plan: the line then says what comes next, or how late they are.
 */
export function OutstandingAdvances({
  claims,
  today,
  back,
}: {
  claims: OpenClaimRow[]
  today: string
  /** Where a failed action comes back to, with its message. */
  back: string
}) {
  return (
    <>
      {claims.map((claim) => (
        // Keyed on what is left: after a partial refund the row remounts, so
        // the amount field states the new remainder instead of the figure that
        // was just submitted.
        <ClaimRow key={`${claim.shareId}-${claim.remaining}`} claim={claim} today={today} back={back} />
      ))}
    </>
  )
}

function ClaimRow({ claim, today, back }: { claim: OpenClaimRow; today: string; back: string }) {
  const t = useTranslations('movements.advances')
  const format = useFormat()
  const [dateOpen, setDateOpen] = useState(false)
  const [planning, setPlanning] = useState(false)
  // The next payment is due today at the latest when it is not late: a plan
  // ahead of schedule says when the next one comes.
  const next = claim.nextDueOn && claim.nextDueAmount !== null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-[13.5px] font-medium">
          {t.rich('owes', {
            debtor: claim.debtor,
            amount: format.eur(claim.remaining, 2),
            tabular: (chunks) => <span className="tabular">{chunks}</span>,
          })}
        </p>
        <p className="text-[12px] text-faint">
          {t('detail', {
            on: claim.on,
            // What was owed only says something new once part of it came back:
            // before that it is the figure the line leads with.
            returned: claim.refunded > 0 ? 'yes' : 'no',
            owed: format.eur(claim.owed, 2),
            refunded: format.eur(claim.refunded, 2),
            account: claim.account,
          })}
        </p>
        {/* Late, the first payment not covered is the one missed: it says
            since when, there is no "next" before it. */}
        {claim.late > 0 ? (
          <p className="text-[12px] text-destructive">
            {t('late', { amount: format.eur(claim.late, 2), date: format.date(claim.nextDueOn!) })}
          </p>
        ) : (
          next && (
            <p className="text-[12px] text-muted-foreground">
              {t('next', {
                amount: format.eur(claim.nextDueAmount!, 2),
                date: format.date(claim.nextDueOn!),
              })}
            </p>
          )
        )}
      </div>

      <form action={refundShareAction} className="ml-auto flex flex-wrap items-center gap-2">
        <input type="hidden" name="shareId" value={claim.shareId} />
        <input type="hidden" name="back" value={back} />
        <AmountInput
          name="amount"
          // A plan proposes its next payment, the whole rest otherwise.
          defaultValue={(claim.late > 0 ? claim.late : (claim.nextDueAmount ?? claim.remaining)).toFixed(2)}
          className="h-7 w-28 text-[12.5px]"
          aria-label={t('refundedAmount', { debtor: claim.debtor })}
        />
        {dateOpen && (
          <div className="w-40">
            <DateField name="date" defaultValue={today} />
          </div>
        )}
        <Button size="sm" type="submit" className="h-7">
          {t('refunded')}
        </Button>
      </form>

      <RowMenu label={`${claim.debtor} · ${claim.on}`}>
        <DropdownMenuItem onSelect={() => setDateOpen((v) => !v)}>
          <CalendarIcon />
          {dateOpen ? t('backToday') : t('backOtherDay')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setPlanning(true)}>
          <CalendarClockIcon />
          {claim.plan.length > 0 ? t('editPlan') : t('plan')}
        </DropdownMenuItem>
        <DropdownMenuItem asChild variant="destructive">
          <form action={closeShareAction}>
            <input type="hidden" name="shareId" value={claim.shareId} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className="flex w-full items-center gap-2">
              <HandCoinsIcon />
              {t('writeOff')}
            </button>
          </form>
        </DropdownMenuItem>
      </RowMenu>

      <Sheet open={planning} onOpenChange={setPlanning}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-[15px]">{t('planTitle', { debtor: claim.debtor })}</SheetTitle>
            <SheetDescription className="text-[12px]">
              {t('planDescription', { owed: format.eur(claim.owed, 2), on: claim.on })}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-6 p-4">
            {claim.plan.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-muted-foreground">{t('currentPlan')}</p>
                <ul className="flex flex-col divide-y divide-border/70 border-y border-border">
                  {claim.plan.map((line, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the row *is* its position in the plan
                    <li key={index} className="flex items-center justify-between py-1.5 text-[12.5px]">
                      <span className="font-mono text-faint tabular">{format.date(line.dueOn)}</span>
                      <span className="font-mono tabular">{format.eur(line.amount, 2)}</span>
                    </li>
                  ))}
                </ul>
                <ActionForm action={planShareAction} onSuccess={() => setPlanning(false)}>
                  <input type="hidden" name="shareId" value={claim.shareId} />
                  <input type="hidden" name="drop" value="1" />
                  <SubmitButton variant="outline" size="sm" className="self-start">
                    {t('dropPlan')}
                  </SubmitButton>
                </ActionForm>
              </div>
            )}
            <ActionForm action={planShareAction} onSuccess={() => setPlanning(false)}>
              <input type="hidden" name="shareId" value={claim.shareId} />
              <FinancingAmountFields today={today} fixedTotal={claim.owed} />
              <SubmitButton className="self-start">{t('savePlan')}</SubmitButton>
            </ActionForm>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
