import { auth } from '@abacus/core/auth'
import { today } from '@abacus/core/domain/period'
import { listActivities, listCategories } from '@abacus/core/services/catalog'
import { listInputs, listLevies, listThresholds } from '@abacus/core/services/levies'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import {
  InputFiche,
  InputList,
  LevyFiche,
  LevyList,
  NewInputFiche,
  NewLevyForm,
  NewThresholdFiche,
  ThresholdFiche,
  ThresholdList,
} from '@/components/activity-rules'
import { EntrySheet } from '@/components/entry-sheet'
import { MasterDetail, NewEntryLink, type Part, PartTabs } from '@/components/master-detail'
import { EmptyLine, PageBody, PageHeader } from '@/components/page-shell'
import { entryHref } from '@/lib/entry-href'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Régime de l’activité' }

const PARTS = ['rules', 'inputs', 'thresholds'] as const
type PartKey = (typeof PARTS)[number]

const PART_LABEL: Record<PartKey, string> = { rules: 'Règles', inputs: 'Paramètres', thresholds: 'Seuils' }

/**
 * The regime of an activity, in data: what it owes and on which source, the
 * figures its rules read, the thresholds it is watched against. Nothing here
 * computes: it says what the engine will read. Laid out as Réglages is, one
 * part at a time, its list beside the sheet of the entry picked from it.
 */
export default async function ActivitySettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ activityId: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')
  const userId = session.user.id
  const { activityId } = await params
  const query = await searchParams

  const activities = await listActivities(userId)
  // An id that designates nothing for this user is a 404, never someone else's
  // activity: the lookup is scoped to them before anything is read.
  const activity = activities.find((a) => a.id === activityId)
  if (!activity) notFound()

  const title = `Régime de ${activity.name}`
  const parent = { label: activity.name, href: `/settings?part=activities&entry=${activity.id}` }
  if (activity.kind !== 'business')
    return (
      <>
        <PageHeader title={title} parent={parent} />
        <PageBody>
          <EmptyLine>
            Cette activité est perso : c’est une dimension d’analyse. Seule une activité professionnelle porte
            un régime.
          </EmptyLine>
        </PageBody>
      </>
    )

  const [levies, inputs, thresholds, categories] = await Promise.all([
    listLevies(userId, activity.id),
    listInputs(userId, activity.id),
    listThresholds(userId, activity.id),
    listCategories(userId),
  ])
  const now = today()
  const names = levies.map((levy) => ({ id: levy.id, name: levy.name }))

  const part: PartKey = PARTS.find((p) => p === query.part) ?? 'rules'
  // As in Réglages, the origin a jump came from is not kept once the page is
  // walked on its own: a named return would then go back one step, not to it.
  const partHref = (key: PartKey) => `/settings/activities/${activity.id}?part=${key}`
  const listHref = partHref(part)
  const back = { href: listHref, label: PART_LABEL[part] }
  const parts: Part[] = [
    { key: 'rules', label: PART_LABEL.rules, count: levies.length, href: partHref('rules') },
    { key: 'inputs', label: PART_LABEL.inputs, count: inputs.length, href: partHref('inputs') },
    {
      key: 'thresholds',
      label: PART_LABEL.thresholds,
      count: thresholds.length,
      href: partHref('thresholds'),
    },
  ]
  const designate = <T extends { id: string }>(entries: T[]) => {
    const found = entries.find((entry) => entry.id === query.entry)
    const blank = query.entry === 'new'
    return { found, blank, designated: found !== undefined || blank }
  }

  let header: React.ReactNode
  let body: React.ReactNode

  if (part === 'rules') {
    const { found, designated } = designate(levies)
    const shown = found ?? levies[0]
    // A rule has seven blocks of fields: declaring one keeps its panel.
    header = (
      <EntrySheet
        label="Règle"
        title="Nouvelle règle"
        description="Un prélèvement, tel que son texte le fixe. Un taux qui change plus tard ne se corrige pas : il se remplace."
      >
        <NewLevyForm activityId={activity.id} categories={categories} levies={names} today={now} />
      </EntrySheet>
    )
    body = (
      <MasterDetail
        designated={designated}
        list={
          <LevyList
            levies={levies}
            listHref={listHref}
            selection={{ id: shown?.id ?? null, designated }}
            today={now}
          />
        }
        fiche={
          shown && (
            <LevyFiche
              key={shown.id}
              levy={shown}
              activityId={activity.id}
              categories={categories}
              // A rule reads the other rules of its activity, never itself.
              levies={names.filter((other) => other.id !== shown.id)}
              today={now}
              back={back}
            />
          )
        }
      />
    )
  } else if (part === 'inputs') {
    const { found, blank, designated } = designate(inputs)
    const shown = blank || inputs.length === 0 ? undefined : (found ?? inputs[0])
    header = <NewEntryLink href={entryHref(listHref, 'new')} label="Paramètre" pressed={blank} />
    body = (
      <MasterDetail
        designated={designated}
        list={
          <InputList inputs={inputs} listHref={listHref} selection={{ id: shown?.id ?? null, designated }} />
        }
        fiche={
          shown ? (
            <InputFiche key={shown.id} input={shown} activityId={activity.id} back={back} />
          ) : (
            <NewInputFiche activityId={activity.id} today={now} back={back} />
          )
        }
      />
    )
  } else {
    const { found, blank, designated } = designate(thresholds)
    const shown = blank || thresholds.length === 0 ? undefined : (found ?? thresholds[0])
    header = <NewEntryLink href={entryHref(listHref, 'new')} label="Seuil" pressed={blank} />
    body = (
      <MasterDetail
        designated={designated}
        list={
          <ThresholdList
            thresholds={thresholds}
            listHref={listHref}
            selection={{ id: shown?.id ?? null, designated }}
          />
        }
        fiche={
          shown ? (
            <ThresholdFiche
              key={shown.id}
              threshold={shown}
              activityId={activity.id}
              today={now}
              back={back}
            />
          ) : (
            <NewThresholdFiche activityId={activity.id} today={now} back={back} />
          )
        }
      />
    )
  }

  return (
    <>
      <PageHeader title={title} description={activity.regimeLabel ?? undefined} parent={parent}>
        {header}
      </PageHeader>
      <PartTabs parts={parts} current={part} label="Parties du régime" />
      <main>{body}</main>
    </>
  )
}
