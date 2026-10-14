'use client'

import { ArrowLeftIcon, ArrowRightIcon, ChevronRightIcon, PencilIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState, useEffect, useState } from 'react'
import type { LinkChoice } from '@/components/advance-links'
import type { CardChoice } from '@/components/card-forms'
import { useEntryPanel } from '@/components/entry-dock'
import { type ActivityOption, type MovementDraft, MovementForm } from '@/components/movement-form'
import { MovementOpenerContext } from '@/components/movement-opener'
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { deleteMovementAction } from '@/lib/actions'
import { useFormat } from '@/lib/format'
import type { LinkedCommitment, LinkedMovement, MovementReading } from '@/lib/movement-detail'
import { cn, idParam } from '@/lib/utils'

interface Option {
  id: string
  name: string
}

interface Detail {
  reading: MovementReading
  draft: MovementDraft
}

/** The search parameter naming the open movement: a reload or a pasted link opens it again. */
const PARAM = 'movement'

/**
 * A declared movement opens to be read before it is corrected. One panel per
 * screen, in the place the declaration panel takes (docked beside the list on
 * a screen with an EntryDock): reading is the way to correcting, a saved
 * correction comes back to reading, and deleting is the last gesture of the
 * correction, behind a confirmation because nothing else undoes it.
 *
 * Opening reads that movement alone, from its own route: the list carries
 * what its rows show and nothing more, and opening never re-renders the page.
 * The open movement is written in place in the address, without navigating.
 *
 * A movement linked to this one (the refunds of an advance, the expense a
 * refund pays back) opens in the same panel, which then names the way back to
 * the one it came from.
 */
export function MovementPanel({
  accounts,
  actors,
  categories,
  activities,
  cards,
  links,
  today,
  from,
  children,
}: {
  accounts: Option[]
  actors: Option[]
  categories: Option[]
  activities: ActivityOption[]
  cards?: CardChoice[]
  /** What the correction offers to link the movement to, as on declaration. */
  links?: { claims: LinkChoice[]; expenses: LinkChoice[]; commitments: LinkChoice[]; incomes: LinkChoice[] }
  today: string
  /** The `?from=` key a link leaving the panel carries, so the page it reaches names the way back. */
  from?: string
  children: React.ReactNode
}) {
  const t = useTranslations('movements.panel')
  const panel = useEntryPanel()
  const [openedId, setOpenedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [corrected, setCorrected] = useState(false)
  // Bumped to read the movement again once a correction is saved.
  const [version, setVersion] = useState(0)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [failed, setFailed] = useState(false)
  // The movements followed to reach this one, the last being the way back.
  const [trail, setTrail] = useState<{ id: string; label: string }[]>([])

  const show = (id: string, path: { id: string; label: string }[]) => {
    setOpenedId(id)
    setTrail(path)
    setEditing(false)
    setCorrected(false)
    panel.setOpen(true)
    writeParam(id)
  }
  // From a row or an acknowledgement: a fresh reading, with nowhere to go back to.
  const open = (id: string) => show(id, [])

  // A reload or a pasted link opens the movement it names. Read from the
  // address at mount: going back restores the server render, not this state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at mount
  useEffect(() => {
    const id = idParam(new URLSearchParams(window.location.search).get(PARAM) ?? undefined)
    if (id) open(id)
  }, [])

  // Closed by its own button, by Escape, or by another panel taking the dock:
  // the address stops naming it either way.
  useEffect(() => {
    if (panel.open || openedId === null) return
    setOpenedId(null)
    setDetail(null)
    setTrail([])
    writeParam(null)
  }, [panel.open, openedId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: version asks for a fresh read
  useEffect(() => {
    if (openedId === null) return
    let live = true
    setFailed(false)
    fetch(`/api/movements/${openedId}`)
      .then(async (response) => {
        if (!live) return
        // Not this user's, or no longer there: the address is ignored, as any
        // stale filter is.
        if (response.status === 404) return panel.setOpen(false)
        if (!response.ok) return setFailed(true)
        setDetail((await response.json()) as Detail)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [openedId, version])

  const shown = detail && detail.reading.id === openedId ? detail : null

  return (
    <MovementOpenerContext.Provider value={{ openedId, open }}>
      {children}
      <Sheet {...panel.sheet}>
        <SheetContent
          {...panel.content}
          className={cn('w-full gap-0 overflow-y-auto sm:max-w-md', panel.content.className)}
          aria-describedby={undefined}
        >
          <SheetHeader className="border-b border-border">
            {trail.length > 0 && !editing && (
              <button
                type="button"
                onClick={() => show(trail.at(-1)!.id, trail.slice(0, -1))}
                className="-ml-1.5 flex w-fit cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                <ArrowLeftIcon className="size-3.5" />
                {trail.at(-1)!.label}
              </button>
            )}
            <SheetTitle className="text-[15px]">
              {editing ? t('editTitle') : (shown?.reading.counterparty ?? t('loading'))}
            </SheetTitle>
          </SheetHeader>
          <div className="p-4">
            {failed ? (
              <p className="text-[12.5px] text-destructive">{t('failed')}</p>
            ) : !shown ? (
              <div className="flex flex-col gap-3" aria-busy>
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : editing ? (
              <div className="flex flex-col gap-6">
                <MovementForm
                  key={version}
                  accounts={accounts}
                  actors={actors}
                  categories={categories}
                  activities={activities}
                  cards={cards}
                  links={links}
                  today={today}
                  draft={shown.draft}
                  onSaved={() => {
                    setEditing(false)
                    setCorrected(true)
                    // Dropped so the reading waits for the fresh one, rather
                    // than acknowledging the correction over the old figures.
                    setDetail(null)
                    setVersion((v) => v + 1)
                  }}
                  onCancel={() => setEditing(false)}
                />
                <MovementDelete reading={shown.reading} onDeleted={() => panel.setOpen(false)} />
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <MovementReadingView
                  reading={shown.reading}
                  corrected={corrected}
                  from={from}
                  onFollow={(id) =>
                    show(id, [...trail, { id: shown.reading.id, label: shown.reading.counterparty }])
                  }
                />
                <Button
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    setCorrected(false)
                    setEditing(true)
                  }}
                >
                  <PencilIcon />
                  {t('edit')}
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </MovementOpenerContext.Provider>
  )
}

/** Rewrites the address in place: opening a movement is not a navigation. */
function writeParam(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set(PARAM, id)
  else url.searchParams.delete(PARAM)
  // Null state: Next takes the call as a plain rewrite and keeps its router in step.
  window.history.replaceState(null, '', url)
}

/**
 * Everything the movement carries, one fact per line. The amount leads, as on
 * its row; a dimension it could carry and does not (no category yet) reads as
 * such, since that is often why it was opened.
 */
function MovementReadingView({
  reading: r,
  corrected,
  from,
  onFollow,
}: {
  reading: MovementReading
  corrected: boolean
  from?: string
  /** Opens a linked movement in the same panel. */
  onFollow: (id: string) => void
}) {
  const t = useTranslations('movements')
  const format = useFormat()
  const isIncome = r.kind === 'income'
  const isTransfer = r.kind === 'transfer'

  const facts: [string, React.ReactNode][] = [
    [t('panel.type'), t(`form.types.${r.kind}`)],
    r.purchasedOn
      ? [
          t('panel.debit'),
          r.awaitingDebit
            ? t('panel.debitExpected', { date: format.date(r.happenedOn) })
            : format.date(r.happenedOn),
        ]
      : [t('panel.date'), format.date(r.happenedOn)],
  ]
  if (r.purchasedOn) facts.push([t('panel.purchase'), format.date(r.purchasedOn)])
  if (r.accrualMonth) facts.push([t('panel.accrualMonth'), format.month(r.accrualMonth)])
  if (isTransfer) {
    facts.push([t('panel.from'), r.account], [t('panel.to'), r.toAccount])
  } else {
    facts.push([isIncome ? t('panel.accountCredited') : t('panel.accountDebited'), r.account])
    if (r.card) facts.push([t('panel.card'), r.card])
    // A refund and money received for a commitment carry no category of their
    // own (the advance or the occurrences do), so they are not missing one.
    const linkedIncome = r.paysBack !== undefined || r.receivedFor !== undefined
    const none = <span className="text-faint">{t('panel.none')}</span>
    if (r.category || !linkedIncome) facts.push([t('panel.category'), r.category ?? none])
    if (r.activity || !linkedIncome) facts.push([t('panel.activity'), r.activity ?? none])
  }
  if (r.vatAmount) facts.push([t('panel.vat'), format.eur(Number(r.vatAmount), 2)])
  if (r.originalCurrency)
    facts.push([t('panel.originalAmount'), format.money(Number(r.originalAmount), r.originalCurrency)])
  if (r.invoice)
    facts.push([
      t('panel.invoice'),
      r.invoice.reference ?? t('panel.invoiceIssued', { date: format.date(r.invoice.issuedOn) }),
    ])
  // What a refund pays back, and what money was received for, show in their
  // own box below; a fact line stays only when the box has nothing to show.
  if (r.paysBack && !r.paysBackMovement && !r.commitment) facts.push([t('panel.paysBack'), r.paysBack])
  if (r.receivedFor && !r.commitment) facts.push([t('panel.receivedFor'), r.receivedFor])
  if (r.note) facts.push([t('panel.note'), r.note])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <span
          className={cn(
            'font-mono text-2xl tabular',
            isIncome ? 'text-good' : isTransfer ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {isIncome ? '+' : isTransfer ? '' : '−'}
          {format.eur(Number(r.amount), 2)}
        </span>
        {r.drawn && (
          <span className="text-[12px] text-faint">
            {t('list.drawnFromReserve', { amount: format.eur(Number(r.drawn), 2) })}
          </span>
        )}
        {r.ghost && <span className="text-[12px] text-faint">{t('panel.ghost')}</span>}
        {corrected && (
          <span aria-live="polite" className="text-xs text-good">
            ✓ {t('form.corrected')}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 text-[12.5px]">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="col-span-2 grid grid-cols-subgrid border-b border-border py-2 last:border-0"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {r.shares.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-muted-foreground">{t('panel.shares')}</h3>
          {/* One box per person, as the form has: who and their share, where
              it stands, and inside it what they paid back, refund by refund.
              A refund never sits beside a person it does not belong to. */}
          <ul className="flex flex-col gap-2">
            {r.shares.map((share) => (
              <li key={share.debtor} className="flex flex-col rounded-md border border-border">
                <div className="flex flex-col gap-0.5 px-3 py-2.5 text-[12.5px]">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{share.debtor}</span>
                    <span className="shrink-0 text-[11.5px] text-muted-foreground">
                      {t('panel.share', { amount: format.eur(Number(share.amount), 2) })}
                    </span>
                  </div>
                  <span className={share.state === 'open' ? 'text-primary' : 'text-muted-foreground'}>
                    {share.state === 'settled'
                      ? t('panel.settled')
                      : share.state === 'written_off'
                        ? t('panel.writtenOff', { refunded: format.eur(Number(share.refunded), 2) })
                        : t('panel.stillOwes', {
                            amount: format.eur(Number(share.amount) - Number(share.refunded), 2),
                          })}
                  </span>
                </div>
                {share.refunds.length > 0 && (
                  <div className="border-t border-border">
                    {share.refunds.map((refund) => (
                      <LinkedFold
                        key={refund.id}
                        movement={refund}
                        title={t('panel.refund')}
                        onOpen={onFollow}
                      />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.paysBackMovement && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-muted-foreground">{t('panel.paysBack')}</h3>
          <div className="rounded-md border border-border">
            <LinkedFold
              movement={r.paysBackMovement}
              title={r.paysBackMovement.counterparty}
              onOpen={onFollow}
            />
          </div>
        </section>
      )}

      {r.commitment && <CommitmentBox commitment={r.commitment} from={from} />}

      {/* An occurrence says where it comes from in its commitment's box. */}
      {r.origin && !(r.origin === 'commitment' && r.commitment) && (
        <p className="text-[11.5px] text-muted-foreground">{t(`form.origin.${r.origin}`)}</p>
      )}
    </div>
  )
}

/**
 * A movement linked to the one being read, as a line that unfolds on its first
 * facts: enough to recognise it, and the way to open it whole in the panel.
 * Folded, it says what it is, when and how much, which tells two refunds apart.
 * It sits inside the box of what it belongs to, which draws the border.
 */
function LinkedFold({
  movement: m,
  title,
  onOpen,
}: {
  movement: LinkedMovement
  title: string
  onOpen: (id: string) => void
}) {
  const t = useTranslations('movements.panel')
  const format = useFormat()
  const isIncome = m.kind === 'income'
  const facts: [string, string][] = [[t('account'), m.account]]
  if (m.category) facts.push([t('category'), m.category])
  if (m.note) facts.push([t('note'), m.note])
  return (
    <details className="fold group/linked border-b border-border last:border-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12.5px] [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3 shrink-0 text-faint transition-transform group-open/linked:rotate-90" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 font-mono text-[11.5px] text-faint">{format.date(m.on)}</span>
        <span className={cn('shrink-0 font-mono tabular', isIncome && 'text-good')}>
          {isIncome ? '+' : m.kind === 'transfer' ? '' : '−'}
          {format.eur(Number(m.amount), 2)}
        </span>
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3 pl-8">
        <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-4 gap-y-1 text-[12px]">
          {facts.map(([label, value]) => (
            <div key={label} className="col-span-2 grid grid-cols-subgrid">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={() => onOpen(m.id)}
          className="inline-flex w-fit cursor-pointer items-center gap-1 text-[12px] text-foreground underline-offset-2 hover:underline"
        >
          {t('openLinked')}
          <ArrowRightIcon className="size-3" />
        </button>
      </div>
    </details>
  )
}

/**
 * The commitment a movement is tied to, as a box that leads to it: its name,
 * what kind it is and its rhythm, its amount. A commitment has no page of its
 * own, so the box lands on its row, on the screen that lists it.
 */
function CommitmentBox({ commitment: c, from }: { commitment: LinkedCommitment; from?: string }) {
  const t = useTranslations('movements.panel')
  const tr = useTranslations('recurring')
  const format = useFormat()
  const heading = {
    occurrence: t('occurrenceOf'),
    reserve: t('receivedFor'),
    refund: t('paysBack'),
    advance: t('advanceOn'),
  }[c.relation]
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-medium text-muted-foreground">{heading}</h3>
      <Link
        href={from ? `${c.href}&from=${from}` : c.href}
        className="group/commitment flex items-center gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-muted/50"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[12.5px] font-medium">{c.label}</span>
          <span className="truncate text-[11.5px] text-muted-foreground">
            {t('commitmentKind', { kind: c.kind })} ·{' '}
            {tr('rhythm', { unit: c.periodUnit, count: c.periodCount })}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[12.5px] tabular">
          {c.currency === 'EUR'
            ? format.eur(Number(c.amount), 2)
            : format.money(Number(c.amount), c.currency)}
        </span>
        <ArrowRightIcon className="size-3.5 shrink-0 text-faint transition-colors group-hover/commitment:text-foreground" />
      </Link>
    </section>
  )
}

/**
 * The last gesture of a correction: deleting, behind a confirmation that names
 * the movement, because nothing else undoes it.
 */
function MovementDelete({ reading, onDeleted }: { reading: MovementReading; onDeleted: () => void }) {
  const t = useTranslations('movements.panel')
  const format = useFormat()
  const [confirming, setConfirming] = useState(false)
  const [state, remove, pending] = useActionState(deleteMovementAction, {})
  const label = `${format.date(reading.happenedOn)} · ${reading.counterparty} · ${format.eur(Number(reading.amount), 2)}`

  // Close on success only: a refused deletion has a reason to show.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the outcome only
  useEffect(() => {
    if (state.ok) {
      setConfirming(false)
      onDeleted()
    }
  }, [state.ok])

  return (
    // Set apart in a zone of its own, far from Save: the one gesture here that
    // nothing undoes.
    <section className="mt-2 flex flex-col gap-3 rounded-md border border-destructive/40 p-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[12.5px] font-medium text-destructive">{t('deleteZone')}</h3>
        <p className="text-[12px] text-muted-foreground">{t('deleteZoneHint')}</p>
      </div>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="self-start"
        onClick={() => setConfirming(true)}
      >
        {t('delete')}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDescription', { label })}</AlertDialogDescription>
          </AlertDialogHeader>
          {state.error && <p className="text-xs text-destructive">{state.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <form action={remove}>
              <input type="hidden" name="movementId" value={reading.id} />
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? '…' : t('delete')}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
