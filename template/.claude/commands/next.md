---
description: Do the current sub-step of the task in progress, then stop and report
---

Take the task `In Progress` (`node scripts/board.mjs`) and read it (`backlog task <id> --plain`). Its current sub-step is its first unticked acceptance criterion. If it has none yet, run `/new-task` first.

1. Do **that sub-step only**, keeping it simple and working.
2. **Write first:** log the start with `backlog task edit <id> --append-notes "<date> · #<n>: <what will be done>"`.
3. **If it needs the user:** add a note starting `Waiting for @bekzod:` saying exactly what is needed, report it, and stop.
4. **When done and checked:** tick it (`backlog task edit <id> --check-ac <n> --append-notes "<date> · #<n> done. <result>"`).
5. **If it was the last sub-step:** run tests/checks, tick DoD items (`--check-dod`), write `--final-summary`, set `-s Done`, and propose a commit (never push unless asked).
6. Stop and report concisely in Uzbek: what changed, how it was checked, and the next sub-step.
