/**
 * The abacus mark at the door of the app, drawn wide: the logo's grid drawn
 * out across the card, each row standing for one step of getting in. A row
 * not yet counted keeps its blocks parked at the left end, as small faint
 * outlines; counted, they cross the grid to its right end and fill with
 * copper, so the three rows counted end exactly like the logo (one, two,
 * three blocks). A pending row is on its way, half-travelled, copper-outlined,
 * while the server answers.
 *
 * Purely a reading aid: every state it draws is also said by the screen
 * around it (fields, a busy button, an error), so it stays hidden from
 * assistive technology. The motion lives in globals.css (`.gate-bead`).
 */
export type BeadState = 'idle' | 'pending' | 'counted'

// The logo's grid (components/logo.tsx), same pitch and block, with more
// places per row: the travel from the left end to the right one is the count.
const PITCH = 4.5
const BLOCK = 3.4
const PLACES = 13
const ROWS = [7.5, 12, 16.5]
const place = (i: number) => BLOCK / 2 + i * PITCH
const XS = Array.from({ length: PLACES }, (_, i) => place(i))
// Row k carries k + 1 blocks: counted at the right end, parked at the left.
const BLOCKS = ROWS.map((_, row) =>
  Array.from({ length: row + 1 }, (_, i) => ({ counted: place(PLACES - 1 - i), parked: place(row - i) })),
)

export function AbacusGate({ beads, className }: { beads: BeadState[]; className?: string }) {
  const width = place(PLACES - 1) + BLOCK / 2
  return (
    // The viewBox is cropped to the grid, so its ends sit on the card's text
    // edges whatever the card's width.
    <svg
      viewBox={`0 ${ROWS[0] - BLOCK / 2} ${width} ${ROWS[2] - ROWS[0] + BLOCK}`}
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <g fill="currentColor" fillOpacity="0.55">
        {ROWS.flatMap((y) => XS.map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.6" />))}
      </g>
      {ROWS.map((y, row) =>
        BLOCKS[row].map(({ counted, parked }) => {
          return (
            <rect
              key={`${counted}-${y}`}
              // Outline and fill share one edge: 2.8 plus the stroke is the
              // logo's 3.4, so a counted block is exactly the logo's block.
              x={counted - 1.4}
              y={y - 1.4}
              width="2.8"
              height="2.8"
              rx="0.5"
              strokeWidth="0.6"
              data-state={beads[row] ?? 'idle'}
              className="gate-bead"
              style={{ '--start': `${parked - counted}px` } as React.CSSProperties}
            />
          )
        }),
      )}
    </svg>
  )
}
