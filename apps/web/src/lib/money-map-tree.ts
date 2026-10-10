import type { BreakdownMass, BreakdownRow, FlowKind, FlowScope, Reading } from '@abacus/core/services/reports'
import { flowLeaves, spendingBreakdown, spendingByCategoryGroup } from '@abacus/core/services/reports'
import type { MapNode } from '@/lib/money-map'
import { type Period, periodParams } from '@/lib/period'
import { NONE } from '@/lib/utils'

/**
 * How many movements a category shows before the smallest are summed into one
 * block: past it, a period long enough would load years of a category to draw
 * movements nobody can zoom close enough to read.
 */
const LEAVES = 500

const UNSET = {
  activity: 'Hors activité',
  group: 'Sans groupe',
  category: 'Sans catégorie',
  actor: 'Sans acteur',
}

/**
 * The whole tree the map draws, down to every movement, since the map can be
 * zoomed anywhere. Every figure comes from the analysis services the ranking
 * reads, so a block weighs what its row weighs, and the movements of a
 * category add up to it.
 */
export async function moneyMap({
  userId,
  period,
  kind,
  reading,
  split,
}: {
  userId: string
  period: Period
  kind: FlowKind
  reading: Reading
  split: boolean
}): Promise<MapNode> {
  const { from, to } = period
  const list = (filters: Record<string, string>) =>
    `/movements?${new URLSearchParams(filters)}&type=${kind}&${periodParams(period)}&from=analysis`

  const [leaves, masses] = await Promise.all([
    flowLeaves(userId, from, to, kind, reading, LEAVES, split ? ['category', 'activity'] : ['category']),
    split
      ? spendingBreakdown(userId, from, to, 'activity', kind, reading).then((activities) =>
          Promise.all(
            activities.map(async (a) => ({
              activity: a,
              groups: await spendingByCategoryGroup(userId, from, to, kind, reading, {
                activityId: a.key,
              } satisfies FlowScope),
            })),
          ),
        )
      : spendingByCategoryGroup(userId, from, to, kind, reading).then((groups) => [
          { activity: null, groups },
        ]),
  ])

  // The movements of each category (within its activity, when split), keyed
  // the way the categories below look them up.
  const place = (category: string | null, activity: string | null) =>
    `${category ?? NONE}|${split ? (activity ?? NONE) : ''}`
  const byPlace = new Map<string, MapNode[]>()
  const push = (key: string, node: MapNode) => byPlace.set(key, [...(byPlace.get(key) ?? []), node])
  for (const m of leaves.movements) {
    const filters = categoryFilters(m.categoryId, split ? m.activityId : undefined)
    push(place(m.categoryId, m.activityId), {
      id: `m:${m.id}`,
      level: 'movement',
      label: m.actor ?? UNSET.actor,
      net: Number(m.net),
      count: 1,
      date: m.happenedOn,
      note: m.note,
      href: list(m.actorId ? { ...filters, actor: m.actorId } : filters),
    })
  }
  for (const r of leaves.rests) {
    const key = place(r.categoryId, r.activityId)
    push(key, {
      id: `rest:${key}`,
      level: 'rest',
      label: `${r.count} autres`,
      net: Number(r.net),
      count: Number(r.count),
      href: list(categoryFilters(r.categoryId, split ? r.activityId : undefined)),
    })
  }

  const groupNode = (g: BreakdownMass, parent: string, activity: string | null): MapNode => {
    const id = `${parent}/g:${g.key ?? NONE}`
    return {
      ...figures(g),
      id,
      level: 'group',
      label: g.label ?? UNSET.group,
      children: g.categories.map((c) => ({
        ...figures(c),
        id: `${id}/c:${c.key ?? NONE}`,
        level: 'category' as const,
        label: c.label ?? UNSET.category,
        href: list(categoryFilters(c.key, split ? activity : undefined)),
        children: byPlace.get(place(c.key, activity)) ?? [],
      })),
    }
  }

  const children: MapNode[] = masses.flatMap(({ activity, groups }) => {
    if (!activity) return groups.map((g) => groupNode(g, '', null))
    const id = `a:${activity.key ?? NONE}`
    return [
      {
        ...figures(activity),
        id,
        level: 'activity' as const,
        label: activity.label ?? UNSET.activity,
        children: groups.map((g) => groupNode(g, id, activity.key)),
      },
    ]
  })

  return {
    id: 'root',
    level: 'root',
    label: kind === 'expense' ? 'Toutes les dépenses' : 'Tous les revenus',
    net: children.reduce((sum, c) => sum + Math.max(0, c.net), 0),
    count: children.reduce((sum, c) => sum + c.count, 0),
    children,
  }
}

function figures(row: BreakdownRow) {
  return { net: Number(row.net), count: Number(row.count) }
}

/** The ledger's filters for a category, within an activity when the map is split. */
function categoryFilters(
  category: string | null,
  activity: string | null | undefined,
): Record<string, string> {
  return { category: category ?? NONE, ...(activity !== undefined ? { activity: activity ?? NONE } : {}) }
}
