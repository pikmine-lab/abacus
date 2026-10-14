import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActors } from '@abacus/core/services/actors'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import {
  COMMITMENT_SORTS,
  DEFAULT_COMMITMENT_SORT,
  listCommitmentsWithProgress,
  monthlyEquivalentEur,
  pendingOccurrences,
  sortCommitments,
} from '@abacus/core/services/commitments'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CommitmentRow } from '@/components/commitment-blocks'
import { CommitmentFocus } from '@/components/commitment-focus'
import { NewCommitmentForm } from '@/components/commitment-forms'
import { EntrySheet } from '@/components/entry-sheet'
import { EmptyLine, PageBody, PageHeader, Rows, Section } from '@/components/page-shell'
import { PendingOccurrences } from '@/components/pending-occurrences'
import { SortMenu } from '@/components/sort'
import { StatRow, StatTile } from '@/components/stats'
import { getFormat } from '@/lib/format-server'
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
  // The coming period's occurrences are listed so an early salary can be
  // recorded, not owed: the tile counts what is.
  const dueIn = pendingIn.filter((p) => !p.ahead)

  const monthly = active.reduce((sum, c) => sum + monthlyEquivalentEur(c), 0)
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]))
  // Same references the creation form offers, so a row can be corrected too.
  const options = {
    accounts: accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name })),
    actors: actors.map((a) => ({ id: a.id, name: a.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    activities: activities.map((a) => ({ id: a.id, name: a.name })),
  }

  return (
    <>
      <PageHeader title={tScreens('recurringIncome')} description={t('income.description')}>
        <EntrySheet label={t('add')} title={t('income.newTitle')} description={t('income.newDescription')}>
          <NewCommitmentForm
            direction="incoming"
            accounts={options.accounts}
            actors={options.actors}
            categories={options.categories}
            activities={options.activities}
            today={today()}
          />
        </EntrySheet>
      </PageHeader>

      <PageBody>
        {/* A movement tied to a commitment lands on its row. */}
        <CommitmentFocus />
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </p>
        )}

        <StatRow>
          <StatTile
            hero
            label={t('income.recurringIncome')}
            value={t('amountPerMonth', { amount: format.eur(monthly, 2) })}
            hint={t('income.perYear', { amount: format.eur(monthly * 12) })}
          />
          <StatTile
            label={t('income.activeSources')}
            value={String(active.length)}
            hint={stopped.length > 0 ? t('income.stoppedCount', { count: stopped.length }) : undefined}
          />
          <StatTile
            label={t('toConfirm')}
            value={String(dueIn.length)}
            hint={
              dueIn.length > 0
                ? t('income.expectedSince', { date: format.date(dueIn[0]!.dueOn) })
                : t('income.upToDate')
            }
          />
        </StatRow>

        {pendingIn.length > 0 && (
          <Section title={t('income.pendingTitle')} description={t('income.pendingDescription')}>
            <PendingOccurrences
              back={PATH}
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
          </Section>
        )}

        <Section
          title={t('income.sources')}
          description={t('income.sourcesDescription')}
          action={
            active.length > 1 && (
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
        >
          {active.length === 0 ? (
            <EmptyLine>{t('income.empty')}</EmptyLine>
          ) : (
            <Rows>
              {sortCommitments(active, sort.current).map((c) => (
                <CommitmentRow
                  key={c.id}
                  commitment={c}
                  showJudgment={false}
                  options={options}
                  today={today()}
                />
              ))}
            </Rows>
          )}
        </Section>

        {stopped.length > 0 && (
          <Section title={t('income.stopped')} description={t('income.stoppedDescription')}>
            <Rows>
              {stopped.map((c) => (
                <div key={c.id} className="flex items-baseline gap-3 py-2 text-faint">
                  <span className="text-[12.5px]">{c.label}</span>
                  <span className="text-[11px]">
                    {t('income.stoppedOn', { date: format.date(c.cancelledOn!) })}
                  </span>
                  <span className="ml-auto font-mono text-[12.5px] tabular">
                    {format.eur(Number(c.amount), 2)}
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
