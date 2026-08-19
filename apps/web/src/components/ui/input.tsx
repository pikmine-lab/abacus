import { cn } from '@/lib/utils'

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-faint focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
