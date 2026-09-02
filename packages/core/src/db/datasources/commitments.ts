import { today } from '../../domain/period.ts'
import type { Commitment, CommitmentEvent, CommitmentEventType } from '../../domain/types.ts'
import { compact, type Executor } from '../client.ts'

export interface NewCommitment {
  userId: string
  kind: Commitment['kind']
  direction?: Commitment['direction']
  label: string
  actorId?: string | null
  accountId: string
  targetAccountId?: string | null
  /**
   * Written whenever a target is, because the composite foreign key that keeps
   * the target an investment account is satisfied as soon as one side is null.
   */
  targetAccountBehavior?: 'investment' | null
  assetId?: string | null
  categoryId?: string | null
  activityId?: string | null
  amount: number
  currency?: string
  periodUnit: Commitment['periodUnit']
  periodCount?: number
  nextDueOn: string
  judgment?: Commitment['judgment']
  judgmentNote?: string | null
  engagedUntil?: string | null
  installmentsTotal?: number | null
  totalAmount?: number | null
}

/**
 * A commitment as stored, before the dated account history is applied:
 * `accountId` is the account it started on.
 */
type StoredCommitment = Omit<Commitment, 'nextAccountMove'>

/** The stored row plus what the two lateral joins below resolved. */
interface ReadCommitment extends StoredCommitment {
  movedAccountId: string | null
  movingToAccountId: string | null
  movingOn: string | null
}

/**
 * The account in force on a date: the last move declared on or before it. Ties
 * on a date go to the last one declared, so re-announcing a move for the same
 * day corrects it instead of being refused.
 */
function accountOn(tx: Executor, on: string) {
  return tx`
    left join lateral (
      select e.account_id from commitment_event e
      where e.commitment_id = c.id and e.type = 'account_changed' and e.occurred_on <= ${on}
      order by e.occurred_on desc, e.created_at desc limit 1
    ) moved on true
    left join lateral (
      select e.account_id, e.occurred_on from commitment_event e
      where e.commitment_id = c.id and e.type = 'account_changed' and e.occurred_on > ${on}
      order by e.occurred_on, e.created_at limit 1
    ) moving on true
  `
}

const READ = (tx: Executor) => tx`
  c.*,
  moved.account_id as moved_account_id,
  moving.account_id as moving_to_account_id,
  moving.occurred_on as moving_on
`

/**
 * What a commitment says today: the account in force now, and the next move
 * already announced. Callers see one account and one announcement; where they
 * come from stays here.
 */
function asCommitment(row: ReadCommitment): Commitment {
  const { movedAccountId, movingToAccountId, movingOn, ...stored } = row
  return {
    ...stored,
    accountId: movedAccountId ?? stored.accountId,
    nextAccountMove: movingToAccountId ? { accountId: movingToAccountId, effectiveOn: movingOn! } : null,
  }
}

export async function insertCommitment(tx: Executor, row: NewCommitment): Promise<Commitment> {
  const [commitment] = await tx<StoredCommitment[]>`insert into commitment ${tx(compact(row))} returning *`
  return { ...commitment!, nextAccountMove: null }
}

export async function getCommitment(
  tx: Executor,
  userId: string,
  id: string,
  on = today(),
): Promise<Commitment | undefined> {
  const [commitment] = await tx<ReadCommitment[]>`
    select ${READ(tx)} from commitment c ${accountOn(tx, on)}
    where c.user_id = ${userId} and c.id = ${id}
  `
  return commitment && asCommitment(commitment)
}

/** Same row, locked against a concurrent confirm/skip until the transaction ends. */
export async function getCommitmentForUpdate(
  tx: Executor,
  userId: string,
  id: string,
  on = today(),
): Promise<Commitment | undefined> {
  const [commitment] = await tx<ReadCommitment[]>`
    select ${READ(tx)} from commitment c ${accountOn(tx, on)}
    where c.user_id = ${userId} and c.id = ${id}
    for update of c
  `
  return commitment && asCommitment(commitment)
}

export async function listCommitments(
  tx: Executor,
  userId: string,
  opts: { activeOnly?: boolean; on?: string } = {},
): Promise<Commitment[]> {
  const rows = await tx<ReadCommitment[]>`
    select ${READ(tx)} from commitment c ${accountOn(tx, opts.on ?? today())}
    where c.user_id = ${userId}
    ${opts.activeOnly ? tx`and c.cancelled_on is null` : tx``}
    order by c.next_due_on
  `
  return rows.map(asCommitment)
}

export async function updateCommitment(
  tx: Executor,
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Commitment | undefined> {
  const [updated] = await tx<{ id: string }[]>`
    update commitment set ${tx({ ...patch, updatedAt: new Date() })}
    where user_id = ${userId} and id = ${id}
    returning id
  `
  return updated && (await getCommitment(tx, userId, id))
}

export async function insertCommitmentEvent(
  tx: Executor,
  commitmentId: string,
  occurredOn: string,
  type: CommitmentEventType,
  amount?: number | null,
  note?: string | null,
  accountId?: string | null,
  currency?: string | null,
): Promise<CommitmentEvent> {
  const [event] = await tx<CommitmentEvent[]>`
    insert into commitment_event (commitment_id, occurred_on, type, amount, note, account_id, currency)
    values (${commitmentId}, ${occurredOn}, ${type}, ${amount ?? null}, ${note ?? null}, ${accountId ?? null}, ${currency ?? null})
    returning *
  `
  return event!
}

/** One account this commitment hit, from a date. */
export interface AccountPeriod {
  accountId: string
  /** When it took over; null for the account it started on. */
  since: string | null
}

/**
 * Every account this commitment has hit, oldest first. Read whole because
 * confirming an occurrence asks for the account of a past date, and a page
 * asks it for several occurrences at once.
 */
export async function accountTimeline(tx: Executor, commitmentId: string): Promise<AccountPeriod[]> {
  return await tx<AccountPeriod[]>`
    select account_id, since from (
      select account_id, null::date as since, created_at from commitment where id = ${commitmentId}
      union all
      select account_id, occurred_on as since, created_at from commitment_event
      where commitment_id = ${commitmentId} and type = 'account_changed'
    ) periods
    order by since asc nulls first, created_at asc
  `
}

/**
 * The plans that buy an asset, cancelled ones included: a plan that ran is part
 * of the history even once stopped, and its occurrences name the asset.
 */
export async function countPlansForAsset(tx: Executor, assetId: string): Promise<number> {
  const [row] = await tx<{ count: string }[]>`
    select count(*) as count from commitment where asset_id = ${assetId}
  `
  return Number(row!.count)
}

export async function listCommitmentEvents(tx: Executor, commitmentId: string): Promise<CommitmentEvent[]> {
  return await tx<CommitmentEvent[]>`
    select * from commitment_event where commitment_id = ${commitmentId} order by occurred_on, created_at
  `
}
