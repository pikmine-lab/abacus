---
description: "Write the artifacts a Spec Kit step changed back to the feature's GitHub issue and pull request"
---

# Push the feature to GitHub

Writing the artifacts into the feature's own issue and pull request is a
standing agreement of this repository: do it without asking. It covers those
two only, and only through this command.

## User Input

```text
$ARGUMENTS
```

## Steps

1. Use the same issue number as the pull that opened the step.
2. Write one sentence, in the issue's language, saying what the step changed
   and why it matters to a reader of the issue (not the list of files: the
   script adds it). For example: "plan revu, la revue de sécurité devient
   obligatoire parce que la fonctionnalité ajoute un champ saisi".
3. Run:

   ```sh
   node .specify/extensions/issue-sync/scripts/issue-sync.mjs push <issue number> --note "<sentence>"
   ```

   Each artifact of the cache becomes one comment of the issue, updated in
   place; `tasks.md` goes to its section of the pull request description, the
   rest of the description untouched. An unchanged artifact is left alone. When
   something changed, the note is posted on the issue as a short comment of its
   own, followed by the list of artifacts.
4. If the script fails, stop and report it: the step is not finished while
   its artifacts exist only in the cache. When it says the tasks have nowhere
   to go, open the draft pull request first, as `/speckit-tasks` says.

Report the artifacts created and updated, in one line.
