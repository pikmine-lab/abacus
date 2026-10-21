import { eur, type Steps } from '@abacus/use-case-language'
import {
  closeAccount,
  createAccount,
  editAccount,
  listAccounts,
  reopenAccount,
} from '../src/services/accounts.ts'
import {
  correctBalanceCheck,
  createAdjustment,
  deleteBalanceCheck,
  listChecks,
  recordBalanceCheck,
} from '../src/services/balanceChecks.ts'
import {
  cardStatements,
  confirmStatement,
  createCard,
  deleteCard,
  editCard,
  listCards,
} from '../src/services/cards.ts'
import { declareMovement } from '../src/services/movements.ts'
import { amountOf, type PreparationContext } from './context.ts'

const money = (value: string | number) => eur(Number(value).toFixed(2))

export function accountsSteps({ user, accountId, actorId }: PreparationContext): Partial<Steps> {
  async function card(name: string) {
    const found = (await listCards(user.id)).find((c) => c.name === name)
    if (!found) throw new Error(`no card named "${name}"`)
    return found
  }
  async function statementId(cardName: string, cutOff: string) {
    const found = (await cardStatements(user.id, (await card(cardName)).id)).find(
      (s) => s.cutOffOn === cutOff,
    )
    if (!found) throw new Error(`no statement of "${cardName}" cut off on ${cutOff}`)
    return found.id
  }
  async function checkId(account: string, on: string) {
    const found = (await listChecks(user.id, await accountId(account))).find((e) => e.check.checkedOn === on)
    if (!found) throw new Error(`no check of "${account}" on ${on}`)
    return found.check.id
  }

  return {
    async createAccount({ name, opening, openedOn }) {
      await createAccount({
        userId: user.id,
        name,
        behavior: 'payment',
        openingBalance: opening ? amountOf(opening) : undefined,
        openedOn: opening ? (openedOn ?? '2026-01-01') : openedOn,
      })
    },
    async readAccountBalance(account) {
      const found = (await listAccounts(user.id)).find((a) => a.name === account)
      if (!found) throw new Error(`no account named "${account}"`)
      return eur(Number(found.balance).toFixed(2))
    },
    async editAccount({ account, name, institution, opening, openedOn }) {
      await editAccount(user.id, await accountId(account), {
        name,
        institution,
        openingBalance: opening ? amountOf(opening) : undefined,
        openedOn,
      })
    },
    async closeAccount(account) {
      await closeAccount(user.id, await accountId(account))
    },
    async reopenAccount(account) {
      await reopenAccount(user.id, await accountId(account))
    },
    async readAccount(account) {
      const found = (await listAccounts(user.id)).find((a) => a.name === account)
      if (!found) throw new Error(`no account named "${account}"`)
      return {
        ...(found.institution ? { institution: found.institution } : {}),
        balance: money(found.balance),
        closed: found.closedOn !== null,
      }
    },

    async createCard(input) {
      await createCard(user.id, {
        name: input.name,
        accountId: await accountId(input.account),
        expiryMonth: input.expiry,
        debitMode: input.debit,
        ...(input.debit === 'deferred' && {
          statementDay: input.cutOffDay,
          statementShift: 'none',
          debitDay: input.debitDay,
          debitShift: 'none',
        }),
      })
    },
    async editCard({ card: name, name: newName, expiry }) {
      await editCard(user.id, (await card(name)).id, { name: newName, expiryMonth: expiry })
    },
    async deleteCard(name) {
      await deleteCard(user.id, (await card(name)).id)
    },
    async readCards(account) {
      const id = await accountId(account)
      return (await listCards(user.id))
        .filter((c) => c.accountId === id)
        .map((c) =>
          c.debitMode === 'deferred'
            ? {
                name: c.name,
                expiry: c.expiryMonth.slice(0, 7),
                debit: 'deferred' as const,
                cutOffDay: c.statementDay!,
                debitDay: c.debitDay!,
              }
            : { name: c.name, expiry: c.expiryMonth.slice(0, 7), debit: 'immediate' as const },
        )
    },
    async declareCardPurchase({ card: name, amount, payee, on }) {
      const paidWith = await card(name)
      await declareMovement(user.id, {
        happenedOn: on,
        amount: amountOf(amount),
        sourceAccountId: paidWith.accountId,
        targetActorId: await actorId(payee),
        cardId: paidWith.id,
      })
    },
    async validateStatement({ card: name, cutOff, debitedOn }) {
      await confirmStatement(user.id, await statementId(name, cutOff), debitedOn)
    },
    async undoStatement({ card: name, cutOff }) {
      await confirmStatement(user.id, await statementId(name, cutOff), null)
    },
    async readCardStatements(name) {
      return (await cardStatements(user.id, (await card(name)).id)).map((s) => ({
        cutOff: s.cutOffOn,
        ...(s.debitedOn ? { debitedOn: s.debitedOn } : {}),
        amount: money(s.amount),
      }))
    },

    async recordBalanceCheck({ account, balance }) {
      await recordBalanceCheck(user.id, await accountId(account), amountOf(balance))
    },
    async correctBalanceCheck({ account, on, balance }) {
      await correctBalanceCheck(user.id, await checkId(account, on), { declaredBalance: amountOf(balance) })
    },
    async deleteBalanceCheck({ account, on }) {
      await deleteBalanceCheck(user.id, await checkId(account, on))
    },
    async settleCheckGap({ account, on, actor }) {
      await createAdjustment(user.id, await checkId(account, on), { actorId: await actorId(actor) })
    },
    async readBalanceChecks(account) {
      return (await listChecks(user.id, await accountId(account))).map((e) => ({
        on: e.check.checkedOn,
        declared: money(e.check.declaredBalance),
        computed: money(e.check.computedBalance),
        gap: money(e.gap),
        settled: e.adjustmentId !== null,
      }))
    },
  }
}
