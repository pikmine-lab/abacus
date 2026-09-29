import type { Card, CardStatement } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

export interface NewCard {
  userId: string
  name: string
  accountId: string
  expiryMonth: string
  debitMode: Card['debitMode']
  statementDay?: number | null
  statementShift?: Card['statementShift']
  debitDay?: number | null
  debitShift?: Card['debitShift']
}

export async function insertCard(tx: Executor, row: NewCard): Promise<Card> {
  const [card] = await tx<Card[]>`insert into card ${tx(compact(row))} returning *`
  return card!
}

export async function getCard(tx: Executor, userId: string, id: string): Promise<Card | undefined> {
  const [card] = await tx<Card[]>`select * from card where user_id = ${userId} and id = ${id}`
  return card
}

export async function listCards(tx: Executor, userId: string): Promise<Card[]> {
  return await tx<Card[]>`select * from card where user_id = ${userId} order by name`
}

export async function updateCardRow(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Card | undefined> {
  const [card] = await tx<Card[]>`
    update card set ${tx(patch)}, updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning *
  `
  return card
}

export async function deleteCardRow(tx: Executor, userId: string, id: string): Promise<void> {
  await tx`delete from card where user_id = ${userId} and id = ${id}`
}

/** What still names a card: the movements paid with it, the subscriptions billed to it. */
export async function cardReferences(
  tx: Executor,
  cardId: string,
): Promise<{ movements: number; commitments: number }> {
  const [row] = await tx<{ movements: string; commitments: string }[]>`
    select
      (select count(*) from movement where card_id = ${cardId}) as movements,
      (select count(*) from commitment where card_id = ${cardId}) as commitments
  `
  return { movements: Number(row!.movements), commitments: Number(row!.commitments) }
}

/** A statement and what its purchases add up to: what the bank takes, net of refunds. */
export type StatementWithTotal = CardStatement & { amount: string; purchases: number }

/**
 * The statement of a cycle, created when it is the cycle's first purchase. The
 * expected debit follows the schedule as long as nothing was stated, so a
 * corrected schedule moves it; a stated one is left as the bank said.
 */
export async function statementFor(
  tx: Executor,
  cardId: string,
  cycle: { cutOffOn: string; dueOn: string },
): Promise<CardStatement> {
  const [statement] = await tx<CardStatement[]>`
    insert into card_statement (card_id, cut_off_on, due_on)
    values (${cardId}, ${cycle.cutOffOn}, ${cycle.dueOn})
    on conflict (card_id, cut_off_on) do update
      set due_on = case when card_statement.debited_on is null then excluded.due_on else card_statement.due_on end
    returning id, card_id, cut_off_on, due_on, debited_on
  `
  return statement!
}

export async function getStatement(
  tx: Executor,
  userId: string,
  id: string,
): Promise<(CardStatement & { cardName: string }) | undefined> {
  const [statement] = await tx<(CardStatement & { cardName: string })[]>`
    select s.id, s.card_id, s.cut_off_on, s.due_on, s.debited_on, c.name as card_name
    from card_statement s join card c on c.id = s.card_id
    where s.id = ${id} and c.user_id = ${userId}
  `
  return statement
}

/**
 * Statements with their totals, most recent cycle first: those of one card, or
 * every card's still waiting for their debit day.
 */
export async function listStatements(
  tx: Executor,
  userId: string,
  filter: { cardId?: string; pendingOnly?: boolean },
): Promise<StatementWithTotal[]> {
  return await tx<StatementWithTotal[]>`
    select s.id, s.card_id, s.cut_off_on, s.due_on, s.debited_on,
           coalesce(sum(case when m.source_account_id is not null then m.amount else -m.amount end), 0)::numeric(14,2) as amount,
           count(m.id)::int as purchases
    from card_statement s
    join card c on c.id = s.card_id
    left join movement m on m.card_statement_id = s.id
    where c.user_id = ${userId}
    ${filter.cardId ? tx`and s.card_id = ${filter.cardId}` : tx``}
    ${filter.pendingOnly ? tx`and s.debited_on is null` : tx``}
    group by s.id
    order by s.cut_off_on desc
  `
}

/** States the day the bank debited a statement, or takes it back with null. */
export async function setStatementDebit(tx: Executor, id: string, debitedOn: string | null): Promise<void> {
  await tx`update card_statement set debited_on = ${debitedOn}, updated_at = now() where id = ${id}`
}

/** Redates every purchase of a statement on its debit: the stated one, the expected one otherwise. */
export async function dateOnStatement(tx: Executor, id: string): Promise<void> {
  await tx`
    update movement m set happened_on = coalesce(s.debited_on, s.due_on), updated_at = now()
    from card_statement s
    where s.id = ${id} and m.card_statement_id = s.id
  `
}

/** The purchases of a card whose statement has no debit day yet. */
export async function pendingPurchases(
  tx: Executor,
  cardId: string,
): Promise<{ id: string; purchasedOn: string }[]> {
  return await tx<{ id: string; purchasedOn: string }[]>`
    select m.id, m.purchased_on from movement m
    join card_statement s on s.id = m.card_statement_id
    where m.card_id = ${cardId} and s.debited_on is null
  `
}

/** Moves a purchase onto another statement, or back to its own day when its card no longer defers. */
export async function placePurchase(
  tx: Executor,
  movementId: string,
  place: { statement: CardStatement } | { purchasedOn: string },
): Promise<void> {
  if ('statement' in place)
    await tx`
      update movement set card_statement_id = ${place.statement.id},
        happened_on = ${place.statement.debitedOn ?? place.statement.dueOn}, updated_at = now()
      where id = ${movementId}
    `
  else
    await tx`
      update movement set card_statement_id = null, purchased_on = null,
        happened_on = ${place.purchasedOn}, updated_at = now()
      where id = ${movementId}
    `
}

/** A statement nothing sits on any more says nothing: it goes. */
export async function dropEmptyStatements(tx: Executor, cardId: string): Promise<void> {
  await tx`
    delete from card_statement s
    where s.card_id = ${cardId}
      and not exists (select 1 from movement m where m.card_statement_id = s.id)
  `
}

/**
 * The condition a balance puts on a movement of alias `m`: a purchase counts
 * once its statement has a debit day, since until then nothing has left the
 * account. Written once, because every balance must leave out the same ones.
 */
export function debitedOnly(tx: Executor, alias: string) {
  return tx`(${tx(alias)}.card_statement_id is null or exists (
    select 1 from card_statement cs
    where cs.id = ${tx(alias)}.card_statement_id and cs.debited_on is not null
  ))`
}
