import { describe, expect, it } from 'vitest';
import {
  TEMPLATES,
  defaultInterpolation,
  findTemplate,
  instantiateTemplate,
  interpolate,
} from '../src/common/notebookTemplates';

describe('notebookTemplates registry', () => {
  it('ships exactly 5 starter templates', () => {
    expect(TEMPLATES).toHaveLength(5);
  });

  it('always includes a Blank entry', () => {
    expect(findTemplate('blank')).toBeDefined();
    expect(findTemplate('blank')?.body).toBe('');
  });

  it('exposes 4 learning-flavoured templates beyond blank', () => {
    const ids = TEMPLATES.map(t => t.id).sort();
    expect(ids).toEqual(['blank', 'book-article', 'concept', 'daily-log', 'lecture']);
  });

  it('every template has a non-empty name + description and stable id', () => {
    for (const t of TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(typeof t.body).toBe('string');
    }
  });
});

describe('interpolate', () => {
  const vars = { date: '2026-04-29', datetime: '2026-04-29 10:30' };

  it('replaces {{date}} placeholders', () => {
    expect(interpolate('Hi {{date}}', vars)).toBe('Hi 2026-04-29');
  });

  it('replaces {{datetime}} placeholders', () => {
    expect(interpolate('At {{datetime}}', vars)).toBe('At 2026-04-29 10:30');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(interpolate('Hi {{user}}', vars)).toBe('Hi {{user}}');
  });

  it('handles multiple occurrences', () => {
    expect(interpolate('{{date}} - {{date}}', vars)).toBe('2026-04-29 - 2026-04-29');
  });
});

describe('defaultInterpolation', () => {
  it('formats date as YYYY-MM-DD', () => {
    const vars = defaultInterpolation(new Date(2026, 0, 5, 9, 4)); // Jan 5
    expect(vars.date).toBe('2026-01-05');
    expect(vars.datetime).toBe('2026-01-05 09:04');
  });
});

describe('instantiateTemplate', () => {
  it('expands {{date}} in title, properties, and body for the daily log', () => {
    const t = findTemplate('daily-log')!;
    const inst = instantiateTemplate(t, new Date(2026, 3, 29, 22, 0)); // Apr 29
    expect(inst.title).toBe('Learning - 2026-04-29');
    expect(inst.properties.date).toBe('2026-04-29');
    expect(inst.body).toContain('# Learning - 2026-04-29');
    expect(inst.body).toContain('## What I studied today');
  });

  it('returns an independent tags array (mutating result does not corrupt the registry)', () => {
    const t = findTemplate('lecture')!;
    const before = [...t.defaultTags];
    const inst = instantiateTemplate(t);
    inst.tags.push('extra');
    expect(t.defaultTags).toEqual(before);
  });

  it('blank template instantiates to an empty body and the canonical Untitled title', () => {
    const t = findTemplate('blank')!;
    const inst = instantiateTemplate(t);
    expect(inst.body).toBe('');
    expect(inst.title).toBe('Untitled');
    expect(inst.tags).toEqual([]);
    expect(inst.properties).toEqual({});
  });

  it('book-article template scaffolds the standard four sections', () => {
    const t = findTemplate('book-article')!;
    const inst = instantiateTemplate(t);
    for (const section of ['## Why I am reading this', '## Key takeaways', '## Quotes', '## Action items']) {
      expect(inst.body).toContain(section);
    }
  });
});
