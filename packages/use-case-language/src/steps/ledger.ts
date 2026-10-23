import type { Money } from '../index.ts'

/**
 * A movement as the person points at it: the day it happened and who it was
 * with, the payee of an expense, the payer of an income, the account a
 * transfer went to. A case never declares two movements a pointer would mix up.
 */
export interface MovementRef {
  counterparty: string
  on: string
}

/** One person owing part of an expense back. */
export interface ShareOwed {
  debtor: string
  amount: Money
}

/** What a movement is tied to, each absent when it has none. */
export interface MovementLinks {
  /** The activity it belongs to. */
  activity?: string
  /** The commitment it is tied to: an occurrence of it, money received for it, a refund on it. */
  commitment?: string
  /** The reference of the invoice an income pays. */
  invoice?: string
  /** What wrote it: a confirmed occurrence of a commitment, or the settling of a balance check gap. */
  origin?: 'commitment' | 'balanceCheck'
}

/** The steps of movements and their links. */
export interface LedgerSteps {
  declareExpense(input: { account: string; amount: Money; payee: string; on: string }): Promise<void>
  declareIncome(input: { account: string; amount: Money; payer: string; on: string }): Promise<void>
  declareTransfer(input: { from: string; to: string; amount: Money; on: string }): Promise<void>
  /** An expense paid for others too: each share is what one person owes back of it. */
  declareSharedExpense(input: {
    account: string
    amount: Money
    payee: string
    on: string
    shares: ShareOwed[]
  }): Promise<void>
  /** An income from a debtor, declared as paying back their share of an expense. */
  declareRefund(input: {
    account: string
    amount: Money
    debtor: string
    on: string
    refunds: MovementRef
  }): Promise<void>
  correctMovementAmount(input: { movement: MovementRef; amount: Money }): Promise<void>
  deleteMovement(movement: MovementRef): Promise<void>
  /** The income no longer pays back anything: it is a plain income again. */
  unlinkRefund(refund: MovementRef): Promise<void>
  /** What was spent at a payee over a month, net of the refunds received. */
  readNetSpent(input: { payee: string; month: string }): Promise<Money>
  /** Files a movement under one of the person's categories. */
  fileMovement(input: { movement: MovementRef; category: string }): Promise<void>
  /** What a movement is tied to, read on the movement itself. */
  readMovementLinks(movement: MovementRef): Promise<MovementLinks>
}
