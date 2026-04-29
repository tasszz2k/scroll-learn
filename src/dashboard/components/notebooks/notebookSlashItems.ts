import type { Editor } from '@tiptap/core';

export interface NotebookSlashItem {
  id: string;
  label: string;
  hint?: string;
  insert: string;
  command: (editor: Editor) => void;
}

export const NOTEBOOK_SLASH_ITEMS: NotebookSlashItem[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    hint: 'Large section title',
    insert: '\n# ',
    command: (editor) => {
      editor.chain().focus().setNode('heading', { level: 1 }).run();
    },
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: 'Medium section title',
    insert: '\n## ',
    command: (editor) => {
      editor.chain().focus().setNode('heading', { level: 2 }).run();
    },
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: 'Small section title',
    insert: '\n### ',
    command: (editor) => {
      editor.chain().focus().setNode('heading', { level: 3 }).run();
    },
  },
  {
    id: 'ul',
    label: 'Bullet list',
    hint: 'Unordered list',
    insert: '\n- ',
    command: (editor) => {
      editor.chain().focus().toggleBulletList().run();
    },
  },
  {
    id: 'ol',
    label: 'Numbered list',
    hint: 'Ordered list',
    insert: '\n1. ',
    command: (editor) => {
      editor.chain().focus().toggleOrderedList().run();
    },
  },
  {
    id: 'todo',
    label: 'Checklist',
    hint: 'Tasks with checkboxes',
    insert: '\n- [ ] ',
    command: (editor) => {
      editor.chain().focus().toggleTaskList().run();
    },
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: 'Indented block',
    insert: '\n> ',
    command: (editor) => {
      editor.chain().focus().toggleBlockquote().run();
    },
  },
  {
    id: 'code',
    label: 'Code block',
    hint: 'Monospaced fenced code',
    insert: '\n```\n\n```\n',
    command: (editor) => {
      editor.chain().focus().toggleCodeBlock().run();
    },
  },
  {
    id: 'table',
    label: 'Table',
    hint: '3 columns, 2 rows',
    insert: '\n| Col 1 | Col 2 | Col 3 |\n| --- | --- | --- |\n| cell | cell | cell |\n',
    command: (editor) => {
      editor.chain().focus().insertTable({ rows: 2, cols: 3, withHeaderRow: true }).run();
    },
  },
  {
    id: 'hr',
    label: 'Divider',
    hint: 'Horizontal rule',
    insert: '\n---\n',
    command: (editor) => {
      editor.chain().focus().setHorizontalRule().run();
    },
  },
  {
    id: 'img',
    label: 'Image',
    hint: 'Insert from URL',
    insert: '![alt](https://)',
    command: (editor) => {
      const url = window.prompt('Image URL', 'https://');
      if (!url) return;
      editor.chain().focus().setImage({ src: url, alt: 'image' }).run();
    },
  },
];
