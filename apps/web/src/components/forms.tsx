'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import type { FormState } from '@/lib/actions'
import { cn } from '@/lib/utils'

export function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the wrapped control always arrives as children
    <label className={cn('flex min-w-0 flex-col gap-1.5 text-xs text-secondary-foreground', className)}>
      {label}
      {children}
    </label>
  )
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full cursor-pointer rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary',
        className,
      )}
      {...props}
    />
  )
}

export function SubmitButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? '…' : children}
    </Button>
  )
}

/**
 * Wires a server action returning FormState to a form: shows the error in
 * place, resets the fields after a success.
 */
type CountedState = FormState & { n: number }

export function ActionForm({
  action,
  className,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>
  className?: string
  children: React.ReactNode
}) {
  const [state, formAction] = useActionState(
    async (prev: CountedState, formData: FormData): Promise<CountedState> => {
      const result = await action(prev, formData)
      // The success counter keys the form: a success remounts it (clearing the
      // fields), an error leaves it in place so nothing typed is lost.
      return { ...result, n: result.ok ? prev.n + 1 : prev.n }
    },
    { n: 0 },
  )
  return (
    <form action={formAction} key={state.n} className={cn('flex flex-col gap-3', className)}>
      {children}
      {state.error && <p className="text-xs text-[#e66767]">{state.error}</p>}
    </form>
  )
}
