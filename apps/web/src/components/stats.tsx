import { ArrowUpRightIcon } from 'lucide-react'
import Link from 'next/link'
import { cn, eur } from '@/lib/utils'

/**
 * A 12-point trend, drawn small and quiet: grey line, last segment and end
 * point in the accent so the eye lands on "now". Decorative in the sense that
 * the exact values are read elsewhere, never the only place a number lives.
 */
function Sparkline({ points, className }: { points: number[]; className?: string }) {
  if (points.length < 2) return null
  const W = 96
  const H = 26
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const x = (i: number) => (i / (points.length - 1)) * (W - 4) + 2
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6)
  const path = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const lastIndex = points.length - 1
  const tail = `M${x(lastIndex - 1).toFixed(1)} ${y(points[lastIndex - 1]!).toFixed(1)} L${x(lastIndex).toFixed(1)} ${y(points[lastIndex]!).toFixed(1)}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('h-[26px] w-24', className)} aria-hidden="true">
      <path d={path} fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={tail} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" />
      <circle
        cx={x(lastIndex)}
        cy={y(points[lastIndex]!)}
        r="2.6"
        fill="var(--primary)"
        stroke="var(--background)"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export interface Delta {
  /** Signed change in currency against the comparison window. */
  value: number
  /** Names what it is compared to: "vs juillet", "vs 12 mois plus tôt". */
  label: string
  /** True when going up is bad (spending): flips the semantic color only. */
  invert?: boolean
}

function DeltaLine({ delta }: { delta: Delta }) {
  if (delta.value === 0) return <p className="text-[11.5px] text-faint">stable {delta.label}</p>
  const up = delta.value > 0
  const good = delta.invert ? !up : up
  return (
    <p className={cn('text-[11.5px]', good ? 'text-good' : 'text-destructive')}>
      {/* The arrow carries the direction; color only reinforces it. */}
      {up ? '↑' : '↓'} {eur(Math.abs(delta.value))} {delta.label}
    </p>
  )
}

export function StatTile({
  label,
  value,
  hint,
  delta,
  spark,
  href,
  hero,
}: {
  label: string
  value: string
  hint?: string
  delta?: Delta
  spark?: number[]
  /** Makes the tile a way into the page that owns the detail. */
  href?: string
  /** The one headline number of the view. Exactly one per screen. */
  hero?: boolean
}) {
  const body = (
    <>
      {/* Affordance in the tile's own corner, away from the label it is not
          part of, and big enough to read as a control. */}
      {href && (
        <ArrowUpRightIcon className="absolute top-3 right-3 size-4 text-faint transition-colors group-hover:text-primary sm:right-4" />
      )}
      <p className="pr-6 text-[11.5px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1.5 font-semibold tracking-tight tabular',
          hero ? 'text-[30px] leading-none' : 'text-[22px] leading-none',
        )}
      >
        {value}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0">
          {delta ? <DeltaLine delta={delta} /> : hint && <p className="text-[11.5px] text-faint">{hint}</p>}
          {delta && hint && <p className="text-[11.5px] text-faint">{hint}</p>}
        </div>
        {spark && spark.length > 1 && <Sparkline points={spark} />}
      </div>
    </>
  )

  const shell = 'group relative flex min-w-0 flex-col px-4 py-3.5 first:pl-0 sm:px-5'
  return href ? (
    <Link href={href} className={cn(shell, 'rounded-md hover:bg-secondary/40')}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  )
}

/** Tiles are separated by hairlines rather than boxed in cards. */
export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-border/70 border-b border-border sm:divide-y-0 lg:grid-cols-4">
      {children}
    </div>
  )
}
