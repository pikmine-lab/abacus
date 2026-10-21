import { eur, type Steps } from '@abacus/use-case-language'
import type { McpContext } from './context.ts'

const money = (value: number) => eur(value.toFixed(2))

interface ListedAccount {
  name: string
  institution?: string
  balance: number
  closedOn?: string
}

interface ListedCard {
  name: string
  account: string
  expiry: string
  debit: 'immediate' | 'deferred'
  cutOffDay?: number
  debitDay?: number
}

interface ListedCheck {
  checkId: string
  on: string
  declared: number
  computed: number
  gap: number
  settledByMovement?: string
  note?: string
}

export function accountsSteps({ call, batch }: McpContext): Partial<Steps> {
  async function account(name: string): Promise<ListedAccount> {
    const { accounts } = await call<{ accounts: ListedAccount[] }>('manage_accounts', { action: 'list' })
    const found = accounts.find((a) => a.name === name)
    if (!found) throw new Error(`no account named "${name}"`)
    return found
  }
  async function checks(name: string): Promise<ListedCheck[]> {
    return await call<ListedCheck[]>('manage_balance_checks', { action: 'list', account: name })
  }
  async function checkId(name: string, on: string): Promise<string> {
    const found = (await checks(name)).find((c) => c.on === on)
    if (!found) throw new Error(`no check of "${name}" on ${on}`)
    return found.checkId
  }

  return {
    async createAccount({ name, opening, openedOn }) {
      await call('manage_accounts', {
        action: 'create',
        name,
        behavior: 'payment',
        openingBalance: opening ? Number(opening.amount) : undefined,
        openedOn: opening ? (openedOn ?? '2026-01-01') : openedOn,
      })
    },
    async readAccountBalance(name) {
      return money((await account(name)).balance)
    },
    async editAccount({ account: name, name: newName, institution, opening, openedOn }) {
      await call('manage_accounts', {
        action: 'update',
        name,
        newName,
        institution,
        openingBalance: opening ? Number(opening.amount) : undefined,
        openedOn,
      })
    },
    async closeAccount(name, on) {
      await call('manage_accounts', { action: 'close', name, closedOn: on })
    },
    async reopenAccount(name) {
      await call('manage_accounts', { action: 'reopen', name })
    },
    async readAccount(name) {
      const found = await account(name)
      return {
        ...(found.institution ? { institution: found.institution } : {}),
        balance: money(found.balance),
        closed: found.closedOn !== undefined,
        ...(found.closedOn ? { closedOn: found.closedOn } : {}),
      }
    },

    async createCard(input) {
      await call('manage_cards', {
        action: 'create',
        name: input.name,
        account: input.account,
        expiry: input.expiry,
        debit: input.debit,
        ...(input.debit === 'deferred' && {
          cutOffDay: input.cutOffDay,
          cutOffShift: 'none',
          debitDay: input.debitDay,
          debitShift: 'none',
        }),
      })
    },
    async editCard({ card, name, expiry }) {
      await call('manage_cards', { action: 'update', name: card, newName: name, expiry })
    },
    async deleteCard(card) {
      await call('manage_cards', { action: 'delete', name: card })
    },
    async readCards(name) {
      const { cards } = await call<{ cards: ListedCard[] }>('manage_cards', { action: 'list' })
      return cards
        .filter((c) => c.account === name)
        .map((c) =>
          c.debit === 'deferred'
            ? {
                name: c.name,
                expiry: c.expiry,
                debit: 'deferred' as const,
                cutOffDay: c.cutOffDay!,
                debitDay: c.debitDay!,
              }
            : { name: c.name, expiry: c.expiry, debit: 'immediate' as const },
        )
    },
    async declareCardPurchase({ card, amount, payee, on }) {
      const { cards } = await call<{ cards: ListedCard[] }>('manage_cards', { action: 'list' })
      const paidWith = cards.find((c) => c.name === card)
      if (!paidWith) throw new Error(`no card named "${card}"`)
      await batch('declare_movements', {
        movements: [
          {
            type: 'expense',
            date: on,
            amount: Number(amount.amount),
            account: paidWith.account,
            actor: payee,
            card,
          },
        ],
        createUnknownActors: true,
      })
    },
    async validateStatement({ card, cutOff, debitedOn }) {
      await call('manage_card_statements', { action: 'validate', card, cutOff, debitedOn })
    },
    async undoStatement({ card, cutOff }) {
      await call('manage_card_statements', { action: 'undo', card, cutOff })
    },
    async readCardStatements(card) {
      const { statements } = await call<{
        statements: { cutOff: string; debitedOn?: string; amount: number }[]
      }>('manage_card_statements', { action: 'list', card })
      return statements.map((s) => ({
        cutOff: s.cutOff,
        ...(s.debitedOn ? { debitedOn: s.debitedOn } : {}),
        amount: money(s.amount),
      }))
    },

    async recordBalanceCheck({ account: name, balance, on, note }) {
      await call('record_balance_check', { account: name, balance: Number(balance.amount), date: on, note })
    },
    async correctBalanceCheck({ account: name, on, balance, note }) {
      await call('manage_balance_checks', {
        action: 'correct',
        check: await checkId(name, on),
        balance: Number(balance.amount),
        note,
      })
    },
    async deleteBalanceCheck({ account: name, on }) {
      await call('manage_balance_checks', { action: 'delete', check: await checkId(name, on) })
    },
    async settleCheckGap({ account: name, on, actor }) {
      await call('settle_check_gap', { checkId: await checkId(name, on), actor })
    },
    async readBalanceChecks(name) {
      return (await checks(name)).map((c) => ({
        on: c.on,
        declared: money(c.declared),
        computed: money(c.computed),
        gap: money(c.gap),
        settled: c.settledByMovement !== undefined,
        ...(c.note ? { note: c.note } : {}),
      }))
    },
  }
}
