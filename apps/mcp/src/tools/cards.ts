import { isValidOn } from '@abacus/core/domain/card'
import { DomainError } from '@abacus/core/domain/errors'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import {
  cardStatements,
  confirmStatement,
  createCard,
  deleteCard,
  editCard,
  listCards,
  type StatementWithTotal,
} from '@abacus/core/services/cards'
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { requireAccountByName, requireCardByName } from '../resolve.ts'
import { fail, isoDate, ok, run } from './shared.ts'

const month = z.string().regex(/^\d{4}-\d{2}$/)

/** A statement as the AI reads it: its cycle, its debit, what it adds up to. */
function statementView(s: StatementWithTotal) {
  return {
    cutOff: s.cutOffOn,
    expectedOn: s.dueOn,
    ...(s.debitedOn ? { debitedOn: s.debitedOn } : {}),
    amount: Number(s.amount),
    purchases: s.purchases,
    // Closed and past its expected day: the bank should have debited it by now.
    ...(!s.debitedOn && s.dueOn <= today() ? { toValidate: true } : {}),
  }
}
const shift = z.enum(['none', 'previous', 'next'])

export function registerCardTools(server: McpServer, userId: string): void {
  server.registerTool(
    'manage_cards',
    {
      description:
        'Manages the user\'s payment cards, never their number: a card is told apart by the name the user gives it. Actions: list, create, update, delete. A card debits one current account. Immediate debit: each purchase leaves the account on its day. Deferred debit: the bank adds the purchases up until a cut-off day, then debits the total on a later day, so a purchase made on September 26th can leave the account on October 30th. That is why a deferred card carries its schedule: cutOffDay and debitDay, each a day of the month (31 means the last day of any month), each with the way it moves when it falls on a weekend (previous: the working day before, next: the working day after, none: it stays). Ask the user for the schedule their bank states ("cut-off on the 20th or the next working day, debit on the last working day of the month" is cutOffDay 20 next, debitDay 31 previous), never guess it. With the card declared, declare_movements takes card and the purchase day: the purchase joins the statement of its cycle and is dated on the debit the schedule expects, never compute that day yourself. It counts in no balance until the statement is validated with the day the bank really debited it (manage_card_statements). Correcting a schedule moves the purchases still waiting for their debit, never those of a validated statement. The expiry month is the one printed on the card: a purchase dated after it is refused, so a renewed card gets its new expiry with update. Delete only works on a card nothing was paid with; an old card simply stays, its expiry saying it no longer works. list gives each deferred card its statements still to validate: what it has bought that the account has not lost yet as far as the ledger knows, which is why the account balance does not show it.',
      inputSchema: z.object({
        action: z.enum(['list', 'create', 'update', 'delete']),
        name: z
          .string()
          .optional()
          .describe('Every action except list: the card, by name (e.g. "Visa Premier")'),
        newName: z.string().optional().describe('update: the corrected name'),
        account: z
          .string()
          .optional()
          .describe(
            'create/update: the current account it debits. Fixed once something was paid with the card',
          ),
        expiry: month.optional().describe('create/update: YYYY-MM, the month printed on the card'),
        debit: z
          .enum(['immediate', 'deferred'])
          .optional()
          .describe(
            'create/update: immediate (each purchase on its day) or deferred (grouped and debited on a later day). Switching to deferred needs the whole schedule',
          ),
        cutOffDay: z
          .number()
          .int()
          .min(1)
          .max(31)
          .optional()
          .describe(
            'deferred: the day of the month that closes a cycle of purchases. 31 is the last day of any month',
          ),
        cutOffShift: shift.optional().describe('deferred: where the cut-off goes when it falls on a weekend'),
        debitDay: z
          .number()
          .int()
          .min(1)
          .max(31)
          .optional()
          .describe(
            'deferred: the day of the month the total is debited, the first one on or after the cut-off. 31 is the last day of any month',
          ),
        debitShift: shift.optional().describe('deferred: where the debit goes when it falls on a weekend'),
      }),
    },
    async (a) =>
      run(async () => {
        if (a.action === 'list') {
          const [cards, accounts] = await Promise.all([listCards(userId), listAccounts(userId)])
          const accountName = new Map(accounts.map((acc) => [acc.id, acc.name]))
          const now = today()
          return ok({
            cards: cards.map((card) => ({
              name: card.name,
              account: accountName.get(card.accountId),
              expiry: card.expiryMonth.slice(0, 7),
              ...(isValidOn(card, now) ? {} : { expired: true }),
              debit: card.debitMode,
              ...(card.debitMode === 'deferred'
                ? {
                    cutOffDay: card.statementDay,
                    cutOffShift: card.statementShift,
                    debitDay: card.debitDay,
                    debitShift: card.debitShift,
                  }
                : {}),
              ...(card.pending.length > 0 ? { statementsToValidate: card.pending.map(statementView) } : {}),
            })),
          })
        }
        if (!a.name) return fail(`${a.action} requires name.`)
        const schedule = {
          statementDay: a.cutOffDay,
          statementShift: a.cutOffShift,
          debitDay: a.debitDay,
          debitShift: a.debitShift,
        }
        if (a.action === 'create') {
          if (!a.account || !a.expiry || !a.debit)
            return fail('create requires account, expiry and debit (immediate or deferred).')
          const card = await createCard(userId, {
            name: a.name,
            accountId: (await requireAccountByName(userId, a.account)).id,
            expiryMonth: a.expiry,
            debitMode: a.debit,
            ...schedule,
          })
          return ok({ cardId: card.id, name: card.name })
        }
        const card = await requireCardByName(userId, a.name)
        if (a.action === 'delete') {
          await deleteCard(userId, card.id)
          return ok({ name: card.name, deleted: true })
        }
        const updated = await editCard(userId, card.id, {
          name: a.newName,
          accountId: a.account ? (await requireAccountByName(userId, a.account)).id : undefined,
          expiryMonth: a.expiry,
          debitMode: a.debit,
          ...schedule,
        })
        return ok({
          cardId: updated.id,
          name: updated.name,
          expiry: updated.expiryMonth.slice(0, 7),
          debit: updated.debitMode,
          note: 'Purchases still waiting for their debit follow the new schedule; debited ones are unchanged.',
        })
      }),
  )

  server.registerTool(
    'manage_card_statements',
    {
      description:
        "The statements of a deferred-debit card: one per cycle, grouping the purchases the bank debits in one go. Actions: list (every statement of a card, most recent first, with its cut-off, the debit its schedule expects, the day it was really debited once validated, its total and its number of purchases), validate (the bank has debited it: state that day; every purchase of the cycle moves onto it and enters the balances), undo (the statement goes back to waiting, off the balances). Validate only once the debit shows on the user's bank account, with the day it shows; ask for that day rather than taking the expected one. The total is not asked: it is the sum of the purchases, so when it differs from what the bank took, a purchase is missing or wrong, and the fix is on the movement (declare_movements, fix_movement), not here. Validating an already validated statement corrects its day.",
      inputSchema: z.object({
        action: z.enum(['list', 'validate', 'undo']),
        card: z.string().describe('The card, by name'),
        cutOff: isoDate
          .optional()
          .describe(
            'validate/undo: the cut-off of the statement, from list. validate defaults to the oldest statement still waiting whose cut-off has passed; undo requires it',
          ),
        debitedOn: isoDate
          .optional()
          .describe('validate: the day the bank debited it, as the bank account shows'),
      }),
    },
    async (a) =>
      run(async () => {
        const card = await requireCardByName(userId, a.card)
        const statements = await cardStatements(userId, card.id)
        if (a.action === 'list') return ok({ card: card.name, statements: statements.map(statementView) })
        const now = today()
        const target = a.cutOff
          ? statements.find((s) => s.cutOffOn === a.cutOff)
          : a.action === 'validate'
            ? [...statements].reverse().find((s) => !s.debitedOn && s.cutOffOn < now)
            : undefined
        if (!target)
          throw new DomainError(
            'statement_not_found',
            a.cutOff
              ? `No statement of "${card.name}" is cut off on ${a.cutOff}. Its statements: ${statements.map((s) => s.cutOffOn).join(', ') || 'none'}.`
              : a.action === 'undo'
                ? 'undo requires cutOff: take it from list.'
                : `No statement of "${card.name}" is closed and waiting for its debit.`,
          )
        if (a.action === 'validate' && !a.debitedOn)
          return fail('validate requires debitedOn, the day the bank debited it.')
        const updated = await confirmStatement(
          userId,
          target.id,
          a.action === 'validate' ? a.debitedOn! : null,
        )
        return ok({ card: card.name, statement: statementView(updated) })
      }),
  )
}
