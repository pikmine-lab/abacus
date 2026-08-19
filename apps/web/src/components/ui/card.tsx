import { cn } from '@/lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-xl border border-border bg-card p-4 sm:p-5', className)} {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('text-[13px] font-semibold', className)} {...props} />
}

function CardSub({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('mt-px text-xs text-faint', className)} {...props} />
}

export { Card, CardSub, CardTitle }
