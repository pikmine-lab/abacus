// Row shapes as the datasources return them (camelCase via the client
// transform). Amounts are strings: they are numeric in PostgreSQL and all
// arithmetic happens in SQL; JavaScript only transports the values.

export type AccountBehavior = 'payment' | 'savings' | 'investment'

export interface Account {
  id: string
  userId: string
  name: string
  institution: string | null
  behavior: AccountBehavior
  currency: string
  openedOn: string | null
  closedOn: string | null
}

export interface Activity {
  id: string
  userId: string
  name: string
}

export interface Category {
  id: string
  userId: string
  name: string
  groupLabel: string | null
}

export interface Actor {
  id: string
  userId: string
  name: string
  activityId: string | null
  note: string | null
}

export type MovementKind = 'transfer' | 'expense' | 'income'

export interface Movement {
  id: string
  userId: string
  happenedOn: string
  amount: string
  currency: string
  sourceAccountId: string | null
  sourceActorId: string | null
  targetAccountId: string | null
  targetActorId: string | null
  kind: MovementKind
  categoryId: string | null
  activityId: string | null
  note: string | null
  commitmentId: string | null
  balanceCheckId: string | null
  expectedRefundFromActorId: string | null
  refundClosed: boolean
  refundsMovementId: string | null
}

export type CommitmentKind = 'subscription' | 'financing'
export type CommitmentDirection = 'outgoing' | 'incoming'
export type PeriodUnit = 'week' | 'month' | 'year'
export type Judgment = 'essential' | 'reducible' | 'to_cancel'

export interface Commitment {
  id: string
  userId: string
  kind: CommitmentKind
  direction: CommitmentDirection
  label: string
  actorId: string
  accountId: string
  categoryId: string | null
  activityId: string | null
  amount: string
  currency: string
  periodUnit: PeriodUnit
  periodCount: number
  nextDueOn: string
  judgment: Judgment | null
  judgmentNote: string | null
  engagedUntil: string | null
  cancelledOn: string | null
  installmentsTotal: number | null
  totalAmount: string | null
}

export type CommitmentEventType = 'created' | 'price_changed' | 'judgment_changed' | 'cancelled'

export interface CommitmentEvent {
  id: string
  commitmentId: string
  occurredOn: string
  type: CommitmentEventType
  amount: string | null
  note: string | null
}

export interface BalanceCheck {
  id: string
  userId: string
  accountId: string
  checkedOn: string
  declaredBalance: string
  computedBalance: string
  note: string | null
}
