/**
 * The money map of the analysis: the period as nested blocks, each as large as
 * the net it weighs, from the masses down to the movements. Shared by the page
 * that builds the tree and the component that draws it.
 */

/** What a block stands for. `rest` is the movements a category's list leaves out, summed. */
export type MapLevel = 'root' | 'activity' | 'group' | 'category' | 'movement' | 'rest'

export interface MapNode {
  /** Unique within the tree: the path of keys from the root. */
  id: string
  level: MapLevel
  label: string
  net: number
  count: number
  /** A movement's day. */
  date?: string
  note?: string | null
  /** Where the block leads in the ledger: the movements it stands for. */
  href?: string
  children?: MapNode[]
}

/** The URL parameters that hold where the map is looking, and the block chosen on it. */
export const VIEW_PARAM = 'at'
export const FOCUS_PARAM = 'focus'

/** What a block draws: only a positive net has a surface. */
export function drawn(nodes: MapNode[] | undefined): MapNode[] {
  return (nodes ?? []).filter((n) => n.net > 0)
}
