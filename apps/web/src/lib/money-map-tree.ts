import type {
  ActivityMass,
  BreakdownGroup,
  BreakdownMass,
  BreakdownRow,
  FlowCut,
  FlowKind,
  FlowPlace,
  Reading,
} from '@abacus/core/services/reports'
import {
  flowLeaves,
  spendingBreakdown,
  spendingByActivity,
  spendingByActor,
  spendingByCategoryGroup,
} from '@abacus/core/services/reports'
import type { MapNode } from '@/lib/money-map'
import { type Period, periodParams } from '@/lib/period'
import { NONE } from '@/lib/utils'

/**
 * How many movements a category shows before the smallest are summed into one
 * block: past it, a period long enough would load years of a category to draw
 * movements nobody can zoom close enough to read.
 */
const LEAVES = 500

/**
 * The words the tree names its blocks with, in the language being spoken:
 * resolved by the page, so this file stays free of any catalog.
 */
export interface MapLabels {
  /** What an unset dimension is called. */
  unset: { activity: string; group: string; category: string; actor: string }
  /** The block that sums the movements a category leaves out. */
  rest: (count: number) => string
  /** The whole map, on the side of the ledger it reads. */
  root: string
  /** A movement's day, when nothing else names it. */
  day: (date: string) => string
}

/** What a category sits under beyond its group: the activity or the actor the map opens on, if any. */
interface Within {
  activity?: string | null
  actor?: string | null
}

/**
 * The whole tree the map draws, down to every movement, since the map can be
 * zoomed anywhere. It opens on the dimension the ranking is sorted by and goes
 * down to the categories and their movements: a group holds the categories it
 * merges, an actor the categories it was paid for, an activity its groups.
 * Every figure comes from the analysis services the ranking reads, so a block
 * weighs what its row weighs, and the movements of a category add up to it.
 */
export async function moneyMap({
  userId,
  period,
  kind,
  reading,
  by,
  labels,
}: {
  userId: string
  period: Period
  kind: FlowKind
  reading: Reading
  by: BreakdownGroup
  labels: MapLabels
}): Promise<MapNode> {
  const { from, to } = period
  const list = (filters: Record<string, string>) =>
    `/movements?${new URLSearchParams(filters)}&type=${kind}&${periodParams(period)}&from=analysis`
  const cuts: FlowCut[] = by === 'activity' || by === 'actor' ? ['category', by] : ['category']
  const within = (p: FlowPlace): Within =>
    by === 'activity' ? { activity: p.activityId } : by === 'actor' ? { actor: p.actorId } : {}

  // The movements of each category (within its activity or actor, when the
  // map opens on them), keyed the way the categories below look them up.
  const place = (category: string | null, w: Within) =>
    [
      category ?? NONE,
      w.activity === undefined ? '' : (w.activity ?? NONE),
      w.actor === undefined ? '' : (w.actor ?? NONE),
    ].join('|')
  const byPlace = new Map<string, MapNode[]>()
  const push = (key: string, node: MapNode) => byPlace.set(key, [...(byPlace.get(key) ?? []), node])

  const categoryNode = (c: BreakdownRow, parent: string, w: Within): MapNode => ({
    ...figures(c),
    id: `${parent}/c:${c.key ?? NONE}`,
    level: 'category',
    label: c.label ?? labels.unset.category,
    href: list(ledgerFilters(c.key, w)),
    children: byPlace.get(place(c.key, w)) ?? [],
  })
  const groupNode = (g: BreakdownMass, parent: string, w: Within): MapNode => {
    const id = `${parent}/g:${g.key ?? NONE}`
    return {
      ...figures(g),
      id,
      level: 'group',
      label: g.label ?? labels.unset.group,
      children: g.categories.map((c) => categoryNode(c, id, w)),
    }
  }

  const [leaves, masses] = await Promise.all([
    flowLeaves(userId, from, to, kind, reading, LEAVES, cuts),
    readMasses(userId, from, to, kind, reading, by),
  ])

  for (const m of leaves.movements) {
    const w = within(m)
    const filters = ledgerFilters(m.categoryId, w)
    push(place(m.categoryId, w), {
      id: `m:${m.id}`,
      level: 'movement',
      // Under its actor, the actor's name would only repeat the block above:
      // what was written on the movement names it instead, or else its day,
      // which then does not show a second time.
      ...(by !== 'actor'
        ? { label: m.actor ?? labels.unset.actor, date: m.happenedOn, note: m.note }
        : m.note
          ? { label: m.note, date: m.happenedOn }
          : { label: labels.day(m.happenedOn) }),
      net: Number(m.net),
      count: 1,
      href: list(m.actorId ? { ...filters, actor: m.actorId } : filters),
    })
  }
  for (const r of leaves.rests) {
    const w = within(r)
    const key = place(r.categoryId, w)
    push(key, {
      id: `rest:${key}`,
      level: 'rest',
      label: labels.rest(Number(r.count)),
      net: Number(r.net),
      count: Number(r.count),
      href: list(ledgerFilters(r.categoryId, w)),
    })
  }

  // Built once the movements have their places, which the categories read.
  let children: MapNode[]
  switch (masses.by) {
    case 'activity':
      children = masses.rows.map((a) => {
        const id = `a:${a.key ?? NONE}`
        return {
          ...figures(a),
          id,
          level: 'activity',
          label: a.label ?? labels.unset.activity,
          children: a.groups.map((g) => groupNode(g, id, { activity: a.key })),
        }
      })
      break
    case 'actor':
      children = masses.rows.map((a) => {
        const id = `p:${a.key ?? NONE}`
        return {
          ...figures(a),
          id,
          level: 'actor',
          label: a.label ?? labels.unset.actor,
          href: list(ledgerFilters(undefined, { actor: a.key })),
          children: a.categories.map((c) => categoryNode(c, id, { actor: a.key })),
        }
      })
      break
    case 'category':
      children = masses.rows.map((c) => categoryNode(c, '', {}))
      break
    case 'categoryGroup':
      children = masses.rows.map((g) => groupNode(g, '', {}))
  }
  return {
    id: 'root',
    level: 'root',
    label: labels.root,
    net: children.reduce((sum, c) => sum + Math.max(0, c.net), 0),
    count: children.reduce((sum, c) => sum + c.count, 0),
    children,
  }
}

/** The masses the map opens on, each with what it unfolds into, as the analysis services give them. */
type Masses =
  | { by: 'activity'; rows: ActivityMass[] }
  | { by: 'actor'; rows: BreakdownMass[] }
  | { by: 'category'; rows: BreakdownRow[] }
  | { by: 'categoryGroup'; rows: BreakdownMass[] }

async function readMasses(
  userId: string,
  from: string,
  to: string,
  kind: FlowKind,
  reading: Reading,
  by: BreakdownGroup,
): Promise<Masses> {
  switch (by) {
    case 'activity':
      return { by, rows: await spendingByActivity(userId, from, to, kind, reading) }
    case 'actor':
      return { by, rows: await spendingByActor(userId, from, to, kind, reading) }
    case 'category':
      return { by, rows: await spendingBreakdown(userId, from, to, 'category', kind, reading) }
    case 'categoryGroup':
      return { by, rows: await spendingByCategoryGroup(userId, from, to, kind, reading) }
  }
}

function figures(row: BreakdownRow) {
  return { net: Number(row.net), count: Number(row.count) }
}

/** The ledger's filters for a category (when there is one), within the activity or actor the map opens on. */
function ledgerFilters(category: string | null | undefined, w: Within): Record<string, string> {
  return {
    ...(category !== undefined ? { category: category ?? NONE } : {}),
    ...(w.activity !== undefined ? { activity: w.activity ?? NONE } : {}),
    ...(w.actor !== undefined ? { actor: w.actor ?? NONE } : {}),
  }
}
