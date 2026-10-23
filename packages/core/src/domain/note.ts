import { DomainError } from './errors.ts'

/** The longest note a person writes on a gesture: a few sentences, enough to say why. */
export const NOTE_MAX_LENGTH = 500

/** A note as given, refused past NOTE_MAX_LENGTH characters. */
export function boundedNote<T extends string | null | undefined>(note: T): T {
  if (typeof note === 'string' && [...note].length > NOTE_MAX_LENGTH)
    throw new DomainError('note_too_long', `A note holds ${NOTE_MAX_LENGTH} characters at most`)
  return note
}
