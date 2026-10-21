import type { Money } from '../index.ts'

/** What another person keeps in the app, as a case refers to it: by name, and its movement by its id. */
export interface SomeoneElses {
  account: string
  movementId: string
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
  /** Comes to the app with no session or token at all. */
  comeAnonymously(): Promise<'refused' | 'let-in'>
  /** An AI client asks for access; the person answers on the consent page. Whether the client got a token. */
  answerAccessRequest(answer: 'accept' | 'refuse'): Promise<'token' | 'no-token'>
  /** Another person, with an account holding one expense, declared through the back. */
  someoneElseDeclares(input: {
    account: string
    amount: Money
    payee: string
    on: string
  }): Promise<SomeoneElses>
  /** The names of the accounts the person sees. */
  readAccountNames(): Promise<string[]>
  /** The AI applications the person let in: their name and the domain they come from. */
  readConnectedApps(): Promise<{ name: string; domain: string | null }[]>
  /** Cuts an application off, named as the person sees it. */
  revokeConnectedApp(name: string): Promise<void>
  /** Whether the AI application the case signed in with still reaches the person's data. */
  connectedAppReaches(): Promise<boolean>
  /** Corrects a movement by its id: whether the correction went through. */
  correctSomeoneElsesMovement(movementId: string, amount: Money): Promise<'corrected' | 'refused'>
}
