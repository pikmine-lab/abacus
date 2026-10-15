import { CheckIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/**
 * Circular progress for a plan that has an end: how far along the installments
 * are. A ring reads as "this much done, this much left" at a glance, and costs
 * no horizontal room in a dense row.
 *
 * The centre carries the share paid, not "done/total": a percentage cannot be
 * misread and fits at any plan length, where "12/24" would not. The exact
 * count lives in the row's own metadata, and in the label for screen readers.
 *
 * A plan that money covers (`coverage`: someone pays it back on its total,
 * or paid into its reserve) is read in money rather than in installments,
 * with the marks of gross and net (DESIGN.md § Graphes): what was paid and
 * covered is the translucent part, what was paid out of pocket the full one.
 * What came in ahead of the installments it will cover runs on in the same
 * translucent tint, thinner: covered already, not paid yet. Its tint ties it
 * to the money that came in, never to what the person pays. The row says the
 * same in words, and which money it was.
 */
export function ProgressRing({
  done,
  total,
  coverage,
  className,
}: {
  done: number
  total: number
  /** In money, for a plan claimed on its total or with a reserve: paid, total, covered and received ahead. */
  coverage?: { paid: number; total: number; covered: number; ahead: number }
  className?: string
}) {
  const t = useTranslations('common.progress')
  const size = 42
  const stroke = 3.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const ratio = coverage ? clamp(coverage.paid / coverage.total) : total > 0 ? clamp(done / total) : 0
  const left = Math.max(0, total - done)
  const tone = left === 0 ? 'var(--good)' : 'var(--primary)'

  // One arc of the ring, from `from` to `to` (shares of the whole), as a dash.
  const arc = (from: number, to: number) => ({
    strokeDasharray: `0 ${circumference * from} ${circumference * Math.max(0, to - from)} ${circumference}`,
  })
  const covered = coverage ? clamp(coverage.covered / coverage.total) : 0
  // Runs on from what is paid, for as much money as came back ahead.
  const ahead = coverage ? clamp(ratio + coverage.ahead / coverage.total) : 0

  const circle = { cx: size / 2, cy: size / 2, r: radius, fill: 'none' }
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        // Start at 12 o'clock and run clockwise, the way a plan is read.
        className="-rotate-90"
        role="img"
        aria-label={left === 0 ? t('allPaid', { total }) : t('paid', { done, total, left })}
      >
        <circle {...circle} stroke="var(--border)" strokeWidth={stroke} />
        {coverage ? (
          <>
            {ahead > ratio && (
              <circle
                {...circle}
                stroke={tone}
                strokeOpacity={0.4}
                strokeWidth={1.5}
                {...arc(ratio, ahead)}
              />
            )}
            <circle {...circle} stroke={tone} strokeOpacity={0.4} strokeWidth={stroke} {...arc(0, covered)} />
            <circle {...circle} stroke={tone} strokeWidth={stroke} {...arc(covered, ratio)} />
          </>
        ) : (
          <circle
            {...circle}
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
          />
        )}
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center leading-none"
      >
        {left === 0 ? (
          <CheckIcon className="size-4 text-good" />
        ) : (
          <span className="font-mono text-[11px] font-semibold text-muted-foreground tabular">
            {Math.round(ratio * 100)}%
          </span>
        )}
      </span>
    </div>
  )
}
