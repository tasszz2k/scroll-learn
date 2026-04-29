// Starter templates for the "+ New from template" flow.
//
// We ship a small, learning-focused bundle on purpose: a Blank baseline
// plus four authoring frames that map to the most common learner moments
// (capturing a day, a concept, a book/article, or a lecture). Adding more
// is cheap -- append a new entry to TEMPLATES and the picker will list
// it automatically.
//
// Token interpolation:
//   {{date}}      -> ISO date (YYYY-MM-DD) at instantiation time.
//   {{datetime}}  -> ISO local timestamp (YYYY-MM-DD HH:mm).
//
// Properties are merged onto the new notebook's `properties` map; tags
// are appended (deduped); folderPath defaults to '' (root) unless the
// template specifies one.

export interface NotebookTemplate {
  id: string;
  name: string;
  description: string;
  defaultTitle: string;        // may include {{date}} or {{datetime}}
  defaultTags: string[];
  defaultFolderPath?: string;
  properties: Record<string, string>;
  body: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export interface TemplateInterpolation {
  date: string;
  datetime: string;
}

export function defaultInterpolation(now: Date = new Date()): TemplateInterpolation {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const datetime = `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return { date, datetime };
}

export function interpolate(template: string, vars: TemplateInterpolation): string {
  return template
    .replace(/\{\{date\}\}/g, vars.date)
    .replace(/\{\{datetime\}\}/g, vars.datetime);
}

export interface InstantiatedTemplate {
  title: string;
  tags: string[];
  folderPath: string;
  properties: Record<string, string>;
  body: string;
}

export function instantiateTemplate(
  template: NotebookTemplate,
  now: Date = new Date(),
): InstantiatedTemplate {
  const vars = defaultInterpolation(now);
  return {
    title: interpolate(template.defaultTitle, vars),
    tags: [...template.defaultTags],
    folderPath: template.defaultFolderPath ?? '',
    properties: Object.fromEntries(
      Object.entries(template.properties).map(([k, v]) => [k, interpolate(v, vars)]),
    ),
    body: interpolate(template.body, vars),
  };
}

export const TEMPLATES: NotebookTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Empty page. No properties, no scaffolding.',
    defaultTitle: 'Untitled',
    defaultTags: [],
    properties: {},
    body: '',
  },
  {
    id: 'daily-log',
    name: 'Daily learning log',
    description: 'A daily journal frame for what you studied, what to remember, and what to revisit.',
    defaultTitle: 'Learning - {{date}}',
    defaultTags: ['daily', 'log'],
    properties: { type: 'daily', date: '{{date}}' },
    body: [
      '# Learning - {{date}}',
      '',
      '## What I studied today',
      '',
      '- ',
      '',
      '## Things I want to remember',
      '',
      '- ',
      '',
      '## Open questions',
      '',
      '- ',
      '',
      '## Tomorrow',
      '',
      '- ',
      '',
    ].join('\n'),
  },
  {
    id: 'concept',
    name: 'Concept note',
    description: 'Capture a single concept: term, plain-English definition, examples, related ideas.',
    defaultTitle: 'Concept - new term',
    defaultTags: ['concept'],
    properties: { type: 'concept' },
    body: [
      '# Term',
      '',
      '_one-line summary_',
      '',
      '## Plain-English definition',
      '',
      '',
      '## Why it matters',
      '',
      '',
      '## Examples',
      '',
      '- ',
      '',
      '## Common pitfalls',
      '',
      '- ',
      '',
      '## Related',
      '',
      '- ',
      '',
    ].join('\n'),
  },
  {
    id: 'book-article',
    name: 'Book or article note',
    description: 'Reading frame: why you are reading, key takeaways, quotes, and follow-up actions.',
    defaultTitle: 'Reading - title',
    defaultTags: ['reading'],
    properties: { type: 'book', author: '', source: '' },
    body: [
      '# Title',
      '',
      '## Why I am reading this',
      '',
      '',
      '## Key takeaways',
      '',
      '- ',
      '',
      '## Quotes',
      '',
      '> ',
      '',
      '## Action items',
      '',
      '- [ ] ',
      '',
    ].join('\n'),
  },
  {
    id: 'lecture',
    name: 'Lecture or talk note',
    description: 'Live-note structure for a class, talk, or video: topic, key concepts, live notes, follow-up questions.',
    defaultTitle: 'Lecture - {{date}}',
    defaultTags: ['lecture'],
    properties: { type: 'lecture', speaker: '', date: '{{date}}' },
    body: [
      '# Lecture - {{date}}',
      '',
      '## Topic',
      '',
      '',
      '## Key concepts',
      '',
      '- ',
      '',
      '## Live notes',
      '',
      '',
      '## Questions for after',
      '',
      '- ',
      '',
    ].join('\n'),
  },
];

export function findTemplate(id: string): NotebookTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}
