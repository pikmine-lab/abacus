---
name: test-first
description: Develop a planned feature or fix in this project with the tests written first by one agent, reviewed from a fresh context, then the code written by another agent under the test guard. Use when implementing a planned feature or fix.
# baudrier test-first skill, version 2.
---

# Test-first development

This session orchestrates: it hands each step to the agent for that role and
passes on what the next one needs. The principles behind it are in the
`harness` skill of the baudrier plugin.

| Role | Agent | Writes |
|---|---|---|
| Write the tests | `test-writer` | Tests only |
| Review the tests | `test-reviewer` | Nothing |
| Write the code | `implementer` | Code; a test only with a reason |
| Audit the tests and the plan | `test-auditor` | Nothing |

In this project:

- plans live in the feature's GitHub issue, one comment per Spec Kit artifact (spec, plan, tasks), cached under `.specify/tmp/issue-<number>/` by the `issue-sync` extension;
- the test guard runs with `node scripts/guard-tests.mjs snapshot` and
  `node scripts/guard-tests.mjs check [--reason <file>="<why>"]...`;
- mutation testing has no CI job yet (#194): the audit says so in its verdict;
- code is reviewed by `/code-review` at the effort level the plan declares, run by `/speckit-converge`.

## 1. The plan

1. Read the whole plan: the behaviours, cases and refusals, and for an
   interface what each screen shows and lets the user do. If it only states
   the intent, stop and get it completed.
2. Show its owner a table of concrete examples (this input gives this result,
   this one is refused with this code), or a mockup for an interface, with the
   open points listed. Wait for the owner's confirmation.
3. Decide every open point before any test. A human decides what touches
   money, data, security, a behaviour users or other systems rely on, or
   anything hard to undo. This session decides the rest, writes each decision
   into the plan, and keeps it for the final report.

## 2. The sequence

1. **Tests.** Give `test-writer` the plan. It returns the tests, a map from
   each item of the plan to its tests, the open points, and the run showing
   each new test fails for the expected reason.
2. **Test review.** Give `test-reviewer` the plan and the list of test files,
   nothing else. Loop back to step 1 with its findings until it accepts; after
   two rounds without agreement, ask a human. Decide any open point it or the
   writer raises (section 1, step 3), then loop back to step 1.
3. **Snapshot.** Run `node scripts/guard-tests.mjs snapshot`.
4. **Code.** Give `implementer` the plan and the accepted tests. It returns
   its report with the guard's output. If it stops on a discovery with real
   consequences, decide it as an open point, update the plan, and go back to
   the step it affects: the tests first if the expected behaviour changes.
5. **Audit and review.** Push the branch and wait for CI. Give `test-auditor` the plan and
   the implementer's report. Send surviving mutants it reports to
   `test-writer`, then through a review and a new snapshot; a mutant that
   reveals a behaviour nobody decided is an open point first. Have the code
   reviewed by `/code-review` at the effort level the plan declares, run by `/speckit-converge`.
6. **Disputed reasons** go to a human, with the reason and the auditor's
   objection side by side.

## 3. Findings

Each finding, whatever its source, takes one path, and only that loop runs
again:

| Finding | Path |
|---|---|
| A bug: the code does not do what the plan says | `test-writer` adds a test that reproduces it and fails, `test-reviewer` reviews it, new snapshot, `implementer` fixes, audit and review |
| A quality issue with no change in behaviour | `implementer` fixes and runs `check`, audit and review |
| The plan was wrong or incomplete | Decide it as an open point, update the plan and its examples, back to step 1 of the sequence |

## 4. Done

- The tests pass and `node scripts/guard-tests.mjs check` passes.
- The audit and the code review accept.
- The final report lists every decision taken on the way.
- The guard's table, if any test changed, is in the pull request description, never
  in a file of the repository.
