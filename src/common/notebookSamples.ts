// Sample notebooks seeded once on first install.
//
// Templates ship empty scaffolding. Samples ship _filled_ notebooks so a
// new user can immediately see what authored content looks like and how
// folders, tags, properties, tables, code blocks, and checklists render.
//
// Theme: English-learning, biased toward DevOps standup/code-review
// vocabulary, because that is the user this extension is built for.
//
// Token interpolation matches notebookTemplates.ts: {{date}} and
// {{datetime}} are resolved at seed time so the daily-log sample lands
// dated to "today".
//
// Seeding is one-shot. The flag STORAGE_KEYS.NOTEBOOKS_SEEDED is set on
// the first run and never cleared, so deleting the samples does not
// resurrect them.

import type { Notebook } from './types';
import { createNotebook } from './types';
import { defaultInterpolation, interpolate } from './notebookTemplates';

export interface NotebookSample {
  // Stable id so tests can refer to a specific sample without hardcoding
  // titles. Not stored anywhere; the seeded notebook's runtime id is a
  // fresh generateId() call.
  id: string;
  title: string;
  folderPath: string;
  tags: string[];
  properties: Record<string, string>;
  body: string;
}

const WELCOME_BODY = [
  '# Welcome to Notebooks',
  '',
  'A quiet place to write your own learning notes, organized in folders, autosaved locally, and searchable from anywhere in the app.',
  '',
  '## What this is for',
  '',
  'Notebooks are for **long-form writing** that you craft yourself: a daily log, a grammar concept, a vocabulary table, a book summary. If you want to *capture* a snippet from the web for later quizzing, that is what the **Bookmarks** tab is for.',
  '',
  '## How writing works here',
  '',
  'You do not need to know markdown. The editor is **rich text** by default - what you see is what you get, like Notion or Obsidian live preview. Three view modes sit at the top:',
  '',
  '- **Format** is the default. Type, click toolbar buttons, or press `/` on an empty line for the quick-insert menu.',
  '- **Read** is a read-only rendered view. Nothing to click, nothing to break.',
  '- **Markdown** shows the raw source for power users who prefer typing markdown directly.',
  '',
  'Under the hood every notebook is stored as plain markdown, so your notes stay portable. Switch to **Markdown** any time you want to peek at the source.',
  '',
  '## What you can do here',
  '',
  '- Write with rich formatting from the toolbar (bold, italic, headings, lists, links, ...)',
  '- Press `/` on a new line for the quick-insert menu (heading, list, table, code block, image, divider)',
  '- Organize notes into folders by dragging them in the tree on the left',
  '- Add `tags` and custom **properties** (like `type`, `author`, `source`) at the top of every notebook',
  '- Paste images directly from the clipboard - they save into local IndexedDB and stay private',
  '- Search across every notebook with `Cmd/Ctrl + Shift + F`',
  '- Open any notebook by name with `Cmd/Ctrl + P`',
  '- Generate a quiz from a notebook through the AI menu',
  '',
  '## Keyboard shortcuts that always work',
  '',
  'You do not have to use any of these - the toolbar covers everything - but a few speed up everyday writing:',
  '',
  '| Action            | Shortcut             |',
  '|-------------------|----------------------|',
  '| Bold              | Cmd/Ctrl + B         |',
  '| Italic            | Cmd/Ctrl + I         |',
  '| Save now          | Cmd/Ctrl + S         |',
  '| Quick open        | Cmd/Ctrl + P         |',
  '| Full-text search  | Cmd/Ctrl + Shift + F |',
  '',
  'Everything else - lists, tables, code blocks, links, images, dividers - is one click on the toolbar or one slash command away.',
  '',
  '## Try it: a small task list',
  '',
  '- [x] Open the Notebooks tab',
  '- [x] Read this welcome page',
  '- [ ] Click anywhere in this list and press `Tab` to indent a sub-task',
  '- [ ] Press `/` on the next empty line and pick "Table" from the menu',
  '- [ ] Open another sample notebook from the tree on the left',
  '- [ ] Create your first notebook with `+ Notebook`',
  '',
  '## Code blocks for things you want to keep exact',
  '',
  'Format mode renders fenced code in monospace and preserves indentation, so kubectl commands, regex, and snippets stay legible:',
  '',
  '```bash',
  'kubectl get pods -n production --field-selector=status.phase=Running',
  '```',
  '',
  '## Quotes for things to remember',
  '',
  '> The best time to write was yesterday. The second-best time is now.',
  '',
  '---',
  '',
  'That is the tour. Open `English learning plan` next to see how a study schedule looks in here, or jump to `Daily learning log` to see what a daily entry looks like.',
  '',
  'If you ever want to bring these samples back, use the `...` menu next to `+ Notebook` and pick **Restore samples**.',
  '',
].join('\n');

const PLAN_BODY = [
  '# English learning plan',
  '',
  'A four-week sprint to feel comfortable speaking English in standups, code reviews, and incident calls.',
  '',
  '## Why this matters',
  '',
  'Most of my technical knowledge is locked behind hesitation, not vocabulary. Practising on a fixed schedule, even in short sessions, beats sporadic deep-dives.',
  '',
  '## Weekly plan',
  '',
  '| Week | Focus                              | Daily routine (20 min)                              |',
  '|------|------------------------------------|-----------------------------------------------------|',
  '| 1    | Standup phrases and numbers        | 5 min listen, 10 min shadow, 5 min self-recording   |',
  '| 2    | Code-review vocabulary             | 5 min reading, 10 min writing, 5 min speak-aloud    |',
  '| 3    | Incident-call phrasing             | 5 min listen, 10 min role-play, 5 min review        |',
  '| 4    | Mock interview and retro           | 15 min mock interview, 5 min retro notes here       |',
  '',
  '## Materials',
  '',
  '- BBC Learning English podcast - **6 Minute English**',
  '- ScrollLearn shadowing tab for short scripts',
  '- One notebook per week in `Daily Logs` to record what stuck',
  '',
  '## Habits to keep',
  '',
  '- [ ] Write at least one entry per day in `Daily Logs`',
  '- [ ] Add 3 new phrasal verbs to `Vocabulary` per week',
  '- [ ] Re-read this plan every Monday',
  '',
  '## Notes for myself',
  '',
  '> Speaking practice without recording is just talking to yourself. Always record, always re-listen.',
  '',
].join('\n');

const PHRASAL_VERBS_BODY = [
  '# Phrasal verbs for standups',
  '',
  'A tight list of phrasal verbs that come up in daily standups, code reviews, and incident calls. Each row has a plain-English meaning, an example, and a Vietnamese gloss.',
  '',
  '## Vocabulary',
  '',
  '| Phrasal verb | Meaning                          | Example                                                       | tiếng Việt              |',
  '|--------------|----------------------------------|---------------------------------------------------------------|-------------------------|',
  '| pick up      | resume, continue from            | "I will pick up the deploy task after the meeting."           | tiếp tục, đảm nhiệm     |',
  '| roll out     | release to production            | "We rolled out the new helm chart to staging last night."     | triển khai              |',
  '| roll back    | revert a change                  | "Let us roll back the last commit; the canary is failing."    | hoàn tác, quay lại      |',
  '| bring up     | mention a topic                  | "I want to bring up the AKV rotation issue."                  | đề cập, nêu ra          |',
  '| run into     | encounter unexpectedly           | "I ran into a permissions error on the GHEC runner."          | gặp phải                |',
  '| look into    | investigate                      | "I will look into the flaky test before EOD."                 | xem xét, điều tra       |',
  '| sign off     | give final approval              | "Could you sign off on this PR before lunch?"                 | duyệt, chấp thuận       |',
  '| catch up     | learn what was missed            | "Let me catch up on yesterday\'s incident summary first."      | bắt kịp, cập nhật       |',
  '| fall behind  | lag behind a schedule            | "We are falling behind on the migration; need to reprioritise." | tụt lại, chậm tiến độ |',
  '| set up       | configure, prepare               | "I set up the kustomize overlays this morning."               | thiết lập, cài đặt      |',
  '',
  '## How I practise these',
  '',
  '1. Pick **two** phrasal verbs each morning.',
  '2. Write one sentence about real work using each.',
  '3. Say each sentence out loud three times before standup.',
  '4. Mark with `- [x]` once I have used it in a real meeting.',
  '',
  '## Today\'s targets',
  '',
  '- [ ] **roll back** - mention rolling back the failed deploy',
  '- [ ] **look into** - offer to look into the flaky CI job',
  '',
  '## Related',
  '',
  '- See `Present perfect vs past simple` for the tense to use when reporting yesterday\'s work.',
  '- Add new entries to this table whenever a teammate uses a phrasal verb I had to translate in my head.',
  '',
].join('\n');

const GRAMMAR_BODY = [
  '# Present perfect vs past simple',
  '',
  'A common stumble in standup updates. The wrong tense changes the meaning - it does not just sound off, it can mislead the team about whether work is finished.',
  '',
  '## Plain-English definition',
  '',
  '- **Past simple** describes a finished action at a specific finished time. *"I deployed the chart yesterday."*',
  '- **Present perfect** links a past action to the present. The result still matters now. *"I have deployed the chart."* (it is deployed right now)',
  '',
  '## Why it matters in standup',
  '',
  '> "I deployed the new ingress" tells the team it is done.',
  '>',
  '> "I have been deploying the new ingress" tells them it is still in progress.',
  '',
  'If I use the wrong one, the lead may pull the wrong follow-up task.',
  '',
  '## Quick rules',
  '',
  '| Use this           | When                                                | Standup example                                            |',
  '|--------------------|-----------------------------------------------------|------------------------------------------------------------|',
  '| Past simple        | Finished action with a specific finished time       | "I merged the PR yesterday."                               |',
  '| Present perfect    | Finished action without a specific time, result now | "I have merged the PR." (so it is in main now)             |',
  '| Present perfect continuous | Started in past, still going                | "I have been investigating the alert since 9am."           |',
  '',
  '## Common pitfalls',
  '',
  '- Mixing **yesterday** with present perfect: avoid "I have merged it yesterday" - use "I merged it yesterday."',
  '- Using past simple for ongoing work: avoid "I investigated since 9am" - use "I have been investigating since 9am."',
  '- Skipping the auxiliary verb: avoid "I rolled back the chart, not finished yet" - use "I have rolled back the chart, but it is not finished yet."',
  '',
  '## Examples copied from real standups',
  '',
  '- "I have **picked up** the PR review from yesterday." (still in progress)',
  '- "I **rolled back** the deploy at 11pm." (specific finished time)',
  '- "I have **been looking into** the AKV issue." (ongoing investigation)',
  '- "I **caught up** on the incident notes this morning." (specific finished time)',
  '',
  '## Mini drill',
  '',
  'Convert each into the right tense:',
  '',
  '1. *I (deploy) the chart at 14:00 yesterday.*',
  '2. *I (look into) the flaky test for two hours now.*',
  '3. *We (sign off) on the PR last sprint.*',
  '4. *I (not finish) the migration yet.*',
  '',
  '> Write the answers below before checking. Self-correction sticks better than reading.',
  '',
].join('\n');

const DAILY_LOG_BODY = [
  '# Learning - {{date}}',
  '',
  '## What I studied today',
  '',
  '- 6 Minute English: **"How to give feedback at work"** (~6 min, fast British speakers)',
  '- Re-read `Present perfect vs past simple`',
  '- Drilled four phrasal verbs: *roll out*, *roll back*, *look into*, *sign off*',
  '',
  '## Things I want to remember',
  '',
  '- "I have been investigating" beats "I investigated" when the work is **still happening**.',
  '- *Roll out* is for a **release**; *roll back* is for a **revert**. Easy to flip in a hurry.',
  '- Native speakers say "could you" far more than "can you" in code-review comments. Softer, less direct.',
  '',
  '## Open questions',
  '',
  '- When is *whilst* used vs *while*? Sounds British in podcasts but I never write it.',
  '- Why is "I am good" acceptable but "I am well" sounds stiff? Both are grammatically correct.',
  '',
  '## Tomorrow',
  '',
  '- [ ] Watch one short on tense usage',
  '- [ ] Add 2 more phrasal verbs to `Phrasal verbs for standups`',
  '- [ ] Use **"I have rolled back"** at least once in standup',
  '',
].join('\n');

export const SAMPLE_NOTEBOOKS: NotebookSample[] = [
  {
    id: 'welcome',
    title: 'Welcome to Notebooks',
    folderPath: '',
    tags: ['welcome', 'tour', 'getting-started'],
    properties: { type: 'guide', created: '{{date}}' },
    body: WELCOME_BODY,
  },
  {
    id: 'learning-plan',
    title: 'English learning plan',
    folderPath: '/English Learning',
    tags: ['plan', 'english'],
    properties: { type: 'plan', goal: 'Speak confidently in standups' },
    body: PLAN_BODY,
  },
  {
    id: 'phrasal-verbs',
    title: 'Phrasal verbs for standups',
    folderPath: '/English Learning/Vocabulary',
    tags: ['vocabulary', 'phrasal-verbs', 'standup'],
    properties: { type: 'vocab' },
    body: PHRASAL_VERBS_BODY,
  },
  {
    id: 'present-perfect',
    title: 'Present perfect vs past simple',
    folderPath: '/English Learning/Grammar',
    tags: ['grammar', 'tense'],
    properties: { type: 'concept' },
    body: GRAMMAR_BODY,
  },
  {
    id: 'daily-log',
    title: 'Learning - {{date}}',
    folderPath: '/English Learning/Daily Logs',
    tags: ['daily', 'log'],
    properties: { type: 'daily', date: '{{date}}' },
    body: DAILY_LOG_BODY,
  },
];

export interface InstantiatedSample {
  metadata: Notebook;
  body: string;
}

// Resolve {{date}} / {{datetime}} placeholders in title, properties, and
// body, then mint a fresh metadata record. The body is returned alongside
// because the caller has to write it to IndexedDB; samples deliberately do
// not couple to the persistence layer here.
export function instantiateSample(
  sample: NotebookSample,
  now: Date = new Date(),
): InstantiatedSample {
  const vars = defaultInterpolation(now);
  const metadata = createNotebook({
    title: interpolate(sample.title, vars),
    folderPath: sample.folderPath,
    tags: [...sample.tags],
    properties: Object.fromEntries(
      Object.entries(sample.properties).map(([k, v]) => [k, interpolate(v, vars)]),
    ),
  });
  return {
    metadata,
    body: interpolate(sample.body, vars),
  };
}

// ----------------------------------------------------------------- seeding

export interface SampleSeedDeps {
  // True if the one-shot seed has already run for this install. Backed by
  // STORAGE_KEYS.NOTEBOOKS_SEEDED in chrome.storage.local in production;
  // tests inject an in-memory implementation.
  isSeeded(): Promise<boolean>;
  // Mark the seed as done. Called even when we skip the seed because the
  // user already has notebooks - we never want to retry on later loads.
  markSeeded(): Promise<void>;
  // Used to detect "existing user with their own notebooks" so we never
  // pollute their tree with samples after the fact.
  listNotebooks(): Promise<Notebook[]>;
  // Persist metadata. The dashboard wires this to the save_notebook
  // message channel so the same flow as user-driven creates runs.
  saveNotebook(notebook: Notebook): Promise<Notebook>;
  // Persist the body to IndexedDB via notebookStore.saveBody.
  saveBody(notebookId: string, markdown: string): Promise<void>;
}

export type SampleSeedReason =
  | 'fresh-install'
  | 'already-seeded'
  | 'has-existing-notebooks';

export interface SampleSeedOutcome {
  seeded: number;
  reason: SampleSeedReason;
}

// Seed the sample notebooks once. Idempotent - safe to call on every
// dashboard mount. The order matters: write the body first so the editor
// never opens to an empty pane, then the metadata so the FolderTree
// renders the entry.
export async function seedSampleNotebooks(
  deps: SampleSeedDeps,
  now: Date = new Date(),
): Promise<SampleSeedOutcome> {
  if (await deps.isSeeded()) {
    return { seeded: 0, reason: 'already-seeded' };
  }
  const existing = await deps.listNotebooks();
  if (existing.length > 0) {
    // Existing user upgraded into the samples release. Skip but still
    // mark seeded so we never trickle samples onto their workspace.
    await deps.markSeeded();
    return { seeded: 0, reason: 'has-existing-notebooks' };
  }

  let seeded = 0;
  for (const sample of SAMPLE_NOTEBOOKS) {
    const inst = instantiateSample(sample, now);
    await deps.saveBody(inst.metadata.id, inst.body);
    await deps.saveNotebook(inst.metadata);
    seeded++;
  }
  await deps.markSeeded();
  return { seeded, reason: 'fresh-install' };
}

// ----------------------------------------------------------- manual restore

export interface RestoreSamplesOutcome {
  // Number of samples actually written.
  added: number;
  // Number of samples skipped because a notebook with the same folder+title
  // already existed (post-interpolation, case-insensitive). Re-running the
  // restore is a no-op once the full set is in place.
  skippedCollisions: number;
}

function collisionKey(folderPath: string, title: string): string {
  return `${folderPath}::${title.trim().toLowerCase()}`;
}

// Manual "Restore samples" path triggered from the FolderTree menu.
//
// Differs from seedSampleNotebooks() in three ways:
//   1. It ignores both gates (the seed flag and the existing-notebooks
//      check). The user explicitly asked for the samples; honour that.
//   2. It de-dupes against the user's current tree by (folderPath, title)
//      so re-running never spawns duplicates of an already-restored
//      sample.
//   3. It still flips the seeded flag so the auto-seed never runs
//      afterwards (no "phantom second seed" on the next install reload).
export async function restoreSampleNotebooks(
  deps: SampleSeedDeps,
  now: Date = new Date(),
): Promise<RestoreSamplesOutcome> {
  const existing = await deps.listNotebooks();
  const existingKey = new Set(existing.map(nb => collisionKey(nb.folderPath, nb.title)));

  let added = 0;
  let skippedCollisions = 0;

  for (const sample of SAMPLE_NOTEBOOKS) {
    const inst = instantiateSample(sample, now);
    const key = collisionKey(inst.metadata.folderPath, inst.metadata.title);
    if (existingKey.has(key)) {
      skippedCollisions++;
      continue;
    }
    await deps.saveBody(inst.metadata.id, inst.body);
    await deps.saveNotebook(inst.metadata);
    existingKey.add(key);
    added++;
  }

  await deps.markSeeded();
  return { added, skippedCollisions };
}
