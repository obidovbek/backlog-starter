import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const starterDir = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.join(starterDir, 'template');
const PLUGIN_FILES = ['manifest.json', 'main.js', 'styles.css', 'README.md'];
const TEXT_WITH_PROJECT_NAME = new Set(['CLAUDE.md', 'backlog/config.yml']);
const GITIGNORE_ENTRIES = ['.obsidian/workspace*.json', '.obsidian/cache'];

function printUsage() {
  console.log(`Usage:
  node setup.mjs <target-folder> [--name "Project Name"] [--update-plugin]

Options:
  --name <name>     Project name for CLAUDE.md and backlog/config.yml (defaults to folder name)
  --update-plugin   Only update Backlog Board plugin code (keeps data.json and project files)
  -h, --help        Show this help`);
}

function parseArgs(argv) {
  let target = null;
  let name = null;
  let updatePlugin = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '--update-plugin') {
      updatePlugin = true;
    } else if (arg === '--name') {
      if (i + 1 >= argv.length) {
        throw new Error('--name requires a value');
      }
      name = argv[++i];
    } else if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (target === null) {
      target = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return { target, name, updatePlugin, help };
}

function walkFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, rel));
    } else if (entry.isFile()) {
      out.push({ rel, full });
    }
  }
  return out;
}

function mergeCommunityPlugins(targetDir) {
  const file = path.join(targetDir, '.obsidian', 'community-plugins.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '[\n  "backlog-board"\n]\n', 'utf8');
    return 'created';
  }
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(current)) {
    throw new Error(`${file} is not a JSON array`);
  }
  if (current.includes('backlog-board')) {
    return 'kept';
  }
  current.push('backlog-board');
  fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  return 'updated';
}

function mergeGitignore(targetDir) {
  const file = path.join(targetDir, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = GITIGNORE_ENTRIES.filter((entry) => !lines.has(entry));
  if (missing.length === 0) {
    return existing ? 'kept' : 'created';
  }
  const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, `${existing}${prefix}${missing.join('\n')}\n`, 'utf8');
  return existing ? 'updated' : 'created';
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help || parsed.target === null) {
    printUsage();
    process.exit(parsed.help ? 0 : 1);
  }

  const targetDir = path.resolve(parsed.target);
  const projectName = (parsed.name && parsed.name.trim()) || path.basename(targetDir);
  fs.mkdirSync(targetDir, { recursive: true });

  if (parsed.updatePlugin) {
    const srcPlugin = path.join(templateDir, '.obsidian', 'plugins', 'backlog-board');
    const dstPlugin = path.join(targetDir, '.obsidian', 'plugins', 'backlog-board');
    fs.mkdirSync(dstPlugin, { recursive: true });
    for (const name of PLUGIN_FILES) {
      fs.copyFileSync(path.join(srcPlugin, name), path.join(dstPlugin, name));
    }
    console.log(`Backlog Board plugini yangilandi: ${dstPlugin} (data.json saqlab qolindi).`);
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const { rel, full } of walkFiles(templateDir)) {
    if (rel === '.obsidian/community-plugins.json') continue;
    const dst = path.join(targetDir, ...rel.split('/'));
    if (fs.existsSync(dst)) {
      skipped += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (TEXT_WITH_PROJECT_NAME.has(rel)) {
      const content = fs.readFileSync(full, 'utf8').replaceAll('{{PROJECT_NAME}}', projectName);
      fs.writeFileSync(dst, content, 'utf8');
    } else {
      fs.copyFileSync(full, dst);
    }
    created += 1;
  }

  for (const dir of [
    'backlog/tasks',
    'backlog/archive/tasks',
    'backlog/milestones',
    'backlog/drafts',
  ]) {
    fs.mkdirSync(path.join(targetDir, ...dir.split('/')), { recursive: true });
  }

  const pluginsState = mergeCommunityPlugins(targetDir);
  const gitignoreState = mergeGitignore(targetDir);

  console.log(`Tayyor (${projectName}): ${created} ta fayl yaratildi, ${skipped} ta mavjud faylga tegilmadi.`);
  console.log(`community-plugins.json: ${pluginsState}, .gitignore: ${gitignoreState}.`);
  console.log('');
  console.log('Keyingi 2 qadam:');
  console.log(`1) Obsidian -> Open folder as vault -> ${targetDir}`);
  console.log('2) Ctrl+P -> "Backlog Board: Doskani agent bilan ochish"');
}

main();
