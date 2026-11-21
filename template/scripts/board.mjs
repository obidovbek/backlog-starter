// The state of the plan, read from the Backlog.md files in backlog/, for AI agents and the terminal.
// No dependencies. Changes nothing.
//
//   node scripts/board.mjs            the task in progress and its current sub-step, what is ready
//                                     to start, and what waits for the owner
//   node scripts/board.mjs overview   progress by stage, counts by status
//
// Tasks are changed with the `backlog` command line, never by this script.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'backlog');

function readOwner() {
  const settingsPath = path.join(root, '.obsidian', 'plugins', 'backlog-board', 'data.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (typeof parsed.me === 'string' && parsed.me.trim()) {
      return parsed.me.trim();
    }
  } catch {
    // Fall back when data.json is absent or unreadable.
  }
  return '@bekzod';
}

const ME = readOwner();

function scalar(raw) {
  const value = raw.trim();
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(value)) return value.slice(1, -1);
  return value;
}

// The YAML Backlog.md writes: scalars, quoted strings, folded/literal blocks, flow lists and block lists.
function yaml(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^([A-Za-z_]\w*):\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const [, key, rest] = match;
    const trimmed = rest.trim();
    if (/^[>|][+-]?$/.test(trimmed)) {
      const parts = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        const nextLine = lines[i + 1];
        if (!/^\s+/.test(nextLine) && nextLine.trim() !== '') break;
        i += 1;
        if (nextLine.trim()) parts.push(nextLine.trim());
      }
      out[key] = parts.join(' ');
    } else if (trimmed.startsWith('[')) {
      const inner = trimmed.slice(1, -1).trim();
      out[key] = inner ? inner.split(',').map(scalar) : [];
    } else if (!trimmed) {
      const list = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        list.push(scalar(lines[++i].replace(/^\s*-\s+/, '')));
      }
      out[key] = list;
    } else {
      out[key] = scalar(rest);
    }
  }
  return out;
}

function readNote(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return { data: match ? yaml(match[1]) : {}, body: match ? text.slice(match[0].length) : text };
}

function marked(body, name) {
  const match = new RegExp(`<!--\\s*(?:SECTION:)?${name}:BEGIN\\s*-->([\\s\\S]*?)<!--\\s*(?:SECTION:)?${name}:END\\s*-->`).exec(body);
  return match ? match[1].trim() : '';
}

function checklist(text) {
  return [...text.matchAll(/^\s*-\s+\[([ xX])\]\s+(?:#(\d+)\s+)?(.*)$/gm)].map((m, i) => ({
    index: m[2] ? Number(m[2]) : i + 1,
    done: m[1] !== ' ',
    text: m[3].trim(),
  }));
}

function list(dir) {
  const full = path.join(folder, dir);
  return fs.existsSync(full) ? fs.readdirSync(full).filter((name) => name.endsWith('.md')).map((name) => path.join(full, name)) : [];
}

if (!fs.existsSync(folder)) {
  console.log('No backlog/ folder here.');
  process.exit(1);
}

const config = yaml(fs.readFileSync(path.join(folder, 'config.yml'), 'utf8'));
const statuses = config.statuses && config.statuses.length ? config.statuses : ['To Do', 'In Progress', 'Done'];
const finalStatus = statuses[statuses.length - 1];
const initialStatus = config.default_status || statuses[0];

const milestones = new Map();
for (const file of list('milestones')) {
  const { data } = readNote(file);
  milestones.set(String(data.id || '').toLowerCase(), String(data.title || path.basename(file)));
}

const tasks = [...list('tasks'), ...list('completed')].map((file) => {
  const { data, body } = readNote(file);
  return {
    id: String(data.id || '').toUpperCase(),
    title: String(data.title || path.basename(file, '.md')),
    status: file.includes(`${path.sep}completed${path.sep}`) ? finalStatus : String(data.status || ''),
    assignee: data.assignee || [],
    deps: (data.dependencies || []).map((id) => String(id).toUpperCase()),
    milestone: milestones.get(String(data.milestone || '').toLowerCase()) || '',
    ordinal: Number.isFinite(Number(data.ordinal)) ? Number(data.ordinal) : Infinity,
    ac: checklist(marked(body, 'AC')),
    notes: marked(body, 'NOTES'),
  };
});
tasks.sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id, undefined, { numeric: true }));

const byId = new Map(tasks.map((task) => [task.id, task]));
const isDone = (task) => task.status === finalStatus;
const unmet = (task) => task.deps.filter((id) => !byId.has(id) || !isDone(byId.get(id)));
const label = (id) => {
  const task = byId.get(id);
  if (!task) return id;
  const first = /^(\S+)\s/.exec(task.title);
  return first && /\d/.test(first[1]) ? first[1] : task.title;
};
const waits = (task) => {
  const open = unmet(task);
  const shown = open.slice(0, 4).map(label).join(', ');
  return open.length > 4 ? `${shown} +${open.length - 4}` : shown;
};
const mine = (task) => task.assignee.includes(ME);
const onlyMine = (task) => mine(task) && task.assignee.length === 1;

if ((process.argv[2] || 'now') === 'overview') {
  const count = (group) => `${group.filter(isDone).length}/${group.length}`;
  console.log(`Total: ${count(tasks)} done`);
  console.log(`By status: ${statuses.map((status) => `${status} ${tasks.filter((task) => task.status === status).length}`).join(' · ')}`);
  const stages = new Map();
  for (const task of tasks) {
    const stage = task.milestone || 'No milestone';
    if (!stages.has(stage)) stages.set(stage, []);
    stages.get(stage).push(task);
  }
  if (stages.size > 0) {
    console.log('By stage:');
    for (const [stage, group] of stages) console.log(`  ${stage}: ${count(group)}${group.every((task) => task.status === 'Locked') ? ' (locked)' : ''}`);
  }
  const open = tasks.filter((task) => mine(task) && !isDone(task) && task.status !== 'Locked');
  console.log(`For ${ME}: ${open.length} open, ${open.filter((task) => !unmet(task).length).length} of them ready`);
  process.exit(0);
}

const active = tasks.filter((task) => task.status === 'In Progress');
if (!active.length) console.log('In progress: nothing.');
for (const task of active) {
  const current = task.ac.find((item) => !item.done);
  console.log(`In progress: ${task.id} ${task.title}${task.milestone ? ` (${task.milestone})` : ''}`);
  console.log(`  sub-steps ${task.ac.filter((item) => item.done).length}/${task.ac.length}${current ? ` · current #${current.index}: ${current.text}` : task.ac.length ? ' · all ticked: close the step' : ' · none yet: plan them'}`);
  const log = task.notes.split(/\r?\n/).filter((line) => line.trim()).slice(-4);
  const cut = (line) => (line.length > 160 ? `${line.slice(0, 159)}…` : line);
  if (log.length) console.log(`  log, last lines:\n${log.map((line) => `    ${cut(line)}`).join('\n')}`);
}
const ready = tasks.filter((task) => task.status === initialStatus && !unmet(task).length && !onlyMine(task));
console.log(`Ready to start: ${ready.map((task) => `${label(task.id)} (${task.id})`).join(', ') || 'nothing'}`);
const open = tasks.filter((task) => mine(task) && !isDone(task) && task.status !== 'Locked' && task.status !== 'In Progress');
const openReady = open.filter((task) => !unmet(task).length);
console.log(`Waiting for ${ME}, ready now (${openReady.length}): ${openReady.map((task) => label(task.id)).join(' · ') || 'nothing'}`);
const later = open.filter((task) => unmet(task).length);
if (later.length) console.log(`Waiting for ${ME}, later (${later.length}): ${later.map((task) => `${label(task.id)} [waits: ${waits(task)}]`).join(' · ')}`);
