import type { Money } from '../index.ts'

/** What another person keeps in the app, as a case refers to it: by name, and its movement and commitment by their id. */
export interface SomeoneElses {
  account: string
  movementId: string
  commitmentId: string
}

/** The steps of sign-up, sign-in, consent, connected applications, isolation. */
export interface IdentitySteps {
  /** Creates an account through the sign-up screen, which leaves its person signed in. */
  signUp(input: { name: string; email: string; password: string }): Promise<void>
  signOut(): Promise<void>
  /** Signs in with an email and a password: whether a session opened. */
  signIn(input: { email: string; password: string }): Promise<'signed-in' | 'refused'>
  /** Whether a page of the app opens, rather than sending to the sign-in. */
  reachesTheApp(): Promise<boolean>
  /** Comes to the app with no session or token at all: let in, refused, or refused and told where to sign in. */
  comeAnonymously(): Promise<'sent-to-sign-in' | 'refused' | 'let-in'>
  /** An AI client asks for access; the person answers on the consent page. Whether the client got a token, and reached the person's data with it. */
  answerAccessRequest(answer: 'accept' | 'refuse'): Promise<'reaches-data' | 'no-token'>
  /** Another person, with an account holding one expense and a subscription, declared through the back. */
  someoneElseDeclares(input: {
    account: string
    amount: Money
    payee: string
    on: string
    subscription: string
  }): Promise<SomeoneElses>
  /** What the other person's expense and subscription are now, read through the back. */
  readSomeoneElses(theirs: SomeoneElses): Promise<{ amount: Money; commitment: string }>
  /** The names of the accounts the person sees. */
  readAccountNames(): Promise<string[]>
  /** Who each movement the person sees was paid to or received from. */
  readMovementCounterparties(): Promise<string[]>
  /** The AI applications the person let in: their name and the domain they come from. */
  readConnectedApps(): Promise<{ name: string; domain: string | null }[]>
  /** Cuts an application off, named as the person sees it. */
  revokeConnectedApp(name: string): Promise<void>
  /** Whether the AI application the case signed in with still reaches the person's data, or is told where to sign in again. */
  connectedAppReaches(): Promise<'reaches' | 'sent-to-sign-in' | 'refused'>
  /** Corrects a movement by its id: whether the correction went through. */
  correctSomeoneElsesMovement(movementId: string, amount: Money): Promise<'corrected' | 'refused'>
  /** Renames a commitment by its id: whether the correction went through. */
  correctSomeoneElsesCommitment(commitmentId: string, label: string): Promise<'corrected' | 'refused'>
}
