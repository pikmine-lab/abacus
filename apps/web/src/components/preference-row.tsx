/**
 * One preference: its name, what it does shown on an example rather than
 * explained, and the control at the end of the line. The example follows the
 * control, so the choice is read before it is made.
 */
export function PreferenceRow({
  label,
  example,
  control,
}: {
  label: string
  example: React.ReactNode
  control: React.ReactNode
}) {
  return (
    <section
      aria-label={label}
      className="grid grid-cols-1 items-center gap-x-8 gap-y-3 border-b border-border py-5 first:pt-2 sm:grid-cols-[1fr_auto]"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h2 className="text-[13px] font-medium">{label}</h2>
        <div className="text-[12.5px] text-muted-foreground">{example}</div>
      </div>
      <div className="sm:justify-self-end">{control}</div>
    </section>
  )
}
