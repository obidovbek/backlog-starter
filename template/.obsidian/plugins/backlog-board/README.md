# Backlog Board

An Obsidian view over [Backlog.md](https://github.com/MrLesk/Backlog.md) task files: what is being
worked on now, a board, the plan by milestone, a searchable list, documents and decisions, and
statistics. It reads and writes the same Markdown files as the `backlog` command line and its web
board, so all three can be used side by side.

It is generic: nothing in it belongs to one project. The folder, the statuses, the names shown and
the language come from the settings and from the project's own `config.yml`.

## Views

| Tab | Shows |
| --- | --- |
| Now | Each task in an active status (default `In Progress`): its current sub-step, day/task action buttons, and "Work with the agent". With nothing active: the tasks ready to start (with action buttons) and the ones waiting. |
| Board | One column per status, in the order of `config.yml`. Drag a card to another column to change its status; drop it on a card to put it just above that card. Ctrl, Cmd or Shift and a click picks several cards, which move together. The last column (Done) can be folded. |
| Plan | Milestones in order with their progress, each with its tasks in plan order. |
| List | Every task, with a search and filters by status, milestone, priority and label. |
| Docs | The project's documentation, its decisions (also from extra folders, such as ADRs), and the drafts, which can be made into tasks. |
| Statistics | Overall progress; tasks by status, priority and milestone; the blocked ones; the most recently updated and created. |

"+ New task" in the header (or the command "Backlog Board: New task") opens a form: title, status,
milestone, priority, labels, assignee, due date, what it waits for, description and sub-steps. The
project's Definition of Done defaults are added to every new task.

Clicking a task opens its page:

- status, priority, milestone, labels, assignee, dates;
- action buttons, **Work with the agent**, Edit, Open file, Archive;
- what it waits for and what waits for it;
- the description;
- sub-steps: tick, add, edit, remove;
- the work log, with a line to add to it;
- **work files and links**: files of the vault or web links (a Google Doc, for instance) attached
  to the task;
- **linked notes**: every note that links to the task, and "+ New note" to write one;
- the Definition of Done, the summary and the comments.

## Working with an AI (Agent panel & ACP)

The board includes its own **Agent** view (`Backlog Board: Open agent panel`, or `Backlog Board: Work layout` to open the board and agent side by side). It talks to any AI agent that speaks the **Agent Client Protocol (ACP)** over JSON-RPC 2.0 on stdin/stdout — no extra npm dependencies are required in the plugin.

- **Agents setting** (one per line, `Name = command`):
  ```
  Claude Code = npx -y @agentclientprotocol/claude-agent-acp@0.109.0
  Gemini CLI = gemini --acp | file
  Codex = npx -y @agentclientprotocol/codex-acp | file
  ```
  Add `| file` for agents without slash commands so they are told to follow `<commandsFolder>/<command>.md`.
- **Targets** (`Where the text goes`):
  - **Agent panel** (default): opens the built-in ACP panel beside the board, streams the agent's words and tool calls, and asks one-time `Allow` / `Reject` for permission requests (`allow_always` is never surfaced as a shortcut). Each agent keeps its own session while Obsidian is open; switching agents in the panel's picker preserves each conversation.
  - **Terminal (Termy)**, **Claudian chat**, or **Copy**: alternative targets if you prefer an external terminal plugin, Claudian, or the clipboard.
- **Notifications** (0.4.0): while Obsidian is not in front, a system notification says when the agent in the panel has finished, stopped with an error, or asks for permission; clicking it brings the panel back. A setting turns it off.
- **Action buttons**: configure `Day actions`, `Active task actions`, and `Ready task actions` as `Label = command [args]` (supporting `{id}`, `{step}`, `{title}`, `{path}`). "Work with the agent" uses the `Text sent to the AI` template.

## What it writes

Only through the Backlog.md format, editing the lines concerned and nothing else:

- a task's `status`, `ordinal`, `title`, `milestone`, `priority`, `labels`, `assignee`, `due_date`,
  `dependencies`, `references` and `updated_date`;
- its sub-steps and Definition of Done items, its description and its work log;
- a new task file in `tasks/`, numbered after every task, archived ones included;
- a draft made into a task (new id, moved to `tasks/`), and a task moved to `archive/tasks/`;
- a new note, in the notes folder, that links to its task.

## Install in another vault

1. The project needs a Backlog.md folder: run `backlog init` in the vault, or point the plugin
   at an existing folder.
2. Copy this folder (`manifest.json`, `main.js`, `styles.css`, this README) to
   `<vault>/.obsidian/plugins/backlog-board/`. Do not copy `data.json`, which holds this vault's
   settings.
3. In Obsidian: Settings → Community plugins → reload the list → turn on **Backlog Board**.
4. Open it from the ribbon icon or the command "Backlog Board: Open the board".
5. In Settings → Backlog Board, set the folder if it is not `backlog`, and the language.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Backlog folder | `backlog` | The Backlog.md folder inside the vault |
| Language | English | Words of the interface: English or O'zbekcha (Uzbek wording is a draft, to be corrected by a native speaker) |
| Tab to open with | Now | The tab a new board opens on |
| Active statuses | `In Progress` | Comma-separated; their tasks fill the Now tab; Start moves a task to the first |
| Blocked statuses | `Blocked` | Comma-separated; their tasks are listed under Waiting |
| Locked statuses | empty | Comma-separated; tasks waiting for a gate: never ready, never in "Waiting for you" |
| You | empty | Your assignee name, e.g. `@bekzod`; your open tasks are listed under "Waiting for you" in Now and Statistics |
| Folded columns | empty | Comma-separated statuses folded on the board until opened; empty folds only the last column (see below) |
| Collapse the last column | on | Folds Done on the board when "Folded columns" is empty |
| Show labels on cards | on | Labels on the board's cards; they are always in the detail and the List filter |
| Lines of the work log | 8 | How much of the log the Now tab shows |
| Names shown | empty | `Original = Shown`, one per line, for statuses and priorities; files keep the original |
| Notes folder | `notes` | Where "+ New note" puts a note linked to a task |
| Plain-words folder | `backlog/plain` | One file per task (`task-12.md`) with a line per sub-step, `#1 what it means in plain words`; a sub-step that has a line gets a "?" that shows it on hover or click |
| More decision folders | empty | Comma-separated folders listed with the decisions, e.g. `docs/decisions` |
| Agents | `Claude Code = npx -y @agentclientprotocol/claude-agent-acp@0.109.0` (for ACP panel) or `Claude Code = claude` (for terminal) | One per line: `Name = command` (add `\| file` for agents without slash commands) |
| Agent | first in list | Active agent used by buttons and the Agent panel |
| Where the text goes | `Agent panel` | `Agent panel` (ACP), `Terminal (Termy)`, `Claudian chat`, or `Copy` |
| Ask before sending to the terminal | on | Confirms before typing into a Termy terminal |
| Commands folder | `.claude/commands` | Folder of command `.md` files for agents marked `\| file` |
| Day / Active / Ready actions | empty | `Label = command [args]` buttons shown in Now and on task pages |
| Text sent to the AI | a short template | Fills in `{id}`, `{title}`, `{path}`, `{current}` and `{goal}` |

## Changing it

One file, no build step: edit `main.js` or `styles.css`, then reload Obsidian
(command "Reload app without saving"). The functions that read and edit files are exported as
`BacklogBoardPlugin.helpers` so they can be tested outside Obsidian. A new interface language is
one more table in `STRINGS`.
