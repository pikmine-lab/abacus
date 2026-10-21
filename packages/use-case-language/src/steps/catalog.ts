import type { Money } from '../index.ts'

/** A category as the person reads it: its name and the group it is filed under, if any. */
export interface CategoryRead {
  name: string
  group: string | null
}

/** An actor as the person reads it: its name and the activity it passes on to its movements, if any. */
export interface ActorRead {
  name: string
  activity: string | null
}

/** The steps of actors, aliases, categories. */
export interface CatalogSteps {
  createCategory(input: { name: string; group?: string }): Promise<void>
  /** Renames a category, or files it under another group; a null group takes it out of any. */
  editCategory(input: { category: string; name?: string; group?: string | null }): Promise<void>
  /** The categories, grouped, then alphabetical inside each group, the ungrouped last. */
  readCategories(): Promise<CategoryRead[]>

  createActor(name: string): Promise<void>
  /** Corrects an actor's name, or the activity it passes on; a null activity detaches it. */
  editActor(input: { actor: string; name?: string; activity?: string | null }): Promise<void>
  /** Another name that resolves to this actor from now on. */
  addAlias(input: { actor: string; alias: string }): Promise<void>
  /** The duplicate's history moves to the actor kept, and its name becomes an alias of it. */
  mergeActors(input: { keep: string; absorb: string }): Promise<void>
  /** The actor's past movements that carry no activity take the one it passes on now. */
  reattachActorHistory(actor: string): Promise<void>
  /** The actors, in alphabetical order. */
  readActors(): Promise<ActorRead[]>

  /**
   * Declares an expense to a payee the person never named before, and ends
   * with that payee existing. The interfaces differ here on purpose, and the
   * inventory says why: the web creates the payee as it is typed, since a
   * person who types a name means it; the MCP refuses the line until the
   * creation is asked for explicitly, since an AI may misspell a name. Each
   * driver plays its interface's way and fails when the interface does
   * otherwise: the web's must go through without being asked anything, the
   * MCP's must be refused first, then go through once creation is asked.
   */
  declareExpenseToUnknownPayee(input: {
    account: string
    amount: Money
    payee: string
    on: string
  }): Promise<void>
}
