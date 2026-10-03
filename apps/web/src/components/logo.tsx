/**
 * The abacus mark: a grid of three rows of places, dots for the empty ones,
 * copper blocks for what is counted, pushed to the right, one, two, three. An
 * abacus read as a display: a count, and a small bar chart. The dots inherit
 * currentColor so the mark sits in whatever ink surrounds it; the blocks carry
 * the copper accent, which is what makes it recognisable at 16px.
 *
 * Same geometry as app/icon.svg (the tab icon, scaled for 16px) and as the
 * wide grid at the door (abacus-gate.tsx), whose counted rows end like this.
 */
const COLUMNS = [5.25, 9.75, 14.25, 18.75]
const ROWS = [7.5, 12, 16.5]
const BLOCK = 3.4

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Larger and denser than the door's dots: at 24px the empty places
          would otherwise fade into the ground and leave a bar chart. */}
      <g fill="currentColor" fillOpacity="0.7">
        {ROWS.flatMap((y) => COLUMNS.map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.85" />))}
      </g>
      <g fill="var(--primary)">
        {ROWS.flatMap((y, row) =>
          COLUMNS.slice(COLUMNS.length - 1 - row).map((x) => (
            <rect
              key={`${x}-${y}`}
              x={x - BLOCK / 2}
              y={y - BLOCK / 2}
              width={BLOCK}
              height={BLOCK}
              rx="0.8"
            />
          )),
        )}
      </g>
    </svg>
  )
}
