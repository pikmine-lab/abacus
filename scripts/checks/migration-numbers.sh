#!/usr/bin/env bash
# Refuse a migration whose number is already taken.
#
# The number is what says the order: the runner applies migrations sorted by
# filename, so two files sharing a number hand that order to the alphabet
# instead. Parallel worktrees are the normal way of working here, and neither
# branch can see the clash on its own: it is born when the two meet. So this
# compares what the branch adds against the merge base, and against the other
# migrations added alongside it. On a merge queue run, those others are the
# pull requests queued ahead of this one, which is the case a pull request
# build alone cannot catch.
set -euo pipefail

base=$(git merge-base origin/main HEAD)

number_of() { basename "$1" | cut -d _ -f 1; }

# Numbers already on main. A number appearing twice there is history we are not
# rewriting (see issue #67), so the last one read simply wins as the name shown.
declare -A taken=()
while read -r file; do
  [ -n "$file" ] || continue
  taken["$(number_of "$file")"]=$file
done < <(git ls-tree -r --name-only "$base" -- 'migrations' | grep '\.sql$' || true)

status=0
while read -r file; do
  [ -n "$file" ] || continue
  number=$(number_of "$file")
  if [ -n "${taken["$number"]:-}" ]; then
    echo "$file: migration number $number is already taken by ${taken["$number"]}" >&2
    status=1
  else
    taken["$number"]=$file
  fi
done < <(git diff --name-only --diff-filter=A "$base" HEAD -- 'migrations/*.sql')

if [ "$status" -ne 0 ]; then
  echo "Renumber the migration above and push again." >&2
  exit 1
fi

echo "No migration number is taken twice."
