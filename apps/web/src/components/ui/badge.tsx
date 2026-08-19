import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-px text-[10.5px] tracking-wide whitespace-nowrap',
  {
    variants: {
      variant: {
        muted: 'border-border text-faint',
        outline: 'border-secondary-foreground text-foreground',
        accent: 'border-primary bg-primary font-semibold text-white',
      },
    },
    defaultVariants: { variant: 'muted' },
  },
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge }
