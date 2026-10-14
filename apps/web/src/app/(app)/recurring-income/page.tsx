import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import {
  COMMITMENT_SORTS,
  DEFAULT_COMMITMENT_SORT,
  groupCommitments,
  listCommitmentsWithProgress,
  monthlyEquivalentEur,
  pendingOccurrences,
} from '@abacus/core/services/commitments'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CommitmentFocus } from '@/components/commitment-focus'
import { NewCommitmentForm } from '@/components/commitment-forms'
import { ActionCard, Figure } from '@/components/composition'
import { EntrySheet } from '@/components/entry-sheet'
import { BAND } from '@/components/expense-list'
import { FoldSection } from '@/components/fold-section'
import { AccountIncome, IncomeRow } from '@/components/income-list'
import { EmptyLine, PageBody, PageHeader, Rows } from '@/components/page-shell'
import { PendingOccurrences } from '@/components/pending-occurrences'
import { SortMenu } from '@/components/sort'
import { getFormat } from '@/lib/format-server'
import { railMarks } from '@/lib/rail-marks'
import { sorter } from '@/lib/sort'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('shell.screens')
  return { title: t('recurringIncome') }
}

const PATH = '/recurring-income'

export default async function RecurringIncomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const params = await searchParams
  const { error } = params
  const t = await getTranslations('recurring')
  const tScreens = await getTranslations('shell.screens')
  const format = await getFormat()
  const sort = sorter('sources', COMMITMENT_SORTS, DEFAULT_COMMITMENT_SORT, params)

  const [commitments, pending, accounts, actors, categories, activities] = await Promise.all([
    listCommitmentsWithProgress(userId, false),
    pendingOccurrences(userId),
    listAccounts(userId),
    listActors(userId),
    listCategories(userId),
    listActivities(userId),
  ])

  const incoming = commitments.filter((c) => c.direction === 'incoming')
  const active = incoming.filter((c) => !c.cancelledOn)
  const stopped = incoming.filter((c) => c.cancelledOn)
  const pendingIn = pending.filter((p) => p.commitment.direction === 'incoming')
  const now = today()

  const monthly = active.reduce((sum, c) => sum + monthlyEquivalentEur(c), 0)
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]))
  // What lands on each account, the best-fed first; one order for the lines,
  // whatever account they fall under.
  const byAccount = groupCommitments(active, { subscriptions: sort.current }).map((account) => ({
    accountId: account.accountId,
    monthlyEur: account.monthlyEur,
    lines: account.means.flatMap((m) => m.subscriptions.lines),
  }))
  // Same references the creation form offers, so a row can be corrected too.
  const options = {
    accounts: accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name })),
    actors: actors.map((a) => ({ id: a.id, name: a.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    activities: activities.map((a) => ({ id: a.id, name: a.name })),
  }

  return (
    <>
      <PageHeader title={tScreens('recurringIncome')}>
        <EntrySheet label={t('add')} title={t('income.newTitle')} description={t('income.newDescription')}>
          <NewCommitmentForm
            direction="incoming"
            accounts={options.accounts}
            actors={options.actors}
            categories={options.categories}
            activities={options.activities}
            today={now}
          />
        </EntrySheet>
      </PageHeader>

      {/* One container for the band and the lists, so the rails line up under its split. */}
      <PageBody className="@container">
        {/* A movement tied to a commitment lands on its row. */}
        <CommitmentFocus />
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </p>
        )}

        {/* The figure that dominates, beside what waits on the user: the
            payments that landed and are not confirmed yet. */}
        <div className={BAND}>
          <Figure
            hero
            label={t('income.monthlyIncome')}
            value={monthly}
            decimals={2}
            per={t('perMonth')}
            note={
              active.length > 0
                ? [
                    t('income.perYear', { amount: format.eur(monthly * 12) }),
                    t('income.sourceCount', { count: active.length }),
                  ].join(' · ')
                : undefined
            }
          />
          {pendingIn.length > 0 && (
            // Beside the figure, the card never runs longer than it: taken out
            // of the flow, it leaves the row its height, and scrolls within.
            // Stacked, it takes the room it needs.
            <div className="relative min-h-0">
              <div className="flex flex-col @4xl:absolute @4xl:inset-x-0 @4xl:top-0 @4xl:max-h-full">
                <ActionCard label={t('toConfirm')} scrolls>
                  <PendingOccurrences
                    back={PATH}
                    aheadInPanel
                    items={pendingIn.map((p) => ({
                      commitmentId: p.commitment.id,
                      label: p.commitment.label,
                      dueOn: p.dueOn,
                      periodUnit: p.commitment.periodUnit,
                      ahead: p.ahead,
                      amount: p.amount,
                      currency: p.commitment.currency,
                      incoming: true,
                      account: accountNames.get(p.accountId) ?? '',
                    }))}
                  />
                </ActionCard>
              </div>
            </div>
          )}
        </div>

        {active.length === 0 ? (
          <EmptyLine>{t('income.empty')}</EmptyLine>
        ) : (
          <div className="flex flex-col gap-12">
            {byAccount.map((account) => (
              <AccountIncome
                key={account.accountId}
                name={accountNames.get(account.accountId) ?? ''}
                // A total that repeats the screen's figure or the account's
                // only line is not a figure.
                monthlyEur={byAccount.length > 1 && account.lines.length > 1 ? account.monthlyEur : undefined}
                sort={
                  account.lines.length > 1 && (
                    <SortMenu
                      sorter={sort}
                      options={[
                        { field: 'monthly', label: t('sorts.monthlyEquivalent') },
                        { field: 'amount', label: t('sorts.amountPaid') },
                        { field: 'next', label: t('nextDue') },
                        { field: 'label', label: t('name') },
                      ]}
                    />
                  )
                }
                today={now}
              >
                {account.lines.map((c) => (
                  <IncomeRow
                    key={c.id}
                    commitment={c}
                    marks={railMarks(c, undefined, now)}
                    today={now}
                    options={options}
                  />
                ))}
              </AccountIncome>
            ))}
          </div>
        )}

        {stopped.length > 0 && (
          // One kind of end, so the count alone: the title already names it.
          <FoldSection title={t('income.stopped')} description={String(stopped.length)}>
            <Rows>
              {stopped.map((c) => (
                <div key={c.id} className="flex items-baseline gap-3 py-2 text-faint">
                  <span className="text-[13px]">{c.label}</span>
                  <span className="text-[11.5px]">
                    {t('income.stoppedOn', { date: format.date(c.cancelledOn!) })}
                  </span>
                  <span className="ml-auto font-mono text-[13px] tabular">
                    {format.eur(Number(c.amount), 2)}
                  </span>
                </div>
              ))}
            </Rows>
          </FoldSection>
        )}
      </PageBody>
    </>
  )
}
