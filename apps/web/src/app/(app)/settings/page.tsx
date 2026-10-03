import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listAccounts } from '@abacus/core/services/accounts'
import { listActorsWithAliases } from '@abacus/core/services/actors'
import {
  CATEGORY_SORTS,
  DEFAULT_CATEGORY_SORT,
  DEFAULT_NAME_SORT,
  listActivities,
  listActivityAccounts,
  listCategories,
  listCategoryExceptions,
  NAME_SORTS,
  sortByName,
  sortCategories,
} from '@abacus/core/services/catalog'
import { rankingViewPreference, readingPreference } from '@abacus/core/services/preferences'
import { listJurisdictions } from '@abacus/core/services/regimes'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ActivityFiche, ActivityList } from '@/components/activity-forms'
import { NewActivitySheet } from '@/components/activity-wizard'
import { MasterDetail, NewEntryLink, type Part, PartTabs } from '@/components/master-detail'
import { PageHeader } from '@/components/page-shell'
import { RankingViewPreference } from '@/components/ranking-view-preference'
import { ReadingPreference } from '@/components/reading-preference'
import {
  ActorFiche,
  ActorList,
  CategoryFiche,
  CategoryList,
  NewActorFiche,
} from '@/components/referential-rows'
import { SortMenu } from '@/components/sort'
import { entryHref } from '@/lib/entry-href'
import { sorter } from '@/lib/sort'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Réglages' }

const PARTS = ['categories', 'activities', 'actors', 'preferences'] as const
type PartKey = (typeof PARTS)[number]

/**
 * How the application is set, and the vocabulary it files with. Nothing
 * dominates here: one comes to set one precise thing, so the screen shows one
 * part at a time, its list beside the sheet of the entry picked from it.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const params = await searchParams
  // A part the URL does not name, or names wrong, falls back to the first.
  const part: PartKey = PARTS.find((p) => p === params.part) ?? 'categories'
  const categorySort = sorter('categories', CATEGORY_SORTS, DEFAULT_CATEGORY_SORT, params)
  const activitySort = sorter('activities', NAME_SORTS, DEFAULT_NAME_SORT, params)
  const actorSort = sorter('actors', NAME_SORTS, DEFAULT_NAME_SORT, params)

  const [categories, activities, exceptions, links, accounts, actors, reading, rankingView] =
    await Promise.all([
      listCategories(userId),
      listActivities(userId),
      listCategoryExceptions(userId),
      listActivityAccounts(userId),
      listAccounts(userId),
      listActorsWithAliases(userId),
      readingPreference(userId),
      rankingViewPreference(userId),
    ])
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }))
  // A closed account holds nothing an activity could still count on, so it is
  // not offered; one already attached before its closure keeps its link.
  const accountOptions = accounts.filter((a) => !a.closedOn).map((a) => ({ id: a.id, name: a.name }))

  /**
   * The URL of a part, keeping the orders the lists were given. The origin a
   * jump came from is not kept: once the screen is walked on its own, a named
   * return to it would go back one step, not to it.
   */
  const partHref = (key: PartKey) => {
    const query = new URLSearchParams({ part: key })
    for (const sort of [categorySort, activitySort, actorSort]) {
      const value = params[sort.param]
      if (value) query.set(sort.param, value)
    }
    return `/settings?${query}`
  }
  const listHref = partHref(part)
  const PART_LABEL: Record<PartKey, string> = {
    categories: 'Catégories',
    activities: 'Activités',
    actors: 'Acteurs',
    preferences: 'Préférences',
  }
  const back = { href: listHref, label: PART_LABEL[part] }
  const parts: Part[] = [
    {
      key: 'categories',
      label: PART_LABEL.categories,
      count: categories.length,
      href: partHref('categories'),
    },
    {
      key: 'activities',
      label: PART_LABEL.activities,
      count: activities.length,
      href: partHref('activities'),
    },
    { key: 'actors', label: PART_LABEL.actors, count: actors.length, href: partHref('actors') },
    { key: 'preferences', label: PART_LABEL.preferences, href: partHref('preferences') },
  ]

  // The entry the URL designates, or `new` for a blank sheet. One that
  // designates nothing (deleted, merged away, mistyped) is no designation: a
  // wide screen then shows the first entry, a narrow one the list.
  const designate = <T extends { id: string }>(entries: T[]) => {
    const found = entries.find((entry) => entry.id === params.entry)
    const blank = params.entry === 'new'
    return { found, blank, designated: found !== undefined || blank }
  }

  let header: React.ReactNode = null
  let body: React.ReactNode

  if (part === 'categories') {
    const sorted = sortCategories(categories, categorySort.current)
    const { found, blank, designated } = designate(sorted)
    // With nothing declared yet, the blank sheet is the one worth showing.
    const shown = blank || sorted.length === 0 ? undefined : (found ?? sorted[0])
    const groups = [
      ...new Set(categories.map((c) => c.groupLabel).filter((g): g is string => g !== null)),
    ].sort((a, b) => a.localeCompare(b, 'fr'))
    header = <NewEntryLink href={entryHref(listHref, 'new')} label="Catégorie" pressed={blank} />
    body = (
      <MasterDetail
        designated={designated}
        list={
          <CategoryList
            categories={sorted}
            grouped={categorySort.current.field === 'group'}
            listHref={listHref}
            selection={{ id: shown?.id ?? null, designated }}
            tools={
              categories.length > 1 && (
                <SortMenu
                  sorter={categorySort}
                  options={[
                    { field: 'group', label: 'Groupe' },
                    { field: 'name', label: 'Nom' },
                  ]}
                />
              )
            }
          />
        }
        fiche={<CategoryFiche key={shown?.id ?? 'new'} category={shown} groups={groups} back={back} />}
      />
    )
  } else if (part === 'activities') {
    const sorted = sortByName(activities, activitySort.current)
    const { found, designated } = designate(sorted)
    const shown = found ?? sorted[0]
    header = (
      <NewActivitySheet
        jurisdictions={listJurisdictions()}
        categories={categoryOptions}
        accounts={accountOptions}
        today={today()}
      />
    )
    body = (
      <MasterDetail
        designated={designated}
        list={
          <ActivityList
            activities={sorted}
            listHref={listHref}
            selection={{ id: shown?.id ?? null, designated }}
            tools={
              activities.length > 1 && (
                <SortMenu sorter={activitySort} options={[{ field: 'name', label: 'Nom' }]} />
              )
            }
          />
        }
        fiche={
          shown && (
            <ActivityFiche
              key={shown.id}
              activity={shown}
              categories={categoryOptions}
              accounts={accountOptions}
              attached={links.filter((l) => l.activityId === shown.id).map((l) => l.accountId)}
              exceptions={exceptions.filter((e) => e.activityId === shown.id).map((e) => e.categoryId)}
              today={today()}
              back={back}
            />
          )
        }
      />
    )
  } else if (part === 'actors') {
    const sorted = sortByName(actors, actorSort.current)
    const { found, blank, designated } = designate(sorted)
    const shown = blank || sorted.length === 0 ? undefined : (found ?? sorted[0])
    header = <NewEntryLink href={entryHref(listHref, 'new')} label="Acteur" pressed={blank} />
    body = (
      <MasterDetail
        designated={designated}
        list={
          <ActorList
            actors={sorted}
            activities={activities}
            listHref={listHref}
            selection={{ id: shown?.id ?? null, designated }}
            tools={
              actors.length > 1 && <SortMenu sorter={actorSort} options={[{ field: 'name', label: 'Nom' }]} />
            }
          />
        }
        fiche={
          shown ? (
            <ActorFiche
              key={shown.id}
              actor={shown}
              activities={activities}
              others={actors.filter((a) => a.id !== shown.id).map((a) => ({ id: a.id, name: a.name }))}
              listHref={listHref}
              back={back}
            />
          ) : (
            <NewActorFiche back={back} />
          )
        }
      />
    )
  } else {
    body = (
      <div className="flex max-w-3xl flex-col px-4 py-4 sm:px-6">
        <ReadingPreference value={reading} />
        <RankingViewPreference value={rankingView} />
      </div>
    )
  }

  return (
    <>
      <PageHeader title="Réglages">{header}</PageHeader>
      <PartTabs parts={parts} current={part} label="Parties des réglages" />
      <main>{body}</main>
    </>
  )
}
