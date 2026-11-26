---
description: Open a task (or create a new one) with sub-steps and wait for an ok
argument-hint: <TASK-ID or short goal>
---

Task: $ARGUMENTS

1. Find the task (`backlog task list --plain`) or create it (`backlog task create "<title>" -a @claude`).
2. Check its dependencies are `Done` and it is not `Locked`.
3. Break it into small, practical sub-steps (`backlog task edit <id> --ac "<sub-step>"`), each starting with who does it (`@bekzod`, `@claude`, or `@bekzod @claude`; no icons), and write for each one line in plain words, in the user's language, in `backlog/plain/task-<n>.md` (`#<step> what the user has to do or what will be done`; the board shows it behind a "?"), keeping the solution simple and working.
4. Show the sub-steps and wait for an ok before setting `-s "In Progress"` and writing code (one task `In Progress` at a time).
