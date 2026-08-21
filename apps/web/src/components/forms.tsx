'use client'

import { CalendarIcon } from 'lucide-react'
import { createContext, useActionState, useContext, useEffect, useRef, useState } from 'react'
import { fr } from 'react-day-picker/locale'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FormState } from '@/lib/actions'
import { cn } from '@/lib/utils'

/**
 * Per-field messages from the last submit. A context rather than props because
 * fields sit several levels below the form, and threading an error through
 * every intermediate component is how a field ends up showing someone else's
 * message.
 */
const FieldErrors = createContext<Record<string, string> | undefined>(undefined)

export function Field({
  label,
  name,
  children,
  className,
}: {
  label: string
  /** Input name this label belongs to; enables its error message and styling. */
  name?: string
  children: React.ReactNode
  className?: string
}) {
  const errors = useContext(FieldErrors)
  const error = name ? errors?.[name] : undefined
  return (
    <Label
      data-invalid={error ? '' : undefined}
      className={cn(
        'flex min-w-0 flex-col items-stretch gap-1.5 text-xs font-normal text-muted-foreground',
        // Reaches the control inside, whatever it is: an input, a Select
        // trigger or the date button are all rendered by children.
        'data-invalid:text-destructive data-invalid:[&_button]:border-destructive data-invalid:[&_input]:border-destructive',
        className,
      )}
    >
      {label}
      {children}
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </Label>
  )
}

/**
 * A text field that survives a rejected submit. React resets uncontrolled
 * inputs once a form action settles, which is right after a success and wrong
 * after a validation error, where retyping everything is the punishment for one
 * missing select. Holding the value in state keeps it; the form's key still
 * clears it on success by remounting.
 */
export function TextField({
  name,
  label,
  defaultValue = '',
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'name' | 'value' | 'defaultValue'> & {
  name: string
  label: string
  defaultValue?: string
}) {
  const [value, setValue] = useState(defaultValue)
  return (
    <Field label={label} name={name}>
      <Input name={name} value={value} onChange={(e) => setValue(e.target.value)} {...props} />
    </Field>
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
  onValueChange,
}: {
  name: string
  options: { value: string; label: string }[]
  placeholder?: string
  required?: boolean
  /** Visible item that clears the selection, for optional fields. */
  noneLabel?: string
  defaultValue?: string
  /** For callers deriving something from the choice, such as a preview. */
  onValueChange?: (value: string) => void
}) {
  const [value, setValue] = useState(defaultValue)
  return (
    <Select
      name={name}
      required={required}
      value={value}
      onValueChange={(v) => {
        const next = v === NONE ? '' : v
        setValue(next)
        onValueChange?.(next)
      }}
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

export function DateField({
  name,
  defaultValue,
  onValueChange,
}: {
  name: string
  defaultValue?: string
  /** Receives the day as "YYYY-MM-DD", for callers that derive from it. */
  onValueChange?: (day: string) => void
}) {
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
              if (d) onValueChange?.(toIsoDay(d))
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
  onSuccess,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>
  className?: string
  /** Acknowledgement kept in place, so entering several in a row stays fluid. */
  successLabel?: string
  /** Called once per success, for a panel that should close itself. */
  onSuccess?: () => void
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
  // Guarded by the last counter fired, so a re-render cannot call it twice
  // while still firing once per actual success.
  const fired = useRef(0)
  useEffect(() => {
    if (state.ok && state.n > fired.current) {
      fired.current = state.n
      onSuccess?.()
    }
  }, [state.n, state.ok, onSuccess])
  return (
    // noValidate: validation is ours, so the browser never puts a bubble on a
    // field the user was not editing.
    <form noValidate action={formAction} key={state.n} className={cn('flex flex-col gap-3', className)}>
      <FieldErrors.Provider value={state.fields}>{children}</FieldErrors.Provider>
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
