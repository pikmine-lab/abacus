import { CheckIcon } from 'lucide-react'
import Link from 'next/link'
import { Logo } from '@/components/logo'
import { cn } from '@/lib/utils'

/**
 * First run. A declarative app is empty until someone declares something, so
 * the empty state is a path, not a notice: each step says what it unlocks, is
 * ticked once done, and only the next open one carries the call to action.
 */
export interface Step {
  title: string
  why: string
  href: string
  cta: string
  done: boolean
}

export function Onboarding({ steps, apiKeyHref }: { steps: Step[]; apiKeyHref: string }) {
  const nextIndex = steps.findIndex((s) => !s.done)

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-14">
      <div className="flex flex-col gap-2">
        <Logo className="size-8 text-muted-foreground" />
        <h1 className="text-xl font-semibold tracking-tight">
          Bienvenue sur abacus<span className="text-primary">_</span>
        </h1>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Tout ici est déclaré par toi : aucune connexion bancaire, aucun import. En échange, tu vois
          exactement ce que tu as décidé de suivre. Trois pas et le tableau de bord se remplit.
        </p>
      </div>

      <ol className="flex flex-col">
        {steps.map((step, i) => {
          const current = i === nextIndex
          return (
            <li
              key={step.href}
              className={cn(
                'flex gap-3 border-t border-border py-4 last:border-b',
                step.done && 'opacity-55',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular',
                  step.done
                    ? 'border-good/40 text-good'
                    : current
                      ? 'border-primary/50 text-primary'
                      : 'border-border text-faint',
                )}
              >
                {step.done ? <CheckIcon className="size-3.5" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">{step.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">{step.why}</p>
              </div>
              {!step.done && (
                <Link
                  href={step.href}
                  className={cn(
                    'mt-0.5 h-8 shrink-0 self-start rounded-md px-3 text-[12.5px] leading-8 font-medium transition-colors',
                    current
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {step.cta}
                </Link>
              )}
            </li>
          )
        })}
      </ol>

      <p className="text-[12.5px] leading-relaxed text-faint">
        Tu peux aussi tout déclarer en langage naturel depuis Claude, en branchant le serveur MCP :{' '}
        <Link href={apiKeyHref} className="text-primary underline-offset-2 hover:underline">
          créer une clé d’API
        </Link>
        .
      </p>
    </div>
  )
}
