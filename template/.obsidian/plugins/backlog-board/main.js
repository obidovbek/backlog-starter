'use strict';

/*
 * Backlog Board: an Obsidian view over Backlog.md task files (https://github.com/MrLesk/Backlog.md).
 *
 * Generic on purpose: the folder, the statuses, the names shown and the language come from the
 * plugin settings and from the project's own <folder>/config.yml, so the plugin can be copied into
 * any vault that holds a Backlog.md folder. One file, no build step: edit it, then reload Obsidian.
 *
 * Reads:  <folder>/config.yml and the tasks, milestones, drafts, docs and decisions under <folder>,
 *         plus any extra decision folders named in the settings.
 * Writes: only through the Backlog.md file format, line by line: a task's fields, its checklists,
 *         its description and work log; new tasks; a draft promoted; a task moved to the archive;
 *         and, when asked, a new note linked to a task.
 */

const {
  Plugin,
  ItemView,
  Modal,
  FuzzySuggestModal,
  PluginSettingTab,
  Setting,
  MarkdownRenderer,
  Notice,
  TFile,
  normalizePath,
  parseYaml,
  debounce,
} = require('obsidian');

const VIEW_TYPE = 'backlog-board-view';
const AGENT_VIEW_TYPE = 'backlog-board-agent-view';
const DRAG_TYPE = 'application/x-backlog-board-task';
const ICON = 'layout-dashboard';
const AGENT_ICON = 'bot';
const CLAUDIAN_VIEW = 'claudian-view';
const CLAUDIAN_OPEN = 'realclaudian:open-view';
// How often an open board looks at the disk for changes Obsidian did not report.
const DISK_CHECK_MS = 3000;
// The agents the board can talk to, one per line (see parseAgents), and where the text goes.
const DEFAULT_AGENTS = 'Claude Code = claude';
const TARGETS = ['panel', 'terminal', 'claudian', 'copy'];
const TERMY_ID = 'termy';

const DEFAULT_PROMPT = [
  'Task {id}: {title}',
  'File: {path}',
  '{current}',
  'Work on it one sub-step at a time. When a sub-step is done, tick it in the task file and add a line to its work log, then stop and report.',
].join('\n');

const DEFAULT_SETTINGS = {
  backlogFolder: 'backlog',
  language: 'en',
  defaultTab: 'now',
  activeStatuses: 'In Progress',
  blockedStatuses: 'Blocked',
  lockedStatuses: '',
  foldStatuses: '',
  collapseFinal: true,
  me: '',
  cardLabels: true,
  logLines: 8,
  displayNames: '',
  notesFolder: 'notes',
  plainFolder: 'backlog/plain',
  decisionFolders: '',
  aiPrompt: DEFAULT_PROMPT,
  agents: DEFAULT_AGENTS,
  agent: '',
  target: 'panel',
  askBeforeSending: true,
  notifyAgent: true,
  commandsFolder: '.claude/commands',
  dayActions: '',
  activeActions: '',
  readyActions: '',
  whoMarks: '',
};

// ---------------------------------------------------------------------------------------------
// Words of the interface. Add a language by adding a table; a missing key falls back to English.
// ---------------------------------------------------------------------------------------------

const STRINGS = {
  en: {
    viewTitle: 'Backlog Board',
    openBoard: 'Open the board',
    newTask: 'New task',
    tabNow: 'Now',
    tabBoard: 'Board',
    tabPlan: 'Plan',
    tabList: 'List',
    tabDocs: 'Docs',
    tabStats: 'Statistics',
    nothingActive: 'Nothing is being worked on',
    readyNext: 'Ready to start',
    noReady: 'Nothing is ready to start.',
    waiting: 'Waiting',
    nextUp: 'Next:',
    start: 'Start',
    subSteps: 'Sub-steps',
    noSubsteps: 'No sub-steps yet.',
    addSubstep: 'Add a sub-step…',
    editSubstep: 'Edit the sub-step',
    removeSubstep: 'Remove',
    removeSubstepConfirm: (text) => `Remove the sub-step "${text}"?`,
    current: 'now',
    log: 'Work log',
    addLog: 'Write',
    logPlaceholder: 'Add a line to the work log…',
    plan: 'Implementation plan',
    dod: 'Definition of Done',
    summary: 'Summary',
    description: 'Description',
    comments: 'Comments',
    waitsFor: 'Waits for',
    waitsShort: 'waits:',
    unblocks: 'Unblocks',
    workFiles: 'Work files and links',
    attachFile: '+ File',
    attachLink: '+ Link',
    linkPrompt: 'A link (https://…)',
    remove: 'Remove',
    linkedNotes: 'Linked notes',
    newNote: '+ New note',
    noLinkedNotes: 'No note links to this task yet.',
    openNote: 'Open file',
    details: 'Details',
    edit: 'Edit',
    archive: 'Archive',
    archiveConfirm: (title) => `Move "${title}" to the archive?`,
    askClaude: 'Work with the agent',
    sentToClaude: 'Written into the Claudian chat: check it, then send.',
    copiedForAi: 'Copied: paste it into your AI chat (Ctrl+V).',
    sentToAgent: (name) => `Sent to ${name}.`,
    notSentCopied: 'It could not be sent, so it was copied: paste it with Ctrl+V.',
    sendAsk: (name) => `Send to ${name}?`,
    send: 'Send',
    stepOfTotal: (n, total) => `Sub-step ${n} of ${total}`,
    allTicked: 'All sub-steps are ticked.',
    doneSteps: (count) => `${count} sub-steps done`,
    moreSteps: (count) => `${count} more`,
    showLess: 'Show less',
    waitingForYou: (count) => `${count} things wait for you`,
    openOne: 'Open one of these.',
    holdsSteps: (count) => `${count} waiting on it`,
    workLayout: 'Open the board with the agent',
    noTermy: 'Termy is not on: turn it on in Community plugins.',
    back: 'Back',
    more: 'More',
    currentTask: 'Task in progress',
    currentStep: (n, total) => `Current sub-step · ${n} / ${total}`,
    and: 'and',
    tick: 'Tick',
    thenWord: 'Then:',
    setWho: 'Who marks',
    setWhoDesc: 'One per line, "mark = word": a mark at the start of a sub-step (such as @bekzod or @claude) is shown as the word.',
    wholeLog: (count) => `All ${count} lines`,
    statsDone: 'Done, of the steps not locked',
    statsLocked: (count) => `${count} locked steps are not counted.`,
    lockedStages: (stages, steps) => `Locked: ${stages} stages, ${steps} steps`,
    moreStages: (count) => `${count} more stages`,
    doneWord: 'done',
    yours: 'you',
    doneInGroup: (count) => `${count} done`,
    lockedInGroup: (count) => `${count} locked`,
    noOtherDocs: 'No other documents or drafts.',
    close: 'Close',
    cancel: 'Cancel',
    save: 'Save',
    create: 'Create',
    confirm: 'Yes',
    noMilestone: 'No milestone',
    none: '—',
    show: 'Show',
    hide: 'Hide',
    other: 'Other',
    selected: (count) => `${count} selected`,
    moveTo: 'Move',
    clearSelection: 'Clear',
    search: 'Search…',
    allStatuses: 'All statuses',
    allMilestones: 'All milestones',
    allPriorities: 'All priorities',
    allLabels: 'All labels',
    results: (count) => `${count} tasks`,
    noResults: 'Nothing found.',
    documentation: 'Documentation',
    decisions: 'Decisions',
    drafts: 'Drafts',
    promote: 'Make it a task',
    noDocs: 'No documents.',
    noDecisions: 'No decisions.',
    noDrafts: 'No drafts.',
    statsOverall: 'Overall',
    statsByStatus: 'By status',
    statsByPriority: 'By priority',
    statsByMilestone: 'By milestone',
    statsBlocked: 'Blocked',
    statsRecentUpdated: 'Recently updated',
    statsRecentCreated: 'Recently created',
    noneYet: 'None yet.',
    fieldTitle: 'Title',
    fieldStatus: 'Status',
    fieldMilestone: 'Milestone',
    fieldPriority: 'Priority',
    fieldLabels: 'Labels',
    fieldAssignee: 'Assignee',
    fieldDue: 'Due date',
    fieldDeps: 'Waits for',
    fieldDescription: 'Description',
    fieldSubsteps: 'Sub-steps',
    fieldSubstepsDesc: 'One per line.',
    addDep: '+ Add',
    commaHint: 'Comma-separated.',
    created: 'created',
    updated: 'updated',
    due: 'due',
    folderMissing: (folder) => `No Backlog.md folder at "${folder}".`,
    openSettings: 'Open settings',
    failed: 'Could not change',
    titleRequired: 'A title is needed.',
    setFolder: 'Backlog folder',
    setFolderDesc: 'The Backlog.md folder inside this vault, usually "backlog".',
    setLanguage: 'Language',
    setTab: 'Tab to open with',
    setActive: 'Active statuses',
    setActiveDesc: 'Comma-separated. Their tasks are shown in the Now tab.',
    setBlocked: 'Blocked statuses',
    setBlockedDesc: 'Comma-separated. Their tasks are listed under Waiting.',
    setCollapse: 'Collapse the last column (Done) on the board',
    setFold: 'Folded columns',
    setFoldDesc: 'Comma-separated statuses folded on the board until opened. Empty: only the last column, as above.',
    setLocked: 'Locked statuses',
    setLockedDesc: 'Comma-separated. Tasks waiting for a gate: never ready, never in "Waiting for you".',
    setMe: 'You',
    setMeDesc: 'Your assignee name, e.g. @bekzod. Your open tasks are listed under "Waiting for you".',
    setCardLabels: 'Show labels on cards',
    forYou: 'Waiting for you',
    setLogLines: 'Lines of the work log shown in the Now tab',
    setNames: 'Names shown',
    setNamesDesc: 'One per line, "Original = Shown", for statuses and priorities. Files keep the original.',
    setPlain: 'Plain-words folder',
    setPlainDesc: 'One file per task (task-12.md) with a line per sub-step, "#1 what it means in plain words". A sub-step that has a line gets a "?" that shows it.',
    plainHelp: 'In plain words',
    setNotes: 'Notes folder',
    setNotesDesc: 'Where "+ New note" creates a note linked to a task.',
    setDecisions: 'More decision folders',
    setDecisionsDesc: 'Comma-separated vault folders listed with the decisions, e.g. docs/decisions.',
    setAgentHeading: 'The AI agent',
    setAgents: 'Agents',
    setAgentsDesc:
      'One per line: Name = command. Add "| file" for an agent without slash commands. {prompt} marks where the first message goes; without it, it goes last.',
    setAgent: 'Agent',
    setTarget: 'Where the text goes',
    targetPanel: 'Agent panel',
    targetTerminal: 'Terminal (Termy)',
    targetClaudian: 'Claudian chat',
    targetCopy: 'Copy',
    agentViewTitle: 'Agent',
    openAgentPanel: 'Open agent panel',
    agentNewChat: 'New chat',
    agentStop: 'Stop',
    agentSend: 'Send',
    agentAllow: 'Allow',
    agentReject: 'Reject',
    agentPlaceholder: 'Message the agent…',
    agentHint: 'Enter — send',
    agentEmpty: 'Empty chat. Click a button on the board or type below.',
    agentReady: 'ready',
    agentStarting: 'starting…',
    agentWorking: 'working…',
    agentAsking: 'question',
    agentStopped: 'stopped',
    agentPermLabel: 'Permission needed',
    agentDone: 'done',
    agentFailed: 'failed',
    agentYou: 'You',
    agentToolRead: 'Read',
    agentToolEdit: 'Edit',
    agentToolExecute: 'Run',
    agentToolSearch: 'Search',
    agentToolOther: 'Tool',
    setAsk: 'Ask before sending to the terminal',
    setNotify: 'Notify when the agent finishes or asks, while Obsidian is not in front',
    notifyDone: 'The agent has finished',
    notifyAsks: 'The agent asks for permission',
    notifyFailed: 'The agent stopped with an error',
    setCommands: 'Commands folder',
    setCommandsDesc: 'For an agent marked "| file": it is told to follow <folder>/<command>.md.',
    setDayActions: 'Buttons of the day (Now)',
    setActiveActions: 'Buttons of the task in progress',
    setReadyActions: 'Buttons of a task ready to start',
    setActionsDesc: 'One per line: Label = command [arguments]. The command is a file in the commands folder; arguments may use {id}, {step}, {title} and {path}. The first is the main button.',
    setPrompt: 'Text sent to the AI',
    setPromptDesc: 'Used by "Work with the agent". Fills in {id}, {title}, {path}, {current} and {goal}.',
  },
  // Draft wording, to be corrected by a native speaker.
  uz: {
    viewTitle: 'Backlog Board',
    openBoard: "Board'ni ochish",
    newTask: 'Yangi qadam',
    tabNow: 'Hozir',
    tabBoard: 'Doska',
    tabPlan: 'Reja',
    tabList: "Ro'yxat",
    tabDocs: 'Hujjatlar',
    tabStats: 'Statistika',
    nothingActive: 'Hozir hech narsa ishlanmayapti',
    readyNext: 'Boshlash mumkin',
    noReady: "Boshlashga tayyor qadam yo'q.",
    waiting: 'Kutayotganlar',
    nextUp: 'Keyingi:',
    start: 'Boshlash',
    subSteps: 'Qadamlar',
    noSubsteps: 'Sub-qadamlar hali yozilmagan.',
    addSubstep: "Sub-qadam qo'shish…",
    editSubstep: 'Sub-qadamni tahrirlash',
    removeSubstep: "O'chirish",
    removeSubstepConfirm: (text) => `"${text}" sub-qadami o'chirilsinmi?`,
    current: 'hozir',
    log: 'Ish logi',
    addLog: 'Yozish',
    logPlaceholder: 'Ish logiga yozish…',
    plan: 'Ish rejasi',
    dod: 'Tayyorlik mezonlari',
    summary: 'Xulosa',
    description: 'Tavsif',
    comments: 'Izohlar',
    waitsFor: 'Kutadi',
    waitsShort: 'kutadi:',
    unblocks: "Bunga bog'liq",
    workFiles: 'Ish fayllari va havolalar',
    attachFile: '+ Fayl',
    attachLink: '+ Havola',
    linkPrompt: 'Havola (https://…)',
    remove: 'Olib tashlash',
    linkedNotes: "Bog'liq eslatmalar",
    newNote: '+ Yangi eslatma',
    noLinkedNotes: "Bu qadamga hali eslatma bog'lanmagan.",
    openNote: 'Faylni ochish',
    details: 'Batafsil',
    edit: 'Tahrirlash',
    archive: 'Arxivlash',
    archiveConfirm: (title) => `"${title}" arxivga ko'chirilsinmi?`,
    askClaude: 'Agent bilan ishlash',
    sentToClaude: 'Claudian oynasiga yozildi: tekshirib, yuboring.',
    copiedForAi: 'Nusxa olindi: AI oynasiga joylang (Ctrl+V).',
    sentToAgent: (name) => `${name}'ga yuborildi.`,
    notSentCopied: 'Yuborib bo\'lmadi, matn nusxalandi: Ctrl+V bilan joylang.',
    sendAsk: (name) => `${name}'ga yuborilsinmi?`,
    send: 'Yuborish',
    stepOfTotal: (n, total) => `${n}-qadam, ${total} tadan`,
    allTicked: 'Hamma qadamlar belgilangan.',
    doneSteps: (count) => `${count} ta qadam bajarildi`,
    moreSteps: (count) => `yana ${count} ta`,
    showLess: 'Yig\'ish',
    waitingForYou: (count) => `Sizni ${count} ta ish kutmoqda`,
    openOne: 'Quyidagilardan birini oching.',
    holdsSteps: (count) => `${count} ta qadam kutyapti`,
    workLayout: 'Doskani agent bilan ochish',
    noTermy: 'Termy yoqilmagan: Community plugins bo\'limida yoqing.',
    back: 'Orqaga',
    more: 'Ko\'proq',
    currentTask: 'Hozirgi vazifa',
    currentStep: (n, total) => `Hozirgi qadam · ${n} / ${total}`,
    and: 'va',
    tick: 'Belgilash',
    thenWord: 'Keyin:',
    setWho: 'Kim belgilari',
    setWhoDesc: 'Har qatorda bittasi, "belgi = so\'z": qadam boshidagi belgi (masalan @bekzod yoki @claude) so\'z bilan ko\'rsatiladi.',
    wholeLog: (count) => `hammasi (${count})`,
    statsDone: 'Bajarildi (qulflanmaganlardan)',
    statsLocked: (count) => `${count} ta qulflangan qadam hisobga olinmagan.`,
    lockedStages: (stages, steps) => `Qulflangan: ${stages} ta bosqich, ${steps} ta qadam`,
    moreStages: (count) => `yana ${count} ta bosqich`,
    doneWord: 'tayyor',
    yours: 'siz',
    doneInGroup: (count) => `${count} ta qadam tayyor`,
    lockedInGroup: (count) => `${count} ta qadam qulflangan`,
    noOtherDocs: 'Boshqa hujjat va qoralama yo\'q.',
    close: 'Yopish',
    cancel: 'Bekor qilish',
    save: 'Saqlash',
    create: 'Yaratish',
    confirm: 'Ha',
    noMilestone: 'Bosqichsiz',
    none: '—',
    show: "Ko'rsatish",
    hide: 'Yashirish',
    other: 'Boshqa',
    selected: (count) => `${count} ta tanlandi`,
    moveTo: "Ko'chirish",
    clearSelection: 'Bekor qilish',
    search: 'Qidirish…',
    allStatuses: 'Barcha statuslar',
    allMilestones: 'Barcha bosqichlar',
    allPriorities: 'Barcha muhimliklar',
    allLabels: 'Barcha yorliqlar',
    results: (count) => `${count} ta qadam`,
    noResults: 'Hech narsa topilmadi.',
    documentation: 'Hujjatlar',
    decisions: 'Qarorlar',
    drafts: 'Qoralamalar',
    promote: 'Qadamga aylantirish',
    noDocs: "Hujjat yo'q.",
    noDecisions: "Qaror yo'q.",
    noDrafts: "Qoralama yo'q.",
    statsOverall: 'Umumiy',
    statsByStatus: "Status bo'yicha",
    statsByPriority: "Muhimlik bo'yicha",
    statsByMilestone: "Bosqichlar bo'yicha",
    statsBlocked: 'Bloklanganlar',
    statsRecentUpdated: "Oxirgi o'zgarganlar",
    statsRecentCreated: 'Oxirgi yaratilganlar',
    noneYet: "Hali yo'q.",
    fieldTitle: 'Nomi',
    fieldStatus: 'Status',
    fieldMilestone: 'Bosqich',
    fieldPriority: 'Muhimlik',
    fieldLabels: 'Yorliqlar',
    fieldAssignee: "Mas'ul",
    fieldDue: 'Muddat',
    fieldDeps: 'Kutadi',
    fieldDescription: 'Tavsif',
    fieldSubsteps: 'Sub-qadamlar',
    fieldSubstepsDesc: 'Har qatorda bitta.',
    addDep: "+ Qo'shish",
    commaHint: 'Vergul bilan.',
    created: 'yaratilgan',
    updated: "o'zgargan",
    due: 'muddat',
    folderMissing: (folder) => `"${folder}" papkasida Backlog.md topilmadi.`,
    openSettings: 'Sozlamalarni ochish',
    failed: "O'zgartirib bo'lmadi",
    titleRequired: 'Nomi kerak.',
    setFolder: 'Backlog papkasi',
    setFolderDesc: 'Vault ichidagi Backlog.md papkasi, odatda "backlog".',
    setLanguage: 'Til',
    setTab: "Ochilgandagi bo'lim",
    setActive: 'Ishlanayotgan statuslar',
    setActiveDesc: "Vergul bilan. Ularning qadamlari \"Hozir\" bo'limida ko'rinadi.",
    setBlocked: 'Bloklangan statuslar',
    setBlockedDesc: "Vergul bilan. Ularning qadamlari \"Kutayotganlar\" ro'yxatida ko'rinadi.",
    setCollapse: "Doskada oxirgi ustunni (Done) yig'ib qo'yish",
    setFold: "Yig'ilgan ustunlar",
    setFoldDesc: "Vergul bilan: doskada ochilmaguncha yig'ilib turadigan statuslar. Bo'sh bo'lsa, faqat oxirgi ustun.",
    setLocked: 'Qulflangan statuslar',
    setLockedDesc: "Vergul bilan. Gate'ni kutayotgan qadamlar: hech qachon \"tayyor\" bo'lmaydi.",
    setMe: 'Siz',
    setMeDesc: "Sizning ismingiz (assignee), masalan @bekzod. Ochiq ishlaringiz \"Sizni kutayotganlar\" ro'yxatida chiqadi.",
    setCardLabels: "Kartalarda yorliqlarni ko'rsatish",
    forYou: 'Sizni kutmoqda',
    setLogLines: "\"Hozir\" bo'limida ish logining nechta qatori ko'rinadi",
    setNames: "Ko'rinadigan nomlar",
    setNamesDesc: 'Har qatorda bittadan, "Asl = Ko\'rinadigan", status va muhimliklar uchun. Fayllarda asl nom qoladi.',
    setPlain: 'Sodda tushuntirishlar papkasi',
    setPlainDesc: 'Har bir ish uchun bitta fayl (task-12.md), har qadamga bir qator: "#1 sodda tilda nima degani". Qatori bor qadam oldida "?" chiqadi va shu qatorni beradi.',
    plainHelp: 'Sodda tilda',
    setNotes: 'Eslatmalar papkasi',
    setNotesDesc: '"+ Yangi eslatma" qadamga bog\'langan eslatmani shu yerda yaratadi.',
    setDecisions: "Qo'shimcha qarorlar papkalari",
    setDecisionsDesc: 'Vergul bilan, masalan docs/decisions. Qarorlar ro\'yxatida ko\'rinadi.',
    setAgentHeading: 'AI agent',
    setAgents: 'Agentlar',
    setAgentsDesc:
      'Har qatorda bittasi: Nom = buyruq. Slash buyruqlari yo\'q agent uchun oxiriga "| file" qo\'shing. {prompt} birinchi xabar qayerga qo\'yilishini bildiradi; bo\'lmasa, u oxiriga qo\'yiladi.',
    setAgent: 'Agent',
    setTarget: 'Matn qayerga boradi',
    targetPanel: 'Agent paneli',
    targetTerminal: 'Terminal (Termy)',
    targetClaudian: 'Claudian oynasi',
    targetCopy: 'Nusxa olish',
    agentViewTitle: 'Agent',
    openAgentPanel: 'Agent panelini ochish',
    agentNewChat: 'Yangi suhbat',
    agentStop: "To'xtatish",
    agentSend: 'Yuborish',
    agentAllow: 'Ruxsat berish',
    agentReject: 'Rad etish',
    agentPlaceholder: 'Agentga yozing…',
    agentHint: 'Enter — yuborish',
    agentEmpty: "Suhbat bo'sh. Doskadagi tugmani bosing yoki pastga yozing.",
    agentReady: 'tayyor',
    agentStarting: 'ochilmoqda…',
    agentWorking: 'ishlamoqda…',
    agentAsking: 'savol',
    agentStopped: "to'xtadi",
    agentPermLabel: 'Ruxsat kerak',
    agentDone: 'bajarildi',
    agentFailed: 'xato',
    agentYou: 'Siz',
    agentToolRead: "O'qish",
    agentToolEdit: 'Tahrirlash',
    agentToolExecute: 'Buyruq',
    agentToolSearch: 'Qidirish',
    agentToolOther: 'Amal',
    setAsk: 'Terminalga yuborishdan oldin so\'rash',
    setNotify: 'Agent tugatganda yoki ruxsat so\'raganda xabar berish (Obsidian oldinda bo\'lmasa)',
    notifyDone: 'Agent tugatdi',
    notifyAsks: 'Agent ruxsat so\'rayapti',
    notifyFailed: 'Agent xato bilan to\'xtadi',
    setCommands: 'Buyruqlar papkasi',
    setCommandsDesc: '"| file" belgili agentga <papka>/<buyruq>.md dagi ko\'rsatmaga amal qilish aytiladi.',
    setDayActions: 'Kun tugmalari ("Hozir")',
    setActiveActions: 'Ishlanayotgan vazifa tugmalari',
    setReadyActions: 'Boshlash mumkin bo\'lgan vazifa tugmalari',
    setActionsDesc: 'Har qatorda bittasi: Yozuv = buyruq [qo\'shimcha]. Buyruq — buyruqlar papkasidagi fayl; qo\'shimchada {id}, {step}, {title} va {path} bo\'lishi mumkin. Birinchisi asosiy tugma.',
    setPrompt: 'AI ga yuboriladigan matn',
    setPromptDesc: '"Agent bilan ishlash" uchun. {id}, {title}, {path}, {current} va {goal} o\'rniga qiymat qo\'yiladi.',
  },
};

// ---------------------------------------------------------------------------------------------
// Reading and editing Backlog.md files. Pure functions: no Obsidian objects, easy to test.
// ---------------------------------------------------------------------------------------------

const SECTION_HEADINGS = {
  description: 'DESCRIPTION',
  'acceptance criteria': 'AC',
  'definition of done': 'DOD',
  'implementation plan': 'PLAN',
  'implementation notes': 'NOTES',
  'final summary': 'FINAL_SUMMARY',
  comments: 'COMMENTS',
};

function toList(value) {
  if (Array.isArray(value)) return value;
  return value == null || value === '' ? [] : [value];
}

function splitList(text) {
  return String(text || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function same(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeYaml(text) {
  if (!text) return {};
  try {
    const value = parseYaml(text);
    return value && typeof value === 'object' ? value : {};
  } catch (error) {
    console.warn('[backlog-board] YAML could not be read', error);
    return {};
  }
}

function dateText(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function splitFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) return { yaml: '', body: content };
  return { yaml: match[1], body: content.slice(match[0].length) };
}

function eolOf(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

// Sections by their "## Heading", then the exact ones between Backlog.md's
// <!-- SECTION:NAME:BEGIN --> / <!-- AC:BEGIN --> markers, which win when present.
function readSections(body) {
  const sections = {};
  let key = null;
  let lines = [];
  const flush = () => {
    if (key) sections[key] = lines.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
  };
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      key = SECTION_HEADINGS[heading[1].toLowerCase()] || null;
      lines = [];
    } else if (key) {
      lines.push(line);
    }
  }
  flush();
  const marker = /<!--\s*(?:SECTION:)?([A-Z_]+):BEGIN\s*-->([\s\S]*?)<!--\s*(?:SECTION:)?\1:END\s*-->/g;
  let match;
  while ((match = marker.exec(body))) sections[match[1]] = match[2].trim();
  return sections;
}

// "- [x] #3 text" → { index: 3, checked: true, text: "text" }
function readChecklist(text) {
  const items = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^\s*[-*]\s+\[([ xX])\]\s+(?:#(\d+)\s+)?(.*)$/.exec(line);
    if (match) {
      items.push({
        index: match[2] ? Number(match[2]) : items.length + 1,
        checked: match[1] !== ' ',
        text: match[3].trim(),
      });
    }
  }
  return items;
}

function markerBlock(content, block) {
  const name = escapeRegExp(block);
  const pattern = new RegExp(`(<!--\\s*${name}:BEGIN\\s*-->)([\\s\\S]*?)(<!--\\s*${name}:END\\s*-->)`);
  const match = pattern.exec(content);
  if (!match) return null;
  return {
    begin: match[1],
    inner: match[2],
    end: match[3],
    start: match.index,
    stop: match.index + match[0].length,
  };
}

function replaceBlockInner(content, found, inner) {
  return content.slice(0, found.start) + found.begin + inner + found.end + content.slice(found.stop);
}

// Ticks or unticks item `index` of a checklist block (AC, DOD). Null when it is not there.
function toggleChecklistItem(content, block, index, checked) {
  const found = markerBlock(content, block);
  if (!found) return null;
  let position = 0;
  let changed = false;
  const inner = found.inner
    .split('\n')
    .map((line) => {
      const item = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(?:#(\d+)\s+)?/.exec(line);
      if (!item) return line;
      position += 1;
      const number = item[4] ? Number(item[4]) : position;
      if (number !== index) return line;
      changed = true;
      return item[1] + (checked ? 'x' : ' ') + line.slice(item[1].length + 1);
    })
    .join('\n');
  return changed ? replaceBlockInner(content, found, inner) : null;
}

// Where a missing checklist section goes: sub-steps after the description, DoD after the sub-steps.
const CHECKLIST_AFTER = { AC: ['SECTION:DESCRIPTION'], DOD: ['SECTION:DESCRIPTION', 'AC'] };

// Rewrites a checklist block from items, numbered #1, #2, … in order.
function writeChecklist(content, block, items, heading) {
  const eol = eolOf(content);
  const lines = items.map((item, i) => `- [${item.checked ? 'x' : ' '}] #${i + 1} ${item.text}`);
  const found = markerBlock(content, block);
  if (found) return replaceBlockInner(content, found, `${eol}${lines.join(eol)}${eol}`);
  if (!items.length) return content;
  const section = [`## ${heading}`, `<!-- ${block}:BEGIN -->`, ...lines, `<!-- ${block}:END -->`].join(eol);
  return insertSection(content, section, CHECKLIST_AFTER[block] || ['SECTION:DESCRIPTION']);
}

function addChecklistItem(content, block, heading, text) {
  const found = markerBlock(content, block);
  const items = found ? readChecklist(found.inner) : [];
  return writeChecklist(content, block, [...items, { checked: false, text }], heading);
}

function editChecklistItem(content, block, index, text) {
  const found = markerBlock(content, block);
  if (!found) return null;
  const items = readChecklist(found.inner);
  const item = items.find((candidate) => candidate.index === index);
  if (!item) return null;
  item.text = text;
  return writeChecklist(content, block, items, '');
}

function removeChecklistItem(content, block, index) {
  const found = markerBlock(content, block);
  if (!found) return null;
  const items = readChecklist(found.inner);
  const kept = items.filter((item) => item.index !== index);
  if (kept.length === items.length) return null;
  return writeChecklist(content, block, kept, '');
}

// Puts a whole "## Heading" section after the last of the given marker blocks that exists, or
// right after the frontmatter when none does.
function insertSection(content, section, after) {
  const eol = eolOf(content);
  let at = -1;
  for (const block of after) {
    const found = markerBlock(content, block);
    if (found && found.stop > at) at = found.stop;
  }
  if (at < 0) {
    const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
    at = fm ? fm[0].length : 0;
    return `${content.slice(0, at)}${eol}${section}${eol}${content.slice(at).replace(/^(\r?\n)+/, eol)}`;
  }
  return `${content.slice(0, at)}${eol}${eol}${section}${content.slice(at)}`;
}

// Sets the whole text of a marker section (DESCRIPTION, NOTES, …), creating it when missing.
function setSectionText(content, block, heading, text, after) {
  const eol = eolOf(content);
  const body = String(text).replace(/\r?\n/g, eol).trim();
  const found = markerBlock(content, block);
  if (found) return replaceBlockInner(content, found, body ? `${eol}${body}${eol}` : eol);
  if (!body) return content;
  const section = [`## ${heading}`, '', `<!-- ${block}:BEGIN -->`, body, `<!-- ${block}:END -->`].join(eol);
  return insertSection(content, section, after);
}

function appendSectionText(content, block, heading, text, after) {
  const found = markerBlock(content, block);
  const existing = found ? found.inner.trim() : '';
  const eol = eolOf(content);
  return setSectionText(content, block, heading, existing ? `${existing}${eol}${text}` : text, after);
}

// Frontmatter: one key and the indented lines that belong to it.
function frontmatterLines(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return null;
  return { match, eol: eolOf(content), lines: match[1].split(/\r?\n/) };
}

function keyRange(lines, key) {
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && /^(\s+\S|\s*-\s)/.test(lines[end])) end += 1;
  return { start, end };
}

function rewriteFrontmatter(content, edit) {
  const fm = frontmatterLines(content);
  if (!fm) return content;
  const lines = fm.lines.slice();
  edit(lines);
  const rest = content.slice(fm.match.index + fm.match[0].length);
  return `---${fm.eol}${lines.join(fm.eol)}${fm.eol}---${rest}`;
}

// Replaces (or adds) one `key: value` line of the frontmatter, leaving every other line as it was.
function setFrontmatterField(content, key, value) {
  return rewriteFrontmatter(content, (lines) => {
    const range = keyRange(lines, key);
    const line = `${key}: ${value}`;
    if (range) lines.splice(range.start, range.end - range.start, line);
    else lines.push(line);
  });
}

function setFrontmatterList(content, key, items) {
  return rewriteFrontmatter(content, (lines) => {
    const range = keyRange(lines, key);
    const block = items.length ? [`${key}:`, ...items.map((item) => `  - ${yamlScalar(item)}`)] : [`${key}: []`];
    if (range) lines.splice(range.start, range.end - range.start, ...block);
    else lines.push(...block);
  });
}

function deleteFrontmatterField(content, key) {
  return rewriteFrontmatter(content, (lines) => {
    const range = keyRange(lines, key);
    if (range) lines.splice(range.start, range.end - range.start);
  });
}

function yamlScalar(value) {
  const text = String(value);
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} _./-]*$/u.test(text) && !/\s$/.test(text);
  const special = /^(true|false|yes|no|on|off|null|~|-?\d+(\.\d+)?)$/i.test(text);
  return plain && !special ? text : `'${text.replace(/'/g, "''")}'`;
}

function timestamp(date = new Date()) {
  return `${date.toISOString().slice(0, 16)}:00Z`;
}

function touch(content) {
  return setFrontmatterField(content, 'updated_date', `'${timestamp()}'`);
}

// "Report: who owes whom (draft)" → "Report-who-owes-whom-draft", as Backlog.md names files.
function slugify(title) {
  const slug = String(title)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s.-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/[-.]+$/, '');
  return slug || 'task';
}

function safeFileName(text) {
  return (
    String(text)
      .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'note'
  );
}

function nextNumber(ids, prefix) {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`, 'i');
  let max = 0;
  for (const id of ids) {
    const match = pattern.exec(String(id));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function idFromBasename(basename) {
  return String(basename).split(' ')[0].trim().toUpperCase();
}

function buildTaskFile(task) {
  const lines = ['---', `id: ${task.id}`, `title: ${yamlScalar(task.title)}`, `status: ${yamlScalar(task.status)}`];
  const list = (key, items) => {
    if (items && items.length) lines.push(`${key}:`, ...items.map((item) => `  - ${yamlScalar(item)}`));
    else lines.push(`${key}: []`);
  };
  list('assignee', task.assignee);
  lines.push(`created_date: '${task.created}'`, `updated_date: '${task.created}'`);
  if (task.due) lines.push(`due_date: '${task.due}'`);
  list('labels', task.labels);
  if (task.milestone) lines.push(`milestone: ${yamlScalar(task.milestone)}`);
  list('dependencies', task.deps);
  if (task.refs && task.refs.length) list('references', task.refs);
  if (task.priority) lines.push(`priority: ${yamlScalar(task.priority)}`);
  if (task.ordinal != null) lines.push(`ordinal: ${task.ordinal}`);
  lines.push('---', '');
  if (task.description) {
    lines.push('## Description', '', '<!-- SECTION:DESCRIPTION:BEGIN -->', task.description.trim(), '<!-- SECTION:DESCRIPTION:END -->', '');
  }
  if (task.ac && task.ac.length) {
    lines.push('## Acceptance Criteria', '<!-- AC:BEGIN -->', ...task.ac.map((text, i) => `- [ ] #${i + 1} ${text}`), '<!-- AC:END -->', '');
  }
  if (task.dod && task.dod.length) {
    lines.push('## Definition of Done', '<!-- DOD:BEGIN -->', ...task.dod.map((text, i) => `- [ ] #${i + 1} ${text}`), '<!-- DOD:END -->', '');
  }
  return lines.join('\n');
}

// Ordinals for a column after a drop: `order` is the column top to bottom with the moved tasks in
// place. Moved tasks get a value between their neighbours; when no whole number fits, the column
// is numbered again from its smallest ordinal. Returns path → new ordinal for what must change.
function planOrdinals(order, moved) {
  const values = order.map((task) => task.ordinal);
  const result = new Map();
  let fits = true;
  for (let i = 0; i < order.length; i += 1) {
    if (!moved.has(order[i].path) && values[i] != null) continue;
    let low = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (values[j] != null) {
        low = values[j];
        break;
      }
    }
    let high = null;
    for (let j = i + 1; j < order.length; j += 1) {
      if (!moved.has(order[j].path) && values[j] != null) {
        high = values[j];
        break;
      }
    }
    let value;
    if (high == null) value = low + 10;
    else if (high - low >= 2) value = Math.floor((low + high) / 2);
    else {
      fits = false;
      break;
    }
    values[i] = value;
    if (value !== order[i].ordinal) result.set(order[i].path, value);
  }
  if (fits) return result;
  result.clear();
  const known = order
    .filter((task) => !moved.has(task.path))
    .map((task) => task.ordinal)
    .filter((value) => value != null);
  const start = known.length ? Math.min(...known) : 10;
  order.forEach((task, i) => {
    const value = start + i * 10;
    if (value !== task.ordinal) result.set(task.path, value);
  });
  return result;
}

function parseTask(content, file) {
  const { yaml, body } = splitFrontmatter(content);
  const fm = safeYaml(yaml);
  const sections = readSections(body);
  const id = String(fm.id || idFromBasename(file.basename)).trim().toUpperCase();
  const ordinal = Number(fm.ordinal);
  const number = Number((/(\d+)\D*$/.exec(id) || [])[1]);
  return {
    id,
    path: file.path,
    title: String(fm.title == null ? file.basename : fm.title).trim(),
    status: String(fm.status == null ? '' : fm.status).trim(),
    milestone: fm.milestone == null ? '' : String(fm.milestone).trim(),
    priority: fm.priority == null ? '' : String(fm.priority).trim(),
    labels: toList(fm.labels).map(String),
    assignee: toList(fm.assignee).map(String),
    due: dateText(fm.due_date).slice(0, 10),
    created: dateText(fm.created_date),
    updated: dateText(fm.updated_date),
    deps: toList(fm.dependencies)
      .map((dep) => String(dep).trim().toUpperCase())
      .filter(Boolean),
    refs: toList(fm.references).map(String),
    ordinal: fm.ordinal != null && Number.isFinite(ordinal) ? ordinal : null,
    number: Number.isFinite(number) ? number : 0,
    description: sections.DESCRIPTION || '',
    ac: readChecklist(sections.AC),
    dod: readChecklist(sections.DOD),
    plan: sections.PLAN || '',
    notes: sections.NOTES || '',
    summary: sections.FINAL_SUMMARY || '',
    comments: sections.COMMENTS || '',
  };
}

function parseMilestone(content, file) {
  const { yaml, body } = splitFrontmatter(content);
  const fm = safeYaml(yaml);
  const sections = readSections(body);
  return {
    id: String(fm.id || file.basename.split(' ')[0]).trim(),
    title: String(fm.title == null ? file.basename : fm.title).trim(),
    description: (sections.DESCRIPTION || '').trim(),
    path: file.path,
  };
}

// A document or a decision: its title from the frontmatter, else its first "# " heading.
function parseNote(content, file) {
  const { yaml, body } = splitFrontmatter(content);
  const fm = safeYaml(yaml);
  const heading = /^#\s+(.+?)\s*$/m.exec(body);
  return {
    path: file.path,
    name: file.basename,
    title: String(fm.title || (heading ? heading[1] : file.basename)).trim(),
    date: dateText(fm.date || fm.created_date).slice(0, 10),
    status: fm.status ? String(fm.status) : '',
  };
}

function byPlanOrder(a, b) {
  const ordinalA = a.ordinal == null ? Infinity : a.ordinal;
  const ordinalB = b.ordinal == null ? Infinity : b.ordinal;
  if (ordinalA !== ordinalB) return ordinalA < ordinalB ? -1 : 1;
  if (a.number !== b.number) return a.number - b.number;
  return naturalCompare(a.id, b.id);
}

// "2.5 Rules for categories" → "2.5"; a title without a leading number is shortened instead.
function shortLabel(task) {
  const first = /^(\S+)\s/.exec(task.title);
  if (first && /\d/.test(first[1])) return first[1];
  return task.title.length > 28 ? `${task.title.slice(0, 27).trim()}…` : task.title;
}

// The first line of a Markdown text as plain words, for one-line hints.
function plainFirstLine(markdown, max = 120) {
  const line = String(markdown || '')
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return '';
  const plain = line
    .replace(/^[#>\-*\s]+/, '')
    .replace(/[*_`]/g, '')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

// The first paragraph of a Markdown text.
function firstParagraph(markdown) {
  return String(markdown || '').trim().split(/\r?\n\s*\r?\n/)[0] || '';
}

function lastLines(text, count) {
  const lines = String(text || '').split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(-count).join('\n');
}

function parseNames(text) {
  const names = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0) {
      const from = line.slice(0, at).trim().toLowerCase();
      const to = line.slice(at + 1).trim();
      if (from && to) names.set(from, to);
    }
  }
  return names;
}

// The marks at the start of a sub-step that say who does it ("@bekzod = you", "@claude = agent"
// in the settings), taken off and given back as words. Upper and lower case count as the same.
function splitWho(text, marks) {
  const who = [];
  let rest = String(text || '').trim();
  for (let found = true; found && marks.size; ) {
    found = false;
    for (const [mark, word] of marks) {
      if (mark && rest.toLowerCase().startsWith(mark)) {
        who.push(word);
        rest = rest.slice(mark.length).trim();
        found = true;
      }
    }
  }
  return { who, text: rest };
}

function fillTemplate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => (key in values ? values[key] : whole));
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Splits a command line into words; double quotes keep spaces, as in "C:\Program Files\x.exe".
function splitWords(text) {
  const words = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(text || '')))) words.push(match[1] !== undefined ? match[1] : match[2]);
  return words;
}

// The agents of the settings, one per line: "Name = command [arguments] [| file]". "| file" marks
// an agent without slash commands: it is told to follow the command's file instead. {prompt}
// among the arguments marks where the first message goes; without it the message goes last.
function parseAgents(text) {
  const agents = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    let rest = line.slice(at + 1).trim();
    let style = 'slash';
    const bar = rest.lastIndexOf('|');
    if (bar >= 0 && /^\s*file\s*$/i.test(rest.slice(bar + 1))) {
      style = 'file';
      rest = rest.slice(0, bar).trim();
    }
    const [command, ...args] = splitWords(rest);
    if (name && command) agents.push({ name, command, args, style });
  }
  return agents;
}

// What the agent is given for one of the project's commands (a file in the commands folder).
function commandText(agent, name, args, folder) {
  const extra = String(args || '').trim();
  if (agent.style === 'file') {
    const file = `${normalizePath(String(folder || '.claude/commands'))}/${name}.md`;
    return `Follow the instructions in ${file}${extra ? `, for: ${extra}` : ''}.`;
  }
  return `/${name}${extra ? ` ${extra}` : ''}`;
}

// The arguments that start an agent with a first message.
function agentArgs(agent, prompt) {
  if (agent.args.includes('{prompt}')) return agent.args.map((arg) => (arg === '{prompt}' ? prompt : arg));
  return prompt ? [...agent.args, prompt] : agent.args.slice();
}

// What is typed into a terminal where the agent already runs: one line as it is, several lines
// as a bracketed paste, so that only the Enter typed after it sends them.
function typedText(text) {
  const value = String(text);
  return /\r|\n/.test(value) ? `\x1b[200~${value.replace(/\r?\n/g, '\r')}\x1b[201~` : value;
}

// The buttons of the settings, one per line: "Label = command [arguments]". The command names a
// file in the commands folder; the arguments may use {id}, {step}, {title} and {path}.
function parseActions(text) {
  const actions = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const label = line.slice(0, at).trim();
    const [name, ...rest] = line.slice(at + 1).trim().split(/\s+/);
    if (label && name) actions.push({ label, name, args: rest.join(' ') });
  }
  return actions;
}

// A task's step number ("2.6", "H.1") when its title starts with one, else its id.
function stepOf(task) {
  const first = /^(\S+)\s/.exec(task.title);
  return first && /\d/.test(first[1]) ? first[1].replace(/[:.,]$/, '') : task.id;
}

// What one of the buttons sends, for a task or for the day (no task).
function actionText(agent, action, task, folder) {
  const values = task ? { id: task.id, step: stepOf(task), title: task.title, path: task.path } : { id: '', step: '', title: '', path: '' };
  return commandText(agent, action.name, fillTemplate(action.args, values), folder);
}

// The board lists and reads its files on the disk, through the vault's adapter, not through
// Obsidian's file index. The index can miss files written outside Obsidian (a git checkout, a
// script, an agent in a terminal), and the board then showed too few tasks.
function fileAt(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return {
    path,
    name,
    basename: dot > 0 ? name.slice(0, dot) : name,
    extension: dot > 0 ? name.slice(dot + 1) : '',
  };
}

// Every Markdown file under a folder of the vault, subfolders included, in path order.
async function listMarkdown(adapter, dir) {
  const found = [];
  const walk = async (path) => {
    if (!path || !(await adapter.exists(path))) return;
    const listed = await adapter.list(path);
    for (const file of listed.files) if (/\.md$/i.test(file)) found.push(fileAt(normalizePath(file)));
    for (const folder of listed.folders) await walk(normalizePath(folder));
  };
  await walk(normalizePath(dir));
  return found.sort((a, b) => naturalCompare(a.path, b.path));
}

// A fingerprint of the Markdown files under some folders: each one's path, size and time of
// change. When it differs from the last one, something changed on the disk.
async function diskFingerprint(adapter, dirs) {
  const lines = [];
  for (const dir of dirs) {
    for (const file of await listMarkdown(adapter, dir)) {
      const stat = await adapter.stat(file.path);
      lines.push(`${file.path}|${stat ? stat.size : ''}|${stat ? stat.mtime : ''}`);
    }
  }
  return lines.join('\n');
}

async function loadBacklog(app, settings) {
  const folder = normalizePath(String(settings.backlogFolder || '').trim() || 'backlog');
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(folder))) return { missing: true, folder };

  let config = {};
  const configPath = `${folder}/config.yml`;
  if (await adapter.exists(configPath)) config = safeYaml(await adapter.read(configPath));

  const statuses = toList(config.statuses).map(String).filter(Boolean);
  if (!statuses.length) statuses.push('To Do', 'In Progress', 'Done');
  const finalStatus = statuses[statuses.length - 1];
  const initialStatus = config.default_status ? String(config.default_status) : statuses[0];
  const priorities = toList(config.priorities).map(String).filter(Boolean);
  if (!priorities.length) priorities.push('High', 'Medium', 'Low');
  const activeStatuses = splitList(settings.activeStatuses);
  const blockedStatuses = splitList(settings.blockedStatuses);

  const under = (dir) => listMarkdown(adapter, dir);
  const read = (file) => adapter.read(file.path);

  const tasks = [];
  for (const [sub, completed] of [
    ['tasks', false],
    ['completed', true],
  ]) {
    for (const file of await under(`${folder}/${sub}`)) {
      try {
        const task = parseTask(await read(file), file);
        if (completed) task.status = finalStatus;
        tasks.push(task);
      } catch (error) {
        console.warn('[backlog-board] task skipped', file.path, error);
      }
    }
  }
  tasks.sort(byPlanOrder);

  const milestones = [];
  for (const file of await under(`${folder}/milestones`)) {
    try {
      milestones.push(parseMilestone(await read(file), file));
    } catch (error) {
      console.warn('[backlog-board] milestone skipped', file.path, error);
    }
  }
  milestones.sort((a, b) => naturalCompare(a.id, b.id));
  const milestoneByKey = new Map();
  for (const milestone of milestones) {
    milestoneByKey.set(milestone.id.toLowerCase(), milestone);
    milestoneByKey.set(milestone.title.toLowerCase(), milestone);
  }
  // Milestones follow the plan: each one sits where its first task does.
  const firstOrdinal = new Map();
  for (const task of tasks) {
    const milestone = task.milestone ? milestoneByKey.get(task.milestone.toLowerCase()) : null;
    if (milestone && task.ordinal != null && !(firstOrdinal.get(milestone) <= task.ordinal)) firstOrdinal.set(milestone, task.ordinal);
  }
  milestones.sort((a, b) => {
    const x = firstOrdinal.has(a) ? firstOrdinal.get(a) : Infinity;
    const y = firstOrdinal.has(b) ? firstOrdinal.get(b) : Infinity;
    return x !== y ? (x < y ? -1 : 1) : naturalCompare(a.id, b.id);
  });

  const drafts = [];
  for (const file of await under(`${folder}/drafts`)) {
    try {
      drafts.push(parseTask(await read(file), file));
    } catch (error) {
      console.warn('[backlog-board] draft skipped', file.path, error);
    }
  }
  drafts.sort((a, b) => naturalCompare(a.id, b.id));

  const docs = [];
  for (const file of await under(`${folder}/docs`)) docs.push(parseNote(await read(file), file));
  docs.sort((a, b) => naturalCompare(a.name, b.name));

  const decisionDirs = [`${folder}/decisions`, ...splitList(settings.decisionFolders).map((dir) => normalizePath(dir))];
  const decisions = [];
  const seen = new Set();
  for (const dir of decisionDirs) {
    for (const file of await under(dir)) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      decisions.push(parseNote(await read(file), file));
    }
  }
  decisions.sort((a, b) => naturalCompare(b.name, a.name));

  const prefix = String(config.task_prefix || 'task');
  const archived = (await under(`${folder}/archive/tasks`)).map((file) => idFromBasename(file.basename));
  const nextTaskNumber = nextNumber([...tasks.map((task) => task.id), ...archived], prefix);
  const archivedDrafts = (await under(`${folder}/archive/drafts`)).map((file) => idFromBasename(file.basename));
  const nextDraftNumber = nextNumber([...drafts.map((draft) => draft.id), ...archivedDrafts], 'draft');
  const ordinals = tasks.map((task) => task.ordinal).filter((value) => value != null);

  const columns = statuses.slice();
  for (const task of tasks) {
    if (!columns.some((status) => same(status, task.status))) columns.push(task.status);
  }

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const byPath = new Map(tasks.map((task) => [task.path, task]));
  const lockedStatuses = splitList(settings.lockedStatuses);
  const me = String(settings.me || '')
    .trim()
    .replace(/^@/, '');

  const model = {
    folder,
    projectName: config.project_name ? String(config.project_name) : '',
    prefix,
    statuses: columns,
    finalStatus,
    initialStatus,
    activeStatus: activeStatuses[0] || statuses[Math.min(1, statuses.length - 1)],
    priorities,
    dodDefaults: toList(config.definition_of_done).map(String),
    tasks,
    milestones,
    drafts,
    docs,
    decisions,
    byId,
    byPath,
    nextTaskNumber,
    nextDraftNumber,
    maxOrdinal: ordinals.length ? Math.max(...ordinals) : 0,
    isFinal: (task) => same(task.status, finalStatus),
    isActive: (task) => activeStatuses.some((status) => same(status, task.status)),
    isBlocked: (task) => blockedStatuses.some((status) => same(status, task.status)),
    isLocked: (task) => lockedStatuses.some((status) => same(status, task.status)),
    isMine: (task) => Boolean(me) && task.assignee.some((name) => same(String(name).replace(/^@/, ''), me)),
    hasBlockedStatuses: blockedStatuses.length > 0,
    milestoneOf: (task) => (task.milestone ? milestoneByKey.get(task.milestone.toLowerCase()) || null : null),
    unmetDeps: (task) =>
      task.deps.filter((id) => {
        const dep = byId.get(id);
        return !dep || !same(dep.status, finalStatus);
      }),
    dependentsOf: (task) => tasks.filter((other) => other.deps.includes(task.id)),
    isReady: (task) => same(task.status, initialStatus) && model.unmetDeps(task).length === 0,
    labelOf: (id) => (byId.has(id) ? shortLabel(byId.get(id)) : id),
    // "2.5, 2.6, H.2 +4": what a task waits for, kept to one short line.
    waitsList: (task, most = 3) => {
      const unmet = model.unmetDeps(task);
      const shown = unmet.slice(0, most).map((id) => model.labelOf(id));
      return unmet.length > most ? `${shown.join(', ')} +${unmet.length - most}` : shown.join(', ');
    },
    stateClass: (task) => {
      if (model.isFinal(task)) return 'is-final';
      if (model.isActive(task)) return 'is-active';
      if (model.isLocked(task)) return 'is-locked';
      if (model.isBlocked(task)) return 'is-blocked';
      if (model.unmetDeps(task).length) return 'is-waiting';
      return 'is-todo';
    },
  };
  return model;
}

// ---------------------------------------------------------------------------------------------
// ACP, the Agent Client Protocol (https://agentclientprotocol.com): the small part of version 1
// that the board needs. The agent runs as a child process; JSON-RPC 2.0 messages go one per line
// over its stdin and stdout. The board offers the agent no files and no terminal of its own, so
// the agent uses its own tools, and asks the board only for permission.
// ---------------------------------------------------------------------------------------------

const ACP_VERSION = 1;
const ACP_START_MS = 180000; // the first start may download the agent's adapter through npx

// A word for the Windows shell: quoted when it holds a space or a sign the shell would read.
function shellWord(word) {
  const text = String(word);
  return /^[\w@%+=:,./\\-]+$/.test(text) ? text : `"${text.replace(/"/g, '""')}"`;
}

class AcpClient {
  // options: spawn (child_process.spawn), command, args, cwd, env, platform; and the handlers
  // onUpdate(params of session/update), onPermission(params) → outcome, onExit(code, lastErrors).
  constructor(options) {
    this.options = options;
    this.child = null;
    this.nextId = 0;
    this.pending = new Map();
    this.buffer = '';
    this.sessionId = null;
    this.agentInfo = null;
    this.exited = false;
    this.errors = [];
  }

  start() {
    const { spawn, command, args = [], cwd, env } = this.options;
    const platform = this.options.platform || process.platform;
    // npx and gemini are .cmd files on Windows, and Node starts those only through the shell.
    this.child =
      platform === 'win32'
        ? spawn([command, ...args].map(shellWord).join(' '), [], { cwd, env, shell: true, windowsHide: true })
        : spawn(command, args, { cwd, env });
    this.child.stdout.on('data', (chunk) => this.read(String(chunk)));
    this.child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) this.errors.push(line.trim());
      this.errors = this.errors.slice(-20);
    });
    this.child.stdin.on('error', () => {});
    this.child.on('error', (error) => this.end(error, null));
    this.child.on('exit', (code) => this.end(new Error(`The agent stopped (${code})`), code));
  }

  read(chunk) {
    this.buffer += chunk;
    for (let at = this.buffer.indexOf('\n'); at >= 0; at = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        this.errors.push(line); // not a message: something the agent printed
        continue;
      }
      this.receive(message);
    }
  }

  receive(message) {
    if (message.method === undefined && message.id !== undefined) {
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(Object.assign(new Error(message.error.message || 'ACP error'), { code: message.error.code, data: message.error.data }));
      else waiting.resolve(message.result);
    } else if (message.method !== undefined && message.id !== undefined) {
      this.answer(message);
    } else if (message.method === 'session/update' && this.options.onUpdate) {
      this.options.onUpdate(message.params);
    }
  }

  // A request from the agent. The board answers only permission; it offers nothing else.
  async answer(message) {
    const reply = (body) => this.write(Object.assign({ jsonrpc: '2.0', id: message.id }, body));
    try {
      if (message.method === 'session/request_permission') {
        const outcome = this.options.onPermission ? await this.options.onPermission(message.params) : { outcome: 'cancelled' };
        reply({ result: { outcome } });
      } else {
        reply({ error: { code: -32601, message: `Method not found: ${message.method}` } });
      }
    } catch (error) {
      reply({ error: { code: -32603, message: String((error && error.message) || error) } });
    }
  }

  write(message) {
    if (this.child && !this.exited) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      if (this.exited || !this.child) {
        reject(new Error('The agent is not running'));
        return;
      }
      let timer = null;
      const settle = (fn) => (value) => {
        if (timer) clearTimeout(timer);
        fn(value);
      };
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      if (timeoutMs) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`The agent did not answer ${method}`));
        }, timeoutMs);
      }
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  end(error, code) {
    if (this.exited) return;
    this.exited = true;
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
    if (this.options.onExit) this.options.onExit(code, this.errors.slice(-5).join('\n'));
  }

  // Starts the agent and opens a conversation in a folder. When the agent wants a sign-in first,
  // the error carries its ways to sign in (authMethods) for the panel to show.
  async open(cwd) {
    this.start();
    const init = await this.request(
      'initialize',
      {
        protocolVersion: ACP_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'backlog-board', version: '0.3.0' },
      },
      ACP_START_MS,
    );
    this.agentInfo = init || {};
    try {
      const session = await this.request('session/new', { cwd, mcpServers: [] }, ACP_START_MS);
      this.sessionId = session.sessionId;
      this.modes = session.modes || null;
    } catch (error) {
      error.authMethods = this.agentInfo.authMethods || [];
      throw error;
    }
    return this.agentInfo;
  }

  prompt(text) {
    return this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] });
  }

  cancel() {
    if (this.sessionId) this.notify('session/cancel', { sessionId: this.sessionId });
  }

  // Ends the agent, and on Windows the whole tree the shell started.
  stop() {
    if (!this.child || this.exited) return;
    const platform = this.options.platform || process.platform;
    if (platform === 'win32' && this.child.pid) this.options.spawn('taskkill', ['/pid', String(this.child.pid), '/t', '/f'], { windowsHide: true });
    else this.child.kill();
  }
}

// ---------------------------------------------------------------------------------------------
// Small pieces of interface
// ---------------------------------------------------------------------------------------------

function renderMarkdown(app, markdown, el, sourcePath, component) {
  el.addClass('bb-md');
  if (typeof MarkdownRenderer.render === 'function') {
    return MarkdownRenderer.render(app, markdown, el, sourcePath, component);
  }
  return MarkdownRenderer.renderMarkdown(markdown, el, sourcePath, component);
}

function meter(parent, done, total) {
  const bar = parent.createDiv({ cls: 'bb-meter' });
  const fill = bar.createSpan();
  fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  return bar;
}

function countChecked(items) {
  return items.filter((item) => item.checked).length;
}

function button(parent, text, onClick, cls) {
  const el = parent.createEl('button', { text, cls });
  el.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick(event);
  });
  return el;
}

class ConfirmModal extends Modal {
  constructor(app, message, confirmText, cancelText, onConfirm) {
    super(app);
    this.message = message;
    this.confirmText = confirmText;
    this.cancelText = cancelText;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.contentEl.createDiv({ cls: 'bb-confirm', text: this.message });
    const row = this.contentEl.createDiv({ cls: 'bb-modal-buttons' });
    button(row, this.cancelText, () => this.close());
    button(
      row,
      this.confirmText,
      async () => {
        this.close();
        await this.onConfirm();
      },
      'mod-warning',
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Asks before text goes to the agent: the exact text, then Cancel or Send.
class SendModal extends Modal {
  constructor(app, plugin, agentName, text, onAnswer) {
    super(app);
    this.plugin = plugin;
    this.agentName = agentName;
    this.text = text;
    this.onAnswer = onAnswer;
    this.answered = false;
  }

  onOpen() {
    this.titleEl.setText(this.plugin.t('sendAsk', this.agentName));
    this.contentEl.createEl('pre', { cls: 'bb-send-text', text: this.text });
    const row = this.contentEl.createDiv({ cls: 'bb-modal-buttons' });
    button(row, this.plugin.t('cancel'), () => this.close());
    button(
      row,
      this.plugin.t('send'),
      () => {
        this.answer(true);
        this.close();
      },
      'mod-cta',
    );
  }

  answer(value) {
    if (this.answered) return;
    this.answered = true;
    this.onAnswer(value);
  }

  onClose() {
    this.answer(false);
    this.contentEl.empty();
  }
}

class TextModal extends Modal {
  constructor(app, title, value, placeholder, submitText, onSubmit) {
    super(app);
    this.heading = title;
    this.value = value;
    this.placeholder = placeholder;
    this.submitText = submitText;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    this.titleEl.setText(this.heading);
    const input = this.contentEl.createEl('input', { type: 'text', cls: 'bb-input bb-wide' });
    input.value = this.value || '';
    input.placeholder = this.placeholder || '';
    const submit = async () => {
      const value = input.value.trim();
      if (!value) return;
      this.close();
      await this.onSubmit(value);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    const row = this.contentEl.createDiv({ cls: 'bb-modal-buttons' });
    button(row, this.submitText, submit, 'mod-cta');
    window.setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class TaskSuggestModal extends FuzzySuggestModal {
  constructor(app, tasks, onChoose) {
    super(app);
    this.tasks = tasks;
    this.onChoose = onChoose;
  }

  getItems() {
    return this.tasks;
  }

  getItemText(task) {
    return `${task.title}  ·  ${task.id}`;
  }

  onChooseItem(task) {
    this.onChoose(task);
  }
}

class FileSuggestModal extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
  }

  getItems() {
    return this.app.vault.getFiles();
  }

  getItemText(file) {
    return file.path;
  }

  onChooseItem(file) {
    this.onChoose(file);
  }
}

// Create or edit a task. `task` is null when creating.
class TaskModal extends Modal {
  constructor(plugin, data, task, onSubmit) {
    super(plugin.app);
    this.plugin = plugin;
    this.data = data;
    this.task = task;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    const plugin = this.plugin;
    const t = (key, ...args) => plugin.t(key, ...args);
    const data = this.data;
    const task = this.task;
    contentEl.addClass('bb-modal');
    this.titleEl.setText(task ? `${t('edit')}: ${task.title}` : t('newTask'));

    const state = {
      title: task ? task.title : '',
      status: task ? task.status : data.initialStatus,
      milestone: task ? task.milestone : '',
      priority: task ? task.priority.toLowerCase() : '',
      labels: task ? task.labels.join(', ') : '',
      assignee: task ? task.assignee.join(', ') : '',
      due: task ? task.due : '',
      deps: task ? task.deps.slice() : [],
      description: task ? task.description : '',
      substeps: '',
    };

    new Setting(contentEl).setName(t('fieldTitle')).addText((text) => {
      text.setValue(state.title).onChange((value) => (state.title = value));
      text.inputEl.addClass('bb-wide');
      window.setTimeout(() => text.inputEl.focus(), 0);
    });

    new Setting(contentEl).setName(t('fieldStatus')).addDropdown((dropdown) => {
      for (const status of data.statuses) dropdown.addOption(status, plugin.displayName(status));
      const current = data.statuses.find((status) => same(status, state.status)) || data.initialStatus;
      dropdown.setValue(current).onChange((value) => (state.status = value));
      state.status = current;
    });

    new Setting(contentEl).setName(t('fieldMilestone')).addDropdown((dropdown) => {
      dropdown.addOption('', t('none'));
      for (const milestone of data.milestones) dropdown.addOption(milestone.id, milestone.title);
      const current = task ? data.milestoneOf(task) : null;
      dropdown.setValue(current ? current.id : '').onChange((value) => (state.milestone = value));
      state.milestone = current ? current.id : '';
    });

    new Setting(contentEl).setName(t('fieldPriority')).addDropdown((dropdown) => {
      dropdown.addOption('', t('none'));
      for (const priority of data.priorities) dropdown.addOption(priority.toLowerCase(), plugin.displayName(priority));
      dropdown.setValue(state.priority).onChange((value) => (state.priority = value));
    });

    new Setting(contentEl)
      .setName(t('fieldLabels'))
      .setDesc(t('commaHint'))
      .addText((text) => text.setValue(state.labels).onChange((value) => (state.labels = value)));

    new Setting(contentEl)
      .setName(t('fieldAssignee'))
      .setDesc(t('commaHint'))
      .addText((text) => text.setValue(state.assignee).onChange((value) => (state.assignee = value)));

    new Setting(contentEl).setName(t('fieldDue')).addText((text) => {
      text.inputEl.type = 'date';
      text.setValue(state.due).onChange((value) => (state.due = value));
    });

    const deps = new Setting(contentEl).setName(t('fieldDeps'));
    const chips = deps.controlEl.createDiv({ cls: 'bb-chips' });
    const drawDeps = () => {
      chips.empty();
      for (const id of state.deps) {
        const dep = data.byId.get(id);
        const chip = chips.createSpan({ cls: 'bb-chip' });
        chip.createSpan({ cls: 'bb-chip-text', text: dep ? dep.title : id });
        const x = chip.createSpan({ cls: 'bb-chip-x', text: '×' });
        x.addEventListener('click', () => {
          state.deps = state.deps.filter((other) => other !== id);
          drawDeps();
        });
      }
    };
    drawDeps();
    deps.addButton((b) =>
      b.setButtonText(t('addDep')).onClick(() => {
        const candidates = data.tasks.filter((other) => (!task || other.id !== task.id) && !state.deps.includes(other.id));
        new TaskSuggestModal(this.app, candidates, (chosen) => {
          state.deps.push(chosen.id);
          drawDeps();
        }).open();
      }),
    );

    new Setting(contentEl)
      .setName(t('fieldDescription'))
      .setClass('bb-stack')
      .addTextArea((area) => {
        area.setValue(state.description).onChange((value) => (state.description = value));
        area.inputEl.rows = 6;
      });

    if (!task) {
      new Setting(contentEl)
        .setName(t('fieldSubsteps'))
        .setDesc(t('fieldSubstepsDesc'))
        .setClass('bb-stack')
        .addTextArea((area) => {
          area.onChange((value) => (state.substeps = value));
          area.inputEl.rows = 5;
        });
    }

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(t('cancel')).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(task ? t('save') : t('create'))
          .setCta()
          .onClick(async () => {
            if (!state.title.trim()) {
              new Notice(t('titleRequired'));
              return;
            }
            this.close();
            await this.onSubmit({
              title: state.title.trim(),
              status: state.status,
              milestone: state.milestone,
              priority: state.priority,
              labels: splitList(state.labels),
              assignee: splitList(state.assignee),
              due: state.due,
              deps: state.deps,
              description: state.description.trim(),
              substeps: state.substeps
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean),
            });
          }),
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

const TABS = ['now', 'plan', 'board', 'list', 'docs', 'stats'];
const TAB_KEYS = { now: 'tabNow', board: 'tabBoard', plan: 'tabPlan', list: 'tabList', docs: 'tabDocs', stats: 'tabStats' };

class BoardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.tab = TABS.includes(plugin.settings.defaultTab) ? plugin.settings.defaultTab : 'now';
    this.selected = null;
    this.picked = new Set();
    this.unfolded = new Set(); // folded columns the user opened
    this.filters = { query: '', status: '', milestone: '', priority: '', label: '' };
    this.drafts = {}; // text typed into the board's inputs, kept across re-renders
    this.data = null;
    this.loads = 0;
    this.scroll = { tab: null, places: {} }; // where each tab and each open task was scrolled to
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return this.plugin.t('viewTitle');
  }

  getIcon() {
    return ICON;
  }

  getState() {
    return { tab: this.tab, selected: this.selected };
  }

  async setState(state, result) {
    if (state && TABS.includes(state.tab)) this.tab = state.tab;
    if (state && state.selected) this.selected = state.selected;
    await super.setState(state, result);
    this.render();
  }

  async onOpen() {
    this.contentEl.addClass('bb-root');
    this.registerDomEvent(this.contentEl, 'keydown', (event) => {
      if (event.key === 'Escape' && this.selected && !(event.target instanceof HTMLInputElement)) this.select(null);
    });
    await this.refresh();
  }

  async onClose() {
    this.contentEl.empty();
  }

  t(key, ...args) {
    return this.plugin.t(key, ...args);
  }

  name(value) {
    return this.plugin.displayName(value);
  }

  async refresh() {
    const load = ++this.loads;
    const data = await loadBacklog(this.app, this.plugin.settings);
    if (load !== this.loads) return;
    this.data = data;
    this.render();
  }

  select(task) {
    this.selected = task ? task.path : null;
    this.render();
  }

  rememberScroll() {
    if (this.mainEl && this.scroll.tab) this.scroll.places[this.scroll.tab] = [this.mainEl.scrollTop, this.mainEl.scrollLeft];
  }

  render() {
    const root = this.contentEl;
    if (!root) return;
    const focused = document.activeElement;
    const keepFocus = focused instanceof HTMLInputElement && root.contains(focused) ? focused.dataset.focusKey : null;
    this.rememberScroll();
    root.empty();
    const data = this.data;
    if (!data) return;
    if (data.missing) {
      this.renderMissing(root, data.folder);
      return;
    }

    const selected = this.selected ? data.byPath.get(this.selected) : null;
    const header = root.createDiv({ cls: 'bb-header' });
    const tabs = header.createDiv({ cls: 'bb-tabs' });
    for (const key of TABS) {
      const tab = tabs.createEl('button', { cls: 'bb-tab', text: this.t(TAB_KEYS[key]) });
      if (this.tab === key) tab.addClass('is-active');
      tab.addEventListener('click', () => {
        this.tab = key;
        this.selected = null;
        this.render();
      });
    }
    const meta = header.createDiv({ cls: 'bb-meta' });
    if (this.tab === 'now' && !selected) {
      for (const action of parseActions(this.plugin.settings.dayActions)) {
        button(meta, action.label, () => this.plugin.runDayAction(action), 'bb-text-btn');
      }
    }
    button(meta, `+ ${this.t('newTask')}`, () => this.plugin.openTaskModal(data, null), 'bb-text-btn');

    const body = root.createDiv({ cls: 'bb-body' });
    const main = body.createDiv({ cls: 'bb-main' });
    // An open task is a page of its own, in place of the tab; "Back" returns to the tab.
    if (selected) this.renderTaskPage(main, selected);
    else if (this.tab === 'board') this.renderBoard(main);
    else if (this.tab === 'plan') this.renderPlan(main);
    else if (this.tab === 'list') this.renderList(main);
    else if (this.tab === 'docs') this.renderDocs(main);
    else if (this.tab === 'stats') this.renderStats(main);
    else this.renderNow(main);

    const place = selected ? `task:${selected.path}` : this.tab;
    const saved = this.scroll.places[place];
    if (saved) {
      main.scrollTop = saved[0];
      main.scrollLeft = saved[1];
    }
    this.scroll.tab = place;
    this.mainEl = main;
    if (keepFocus) {
      const again = root.querySelector(`input[data-focus-key="${keepFocus}"]`);
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    }
  }

  renderMissing(root, folder) {
    const box = root.createDiv({ cls: 'bb-missing' });
    box.createDiv({ text: this.t('folderMissing', folder) });
    button(
      box,
      this.t('openSettings'),
      () => {
        const setting = this.app.setting;
        if (setting) {
          setting.open();
          setting.openTabById(this.plugin.manifest.id);
        }
      },
      'mod-cta',
    );
  }

  // --- Now: the step being worked on, from the inside -------------------------------------

  // A task only you are assigned to is yours to do, not one to start from the board.
  onlyMine(task) {
    return this.data.isMine(task) && task.assignee.length === 1;
  }

  toggleUnfold(key) {
    if (this.unfolded.has(key)) this.unfolded.delete(key);
    else this.unfolded.add(key);
    this.render();
  }

  // How many open tasks wait for this one, or what it waits for itself.
  holdsText(task) {
    const data = this.data;
    const held = data.dependentsOf(task).filter((other) => !data.isFinal(other)).length;
    if (held) return this.t('holdsSteps', held);
    const waits = data.waitsList(task);
    return waits ? `${this.t('waitsShort')} ${waits}` : '';
  }

  // The buttons of the settings for this task: the task in progress has its own, a task ready to
  // start has its own. The first one is the primary button. Returns how many there are.
  renderTaskActions(parent, task) {
    const data = this.data;
    const settings = this.plugin.settings;
    let actions = [];
    if (data.isActive(task)) actions = parseActions(settings.activeActions);
    else if (data.isReady(task)) actions = parseActions(settings.readyActions);
    actions.forEach((action, i) => button(parent, action.label, () => this.plugin.runAction(action, task), i === 0 ? 'mod-cta' : ''));
    return actions.length;
  }

  // Now: the task in progress from the inside, and little else. With nothing in progress: what
  // can start, and what waits for you.
  renderNow(main) {
    const data = this.data;
    const active = data.tasks.filter((task) => data.isActive(task));
    const mine = data.tasks
      .filter((task) => data.isMine(task) && !data.isFinal(task) && !data.isLocked(task) && !data.isActive(task))
      .sort((a, b) => (data.unmetDeps(a).length ? 1 : 0) - (data.unmetDeps(b).length ? 1 : 0));
    const now = main.createDiv({ cls: 'bb-now' });
    if (active.length) {
      for (const task of active) this.renderFocus(now, task);
      if (mine.length) {
        const foot = now.createDiv({ cls: 'bb-now-foot' });
        const open = this.unfolded.has('now:mine');
        button(foot, open ? this.t('showLess') : this.t('waitingForYou', mine.length), () => this.toggleUnfold('now:mine'), 'bb-text-btn');
        if (open) for (const task of mine) this.renderPlainRow(foot, task, this.holdsText(task));
      }
      return;
    }

    now.createDiv({ cls: 'bb-now-title', text: this.t('nothingActive') });
    now.createDiv({ cls: 'bb-now-count', text: this.t('openOne') });
    const ready = data.tasks.filter((task) => data.isReady(task) && !this.onlyMine(task));
    const readyActions = parseActions(this.plugin.settings.readyActions);
    this.renderNowList(now, this.t('readyNext'), ready, 'ready', 5, (row, task) => {
      const label = readyActions.length ? readyActions[0].label : this.t('start');
      const start = readyActions.length
        ? () => this.plugin.runAction(readyActions[0], task)
        : () => this.plugin.moveTasks(data, [task.path], data.activeStatus, null);
      button(row, label, start, 'bb-text-btn bb-accent-text');
    });
    this.renderNowList(now, this.t('forYou'), mine, 'mine', 4, (row, task) => row.createSpan({ cls: 'bb-plain-side', text: this.holdsText(task) }));
    const blocked = data.tasks.filter((task) => data.isBlocked(task));
    this.renderNowList(now, this.t('waiting'), blocked, 'blocked', 4, (row, task) => row.createSpan({ cls: 'bb-plain-side', text: this.holdsText(task) }));
  }

  renderNowList(parent, title, tasks, key, shown, decorate) {
    if (!tasks.length) return;
    parent.createDiv({ cls: 'bb-now-heading', text: title });
    const open = this.unfolded.has(`now:${key}`);
    for (const task of open ? tasks : tasks.slice(0, shown)) decorate(this.renderPlainRow(parent, task, ''), task);
    if (tasks.length > shown) {
      button(parent, open ? this.t('showLess') : this.t('moreSteps', tasks.length - shown), () => this.toggleUnfold(`now:${key}`), 'bb-text-btn bb-now-more');
    }
  }

  // A plain row: the title (opens the task) and, if given, a grey word on the right.
  renderPlainRow(parent, task, side) {
    const row = parent.createDiv({ cls: 'bb-plain-row' });
    if (this.selected === task.path) row.addClass('is-selected');
    const title = row.createDiv({ cls: 'bb-plain-title', text: task.title });
    title.addEventListener('click', () => this.select(task));
    if (side) row.createSpan({ cls: 'bb-plain-side', text: side });
    return row;
  }

  // The task in progress, said plainly: which task, which sub-step and who does it, the one main
  // button (and "tick" for doing it by hand), and what comes after. The rest is on its page.
  renderFocus(parent, task) {
    const marks = parseNames(this.plugin.settings.whoMarks);
    const box = parent.createDiv({ cls: 'bb-now-task' });
    box.createDiv({ cls: 'bb-now-label', text: this.t('currentTask') });
    const title = box.createDiv({ cls: 'bb-now-title', text: task.title });
    title.addEventListener('click', () => this.select(task));

    const open = task.ac.filter((item) => !item.checked);
    const current = open[0] || null;
    const step = box.createDiv({ cls: 'bb-now-step' });
    if (current) {
      const { who, text } = splitWho(current.text, marks);
      const label = [this.t('currentStep', current.index, task.ac.length)];
      if (who.length) label.push(who.join(` ${this.t('and')} `));
      step.createDiv({ cls: 'bb-now-label', text: label.join(' · ') });
      renderMarkdown(this.app, text, step.createDiv({ cls: 'bb-now-text' }), task.path, this);
    } else {
      step.createDiv({ cls: 'bb-now-label', text: task.ac.length ? this.t('allTicked') : this.t('noSubsteps') });
    }
    const buttons = step.createDiv({ cls: 'bb-now-buttons' });
    if (!this.renderTaskActions(buttons, task)) button(buttons, this.t('askClaude'), () => this.plugin.sendToAi(task), 'mod-cta');
    if (current) button(buttons, this.t('tick'), () => this.plugin.toggleItem(task.path, 'AC', current.index, true), 'bb-text-btn');

    if (open[1]) {
      const next = box.createDiv({ cls: 'bb-now-next', text: `${this.t('thenWord')} ${plainFirstLine(splitWho(open[1].text, marks).text, 200)}` });
      next.addEventListener('click', () => this.select(task));
    }
  }

  renderCheck(parent, task, block, item, isCurrent, editable) {
    const row = parent.createDiv({ cls: 'bb-check' });
    if (item.checked) row.addClass('is-checked');
    if (isCurrent) row.addClass('is-current');
    const box = row.createEl('input', { type: 'checkbox' });
    box.checked = item.checked;
    box.addEventListener('change', () => this.plugin.toggleItem(task.path, block, item.index, box.checked));
    // The sub-step in plain words, when the plain-words file of the task has a line for it: a "?" before the
    // text shows it on hover, and a click puts it under the sub-step (for a touch screen).
    const help = row.createSpan({ cls: 'bb-check-help', text: '?' });
    help.hide();
    const { who, text } = splitWho(item.text, parseNames(this.plugin.settings.whoMarks));
    const body = row.createDiv({ cls: 'bb-check-text' });
    renderMarkdown(this.app, text, body, task.path, this);
    if (block === 'AC') {
      this.plugin.plainWords(task.id, item.index).then((plain) => {
        if (!plain || !help.isConnected) return;
        help.show();
        help.setAttr('aria-label', plain);
        help.addEventListener('click', () => {
          const shown = body.querySelector('.bb-check-plain');
          if (shown) shown.remove();
          else body.createDiv({ cls: 'bb-check-plain', text: `${this.t('plainHelp')}: ${plain}` });
        });
      });
    }
    if (who.length) row.createSpan({ cls: 'bb-check-who', text: who.join(` ${this.t('and')} `) });
    if (editable) {
      const tools = row.createDiv({ cls: 'bb-check-tools' });
      const edit = button(tools, '✎', () =>
        new TextModal(this.app, this.t('editSubstep'), item.text, '', this.t('save'), (text) =>
          this.plugin.editSubstep(task.path, block, item.index, text),
        ).open(),
      );
      edit.setAttr('aria-label', this.t('editSubstep'));
      const remove = button(tools, '×', () =>
        new ConfirmModal(this.app, this.t('removeSubstepConfirm', plainFirstLine(item.text, 80)), this.t('removeSubstep'), this.t('cancel'), () =>
          this.plugin.removeSubstep(task.path, block, item.index),
        ).open(),
      );
      remove.setAttr('aria-label', this.t('removeSubstep'));
    }
  }

  // An input whose text survives the re-render that a file change causes.
  draftInput(parent, key, placeholder, onSubmit) {
    const input = parent.createEl('input', { type: 'text', cls: 'bb-input', attr: { placeholder } });
    input.dataset.focusKey = key;
    input.value = this.drafts[key] || '';
    input.addEventListener('input', () => {
      this.drafts[key] = input.value;
    });
    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      delete this.drafts[key];
      onSubmit(text);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    return submit;
  }

  renderLogInput(parent, task, key) {
    const row = parent.createDiv({ cls: 'bb-inline-input' });
    const submit = this.draftInput(row, `log-${key}-${task.path}`, this.t('logPlaceholder'), (text) => this.plugin.appendLog(task.path, text));
    button(row, this.t('addLog'), submit);
  }

  priorityName(priority) {
    return this.data.priorities.find((name) => same(name, priority)) || priority;
  }

  // --- Board: one column per status --------------------------------------------------------

  renderBoard(main) {
    const data = this.data;
    for (const path of [...this.picked]) if (!data.byPath.has(path)) this.picked.delete(path);
    if (this.picked.size) this.renderPickBar(main);

    // Folded columns are only their names, at the end; a column shows ten cards, then "N more".
    const board = main.createDiv({ cls: 'bb-board' });
    const fold = splitList(this.plugin.settings.foldStatuses);
    const folded = [];
    for (const status of data.statuses) {
      const tasks = data.tasks.filter((task) => same(task.status, status));
      const foldable = fold.length
        ? fold.some((name) => same(name, status))
        : same(status, data.finalStatus) && this.plugin.settings.collapseFinal;
      if (foldable && !this.unfolded.has(status)) {
        folded.push({ status, count: tasks.length });
        continue;
      }
      const column = board.createDiv({ cls: 'bb-col' });
      const head = column.createDiv({ cls: 'bb-col-head' });
      head.createSpan({ cls: 'bb-col-title', text: status ? this.name(status) : this.t('other') });
      head.createSpan({ cls: 'bb-col-count', text: String(tasks.length) });
      if (foldable) button(head, this.t('hide'), () => this.toggleUnfold(status), 'bb-text-btn');
      const list = column.createDiv({ cls: 'bb-col-list' });
      const open = this.unfolded.has(`col:${status}`);
      const shown = open ? tasks : tasks.slice(0, 10);
      for (const task of shown) this.renderCard(list, task);
      if (tasks.length > 10) {
        button(list, open ? this.t('showLess') : this.t('moreSteps', tasks.length - shown.length), () => this.toggleUnfold(`col:${status}`), 'bb-text-btn bb-col-more');
      }
      this.acceptDrops(column, status);
    }
    if (folded.length) {
      const names = board.createDiv({ cls: 'bb-col-folded' });
      for (const { status, count } of folded) {
        const name = button(names, '', () => this.toggleUnfold(status), 'bb-text-btn bb-folded-name');
        name.createSpan({ text: status ? this.name(status) : this.t('other') });
        name.createSpan({ cls: 'bb-col-count', text: ` ${count}` });
        // A card dropped on a folded column's name moves there.
        this.acceptDrops(name, status);
      }
    }
  }

  renderPickBar(main) {
    const data = this.data;
    const bar = main.createDiv({ cls: 'bb-pickbar' });
    bar.createSpan({ text: this.t('selected', this.picked.size) });
    const select = bar.createEl('select', { cls: 'dropdown' });
    for (const status of data.statuses) select.createEl('option', { value: status, text: this.name(status) });
    button(
      bar,
      this.t('moveTo'),
      () => {
        const paths = [...this.picked];
        this.picked.clear();
        this.plugin.moveTasks(data, paths, select.value, null);
      },
      'mod-cta',
    );
    button(bar, this.t('clearSelection'), () => {
      this.picked.clear();
      this.render();
    });
  }

  renderCard(list, task) {
    const data = this.data;
    const card = list.createDiv({ cls: 'bb-card' });
    card.dataset.path = task.path;
    if (this.selected === task.path) card.addClass('is-selected');
    if (this.picked.has(task.path)) card.addClass('is-picked');
    if (data.isActive(task)) card.addClass('is-active');
    card.draggable = true;
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData(DRAG_TYPE, task.path);
      event.dataTransfer.effectAllowed = 'move';
      card.addClass('is-dragging');
    });
    card.addEventListener('dragend', () => card.removeClass('is-dragging'));
    card.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        if (this.picked.has(task.path)) this.picked.delete(task.path);
        else this.picked.add(task.path);
        this.render();
        return;
      }
      this.picked.clear();
      this.select(task);
    });

    // The title, and one grey line only when there is something to say.
    card.createDiv({ cls: 'bb-card-title', text: task.title });
    const notes = [];
    if (task.priority) notes.push(this.name(this.priorityName(task.priority)));
    if (data.isActive(task) && task.ac.length) {
      const current = task.ac.find((item) => !item.checked);
      notes.push(current ? this.t('stepOfTotal', current.index, task.ac.length) : this.t('allTicked'));
    } else if (!data.isFinal(task) && !data.isLocked(task)) {
      const waits = data.waitsList(task);
      if (waits) notes.push(`${this.t('waitsShort')} ${waits}`);
    }
    if (this.plugin.settings.cardLabels && task.labels.length) notes.push(task.labels.join(', '));
    if (notes.length) card.createDiv({ cls: 'bb-card-note', text: notes.join(' · ') });
  }

  acceptDrops(column, status) {
    const clearMarks = () => {
      for (const marked of column.querySelectorAll('.is-drop-before')) marked.removeClass('is-drop-before');
    };
    column.addEventListener('dragover', (event) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      column.addClass('is-drop-target');
      clearMarks();
      const card = event.target instanceof HTMLElement ? event.target.closest('.bb-card') : null;
      if (card && !card.hasClass('is-dragging')) card.addClass('is-drop-before');
    });
    column.addEventListener('dragleave', (event) => {
      if (!column.contains(event.relatedTarget)) {
        column.removeClass('is-drop-target');
        clearMarks();
      }
    });
    column.addEventListener('drop', (event) => {
      column.removeClass('is-drop-target');
      clearMarks();
      const path = event.dataTransfer.getData(DRAG_TYPE);
      if (!path) return;
      event.preventDefault();
      const card = event.target instanceof HTMLElement ? event.target.closest('.bb-card') : null;
      const before = card && card.dataset.path !== path ? card.dataset.path : null;
      const paths = this.picked.has(path) ? [...this.picked] : [path];
      this.picked.clear();
      this.plugin.moveTasks(this.data, paths, status, before);
    });
  }

  // --- Plan: milestones in order, their steps in order -------------------------------------

  // The milestones in plan order, each one with its tasks: done, open or locked.
  planGroups() {
    const data = this.data;
    const groups = data.milestones.map((milestone) => ({
      key: milestone.id,
      title: milestone.title,
      tasks: data.tasks.filter((task) => data.milestoneOf(task) === milestone),
    }));
    const loose = data.tasks.filter((task) => !data.milestoneOf(task));
    if (loose.length) groups.push({ key: '', title: this.t('noMilestone'), tasks: loose });
    return groups
      .filter((group) => group.tasks.length)
      .map((group) => {
        const done = group.tasks.filter((task) => data.isFinal(task));
        const locked = group.tasks.filter((task) => !data.isFinal(task) && data.isLocked(task));
        const open = group.tasks.filter((task) => !data.isFinal(task) && !data.isLocked(task));
        const state = open.length ? 'open' : locked.length ? 'locked' : 'done';
        return Object.assign(group, { done, locked, open, state });
      });
  }

  // What a row of the plan says on the right: where a step stands, briefly.
  planNote(task) {
    const data = this.data;
    if (data.isActive(task)) {
      const current = task.ac.find((item) => !item.checked);
      return current ? this.t('stepOfTotal', current.index, task.ac.length) : this.name(task.status);
    }
    const waits = data.waitsList(task);
    if (waits) return `${this.t('waitsShort')} ${waits}`;
    if (this.onlyMine(task)) return this.t('yours');
    return '';
  }

  // Plan: done stages one grey line each, the first three open stages with their steps, the
  // other open stages and the locked ones folded into a line each.
  renderPlan(main) {
    const page = main.createDiv({ cls: 'bb-plain-page' });
    const groups = this.planGroups();
    const open = groups.filter((group) => group.state === 'open');
    const showAll = this.unfolded.has('plan:all');
    const shownOpen = new Set(showAll ? open : open.slice(0, 3));
    for (const group of groups) {
      if (group.state === 'done') {
        const row = page.createDiv({ cls: 'bb-plain-row is-done' });
        row.createDiv({ cls: 'bb-plain-text', text: group.title });
        row.createSpan({ cls: 'bb-plain-side', text: this.t('doneWord') });
      } else if (group.state === 'open' && shownOpen.has(group)) {
        this.renderPlanGroup(page, group);
      }
    }
    if (open.length > 3) {
      button(page, showAll ? this.t('showLess') : this.t('moreStages', open.length - 3), () => this.toggleUnfold('plan:all'), 'bb-text-btn bb-plan-more');
    }
    const locked = groups.filter((group) => group.state === 'locked');
    if (locked.length) {
      const showLocked = this.unfolded.has('plan:locked');
      const steps = locked.reduce((sum, group) => sum + group.tasks.length, 0);
      button(page, showLocked ? this.t('showLess') : this.t('lockedStages', locked.length, steps), () => this.toggleUnfold('plan:locked'), 'bb-text-btn bb-plan-more');
      if (showLocked) {
        for (const group of locked) {
          const row = page.createDiv({ cls: 'bb-plain-row is-done' });
          row.createDiv({ cls: 'bb-plain-text', text: group.title });
          row.createSpan({ cls: 'bb-plain-side', text: String(group.tasks.length) });
        }
      }
    }
  }

  renderPlanGroup(parent, group) {
    const section = parent.createDiv({ cls: 'bb-plan-group' });
    const head = section.createDiv({ cls: 'bb-plan-head' });
    head.createSpan({ cls: 'bb-plan-title', text: group.title });
    head.createSpan({ cls: 'bb-plain-side', text: `${group.done.length} / ${group.tasks.length}` });
    if (group.done.length) {
      const showDone = this.unfolded.has(`plan:done:${group.key}`);
      button(section, showDone ? this.t('showLess') : this.t('doneInGroup', group.done.length), () => this.toggleUnfold(`plan:done:${group.key}`), 'bb-text-btn bb-plan-done');
      if (showDone) for (const task of group.done) this.renderPlainRow(section, task, '').addClass('is-finished');
    }
    for (const task of group.open) this.renderPlainRow(section, task, this.planNote(task));
    if (group.locked.length) section.createDiv({ cls: 'bb-plan-locked', text: this.t('lockedInGroup', group.locked.length) });
  }

  // --- List: every task, searched and filtered ----------------------------------------------

  // List: a search and one filter, by status; then every task as a plain row.
  renderList(main) {
    const data = this.data;
    const filters = this.filters;
    const page = main.createDiv({ cls: 'bb-plain-page' });
    const bar = page.createDiv({ cls: 'bb-list-bar' });
    const search = bar.createEl('input', { type: 'search', cls: 'bb-underline', attr: { placeholder: this.t('search'), 'aria-label': this.t('search') } });
    search.value = filters.query;
    search.dataset.focusKey = 'list-search';
    search.addEventListener(
      'input',
      debounce(() => {
        filters.query = search.value;
        this.render();
      }, 200, true),
    );
    const dropdown = (key, allText, options) => {
      const select = bar.createEl('select', { cls: 'dropdown' });
      select.createEl('option', { value: '', text: allText });
      for (const [value, text] of options) select.createEl('option', { value, text });
      select.value = filters[key];
      select.addEventListener('change', () => {
        filters[key] = select.value;
        this.render();
      });
    };
    dropdown('status', this.t('allStatuses'), data.statuses.map((status) => [status, this.name(status)]));

    const query = filters.query.trim().toLowerCase();
    const found = data.tasks.filter((task) => {
      if (filters.status && !same(task.status, filters.status)) return false;
      if (!query) return true;
      const haystack = [task.id, task.title, task.description, task.labels.join(' '), task.ac.map((item) => item.text).join(' ')]
        .join(' ')
        .toLowerCase();
      return query.split(/\s+/).every((word) => haystack.includes(word));
    });

    page.createDiv({ cls: 'bb-now-count', text: this.t('results', found.length) });
    if (!found.length) page.createDiv({ cls: 'bb-now-log', text: this.t('noResults') });
    for (const task of found) {
      const row = this.renderPlainRow(page, task, this.name(task.status));
      if (data.isFinal(task)) row.addClass('is-finished');
    }
  }

  // --- Docs: documentation, decisions, drafts ------------------------------------------------

  // Docs: numbered decisions (a note in the folder without a number, such as a list of them, is a
  // link beside the heading), then documents and drafts when there are any.
  renderDocs(main) {
    const data = this.data;
    const page = main.createDiv({ cls: 'bb-plain-page' });
    const noteRow = (parent, note, number) => {
      const row = parent.createDiv({ cls: 'bb-plain-row' });
      if (number) row.createSpan({ cls: 'bb-plain-num', text: number });
      const title = row.createDiv({ cls: 'bb-plain-title', text: number ? note.title.replace(/^\d+\s*[—–:-]?\s*/, '') : note.title });
      title.addEventListener('click', () => this.plugin.openPath(note.path));
      if (note.date) row.createSpan({ cls: 'bb-plain-side', text: note.date });
      return row;
    };
    const numberOf = (note) => (/^(\d+)/.exec(note.name) || [])[1] || '';
    const numbered = data.decisions.filter((note) => numberOf(note));
    const lists = data.decisions.filter((note) => !numberOf(note));
    if (numbered.length || lists.length) {
      const head = page.createDiv({ cls: 'bb-plan-head' });
      head.createSpan({ cls: 'bb-plan-title', text: this.t('decisions') });
      head.createSpan({ cls: 'bb-plain-side', text: String(numbered.length) });
      for (const note of lists) button(head, note.title, () => this.plugin.openPath(note.path), 'bb-text-btn bb-head-link');
      const open = this.unfolded.has('docs:decisions');
      for (const note of open ? numbered : numbered.slice(0, 10)) noteRow(page, note, numberOf(note));
      if (numbered.length > 10) {
        button(page, open ? this.t('showLess') : this.t('moreSteps', numbered.length - 10), () => this.toggleUnfold('docs:decisions'), 'bb-text-btn bb-plan-more');
      }
    }
    if (data.docs.length) {
      page.createDiv({ cls: 'bb-now-heading', text: this.t('documentation') });
      for (const note of data.docs) noteRow(page, note, '');
    }
    if (data.drafts.length) {
      page.createDiv({ cls: 'bb-now-heading', text: this.t('drafts') });
      for (const draft of data.drafts) {
        const row = noteRow(page, draft, '');
        button(row, this.t('promote'), () => this.plugin.promoteDraft(data, draft), 'bb-text-btn bb-accent-text');
      }
    }
    if (!data.docs.length && !data.drafts.length) page.createDiv({ cls: 'bb-now-log', text: this.t('noOtherDocs') });
  }

  // --- Statistics -------------------------------------------------------------------------------

  // Statistics: one number (what is done, of what is not locked), then the stages as plain rows.
  renderStats(main) {
    const data = this.data;
    const page = main.createDiv({ cls: 'bb-plain-page' });
    const counted = data.tasks.filter((task) => !data.isLocked(task));
    const done = counted.filter((task) => data.isFinal(task)).length;
    page.createDiv({ cls: 'bb-now-count', text: this.t('statsDone') });
    const big = page.createDiv({ cls: 'bb-stat-number' });
    big.createSpan({ text: String(done) });
    big.createSpan({ cls: 'bb-stat-of', text: ` / ${counted.length}` });
    meter(page, done, counted.length);
    const lockedCount = data.tasks.length - counted.length;
    if (lockedCount) page.createDiv({ cls: 'bb-now-log', text: this.t('statsLocked', lockedCount) });

    const groups = this.planGroups();
    const rows = page.createDiv({ cls: 'bb-stat-stages' });
    for (const group of groups.filter((one) => one.state !== 'locked')) {
      const row = rows.createDiv({ cls: 'bb-plain-row' });
      if (group.state === 'done') row.addClass('is-done');
      row.createDiv({ cls: 'bb-plain-text', text: group.title });
      row.createSpan({ cls: 'bb-plain-side', text: group.state === 'done' ? this.t('doneWord') : `${group.done.length} / ${group.tasks.length}` });
    }
    const locked = groups.filter((group) => group.state === 'locked');
    if (locked.length) {
      const steps = locked.reduce((sum, group) => sum + group.tasks.length, 0);
      rows.createDiv({ cls: 'bb-now-log', text: this.t('lockedStages', locked.length, steps) });
    }
  }

  // --- Detail: everything about one step ---------------------------------------------------

  // A task as a page of its own, plain: where it stands, its title, the first paragraph of what it
  // is, its buttons, its sub-steps, the end of its work log, its files. The rest is folded or grey.
  renderTaskPage(main, task) {
    const data = this.data;
    const page = main.createDiv({ cls: 'bb-plain-page bb-task-page' });
    const top = page.createDiv({ cls: 'bb-task-top' });
    button(top, `← ${this.t('back')}`, () => this.select(null), 'bb-text-btn');
    const tools = top.createDiv({ cls: 'bb-task-tools' });
    button(tools, this.t('edit'), () => this.plugin.openTaskModal(data, task), 'bb-text-btn');
    button(tools, this.t('openNote'), () => this.plugin.openPath(task.path), 'bb-text-btn');

    const current = data.isFinal(task) ? null : task.ac.find((item) => !item.checked);
    const where = [this.name(task.status)];
    if (current) where.push(this.t('stepOfTotal', current.index, task.ac.length));
    const milestone = data.milestoneOf(task);
    if (milestone) where.push(milestone.title);
    page.createDiv({ cls: 'bb-now-count', text: where.join(' · ') });
    page.createDiv({ cls: 'bb-task-title', text: task.title });

    if (task.description) {
      const whole = this.unfolded.has(`desc:${task.path}`);
      const first = firstParagraph(task.description);
      renderMarkdown(this.app, whole ? task.description : first, page.createDiv({ cls: 'bb-task-desc' }), task.path, this);
      if (first.trim() !== task.description.trim()) {
        button(page, whole ? this.t('showLess') : this.t('more'), () => this.toggleUnfold(`desc:${task.path}`), 'bb-text-btn');
      }
    }

    const buttons = page.createDiv({ cls: 'bb-now-buttons' });
    const own = this.renderTaskActions(buttons, task);
    if (!data.isFinal(task)) button(buttons, this.t('askClaude'), () => this.plugin.sendToAi(task), own ? '' : 'mod-cta');

    if (task.deps.length) this.renderLinkLine(page, this.t('waitsFor'), task.deps.map((id) => data.byId.get(id) || { id, title: id, missing: true }));
    const dependents = data.dependentsOf(task);
    if (dependents.length) this.renderLinkLine(page, this.t('unblocks'), dependents);

    const stepsHead = page.createDiv({ cls: 'bb-now-heading' });
    stepsHead.setText(task.ac.length ? `${this.t('subSteps')} · ${countChecked(task.ac)} / ${task.ac.length}` : this.t('subSteps'));
    const steps = page.createDiv({ cls: 'bb-steps' });
    for (const item of task.ac) this.renderCheck(steps, task, 'AC', item, item === current, true);
    const add = page.createDiv({ cls: 'bb-inline-input' });
    this.draftInput(add, `add-${task.path}`, this.t('addSubstep'), (text) => this.plugin.addSubstep(task.path, text));

    if (task.plan) {
      page.createDiv({ cls: 'bb-now-heading', text: this.t('plan') });
      renderMarkdown(this.app, task.plan, page.createDiv({ cls: 'bb-task-desc' }), task.path, this);
    }

    page.createDiv({ cls: 'bb-now-heading', text: this.t('log') });
    const logLines = String(task.notes || '').split(/\r?\n/).filter((line) => line.trim());
    if (logLines.length) {
      const whole = this.unfolded.has(`log:${task.path}`);
      const shown = whole ? task.notes : lastLines(task.notes, 4);
      renderMarkdown(this.app, shown, page.createDiv({ cls: 'bb-log' }), task.path, this);
      if (logLines.length > 4) button(page, whole ? this.t('showLess') : this.t('wholeLog', logLines.length), () => this.toggleUnfold(`log:${task.path}`), 'bb-text-btn');
    }
    this.renderLogInput(page, task, 'detail');

    page.createDiv({ cls: 'bb-now-heading', text: this.t('workFiles') });
    const refs = page.createDiv({ cls: 'bb-refs' });
    for (const ref of task.refs) this.renderRef(refs, ref, task);
    const refButtons = page.createDiv({ cls: 'bb-mini-actions' });
    button(refButtons, this.t('attachFile'), () => new FileSuggestModal(this.app, (file) => this.plugin.addReference(task.path, file.path)).open(), 'bb-text-btn');
    button(
      refButtons,
      this.t('attachLink'),
      () => new TextModal(this.app, this.t('attachLink'), '', this.t('linkPrompt'), this.t('save'), (url) => this.plugin.addReference(task.path, url)).open(),
      'bb-text-btn',
    );
    button(refButtons, this.t('newNote'), () => this.plugin.createLinkedNote(task), 'bb-text-btn');
    const linked = this.plugin.notesLinkingTo(task.path);
    if (linked.length) {
      page.createDiv({ cls: 'bb-now-heading', text: this.t('linkedNotes') });
      const notes = page.createDiv({ cls: 'bb-refs' });
      for (const path of linked) {
        const link = notes.createEl('a', { cls: 'bb-ref', text: path.replace(/\.md$/, ''), href: '#' });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          this.plugin.openPath(path);
        });
      }
    }

    if (task.dod.length) {
      const details = page.createEl('details', { cls: 'bb-dod' });
      details.createEl('summary', { cls: 'bb-now-heading', text: `${this.t('dod')} · ${countChecked(task.dod)} / ${task.dod.length}` });
      const list = details.createDiv({ cls: 'bb-steps' });
      for (const item of task.dod) this.renderCheck(list, task, 'DOD', item, false, false);
    }
    if (task.summary) {
      page.createDiv({ cls: 'bb-now-heading', text: this.t('summary') });
      renderMarkdown(this.app, task.summary, page.createDiv({ cls: 'bb-task-desc' }), task.path, this);
    }
    if (task.comments) {
      page.createDiv({ cls: 'bb-now-heading', text: this.t('comments') });
      renderMarkdown(this.app, task.comments, page.createDiv({ cls: 'bb-log' }), task.path, this);
    }

    const facts = [];
    if (task.priority) facts.push(this.name(this.priorityName(task.priority)));
    if (task.labels.length) facts.push(task.labels.map((label) => `#${label}`).join(' '));
    if (task.assignee.length) facts.push(task.assignee.join(', '));
    if (task.due) facts.push(`${this.t('due')} ${task.due}`);
    if (task.created) facts.push(`${this.t('created')} ${task.created.slice(0, 10)}`);
    const foot = page.createDiv({ cls: 'bb-task-foot' });
    if (facts.length) foot.createSpan({ text: facts.join(' · ') });
    button(
      foot,
      this.t('archive'),
      () =>
        new ConfirmModal(this.app, this.t('archiveConfirm', task.title), this.t('archive'), this.t('cancel'), async () => {
          await this.plugin.archiveTask(data, task);
          this.select(null);
        }).open(),
      'bb-text-btn',
    );
  }

  // One quiet line: a label, then other tasks by their short names, each opening that task.
  renderLinkLine(parent, label, tasks) {
    const line = parent.createDiv({ cls: 'bb-link-line' });
    line.createSpan({ text: `${label} ` });
    tasks.forEach((task, i) => {
      if (i) line.createSpan({ text: ', ' });
      if (task.missing) line.createSpan({ text: task.id });
      else button(line, shortLabel(task), () => this.select(task), 'bb-text-btn bb-accent-text');
    });
  }

  renderRef(parent, ref, task) {
    const row = parent.createDiv({ cls: 'bb-ref-row' });
    const target =
      this.app.metadataCache.getFirstLinkpathDest(ref, task.path) || this.app.vault.getAbstractFileByPath(normalizePath(ref));
    if (target instanceof TFile) {
      const link = row.createEl('a', { cls: 'bb-ref', text: ref, href: '#' });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        this.plugin.openPath(target.path);
      });
    } else if (/^https?:\/\//i.test(ref)) {
      row.createEl('a', { cls: 'bb-ref', text: ref, href: ref });
    } else {
      row.createSpan({ cls: 'bb-ref bb-muted', text: ref });
    }
    const remove = button(row, '×', () => this.plugin.removeReference(task.path, ref), 'bb-icon-btn bb-ref-x');
    remove.setAttr('aria-label', this.t('remove'));
  }
}

// ---------------------------------------------------------------------------------------------
// Agent panel view (ACP)
// ---------------------------------------------------------------------------------------------

class AgentView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.draft = '';
    this.lastItemCount = 0;
  }

  getViewType() {
    return AGENT_VIEW_TYPE;
  }

  getDisplayText() {
    return this.plugin.t('agentViewTitle');
  }

  getIcon() {
    return AGENT_ICON;
  }

  async onOpen() {
    this.mount();
    this.render();
  }

  async onClose() {
    this.headerEl = null;
    this.streamEl = null;
    this.composerEl = null;
    this.contentEl.empty();
  }

  mount() {
    const root = this.contentEl;
    root.empty();
    root.addClass('bb-root');
    root.addClass('ap-root');
    this.headerEl = root.createDiv({ cls: 'ap-header' });
    this.streamEl = root.createDiv({ cls: 'ap-stream' });
    this.composerEl = root.createDiv({ cls: 'ap-composer' });

    const input = this.composerEl.createEl('textarea', { cls: 'ap-input', attr: { placeholder: this.t('agentPlaceholder') } });
    input.value = this.draft;
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      this.draft = '';
      input.value = '';
      await this.plugin.sendToPanel(this.plugin.currentAgent(), text);
    };
    input.addEventListener('input', () => {
      this.draft = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    const foot = this.composerEl.createDiv({ cls: 'ap-composer-foot' });
    foot.createSpan({ cls: 'ap-hint', text: this.t('agentHint') });
    const composerActions = foot.createDiv({ cls: 'ap-composer-actions' });
    button(composerActions, this.t('agentSend'), submit, 'mod-cta');
  }

  t(key, ...args) {
    return this.plugin.t(key, ...args);
  }

  toolLabel(kind) {
    if (kind === 'read') return this.t('agentToolRead');
    if (kind === 'edit' || kind === 'delete' || kind === 'move') return this.t('agentToolEdit');
    if (kind === 'execute') return this.t('agentToolExecute');
    if (kind === 'search' || kind === 'fetch') return this.t('agentToolSearch');
    return this.t('agentToolOther');
  }

  toolStatusText(status) {
    if (status === 'completed') return this.t('agentDone');
    if (status === 'failed') return this.t('agentFailed');
    return this.t('agentWorking');
  }

  stateText(status) {
    if (status === 'starting') return this.t('agentStarting');
    if (status === 'working') return this.t('agentWorking');
    if (status === 'asking') return this.t('agentAsking');
    if (status === 'error') return this.t('agentStopped');
    return this.t('agentReady');
  }

  render() {
    if (!this.headerEl || !this.streamEl) this.mount();
    const prevScroll = this.streamEl.scrollTop;
    const header = this.headerEl;
    const stream = this.streamEl;
    header.empty();
    stream.empty();

    const agent = this.plugin.currentAgent();
    const session = this.plugin.agentSession(agent.name);
    const busy = session.status === 'starting' || session.status === 'working' || session.status === 'asking';

    const picker = header.createDiv({ cls: 'ap-picker' });
    const select = picker.createEl('select', { cls: 'ap-select', attr: { 'aria-label': this.t('setAgent') } });
    for (const item of this.plugin.agents()) {
      const option = select.createEl('option', { text: item.name, attr: { value: item.name } });
      if (item.name === agent.name) option.selected = true;
    }
    select.addEventListener('change', async () => {
      this.plugin.settings.agent = select.value;
      await this.plugin.saveSettings();
      this.render();
    });
    picker.createSpan({ cls: 'ap-state', text: this.stateText(session.status) });

    const actions = header.createDiv({ cls: 'ap-header-actions' });
    if (busy) button(actions, this.t('agentStop'), () => this.plugin.cancelAgent(agent.name), 'bb-text-btn');
    button(actions, this.t('agentNewChat'), () => this.plugin.resetAgentSession(agent.name), 'bb-text-btn');

    if (!session.items.length && !session.pendingPermission) {
      stream.createDiv({ cls: 'ap-state', text: this.t('agentEmpty') });
    } else {
      let toolsBox = null;
      for (const item of session.items) {
        if (item.kind === 'tool') {
          if (!toolsBox) toolsBox = stream.createDiv({ cls: 'ap-tools' });
          const line = toolsBox.createDiv({ cls: 'ap-tool-line' });
          const what = line.createSpan({ cls: 'ap-tool-what' });
          what.createSpan({ cls: 'ap-tool-name', text: this.toolLabel(item.toolKind) });
          what.createSpan({ text: item.title || '' });
          line.createSpan({ cls: 'ap-tool-status', text: this.toolStatusText(item.status) });
          continue;
        }
        toolsBox = null;
        if (item.kind === 'user') {
          const row = stream.createDiv({ cls: 'ap-msg-user' });
          row.createEl('strong', { text: this.t('agentYou') });
          row.createSpan({ text: item.text });
        } else if (item.kind === 'agent') {
          const row = stream.createDiv({ cls: 'ap-msg-agent' });
          if (typeof MarkdownRenderer !== 'undefined' && MarkdownRenderer && (typeof MarkdownRenderer.render === 'function' || typeof MarkdownRenderer.renderMarkdown === 'function')) {
            renderMarkdown(this.app, item.text, row, '', this);
          } else {
            row.createSpan({ text: item.text });
          }
        } else if (item.kind === 'error') {
          stream.createDiv({ cls: 'ap-msg-error', text: item.text });
        }
      }
      if (session.pendingPermission) {
        const perm = stream.createDiv({ cls: 'ap-permission' });
        perm.createDiv({ cls: 'ap-perm-label', text: this.t('agentPermLabel') });
        perm.createDiv({ cls: 'ap-perm-cmd', text: session.pendingPermission.title });
        const buttons = perm.createDiv({ cls: 'ap-perm-buttons' });
        button(buttons, this.t('agentAllow'), () => this.plugin.answerPermission(agent.name, true), 'mod-cta');
        button(buttons, this.t('agentReject'), () => this.plugin.answerPermission(agent.name, false), 'bb-text-btn');
      }
    }

    if (session.items.length !== this.lastItemCount || session.pendingPermission) {
      stream.scrollTop = stream.scrollHeight || 0;
      this.lastItemCount = session.items.length;
    } else if (prevScroll !== null && prevScroll !== undefined) {
      stream.scrollTop = prevScroll;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

class BoardSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const plugin = this.plugin;
    const t = (key) => plugin.t(key);
    containerEl.empty();
    const save = async () => plugin.saveSettings();
    const text = (key, name, desc, placeholder) =>
      new Setting(containerEl)
        .setName(t(name))
        .setDesc(desc ? t(desc) : '')
        .addText((input) =>
          input
            .setPlaceholder(placeholder || '')
            .setValue(plugin.settings[key])
            .onChange(async (value) => {
              plugin.settings[key] = value;
              await save();
            }),
        );

    text('backlogFolder', 'setFolder', 'setFolderDesc', 'backlog');
    new Setting(containerEl).setName(t('setLanguage')).addDropdown((dropdown) =>
      dropdown
        .addOption('en', 'English')
        .addOption('uz', "O'zbekcha")
        .setValue(plugin.settings.language)
        .onChange(async (value) => {
          plugin.settings.language = value;
          await save();
          this.display();
        }),
    );
    new Setting(containerEl).setName(t('setTab')).addDropdown((dropdown) => {
      for (const key of TABS) dropdown.addOption(key, t(TAB_KEYS[key]));
      dropdown.setValue(plugin.settings.defaultTab).onChange(async (value) => {
        plugin.settings.defaultTab = value;
        await save();
      });
    });
    text('activeStatuses', 'setActive', 'setActiveDesc');
    text('blockedStatuses', 'setBlocked', 'setBlockedDesc');
    text('lockedStatuses', 'setLocked', 'setLockedDesc');
    text('me', 'setMe', 'setMeDesc', '@name');
    text('foldStatuses', 'setFold', 'setFoldDesc');
    new Setting(containerEl).setName(t('setCollapse')).addToggle((toggle) =>
      toggle.setValue(plugin.settings.collapseFinal).onChange(async (value) => {
        plugin.settings.collapseFinal = value;
        await save();
      }),
    );
    new Setting(containerEl).setName(t('setCardLabels')).addToggle((toggle) =>
      toggle.setValue(plugin.settings.cardLabels).onChange(async (value) => {
        plugin.settings.cardLabels = value;
        await save();
      }),
    );
    new Setting(containerEl).setName(t('setLogLines')).addSlider((slider) =>
      slider
        .setLimits(3, 30, 1)
        .setValue(plugin.settings.logLines)
        .setDynamicTooltip()
        .onChange(async (value) => {
          plugin.settings.logLines = value;
          await save();
        }),
    );
    new Setting(containerEl)
      .setName(t('setNames'))
      .setDesc(t('setNamesDesc'))
      .setClass('bb-stack')
      .addTextArea((area) => {
        area.setPlaceholder('To Do = …\nIn Progress = …').setValue(plugin.settings.displayNames).onChange(async (value) => {
          plugin.settings.displayNames = value;
          await save();
        });
        area.inputEl.rows = 6;
      });
    new Setting(containerEl)
      .setName(t('setWho'))
      .setDesc(t('setWhoDesc'))
      .setClass('bb-stack')
      .addTextArea((area) => {
        area.setPlaceholder('@bekzod = you\n@claude = agent').setValue(plugin.settings.whoMarks).onChange(async (value) => {
          plugin.settings.whoMarks = value;
          await save();
        });
        area.inputEl.rows = 2;
      });
    text('notesFolder', 'setNotes', 'setNotesDesc', 'notes');
    text('plainFolder', 'setPlain', 'setPlainDesc', 'backlog/plain');
    text('decisionFolders', 'setDecisions', 'setDecisionsDesc', 'docs/decisions');

    new Setting(containerEl).setName(t('setAgentHeading')).setHeading();
    new Setting(containerEl)
      .setName(t('setAgents'))
      .setDesc(t('setAgentsDesc'))
      .setClass('bb-stack')
      .addTextArea((area) => {
        area.setPlaceholder(DEFAULT_AGENTS).setValue(plugin.settings.agents).onChange(async (value) => {
          plugin.settings.agents = value;
          await save();
        });
        area.inputEl.rows = 4;
        // The list of agents below follows what was typed, once the field is left.
        area.inputEl.addEventListener('blur', () => this.display());
      });
    new Setting(containerEl).setName(t('setAgent')).addDropdown((dropdown) => {
      for (const agent of plugin.agents()) dropdown.addOption(agent.name, agent.name);
      dropdown.setValue(plugin.currentAgent().name).onChange(async (value) => {
        plugin.settings.agent = value;
        await save();
      });
    });
    new Setting(containerEl).setName(t('setTarget')).addDropdown((dropdown) => {
      dropdown
        .addOption('panel', t('targetPanel'))
        .addOption('terminal', t('targetTerminal'))
        .addOption('claudian', t('targetClaudian'))
        .addOption('copy', t('targetCopy'));
      dropdown.setValue(TARGETS.includes(plugin.settings.target) ? plugin.settings.target : 'panel').onChange(async (value) => {
        plugin.settings.target = value;
        await save();
      });
    });
    new Setting(containerEl).setName(t('setAsk')).addToggle((toggle) =>
      toggle.setValue(plugin.settings.askBeforeSending).onChange(async (value) => {
        plugin.settings.askBeforeSending = value;
        await save();
      }),
    );
    new Setting(containerEl).setName(t('setNotify')).addToggle((toggle) =>
      toggle.setValue(plugin.settings.notifyAgent).onChange(async (value) => {
        plugin.settings.notifyAgent = value;
        await save();
      }),
    );
    text('commandsFolder', 'setCommands', 'setCommandsDesc', '.claude/commands');
    for (const [key, name, placeholder] of [
      ['dayActions', 'setDayActions', 'Start the day = start-day'],
      ['activeActions', 'setActiveActions', 'Next sub-step = next'],
      ['readyActions', 'setReadyActions', 'Open = new-task {step}'],
    ]) {
      new Setting(containerEl)
        .setName(t(name))
        .setDesc(t('setActionsDesc'))
        .setClass('bb-stack')
        .addTextArea((area) => {
          area.setPlaceholder(placeholder).setValue(plugin.settings[key]).onChange(async (value) => {
            plugin.settings[key] = value;
            await save();
          });
          area.inputEl.rows = 3;
        });
    }
    new Setting(containerEl)
      .setName(t('setPrompt'))
      .setDesc(t('setPromptDesc'))
      .setClass('bb-stack')
      .addTextArea((area) => {
        area.setValue(plugin.settings.aiPrompt).onChange(async (value) => {
          plugin.settings.aiPrompt = value || DEFAULT_PROMPT;
          await save();
        });
        area.inputEl.rows = 6;
      });
  }
}

// ---------------------------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------------------------

class BacklogBoardPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new BoardView(leaf, this));
    this.registerView(AGENT_VIEW_TYPE, (leaf) => new AgentView(leaf, this));
    this.addRibbonIcon(ICON, this.t('openBoard'), () => this.activateView());
    this.addCommand({ id: 'open', name: this.t('openBoard'), callback: () => this.activateView() });
    this.addCommand({ id: 'open-agent', name: this.t('openAgentPanel'), callback: () => this.activateAgentView() });
    this.addCommand({ id: 'work-layout', name: this.t('workLayout'), callback: () => this.openWorkLayout() });
    this.addCommand({
      id: 'new-task',
      name: this.t('newTask'),
      callback: async () => {
        const data = await loadBacklog(this.app, this.settings);
        if (!data.missing) this.openTaskModal(data, null);
      },
    });
    this.addSettingTab(new BoardSettingTab(this.app, this));

    const refresh = debounce(() => this.refreshViews(), 250, true);
    const watch = (file) => {
      if (file && this.inFolder(file.path)) refresh();
    };
    this.registerEvent(this.app.vault.on('modify', watch));
    this.registerEvent(this.app.vault.on('create', watch));
    this.registerEvent(this.app.vault.on('delete', watch));
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (this.inFolder(file.path) || this.inFolder(oldPath)) refresh();
      }),
    );
    // Linked notes live outside the folder: when links change, refresh a board showing a task.
    this.registerEvent(
      this.app.metadataCache.on('resolved', () => {
        if (this.views().some((view) => view.selected)) refresh();
      }),
    );
    // Obsidian does not report every change made outside it (many files at once, by git or a
    // script). While a board is open and the window is seen, the disk is looked at as well.
    this.registerInterval(
      window.setInterval(() => {
        if (document.visibilityState === 'visible') this.checkDisk();
      }, DISK_CHECK_MS),
    );
    this.registerDomEvent(window, 'focus', () => this.checkDisk());
  }

  // The agents started over ACP end with Obsidian, or when the plugin is turned off.
  onunload() {
    if (this.acpClients) for (const client of this.acpClients.values()) client.stop();
    if (this.agentSessions) {
      for (const session of this.agentSessions.values()) {
        if (session.client) session.client.stop();
      }
    }
  }

  // Obsidian calls this when data.json was changed on the disk (by hand, by git or by sync).
  async onExternalSettingsChange() {
    await this.loadSettings();
    this.refreshViews();
  }

  watchedFolders() {
    return [this.backlogFolder(), ...splitList(this.settings.decisionFolders).map((dir) => normalizePath(dir))];
  }

  async fingerprint() {
    const adapter = this.app.vault.adapter;
    const config = `${this.backlogFolder()}/config.yml`;
    const stat = (await adapter.exists(config)) ? await adapter.stat(config) : null;
    return `${stat ? stat.mtime : ''}\n${await diskFingerprint(adapter, this.watchedFolders())}`;
  }

  // Reloads the open boards when the files on the disk changed since the last look.
  async checkDisk() {
    if (this.checking || !this.views().length) return;
    this.checking = true;
    try {
      const print = await this.fingerprint();
      const changed = this.lastPrint !== undefined && print !== this.lastPrint;
      this.lastPrint = print;
      if (changed) for (const view of this.views()) view.refresh();
    } catch (error) {
      console.warn('[backlog-board] the disk could not be read', error);
    } finally {
      this.checking = false;
    }
  }

  t(key, ...args) {
    const table = STRINGS[this.settings.language] || STRINGS.en;
    const value = key in table ? table[key] : STRINGS.en[key];
    if (typeof value === 'function') return value(...args);
    return value == null ? key : value;
  }

  displayName(value) {
    if (!this.names || this.namesFrom !== this.settings.displayNames) {
      this.names = parseNames(this.settings.displayNames);
      this.namesFrom = this.settings.displayNames;
    }
    return this.names.get(String(value || '').trim().toLowerCase()) || value;
  }

  backlogFolder() {
    return normalizePath(String(this.settings.backlogFolder || '').trim() || 'backlog');
  }

  inFolder(path) {
    const folder = this.backlogFolder();
    if (path === folder || path.startsWith(`${folder}/`)) return true;
    return splitList(this.settings.decisionFolders).some((dir) => path.startsWith(`${normalizePath(dir)}/`));
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  views() {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view) => view instanceof BoardView);
  }

  agentViews() {
    return this.app.workspace
      .getLeavesOfType(AGENT_VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view) => view instanceof AgentView);
  }

  refreshAgentViews() {
    for (const view of this.agentViews()) view.render();
  }

  async activateAgentView(beside = false) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(AGENT_VIEW_TYPE)[0];
    if (!leaf) {
      const board = beside ? workspace.getLeavesOfType(VIEW_TYPE)[0] : null;
      leaf = board && typeof workspace.createLeafBySplit === 'function' ? workspace.createLeafBySplit(board, 'vertical') : workspace.getLeaf('tab');
      await leaf.setViewState({ type: AGENT_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    return leaf.view;
  }

  refreshViews() {
    for (const view of this.views()) view.refresh();
    this.refreshAgentViews();
    // Remember what the disk holds now, so the next look does not reload the boards again.
    this.fingerprint()
      .then((print) => {
        this.lastPrint = print;
      })
      .catch(() => {});
  }

  selectInViews(path) {
    for (const view of this.views()) view.selected = path;
  }

  async openPath(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(file);
  }

  // A file or folder exists when Obsidian knows it or when it is on the disk.
  async exists(path) {
    return Boolean(this.app.vault.getAbstractFileByPath(path)) || (await this.app.vault.adapter.exists(path));
  }

  async ensureFolder(path) {
    const parts = normalizePath(path).split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.exists(current))) await this.app.vault.createFolder(current);
    }
  }

  async freePath(folder, base) {
    let path = normalizePath(`${folder}/${base}.md`);
    for (let i = 2; await this.exists(path); i += 1) path = normalizePath(`${folder}/${base} ${i}.md`);
    return path;
  }

  async editFile(path, edit) {
    const file = this.app.vault.getAbstractFileByPath(path);
    try {
      if (file instanceof TFile) {
        if (typeof this.app.vault.process === 'function') {
          await this.app.vault.process(file, edit);
        } else {
          await this.app.vault.modify(file, edit(await this.app.vault.read(file)));
        }
        return true;
      }
      // A file Obsidian has not noticed yet (written outside it) is edited on the disk.
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(path))) return false;
      const content = await adapter.read(path);
      const next = edit(content);
      if (next !== content) await adapter.write(path, next);
      this.refreshViews();
      return true;
    } catch (error) {
      console.error('[backlog-board]', error);
      new Notice(`${this.t('failed')}: ${fileAt(path).basename}`);
      return false;
    }
  }

  // Moves a file, through Obsidian when it knows the file (so links follow), else on the disk.
  async moveFile(from, to) {
    const file = this.app.vault.getAbstractFileByPath(from);
    if (file instanceof TFile) {
      await this.app.fileManager.renameFile(file, to);
    } else {
      await this.app.vault.adapter.rename(from, to);
      this.refreshViews();
    }
  }

  // --- Changes to tasks ---------------------------------------------------------------------

  // Moves tasks to a status. Their place in the plan (ordinal) changes only when they were dropped
  // on a card: then they go just above it. Dropped on a column, or moved by a button, they keep it.
  async moveTasks(data, paths, status, beforePath) {
    const moving = paths.map((path) => data.byPath.get(path)).filter(Boolean);
    if (!moving.length) return;
    let ordinals = new Map();
    let touched = moving;
    if (beforePath) {
      const column = data.tasks.filter((task) => same(task.status, status) && !paths.includes(task.path));
      let at = column.findIndex((task) => task.path === beforePath);
      if (at < 0) at = column.length;
      const order = [...column.slice(0, at), ...moving, ...column.slice(at)];
      ordinals = planOrdinals(order, new Set(paths));
      touched = order;
    }
    for (const task of touched) {
      const isMoving = paths.includes(task.path);
      const ordinal = ordinals.get(task.path);
      const statusChanges = isMoving && !same(task.status, status);
      if (!statusChanges && ordinal == null) continue;
      await this.editFile(task.path, (content) => {
        let next = content;
        if (statusChanges) next = setFrontmatterField(next, 'status', yamlScalar(status));
        if (ordinal != null) next = setFrontmatterField(next, 'ordinal', String(ordinal));
        return statusChanges ? touch(next) : next;
      });
    }
  }

  // The plain words of one sub-step: line "#<n> ..." of <plain-words folder>/<task id>.md, or '' when there is none.
  async plainWords(taskId, index) {
    const folder = normalizePath(String(this.settings.plainFolder || '').trim() || 'backlog/plain');
    const file = this.app.vault.getAbstractFileByPath(`${folder}/${String(taskId).toLowerCase()}.md`);
    if (!file || file.children) return '';
    const lines = (await this.app.vault.cachedRead(file)).split(/\r?\n/);
    for (const line of lines) {
      const match = /^\s*(?:[-*]\s*)?#(\d+)[\s:.)-]+(.+)$/.exec(line);
      if (match && Number(match[1]) === Number(index)) return match[2].trim();
    }
    return '';
  }

  setStatus(path, status) {
    return this.editFile(path, (content) => touch(setFrontmatterField(content, 'status', yamlScalar(status))));
  }

  toggleItem(path, block, index, checked) {
    return this.editFile(path, (content) => {
      const next = toggleChecklistItem(content, block, index, checked);
      return next == null ? content : touch(next);
    });
  }

  addSubstep(path, text) {
    return this.editFile(path, (content) => touch(addChecklistItem(content, 'AC', 'Acceptance Criteria', text)));
  }

  editSubstep(path, block, index, text) {
    return this.editFile(path, (content) => {
      const next = editChecklistItem(content, block, index, text);
      return next == null ? content : touch(next);
    });
  }

  removeSubstep(path, block, index) {
    return this.editFile(path, (content) => {
      const next = removeChecklistItem(content, block, index);
      return next == null ? content : touch(next);
    });
  }

  appendLog(path, text) {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(
      now.getHours(),
    ).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return this.editFile(path, (content) =>
      touch(appendSectionText(content, 'SECTION:NOTES', 'Implementation Notes', `- ${stamp} — ${text}`, ['SECTION:DESCRIPTION', 'AC', 'DOD', 'SECTION:PLAN', 'SECTION:NOTES'])),
    );
  }

  addReference(path, ref) {
    return this.editFile(path, (content) => {
      const task = parseTask(content, { path, basename: '' });
      if (task.refs.includes(ref)) return content;
      return touch(setFrontmatterList(content, 'references', [...task.refs, ref]));
    });
  }

  removeReference(path, ref) {
    return this.editFile(path, (content) => {
      const task = parseTask(content, { path, basename: '' });
      const refs = task.refs.filter((other) => other !== ref);
      return touch(refs.length ? setFrontmatterList(content, 'references', refs) : deleteFrontmatterField(content, 'references'));
    });
  }

  openTaskModal(data, task) {
    new TaskModal(this, data, task, (state) => (task ? this.updateTask(task, state) : this.createTask(state))).open();
  }

  async createTask(state) {
    const data = await loadBacklog(this.app, this.settings);
    if (data.missing) return;
    const number = data.nextTaskNumber;
    const id = `${data.prefix.toUpperCase()}-${number}`;
    const folder = `${data.folder}/tasks`;
    await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/${data.prefix.toLowerCase()}-${number} - ${slugify(state.title)}.md`);
    const content = buildTaskFile({
      id,
      title: state.title,
      status: state.status,
      assignee: state.assignee,
      created: timestamp(),
      due: state.due,
      labels: state.labels,
      milestone: state.milestone,
      deps: state.deps,
      priority: state.priority,
      ordinal: data.maxOrdinal + 10,
      description: state.description,
      ac: state.substeps,
      dod: data.dodDefaults,
    });
    await this.app.vault.create(path, content);
    this.selectInViews(path);
  }

  updateTask(task, state) {
    return this.editFile(task.path, (content) => {
      let next = content;
      if (state.title !== task.title) next = setFrontmatterField(next, 'title', yamlScalar(state.title));
      if (!same(state.status, task.status)) next = setFrontmatterField(next, 'status', yamlScalar(state.status));
      if (state.milestone !== task.milestone) {
        next = state.milestone ? setFrontmatterField(next, 'milestone', yamlScalar(state.milestone)) : deleteFrontmatterField(next, 'milestone');
      }
      if (!same(state.priority, task.priority)) {
        next = state.priority ? setFrontmatterField(next, 'priority', yamlScalar(state.priority)) : deleteFrontmatterField(next, 'priority');
      }
      if (!sameList(state.labels, task.labels)) next = setFrontmatterList(next, 'labels', state.labels);
      if (!sameList(state.assignee, task.assignee)) next = setFrontmatterList(next, 'assignee', state.assignee);
      if (state.due !== task.due) next = state.due ? setFrontmatterField(next, 'due_date', `'${state.due}'`) : deleteFrontmatterField(next, 'due_date');
      if (!sameList(state.deps, task.deps)) next = setFrontmatterList(next, 'dependencies', state.deps);
      if (state.description !== task.description) next = setSectionText(next, 'SECTION:DESCRIPTION', 'Description', state.description, []);
      return next === content ? content : touch(next);
    });
  }

  async archiveTask(data, task) {
    if (!(await this.exists(task.path))) return;
    const folder = `${data.folder}/archive/tasks`;
    await this.ensureFolder(folder);
    await this.moveFile(task.path, normalizePath(`${folder}/${fileAt(task.path).name}`));
  }

  async promoteDraft(data, draft) {
    if (!(await this.exists(draft.path))) return;
    const fresh = await loadBacklog(this.app, this.settings);
    const number = fresh.nextTaskNumber;
    const id = `${fresh.prefix.toUpperCase()}-${number}`;
    await this.editFile(draft.path, (content) =>
      touch(setFrontmatterField(setFrontmatterField(content, 'id', id), 'status', yamlScalar(fresh.initialStatus))),
    );
    const folder = `${fresh.folder}/tasks`;
    await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/${fresh.prefix.toLowerCase()}-${number} - ${slugify(draft.title)}.md`);
    await this.moveFile(draft.path, path);
    this.selectInViews(path);
  }

  // --- Notes and links around a task --------------------------------------------------------

  notesLinkingTo(path) {
    const links = this.app.metadataCache.resolvedLinks || {};
    return Object.keys(links)
      .filter((source) => source !== path && links[source] && links[source][path])
      .sort(naturalCompare);
  }

  async createLinkedNote(task) {
    if (!(await this.exists(task.path))) return;
    const taskFile = this.app.vault.getAbstractFileByPath(task.path);
    const folder = normalizePath(String(this.settings.notesFolder || '').trim() || 'notes');
    await this.ensureFolder(folder);
    const path = await this.freePath(folder, safeFileName(task.title));
    const link =
      taskFile instanceof TFile ? this.app.fileManager.generateMarkdownLink(taskFile, path) : `[[${fileAt(task.path).basename}]]`;
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const content = ['---', `task: ${task.id}`, `created: ${day}`, '---', '', `# ${task.title}`, '', `Task: ${link}`, '', ''].join('\n');
    const note = await this.app.vault.create(path, content);
    await this.app.workspace.getLeaf('tab').openFile(note);
  }

  // --- Working with an AI ---------------------------------------------------------------------

  aiPrompt(task) {
    const current = task.ac.find((item) => !item.checked);
    let currentText;
    if (!task.ac.length) currentText = 'It has no sub-steps yet: propose them first and wait for an ok.';
    else if (current) currentText = `Current sub-step: #${current.index} ${current.text}`;
    else currentText = 'All its sub-steps are ticked: check the Definition of Done.';
    return fillTemplate(this.settings.aiPrompt || DEFAULT_PROMPT, {
      id: task.id,
      title: task.title,
      path: task.path,
      current: currentText,
      goal: plainFirstLine(task.description, 400),
    });
  }

  sendToAi(task) {
    return this.sendToAgent(this.aiPrompt(task));
  }

  // One of the buttons of the settings, for a task.
  runAction(action, task) {
    return this.sendToAgent(actionText(this.currentAgent(), action, task, this.settings.commandsFolder));
  }

  // One of the day's buttons: no task.
  runDayAction(action) {
    return this.sendToAgent(actionText(this.currentAgent(), action, null, this.settings.commandsFolder));
  }

  // The board, and the agent's panel or terminal beside it.
  async openWorkLayout() {
    await this.activateView();
    const target = TARGETS.includes(this.settings.target) ? this.settings.target : 'panel';
    if (target === 'panel') {
      await this.activateAgentView(true);
      return true;
    }
    const api = this.termy();
    if (!api) {
      new Notice(this.t('noTermy'));
      return false;
    }
    const agent = this.currentAgent();
    if (!this.terminals) this.terminals = new Map();
    const open = this.terminals.get(agent.name);
    if (open && !open.isClosed) {
      await open.focus();
      return true;
    }
    try {
      const adapter = this.app.vault.adapter;
      const cwd = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : undefined;
      const args = agent.args.filter((arg) => arg !== '{prompt}');
      this.terminals.set(agent.name, await this.besideBoard(() => api.createTerminal({ executable: agent.command, args, cwd, title: agent.name, focus: true })));
      return true;
    } catch (error) {
      console.warn('[backlog-board] the terminal could not be opened', error);
      new Notice(`${this.t('failed')}: ${error && error.message ? error.message : error}`);
      return false;
    }
  }

  agents() {
    const list = parseAgents(this.settings.agents);
    return list.length ? list : parseAgents(DEFAULT_AGENTS);
  }

  currentAgent() {
    const list = this.agents();
    return list.find((agent) => agent.name === this.settings.agent) || list[0];
  }

  // Termy's public interface, version 1, when that plugin is on.
  termy() {
    const plugins = this.app.plugins;
    const termy = plugins && typeof plugins.getPlugin === 'function' ? plugins.getPlugin(TERMY_ID) : null;
    const api = termy && termy.api;
    return api && api.version === 1 && typeof api.createTerminal === 'function' ? api : null;
  }

  // Every button that talks to the agent comes here. The text goes into the agent's panel,
  // into its terminal, into Claudian's chat, or to the clipboard, as the settings say.
  async sendToAgent(text) {
    const agent = this.currentAgent();
    const target = TARGETS.includes(this.settings.target) ? this.settings.target : 'panel';
    if (target === 'panel') {
      await this.sendToPanel(agent, text);
      return true;
    }
    // Only the terminal takes the text at once; Claudian's input and the clipboard are already a
    // place to read it before it is sent.
    if (target === 'terminal' && this.settings.askBeforeSending && !(await this.confirmSend(agent, text))) return false;
    if (target === 'terminal' && (await this.sendToTerminal(agent, text))) {
      new Notice(this.t('sentToAgent', agent.name));
      return true;
    }
    if (target === 'claudian' && (await this.sendToClaudian(text))) {
      new Notice(this.t('sentToClaude'));
      return true;
    }
    await this.copyText(text);
    new Notice(target === 'copy' ? this.t('copiedForAi') : this.t('notSentCopied'));
    return true;
  }

  confirmSend(agent, text) {
    return new Promise((resolve) => new SendModal(this.app, this, agent.name, text, resolve).open());
  }

  spawnChild() {
    if (typeof this.customSpawn === 'function') return this.customSpawn;
    return require('child_process').spawn;
  }

  agentSession(agentName) {
    if (!this.agentSessions) this.agentSessions = new Map();
    let session = this.agentSessions.get(agentName);
    if (!session) {
      session = { agentName, client: null, status: 'idle', items: [], pendingPermission: null, opening: null };
      this.agentSessions.set(agentName, session);
    }
    return session;
  }

  applyAcpUpdate(session, params) {
    const update = params && params.update;
    if (!update) return;
    if (update.sessionUpdate === 'agent_message_chunk') {
      const text = update.content && update.content.text;
      if (!text) return;
      const last = session.items[session.items.length - 1];
      if (last && last.kind === 'agent') last.text += text;
      else session.items.push({ kind: 'agent', text });
    } else if (update.sessionUpdate === 'tool_call') {
      session.items.push({
        kind: 'tool',
        id: update.toolCallId,
        title: update.title || '',
        toolKind: update.kind || 'other',
        status: update.status || 'pending',
      });
    } else if (update.sessionUpdate === 'tool_call_update') {
      const tool = session.items.find((item) => item.kind === 'tool' && item.id === update.toolCallId);
      if (tool) {
        if (update.status) tool.status = update.status;
        if (update.title) tool.title = update.title;
        if (update.kind) tool.toolKind = update.kind;
      }
    }
    this.refreshAgentViews();
  }

  requestAcpPermission(session, params) {
    const options = Array.isArray(params && params.options) ? params.options : [];
    const allowOpt = options.find((o) => o.kind === 'allow_once') || options.find((o) => o.kind !== 'allow_always' && !String(o.kind || '').startsWith('reject'));
    const rejectOpt = options.find((o) => o.kind === 'reject_once') || options.find((o) => String(o.kind || '').startsWith('reject'));
    const toolCall = (params && params.toolCall) || {};
    const title = toolCall.title || toolCall.toolCallId || this.t('agentPermLabel');
    this.notifyAgent(this.t('notifyAsks'), title);
    return new Promise((resolve) => {
      session.pendingPermission = {
        title,
        allowOptionId: allowOpt ? allowOpt.optionId : null,
        rejectOptionId: rejectOpt ? rejectOpt.optionId : null,
        resolve,
      };
      session.status = 'asking';
      this.refreshAgentViews();
    });
  }

  answerPermission(agentName, allow) {
    const session = this.agentSession(agentName);
    const pending = session.pendingPermission;
    if (!pending) return;
    session.pendingPermission = null;
    session.status = 'working';
    const optionId = allow ? pending.allowOptionId : pending.rejectOptionId;
    pending.resolve(optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' });
    this.refreshAgentViews();
  }

  cancelAgent(agentName) {
    const session = this.agentSession(agentName);
    if (session.pendingPermission) {
      const pending = session.pendingPermission;
      session.pendingPermission = null;
      pending.resolve({ outcome: 'cancelled' });
    }
    if (session.client) session.client.cancel();
    session.status = 'idle';
    this.refreshAgentViews();
  }

  resetAgentSession(agentName) {
    const session = this.agentSession(agentName);
    if (session.pendingPermission) {
      session.pendingPermission.resolve({ outcome: 'cancelled' });
      session.pendingPermission = null;
    }
    if (session.client) {
      session.client.stop();
      session.client = null;
    }
    session.opening = null;
    session.items = [];
    session.status = 'idle';
    this.refreshAgentViews();
  }

  async ensureAcpClient(agent, session) {
    if (session.client && !session.client.exited && session.client.sessionId) return session.client;
    if (session.opening) return session.opening;
    session.status = 'starting';
    this.refreshAgentViews();
    const adapter = this.app.vault.adapter;
    const cwd = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : process.cwd();
    const args = agent.args.filter((arg) => arg !== '{prompt}');
    const client = new AcpClient({
      spawn: this.spawnChild(),
      command: agent.command,
      args,
      cwd,
      env: process.env,
      onUpdate: (params) => this.applyAcpUpdate(session, params),
      onPermission: (params) => this.requestAcpPermission(session, params),
      onExit: (code, errors) => {
        if (session.client === client) {
          session.client = null;
          if (session.pendingPermission) {
            session.pendingPermission.resolve({ outcome: 'cancelled' });
            session.pendingPermission = null;
          }
          if (session.status !== 'idle') {
            session.status = 'error';
            if (errors) session.items.push({ kind: 'error', text: errors });
          }
          this.refreshAgentViews();
        }
      },
    });
    session.client = client;
    session.opening = client
      .open(cwd)
      .then(() => {
        session.opening = null;
        return client;
      })
      .catch((error) => {
        session.opening = null;
        if (session.client === client) session.client = null;
        throw error;
      });
    return session.opening;
  }

  async sendToPanel(agent, text) {
    await this.activateAgentView(true);
    const session = this.agentSession(agent.name);
    session.items.push({ kind: 'user', text });
    this.refreshAgentViews();
    try {
      const client = await this.ensureAcpClient(agent, session);
      session.status = 'working';
      this.refreshAgentViews();
      await client.prompt(text);
      session.status = 'idle';
      this.refreshAgentViews();
      this.notifyAgent(this.t('notifyDone'), agent.name);
      return true;
    } catch (error) {
      session.status = 'error';
      session.items.push({ kind: 'error', text: String((error && error.message) || error) });
      this.refreshAgentViews();
      this.notifyAgent(this.t('notifyFailed'), String((error && error.message) || error));
      return false;
    }
  }

  // A system notification, only while Obsidian is not in front: in front, the panel shows it.
  notifyAgent(title, body) {
    if (!this.settings.notifyAgent || typeof Notification === 'undefined') return;
    if (typeof document !== 'undefined' && document.hasFocus()) return;
    try {
      const vault = typeof this.app.vault.getName === 'function' ? this.app.vault.getName() : '';
      const note = new Notification(vault ? `${title} · ${vault}` : title, { body: body || '' });
      note.onclick = () => {
        if (typeof window !== 'undefined') window.focus();
        this.activateAgentView(true);
      };
    } catch (error) {
      console.warn('[backlog-board] the notification could not be shown', error);
    }
  }

  // Into the agent's terminal in Termy: typed into the one this board opened before, or a new
  // terminal that starts the agent in the vault's folder with the text as its first message.
  async sendToTerminal(agent, text) {
    const api = this.termy();
    if (!api) return false;
    if (!this.terminals) this.terminals = new Map();
    const open = this.terminals.get(agent.name);
    if (open && !open.isClosed) {
      try {
        open.write(typedText(text));
        await pause(150);
        open.write('\r');
        await open.focus();
        return true;
      } catch (error) {
        // The agent has exited: it is started again below.
      }
    }
    try {
      const adapter = this.app.vault.adapter;
      const cwd = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : undefined;
      const handle = await this.besideBoard(() =>
        api.createTerminal({ executable: agent.command, args: agentArgs(agent, text), cwd, title: agent.name, focus: true }),
      );
      this.terminals.set(agent.name, handle);
      return true;
    } catch (error) {
      console.warn('[backlog-board] the terminal could not be opened', error);
      new Notice(`${this.t('failed')}: ${error && error.message ? error.message : error}`);
      return false;
    }
  }

  // Termy opens a new terminal as a tab where the active tab is. A pane is first made beside the
  // board and made active, so the terminal opens there; the pane, still empty, is then closed.
  async besideBoard(open) {
    const workspace = this.app.workspace;
    const board = workspace.getLeavesOfType(VIEW_TYPE)[0];
    let spare = null;
    if (board && typeof workspace.createLeafBySplit === 'function') {
      spare = workspace.createLeafBySplit(board, 'vertical');
      workspace.setActiveLeaf(spare, { focus: false });
    }
    try {
      return await open();
    } finally {
      if (spare) spare.detach();
    }
  }

  // Writes the text into Claudian's chat input, to be checked and sent there.
  async sendToClaudian(text) {
    let leaf = this.app.workspace.getLeavesOfType(CLAUDIAN_VIEW)[0];
    const commands = this.app.commands;
    if (!leaf && commands && commands.commands && commands.commands[CLAUDIAN_OPEN]) {
      commands.executeCommandById(CLAUDIAN_OPEN);
      await pause(400);
      leaf = this.app.workspace.getLeavesOfType(CLAUDIAN_VIEW)[0];
    }
    if (!leaf || !leaf.view || typeof leaf.view.appendToActiveInput !== 'function') return false;
    try {
      await this.app.workspace.revealLeaf(leaf);
      if (leaf.view.appendToActiveInput(text) === false) return false;
      if (typeof leaf.view.focusActiveInput === 'function') leaf.view.focusActiveInput();
      return true;
    } catch (error) {
      console.warn('[backlog-board] Claudian did not take the text', error);
      return false;
    }
  }

  copyText(text) {
    return navigator.clipboard.writeText(text);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshViews();
  }
}

// Exposed for tests outside Obsidian; Obsidian itself only uses the default export.
BacklogBoardPlugin.helpers = {
  BoardView,
  AgentView,
  AGENT_VIEW_TYPE,
  AcpClient,
  shellWord,
  fileAt,
  listMarkdown,
  diskFingerprint,
  splitWords,
  parseAgents,
  commandText,
  agentArgs,
  typedText,
  parseActions,
  stepOf,
  actionText,
  splitWho,
  splitFrontmatter,
  readSections,
  readChecklist,
  toggleChecklistItem,
  addChecklistItem,
  editChecklistItem,
  removeChecklistItem,
  setSectionText,
  appendSectionText,
  setFrontmatterField,
  setFrontmatterList,
  deleteFrontmatterField,
  yamlScalar,
  slugify,
  safeFileName,
  nextNumber,
  buildTaskFile,
  planOrdinals,
  parseTask,
  parseMilestone,
  parseNote,
  parseNames,
  fillTemplate,
  loadBacklog,
  shortLabel,
  plainFirstLine,
  lastLines,
  timestamp,
};

module.exports = BacklogBoardPlugin;
