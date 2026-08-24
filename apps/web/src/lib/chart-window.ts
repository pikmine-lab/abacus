import { addPeriod } from '@abacus/core/domain/period'

/**
 * How far back a placement curve is drawn. This is the one control that does
 * not live in the page's filter row: it scopes its own chart and nothing else
 * (the positions and the operations under it are snapshots, not a period), and
 * a row promising to scope everything below it would be lying. It still writes
 * to the URL, so a framing shares, reloads and undoes at the back button.
 */
export type ChartWindow = '1w' | '1m' | '1y' | 'all'

const WINDOWS: ChartWindow[] = ['1w', '1m', '1y', 'all']

export const WINDOW_LABEL: Record<ChartWindow, string> = {
  '1w': '1S',
  '1m': '1M',
  '1y': '1A',
  all: 'Tout',
}

/**
 * The first day to draw, for the chosen window. `earliest` is where the data
 * itself starts (the first operation, the first close known): asking for a
 * year of a holding bought last week would draw twelve months of flat nothing
 * and squeeze the part that says something.
 */
export function resolveChartWindow(
  params: { window?: string },
  now: string,
  earliest: string,
): { window: ChartWindow; from: string } {
  const window = (WINDOWS as string[]).includes(params.window ?? '') ? (params.window as ChartWindow) : 'all'
  if (window === 'all') return { window, from: earliest }
  const unit = window === '1w' ? 'week' : window === '1m' ? 'month' : 'year'
  const start = addPeriod(now, unit, -1)
  return { window, from: start > earliest ? start : earliest }
}
