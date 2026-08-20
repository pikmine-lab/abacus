import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Circular progress for a plan that has an end: how far along the installments
 * are. A ring reads as "this much done, this much left" at a glance, and costs
 * no horizontal room in a dense row.
 *
 * The centre carries the share paid, not "done/total": a percentage cannot be
 * misread and fits at any plan length, where "12/24" would not. The exact
 * count lives in the row's own metadata, and in the label for screen readers.
 */
export function ProgressRing({
  done,
  total,
  className,
}: {
  done: number
  total: number
  className?: string
}) {
  const size = 42
  const stroke = 3.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
  const left = Math.max(0, total - done)

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        // Start at 12 o'clock and run clockwise, the way a plan is read.
        className="-rotate-90"
        role="img"
        aria-label={
          left === 0
            ? `Les ${total} échéances sont payées`
            : `${done} échéances payées sur ${total}, ${left} restante${left > 1 ? 's' : ''}`
        }
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={left === 0 ? 'var(--good)' : 'var(--primary)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
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
