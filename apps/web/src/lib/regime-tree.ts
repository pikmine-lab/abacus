import type { Answers, RegimeQuestion } from '@abacus/core/domain/regime'
import { satisfies } from '@abacus/core/domain/regime'

/**
 * The trail of a questionnaire: the questions already answered, in the order
 * they were put. The screen keeps the whole question and not just its answer,
 * because going back has to show the options again, and because a question
 * carries the condition that says whether it still applies at all.
 *
 * `satisfies` is the domain's, deliberately: what a condition means is decided
 * where the tree is defined, and a second reading of it here would drift.
 */
export interface AnsweredQuestion {
  question: RegimeQuestion
  /** The option value chosen, as the question declares it. */
  value: string
}

/**
 * The trail with every answer that lost its object dropped. A question only
 * asked because of an earlier answer stops existing when that answer changes,
 * and the answer it held has to go with it: kept, it would still feed the
 * model it belonged to (a VAT rate under an activity that just said it
 * charges none), and the regime would be written from something nobody was
 * asked any more.
 *
 * One forward pass settles it: the catalog refuses a question that waits on a
 * question asked after it, so an answer can only ever be voided by an earlier
 * one.
 */
export function keepMeaningful(trail: AnsweredQuestion[]): AnsweredQuestion[] {
  const kept: AnsweredQuestion[] = []
  const answers: Answers = {}
  for (const step of trail) {
    if (!satisfies(step.question.when, answers)) continue
    kept.push(step)
    answers[step.question.id] = step.value
  }
  return kept
}

/** The answers a trail carries, in the shape the questionnaire reads them. */
export function answersOf(trail: AnsweredQuestion[]): Answers {
  return Object.fromEntries(trail.map((step) => [step.question.id, step.value]))
}

/**
 * Answering: at the end of the trail for a new question, in place for one
 * already answered, which is what going back to it does.
 */
export function answered(
  trail: AnsweredQuestion[],
  question: RegimeQuestion,
  value: string,
): AnsweredQuestion[] {
  const at = trail.findIndex((step) => step.question.id === question.id)
  const next = at === -1 ? [...trail, { question, value }] : trail.with(at, { question, value })
  return keepMeaningful(next)
}
