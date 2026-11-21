# {{PROJECT_NAME}}

Short description of what this project does. (Fill this in once.)

## How we work

- **Keep it simple and working.** Build plain things an ordinary person understands — no
  over-engineering, no AI polish for its own sake, and nothing extra that the task does not need.
  Ship working software and keep the project moving.
- **Tasks live in `backlog/tasks/`** and are viewed on the Backlog Board in Obsidian. Always use
  the `backlog` CLI (`backlog task create/edit/...`), never rewrite a task file by hand.
- **Start:** run `node scripts/board.mjs` and read the active task (`backlog task <id> --plain`).
  When asked to continue ("davom et"), follow `.claude/commands/next.md`.
- **One task `In Progress`, one sub-step at a time:** log before starting (`--append-notes`),
  do the work, check it, tick (`--check-ac <n>`), then stop and report.
- **Never push unless asked.** Propose a commit when a task is done.
- Reply in Uzbek when the user writes in Uzbek. Code, comments, and commits are in English.

## Commands

```powershell
node scripts/board.mjs          # see what is active, ready, and waiting
backlog task list --plain       # list all tasks
backlog task <id> --plain       # read one task
# Add your build/test commands here:
# npm test
```
