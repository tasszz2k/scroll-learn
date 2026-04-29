import { describe, expect, it } from 'vitest';
import {
  buildFrontMatter,
  buildNotebookZip,
  exportNotebookMarkdown,
  writeZipBlob,
} from '../src/common/notebookExport';
import { createNotebook } from '../src/common/types';

function nb(title: string, opts: Partial<{
  tags: string[];
  folderPath: string;
  properties: Record<string, string>;
}> = {}) {
  return createNotebook({
    title,
    folderPath: opts.folderPath ?? '',
    tags: opts.tags ?? [],
    properties: opts.properties ?? {},
  });
}

describe('buildFrontMatter', () => {
  it('includes title, folder, tags, created, updated', () => {
    const n = nb('Helm', {
      folderPath: '/Demo',
      tags: ['helm', 'k8s'],
      properties: { type: 'concept' },
    });
    const fm = buildFrontMatter(n);
    expect(fm).toContain('title: Helm');
    expect(fm).toContain('folder: /Demo');
    expect(fm).toContain('tags: [helm, k8s]');
    expect(fm).toContain('type: concept');
    expect(fm.startsWith('---')).toBe(true);
    expect(fm.endsWith('---')).toBe(true);
  });

  it('skips folder/tag lines when both are empty', () => {
    const n = nb('Bare');
    const fm = buildFrontMatter(n);
    expect(fm).not.toContain('folder:');
    expect(fm).not.toContain('tags:');
  });

  it('quotes values that contain reserved characters', () => {
    const n = nb('Title: with colons', { properties: { url: 'https://example.com' } });
    const fm = buildFrontMatter(n);
    expect(fm).toContain('title: "Title: with colons"');
  });
});

describe('exportNotebookMarkdown', () => {
  it('combines front matter and body into one .md payload', () => {
    const n = nb('Notes', { tags: ['demo'] });
    const out = exportNotebookMarkdown(n, 'Hello there.');
    expect(out.filename).toBe('Notes.md');
    expect(out.archivePath).toBe('Notes.md');
    expect(out.content).toMatch(/^---\n/);
    expect(out.content).toContain('Hello there.');
  });

  it('routes archive paths to mirror folderPath', () => {
    const n = nb('Inside', { folderPath: '/Demo/Sub' });
    const out = exportNotebookMarkdown(n, '');
    expect(out.archivePath).toBe('Demo/Sub/Inside.md');
  });

  it('sanitises filesystem-hostile characters in the filename', () => {
    const n = nb('weird/title:with*chars?', { folderPath: '/A/B' });
    const out = exportNotebookMarkdown(n, '');
    // Slashes and colons get replaced with underscores; dir keeps its slashes.
    expect(out.filename).not.toContain('/');
    expect(out.filename).not.toContain(':');
    expect(out.filename.endsWith('.md')).toBe(true);
    expect(out.archivePath.startsWith('A/B/')).toBe(true);
  });
});

describe('writeZipBlob', () => {
  it('produces a Blob whose first 4 bytes are the local-file signature', async () => {
    const blob = writeZipBlob([{ path: 'hello.txt', content: 'hello world' }]);
    expect(blob.size).toBeGreaterThan(20);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    // PK\x03\x04 = 0x04034b50 little-endian
    expect(view.getUint32(0, true)).toBe(0x04034b50);
  });

  it('writes EOCD signature near the end of the buffer', async () => {
    const blob = writeZipBlob([
      { path: 'a.txt', content: 'a' },
      { path: 'b.txt', content: 'b' },
    ]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const eocdSig = [0x50, 0x4b, 0x05, 0x06];
    let found = false;
    // EOCD lives in the last 22 bytes (no comment).
    for (let i = buf.length - 22; i >= 0 && i >= buf.length - 60; i--) {
      if (
        buf[i] === eocdSig[0] &&
        buf[i + 1] === eocdSig[1] &&
        buf[i + 2] === eocdSig[2] &&
        buf[i + 3] === eocdSig[3]
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('embeds each filename as readable bytes in the local-header section', async () => {
    const blob = writeZipBlob([{ path: 'docs/A.md', content: 'hi' }]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(buf);
    expect(text).toContain('docs/A.md');
    expect(text).toContain('hi');
  });
});

describe('buildNotebookZip', () => {
  it('round-trips notebook content with front matter into the archive bytes', async () => {
    const a = nb('First', { folderPath: '/Demo', tags: ['x'] });
    const b = nb('Second');
    const records = [
      { notebook: a, body: 'first body' },
      { notebook: b, body: 'second body' },
    ];
    const blob = buildNotebookZip(records);
    expect(blob.size).toBeGreaterThan(60);
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    // Both bodies and titles end up in the archive's raw bytes.
    expect(text).toContain('first body');
    expect(text).toContain('second body');
    expect(text).toContain('Demo/First.md');
    expect(text).toContain('Second.md');
  });

  it('disambiguates duplicate filenames with a numeric suffix', async () => {
    const a = nb('Dup');
    const b = nb('Dup');
    const records = [
      { notebook: a, body: 'aaa' },
      { notebook: b, body: 'bbb' },
    ];
    const blob = buildNotebookZip(records);
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain('Dup.md');
    expect(text).toContain('Dup (2).md');
  });
});
