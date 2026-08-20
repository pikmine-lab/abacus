'use client'

import { CalendarIcon } from 'lucide-react'
import { useActionState, useState } from 'react'
import { fr } from 'react-day-picker/locale'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
    <Label
      className={cn(
        'flex min-w-0 flex-col items-stretch gap-1.5 text-xs font-normal text-muted-foreground',
        className,
      )}
    >
      {label}
      {children}
    </Label>
  )
}

/* Radix items cannot carry an empty value, so the optional "none" item uses a
   sentinel mapped back to '' (which the server actions read as absent). */
const NONE = '__none__'

export function FormSelect({
  name,
  options,
  placeholder,
  required,
  noneLabel,
  defaultValue = '',
}: {
  name: string
  options: { value: string; label: string }[]
  placeholder?: string
  required?: boolean
  /** Visible item that clears the selection, for optional fields. */
  noneLabel?: string
  defaultValue?: string
}) {
  const [value, setValue] = useState(defaultValue)
  return (
    <Select
      name={name}
      required={required}
      value={value}
      onValueChange={(v) => setValue(v === NONE ? '' : v)}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder ?? noneLabel} />
      </SelectTrigger>
      <SelectContent>
        {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/* Local dates only (YYYY-MM-DD), never through Date.toISOString (timezone shift). */
function toIsoDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

function fromIsoDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

export function DateField({ name, defaultValue }: { name: string; defaultValue?: string }) {
  const [date, setDate] = useState<Date | undefined>(defaultValue ? fromIsoDay(defaultValue) : undefined)
  const [open, setOpen] = useState(false)
  return (
    <>
      <input type="hidden" name={name} value={date ? toIsoDay(date) : ''} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between font-normal">
            {date ? (
              date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
            ) : (
              <span className="text-muted-foreground">Choisir une date</span>
            )}
            <CalendarIcon className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={fr}
            selected={date}
            defaultMonth={date}
            onSelect={(d) => {
              setDate(d)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </>
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
  successLabel,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>
  className?: string
  /** Acknowledgement kept in place, so entering several in a row stays fluid. */
  successLabel?: string
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
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      {successLabel && state.ok && state.n > 0 && (
        <p aria-live="polite" className="text-xs text-good">
          ✓ {successLabel}
          {state.n > 1 ? ` (${state.n})` : ''}
        </p>
      )}
    </form>
  )
}
