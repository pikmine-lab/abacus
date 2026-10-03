/**
 * The months the flow band of Analyse shows, as the days to ask the monthly
 * series for. Null when there is nothing to draw.
 *
 * A period of several months is shown whole. A single month has no trend of
 * its own, so the band shows the twelve months it belongs to, cut in fixed
 * blocks counted back from the current month: a click inside the band moves
 * the wash, never the band, and the current block is the last twelve months,
 * the window of the overview. Months before the first declaration are left
 * out rather than drawn as empty months that would read as months spent at
 * zero.
 */
export function flowBandWindow(
  period: { preset: string; ref: string; from: string; to: string },
  firstDeclaredDay: string | null,
  currentMonth: string,
): { from: string; to: string } | null {
  if (firstDeclaredDay === null) return null
  const window = period.preset === 'month' ? monthBlock(period.ref, currentMonth) : period
  const from = window.from > firstDeclaredDay ? window.from : firstDeclaredDay
  return from > window.to ? null : { from, to: window.to }
}

/** The twelve-month block holding `ref`, blocks ending on the current month. */
function monthBlock(ref: string, currentMonth: string): { from: string; to: string } {
  const back = index(currentMonth) - index(ref)
  // A month after the current one (a hand-written URL) ends its own block.
  const end = back < 0 ? index(ref) : index(currentMonth) - Math.floor(back / 12) * 12
  return { from: `${month(end - 11)}-01`, to: `${month(end)}-${lastDay(end)}` }
}

function index(ref: string): number {
  const [y, m] = ref.split('-').map(Number)
  return y! * 12 + (m! - 1)
}

function month(i: number): string {
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}

function lastDay(i: number): string {
  return String(new Date(Date.UTC(Math.floor(i / 12), (i % 12) + 1, 0)).getUTCDate()).padStart(2, '0')
}
