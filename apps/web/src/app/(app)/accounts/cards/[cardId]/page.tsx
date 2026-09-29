import { auth } from '@abacus/core/auth'
import type { Movement } from '@abacus/core/domain'
import { isValidOn } from '@abacus/core/domain/card'
import { addPeriod, endOfMonth, today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { cardStatements, listCards } from '@abacus/core/services/cards'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import { listCommitments, monthlyEquivalentEur } from '@abacus/core/services/commitments'
import { listMovements } from '@abacus/core/services/movements'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { BankCard } from '@/components/bank-card'
import { CardActions, ValidateStatement } from '@/components/card-forms'
import { MovementRowActions } from '@/components/movement-row-actions'
import { EmptyLine, PageBody, PageHeader, Rows, Section, SectionLink } from '@/components/page-shell'
import { StatementFold } from '@/components/statement-fold'
import { StatRow, StatTile } from '@/components/stats'
import { movementDraft, movementFormOptions } from '@/lib/movement-form-data'
import { eur, frDate, frMonthLong } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/**
 * One card, and the question it is opened for: what did it pay, and what does
 * it still owe the account? A deferred card answers by statement, one per
 * cycle, each with its purchases and its validation; an immediate one by the
 * list of what it paid. The subscriptions billed to it close the page, since
 * they are what a renewed card has to be given again.
 */
export default async function CardPage({ params }: { params: Promise<{ cardId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const { cardId } = await params
  const now = today()

  const cards = await listCards(userId)
  const card = cards.find((c) => c.id === cardId)
  // An id that designates nothing for this user is a 404, never someone
  // else's card: the lookup is scoped to them before anything is read.
  if (!card) notFound()
  const deferred = card.debitMode === 'deferred'

  const [accounts, actors, categories, activities, movements, statements, commitments] = await Promise.all([
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
    listActivities(userId),
    listMovements(userId, { cardId, limit: 1000 }),
    deferred ? cardStatements(userId, cardId) : Promise.resolve([]),
    listCommitments(userId),
  ])
  const account = accounts.find((a) => a.id === card.accountId)
  const actorName = new Map(actors.map((a) => [a.id, a.name]))
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const options = movementFormOptions({ accounts, actors, categories, activities, cards })
  const cardAccounts = accounts
    .filter((a) => a.behavior === 'payment' && !a.closedOn)
    .map((a) => ({ id: a.id, name: a.name }))
  const subscriptions = commitments.filter((c) => c.cardId === cardId && !c.cancelledOn)

  const purchaseDay = (m: Movement) => m.purchasedOn ?? m.happenedOn
  const signed = (m: Movement) => (m.kind === 'income' ? -Number(m.amount) : Number(m.amount))
  // What it paid this month, by the day of each purchase: the question a card
  // is asked about, whatever day the bank debits it.
  const month = now.slice(0, 7)
  const paidThisMonth = movements
    .filter((m) => purchaseDay(m).startsWith(month))
    .reduce((sum, m) => sum + signed(m), 0)
  const owed = card.pending.reduce((sum, s) => sum + Number(s.amount), 0)
  const nextDebit = card.pending[0]
  const expired = !isValidOn(card, now)
  const expiring = !expired && endOfMonth(card.expiryMonth) <= endOfMonth(addPeriod(now, 'month', 1))

  const row = (m: Movement) => {
    const income = m.kind === 'income'
    const counterparty = actorName.get((income ? m.sourceActorId : m.targetActorId)!) ?? '?'
    return (
      <div key={m.id} className="flex items-center gap-3 py-2.5">
        <span className="w-20 shrink-0 font-mono text-[11.5px] text-faint">{frDate(purchaseDay(m))}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px]">{counterparty}</span>
          {m.note && <span className="truncate text-[11px] text-faint">{m.note}</span>}
        </div>
        <span className="hidden w-40 truncate text-[12px] text-muted-foreground md:block">
          {m.categoryId ? (categoryName.get(m.categoryId) ?? '') : ''}
        </span>
        <span
          className={`w-24 shrink-0 text-right font-mono text-[13px] tabular ${income ? 'text-good' : ''}`}
        >
          {income ? '+' : '−'}
          {eur(Number(m.amount), 2)}
        </span>
        <MovementRowActions
          {...options}
          today={now}
          label={`${frDate(purchaseDay(m))} · ${counterparty} · ${eur(Number(m.amount), 2)}`}
          draft={movementDraft(m, actorName)}
        />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title={card.name}
        description={`${deferred ? 'débit différé' : 'débit immédiat'} sur ${account?.name ?? ''}`}
      >
        <CardActions
          cardId={card.id}
          accounts={cardAccounts}
          today={now}
          afterDelete="/accounts"
          defaults={{
            name: card.name,
            accountId: card.accountId,
            expiryMonth: card.expiryMonth.slice(0, 7),
            debitMode: card.debitMode,
            statementDay: card.statementDay ?? undefined,
            statementShift: card.statementShift ?? undefined,
            debitDay: card.debitDay ?? undefined,
            debitShift: card.debitShift ?? undefined,
          }}
        />
      </PageHeader>

      <PageBody>
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <div className="flex w-full shrink-0 flex-col gap-2 md:w-72">
            <BankCard
              id={card.id}
              name={card.name}
              accountName={account?.name ?? ''}
              expiryMonth={card.expiryMonth}
              deferred={deferred}
              expired={expired}
            />
            <div className="flex flex-col gap-0.5 text-[11.5px]">
              {deferred && (
                <span className="text-faint">
                  arrêté {dayLabel(card.statementDay!)}, prélevé {dayLabel(card.debitDay!)}
                </span>
              )}
              {expired && <span className="text-destructive">expirée : elle ne paie plus</span>}
              {expiring && (
                <span className="text-muted-foreground">
                  expire fin {frMonthLong(card.expiryMonth)} : à renouveler
                </span>
              )}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <StatRow>
              {deferred && (
                <StatTile
                  hero
                  label="À prélever"
                  value={eur(owed, 2)}
                  hint={
                    nextDebit
                      ? `${card.pending.length} relevé${card.pending.length > 1 ? 's' : ''} en attente, le premier attendu le ${frDate(nextDebit.dueOn)}`
                      : 'rien en attente'
                  }
                />
              )}
              <StatTile
                hero={!deferred}
                label={`Payé en ${frMonthLong(month).split(' ')[0]}`}
                value={eur(paidThisMonth, 2)}
                hint="par date d’achat"
              />
            </StatRow>
          </div>
        </div>

        {deferred ? (
          <Section title="Relevés" description="un par cycle, dans le solde une fois validé au jour du débit">
            {statements.length === 0 ? (
              <EmptyLine>Aucun achat pour l’instant.</EmptyLine>
            ) : (
              <Rows>
                {statements.map((statement) => {
                  const closed = statement.cutOffOn < now
                  const purchases = movements
                    .filter((m) => m.cardStatementId === statement.id)
                    .sort((a, b) => purchaseDay(b).localeCompare(purchaseDay(a)))
                  const state = statement.debitedOn
                    ? `débité le ${frDate(statement.debitedOn)}`
                    : !closed
                      ? 'en cours'
                      : statement.dueOn <= now
                        ? `attendu le ${frDate(statement.dueOn)}, à valider`
                        : `attendu le ${frDate(statement.dueOn)}`
                  return (
                    <StatementFold
                      key={statement.id}
                      id={`statement-${statement.id}`}
                      open={!statement.debitedOn}
                      header={
                        <>
                          <span className="text-[13px] font-medium">
                            Cycle arrêté le {frDate(statement.cutOffOn)}
                          </span>
                          <span className="text-[11.5px] text-faint">
                            {statement.purchases} achat{statement.purchases > 1 ? 's' : ''} · {state}
                          </span>
                        </>
                      }
                      figures={
                        <>
                          <span className="font-mono text-[13px] font-semibold tabular">
                            −{eur(Number(statement.amount), 2)}
                          </span>
                          {closed && (
                            <ValidateStatement
                              cardName={card.name}
                              statement={{
                                id: statement.id,
                                cutOffOn: statement.cutOffOn,
                                dueOn: statement.dueOn,
                                debitedOn: statement.debitedOn,
                                amount: Number(statement.amount),
                                purchases: statement.purchases,
                              }}
                              today={now}
                              urgent={!statement.debitedOn && statement.dueOn <= now}
                            />
                          )}
                        </>
                      }
                    >
                      {purchases.map(row)}
                    </StatementFold>
                  )
                })}
              </Rows>
            )}
          </Section>
        ) : (
          <Section title="Achats" description="tout ce qu’elle a payé, le plus récent d’abord">
            {movements.length === 0 ? (
              <EmptyLine>Rien n’a encore été payé avec cette carte.</EmptyLine>
            ) : (
              <Rows>
                {[...movements].sort((a, b) => purchaseDay(b).localeCompare(purchaseDay(a))).map(row)}
              </Rows>
            )}
          </Section>
        )}

        {subscriptions.length > 0 && (
          <Section
            title="Abonnements"
            description="payés avec cette carte, à lui redonner quand elle est renouvelée"
            action={<SectionLink href="/recurring-expenses?from=accounts">Dépenses récurrentes</SectionLink>}
          >
            <Rows>
              {subscriptions.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px]">{c.label}</span>
                    <span className="text-[11.5px] text-faint">prochaine le {frDate(c.nextDueOn)}</span>
                  </div>
                  <span className="ml-auto shrink-0 font-mono text-[13px] tabular">
                    −{eur(monthlyEquivalentEur(c), 2)}
                    <span className="text-[11px] text-faint"> /mois</span>
                  </span>
                </div>
              ))}
            </Rows>
          </Section>
        )}
      </PageBody>
    </>
  )
}

/** "le 25", or "en fin de mois" for the 31st, which is how a bank says it. */
function dayLabel(day: number): string {
  return day === 31 ? 'en fin de mois' : `le ${day}`
}
