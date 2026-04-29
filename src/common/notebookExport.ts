// Notebook export helpers.
//
// Two flows:
//   - exportNotebookMarkdown(notebook, body, opts) -> { filename, content }
//     Renders a single .md file with a YAML front-matter header for
//     properties, tags, folderPath. Used by per-notebook "Export" action.
//
//   - buildNotebookZip(records) -> Promise<Blob>
//     Tar-style archive of every notebook keyed by folderPath/title.md.
//     Implemented with an in-tree, no-compression ZIP writer (STORE method)
//     so we keep zero external dependencies and the resulting archive is
//     forwarded as-is to a download anchor.

import type { Notebook } from './types';

// --- Front-matter / .md export ------------------------------------------

function escapeYamlValue(v: string): string {
  // YAML strings: anything with reserved chars or non-trivial whitespace
  // gets quoted. Inside a double-quoted string we escape backslash and
  // quote.
  if (v === '') return '""';
  if (/[:#&*!|>'"%@`,[\]{}?\n]/.test(v) || /^\s|\s$/.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return v;
}

export interface ExportedMarkdown {
  filename: string;        // e.g. 'My Notebook.md'
  // Path inside the zip archive ("My Folder/My Notebook.md"). Intentionally
  // lossless: when notebook.folderPath is '/Demo/Sub', the path becomes
  // 'Demo/Sub/My Notebook.md'.
  archivePath: string;
  content: string;
}

function sanitizeFilename(s: string): string {
  // Strip filesystem-hostile characters but keep readable spaces and dashes.
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Untitled';
}

function folderPathToArchive(folderPath: string): string {
  if (!folderPath) return '';
  // '/Demo/Sub' -> 'Demo/Sub'
  return folderPath.replace(/^\//, '');
}

export function buildFrontMatter(notebook: Notebook): string {
  const lines: string[] = ['---'];
  if (notebook.title) lines.push(`title: ${escapeYamlValue(notebook.title)}`);
  if (notebook.folderPath) lines.push(`folder: ${escapeYamlValue(notebook.folderPath)}`);
  if (notebook.tags.length > 0) {
    lines.push(`tags: [${notebook.tags.map(t => escapeYamlValue(t)).join(', ')}]`);
  }
  lines.push(`created: ${new Date(notebook.createdAt).toISOString()}`);
  lines.push(`updated: ${new Date(notebook.updatedAt).toISOString()}`);
  // Custom k/v rows go last so the system fields stay readable at the top.
  for (const [k, v] of Object.entries(notebook.properties)) {
    lines.push(`${escapeYamlValue(k)}: ${escapeYamlValue(v)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

export function exportNotebookMarkdown(
  notebook: Notebook,
  body: string,
): ExportedMarkdown {
  const filename = `${sanitizeFilename(notebook.title)}.md`;
  const archiveDir = folderPathToArchive(notebook.folderPath);
  const archivePath = archiveDir ? `${archiveDir}/${filename}` : filename;
  const frontMatter = buildFrontMatter(notebook);
  const content = `${frontMatter}\n\n${body.endsWith('\n') ? body : body + '\n'}`;
  return { filename, archivePath, content };
}

// --- ZIP writer (STORE method, no compression) -------------------------

// A ZIP archive is a sequence of "local file headers" each followed by file
// data, then a "central directory" listing every file, then an "end of
// central directory" record. The STORE method (compression = 0) lets us
// skip deflate; the file bytes are written verbatim. Tradeoff: the archive
// is larger than zip-with-deflate would be, but we save the deflate
// dependency and CPU. Suits markdown exports (text compresses well in
// practice but most exports are small enough that the size doesn't matter).

const SIG_LOCAL = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;

// CRC-32 (IEEE 802.3 polynomial 0xEDB88320). Required by the ZIP spec.
let crcTable: Uint32Array | null = null;
function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}
function crc32(bytes: Uint8Array): number {
  if (!crcTable) crcTable = buildCrcTable();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeUint16LE(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}
function writeUint32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

export function writeZipBlob(entries: { path: string; content: string | Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const records: Array<{
    nameBytes: Uint8Array;
    bytes: Uint8Array;
    crc: number;
    localOffset: number;
  }> = [];

  // Collect parts so we can compute total size up-front (a single Blob).
  const localParts: Uint8Array[] = [];
  let cursor = 0;
  for (const e of entries) {
    const bytes = typeof e.content === 'string' ? enc.encode(e.content) : e.content;
    const nameBytes = enc.encode(e.path);
    const crc = crc32(bytes);
    const localOffset = cursor;
    // Local file header (30 bytes) + name + data.
    const header = new ArrayBuffer(30);
    const view = new DataView(header);
    writeUint32LE(view, 0, SIG_LOCAL);
    writeUint16LE(view, 4, 20);              // version needed
    writeUint16LE(view, 6, 0);               // gp flag
    writeUint16LE(view, 8, 0);               // method = STORE
    writeUint16LE(view, 10, 0);              // mod time
    writeUint16LE(view, 12, 0);              // mod date
    writeUint32LE(view, 14, crc);
    writeUint32LE(view, 18, bytes.length);   // compressed size
    writeUint32LE(view, 22, bytes.length);   // uncompressed size
    writeUint16LE(view, 26, nameBytes.length);
    writeUint16LE(view, 28, 0);              // extra field length
    localParts.push(new Uint8Array(header));
    localParts.push(nameBytes);
    localParts.push(bytes);
    cursor += 30 + nameBytes.length + bytes.length;
    records.push({ nameBytes, bytes, crc, localOffset });
  }

  const cdStart = cursor;
  const cdParts: Uint8Array[] = [];
  for (const r of records) {
    const cd = new ArrayBuffer(46);
    const view = new DataView(cd);
    writeUint32LE(view, 0, SIG_CD);
    writeUint16LE(view, 4, 20);              // version made by
    writeUint16LE(view, 6, 20);              // version needed
    writeUint16LE(view, 8, 0);               // gp flag
    writeUint16LE(view, 10, 0);              // method
    writeUint16LE(view, 12, 0);              // mod time
    writeUint16LE(view, 14, 0);              // mod date
    writeUint32LE(view, 16, r.crc);
    writeUint32LE(view, 20, r.bytes.length);
    writeUint32LE(view, 24, r.bytes.length);
    writeUint16LE(view, 28, r.nameBytes.length);
    writeUint16LE(view, 30, 0);              // extra
    writeUint16LE(view, 32, 0);              // comment
    writeUint16LE(view, 34, 0);              // disk #
    writeUint16LE(view, 36, 0);              // internal attrs
    writeUint32LE(view, 38, 0);              // external attrs
    writeUint32LE(view, 42, r.localOffset);
    cdParts.push(new Uint8Array(cd));
    cdParts.push(r.nameBytes);
    cursor += 46 + r.nameBytes.length;
  }
  const cdSize = cursor - cdStart;

  // EOCD (22 bytes).
  const eocd = new ArrayBuffer(22);
  const eocdView = new DataView(eocd);
  writeUint32LE(eocdView, 0, SIG_EOCD);
  writeUint16LE(eocdView, 4, 0);              // disk #
  writeUint16LE(eocdView, 6, 0);              // disk where CD starts
  writeUint16LE(eocdView, 8, records.length); // entries on this disk
  writeUint16LE(eocdView, 10, records.length);// total entries
  writeUint32LE(eocdView, 12, cdSize);
  writeUint32LE(eocdView, 16, cdStart);
  writeUint16LE(eocdView, 20, 0);             // comment length

  // Cast through ArrayBuffer to satisfy lib.dom.d.ts (BlobPart wants
  // ArrayBufferView<ArrayBuffer>, not <ArrayBufferLike>).
  const allParts = [...localParts, ...cdParts, new Uint8Array(eocd)].map(
    chunk => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
  );
  return new Blob(allParts, { type: 'application/zip' });
}

// Convenience: build a zip from notebook + body records. Produces an
// archive with file paths mirroring folderPath.
export function buildNotebookZip(
  records: Array<{ notebook: Notebook; body: string }>,
): Blob {
  const entries = records.map(({ notebook, body }) => {
    const exported = exportNotebookMarkdown(notebook, body);
    return { path: exported.archivePath, content: exported.content };
  });
  // Disambiguate filename collisions ("Untitled.md" twice) by appending
  // " (2).md", " (3).md", etc.
  const seen = new Map<string, number>();
  const dedupedEntries = entries.map(e => {
    const count = seen.get(e.path) ?? 0;
    seen.set(e.path, count + 1);
    if (count === 0) return e;
    const dot = e.path.lastIndexOf('.');
    const base = dot >= 0 ? e.path.slice(0, dot) : e.path;
    const ext = dot >= 0 ? e.path.slice(dot) : '';
    return { ...e, path: `${base} (${count + 1})${ext}` };
  });
  return writeZipBlob(dedupedEntries);
}

// Trigger a browser download for the given Blob. Caller-friendly wrapper.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke a tick so Chrome has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
