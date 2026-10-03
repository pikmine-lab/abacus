import { AbacusGate, type BeadState } from '@/components/abacus-gate'
import { Card } from '@/components/ui/card'

/**
 * The door of the app, outside its shell: sign-in and consent are reached
 * from a link or from an AI client, never from the navigation, so each is one
 * card on the bare page. The abacus heading it counts the way in.
 *
 * `data-gate` lets a control inside the card drive the beads from CSS
 * (globals.css), without threading state from the buttons up to the mark.
 */
export function Door({ beads, children }: { beads: BeadState[]; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card data-gate="" className="w-full max-w-sm gap-0 px-6 py-7 sm:px-8 sm:py-8">
        <AbacusGate beads={beads} className="w-full text-faint" />
        <p className="mt-4 font-mono text-[15px] font-semibold tracking-tight">
          abacus<span className="text-primary">_</span>
        </p>
        {children}
      </Card>
    </main>
  )
}
