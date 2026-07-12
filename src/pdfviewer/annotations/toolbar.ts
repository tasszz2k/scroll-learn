import type { ToolId, ToolState } from './types';
import {
  getPdfAnnotationFontSize,
  savePdfAnnotationFontSize,
} from '../../common/storage';

const DEFAULT_STATE: ToolState = {
  activeTool: 'hand',
  color: '#dc2626',
  width: 2,
  fontSize: 16,
  fill: false,
};

interface ToolDefinition {
  label: string;
  title: string;
  icon: readonly string[];
}

const TOOL_DEFINITIONS = {
  hand: { label: 'Read', title: 'Hand and read tool', icon: ['M7 11V6a2 2 0 0 1 4 0v4', 'M11 10V4a2 2 0 0 1 4 0v6', 'M15 10V6a2 2 0 0 1 4 0v7c0 5-3 8-8 8-3 0-5-2-7-5l-2-3a2 2 0 0 1 3-3l2 2'] },
  select: { label: 'Select', title: 'Select and move annotations', icon: ['M5 3l14 8-7 2-3 7z', 'M13 13l5 5'] },
  text: { label: 'Text', title: 'Add a text box', icon: ['M5 5h14', 'M12 5v14', 'M8 19h8'] },
  highlight: { label: 'Highlight area', title: 'Highlight a rectangular area', icon: ['M4 6h16v12H4z', 'M7 15l4-6 2 3 2-2 2 5'] },
  note: { label: 'Sticky note', title: 'Add a sticky note', icon: ['M5 4h14v12l-4 4H5z', 'M15 20v-4h4'] },
  pencil: { label: 'Pencil', title: 'Draw with the pencil', icon: ['M4 20l4-1 11-11-3-3L5 16z', 'M14 7l3 3'] },
  highlighter: { label: 'Highlighter', title: 'Draw with the freehand highlighter', icon: ['M6 15l8-11 4 3-8 11z', 'M4 20h16', 'M6 15l4 3'] },
  rect: { label: 'Rectangle', title: 'Draw a rectangle', icon: ['M4 5h16v14H4z'] },
  ellipse: { label: 'Ellipse', title: 'Draw an ellipse', icon: ['M3 12a9 6 0 1 0 18 0 9 6 0 1 0-18 0'] },
  line: { label: 'Line', title: 'Draw a line', icon: ['M5 19L19 5'] },
  arrow: { label: 'Arrow', title: 'Draw an arrow', icon: ['M5 19L19 5', 'M11 5h8v8'] },
  eraser: { label: 'Eraser', title: 'Erase annotations', icon: ['M4 15l8-10 7 6-7 9H8z', 'M12 20h8'] },
} satisfies Record<ToolId, ToolDefinition>;

const TOOL_ORDER = Object.keys(TOOL_DEFINITIONS) as ToolId[];

const COLOR_TOOLS = new Set<ToolId>([
  'text',
  'highlight',
  'note',
  'pencil',
  'highlighter',
  'rect',
  'ellipse',
  'line',
  'arrow',
]);
const WIDTH_TOOLS = new Set<ToolId>([
  'pencil',
  'highlighter',
  'rect',
  'ellipse',
  'line',
  'arrow',
]);
const FILL_TOOLS = new Set<ToolId>(['rect', 'ellipse']);
const COMMON_COLORS = [
  { value: '#dc2626', label: 'Red' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#16a34a', label: 'Green' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#7c3aed', label: 'Purple' },
  { value: '#111827', label: 'Black' },
  { value: '#ffffff', label: 'White' },
] as const;

export interface AnnotationToolbarController {
  setTool(state: Readonly<ToolState>): void;
  undo(): void;
  redo(): void;
}

export interface AnnotationToolbarHandle {
  getState(): Readonly<ToolState>;
  /** Applies state to the toolbar and synchronizes the controller and subscribers. */
  setState(nextState: Partial<ToolState>): void;
  onStateChange(listener: (state: Readonly<ToolState>) => void): () => void;
  setHistoryState(canUndo: boolean, canRedo: boolean): void;
  destroy(): void;
}

const activeHandles = new WeakMap<HTMLDivElement, AnnotationToolbarHandle>();

function createButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  const labelElement = document.createElement('span');
  labelElement.textContent = label;
  button.appendChild(labelElement);
  return button;
}

function createToolIcon(paths: readonly string[]): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('ssv-toolbar-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  for (const data of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', data);
    icon.appendChild(path);
  }
  return icon;
}

function createControlGroup(labelText: string): {
  wrapper: HTMLDivElement;
  label: HTMLSpanElement;
} {
  const wrapper = document.createElement('div');
  wrapper.className = 'ssv-toolbar-control';
  const label = document.createElement('span');
  label.className = 'ssv-toolbar-control-label';
  label.textContent = labelText;
  wrapper.appendChild(label);
  return { wrapper, label };
}

export function mountAnnotationToolbar(
  controller: AnnotationToolbarController,
): AnnotationToolbarHandle {
  const root = document.querySelector<HTMLDivElement>('#ssv-toolbar');
  if (!root) {
    throw new Error('Annotation toolbar mount point #ssv-toolbar was not found');
  }

  activeHandles.get(root)?.destroy();
  const listenerController = new AbortController();

  const toolbar = document.createElement('div');
  toolbar.className = 'ssv-annotation-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'PDF annotation tools');

  const toolGroup = document.createElement('div');
  toolGroup.className = 'ssv-toolbar-tools';
  toolGroup.setAttribute('role', 'group');
  toolGroup.setAttribute('aria-label', 'Annotation tool');

  const toolButtons = new Map<ToolId, HTMLButtonElement>();
  for (const toolId of TOOL_ORDER) {
    const definition = TOOL_DEFINITIONS[toolId];
    const button = createButton(definition.label, definition.title);
    button.className = 'ssv-toolbar-tool';
    button.dataset.tool = toolId;
    button.setAttribute('aria-pressed', 'false');
    button.prepend(createToolIcon(definition.icon));
    toolButtons.set(toolId, button);
    toolGroup.appendChild(button);
  }

  const controls = document.createElement('div');
  controls.className = 'ssv-toolbar-controls';

  const colorGroup = createControlGroup('Color');
  const colorPalette = document.createElement('div');
  colorPalette.className = 'ssv-toolbar-colors';
  colorPalette.setAttribute('role', 'group');
  colorPalette.setAttribute('aria-label', 'Annotation color');
  const colorButtons = new Map<string, HTMLButtonElement>();
  for (const color of COMMON_COLORS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ssv-toolbar-color';
    button.title = color.label;
    button.setAttribute('aria-label', color.label);
    button.setAttribute('aria-pressed', 'false');
    button.style.setProperty('--ssv-swatch-color', color.value);
    colorButtons.set(color.value, button);
    colorPalette.appendChild(button);
  }
  colorGroup.wrapper.appendChild(colorPalette);

  const widthGroup = createControlGroup('Width');
  const widthInput = document.createElement('input');
  widthInput.type = 'range';
  widthInput.className = 'ssv-toolbar-width';
  widthInput.min = '1';
  widthInput.max = '24';
  widthInput.step = '1';
  widthInput.title = 'Stroke width';
  widthInput.setAttribute('aria-label', 'Stroke width');
  widthGroup.wrapper.appendChild(widthInput);

  const fontSizeGroup = createControlGroup('Font size');
  const fontSizeInput = document.createElement('input');
  fontSizeInput.type = 'number';
  fontSizeInput.className = 'ssv-toolbar-font-size';
  fontSizeInput.min = '1';
  fontSizeInput.step = '1';
  fontSizeInput.inputMode = 'numeric';
  fontSizeInput.title = 'Text font size in points';
  fontSizeInput.setAttribute('aria-label', 'Text font size in points');
  fontSizeGroup.wrapper.appendChild(fontSizeInput);

  const fillGroup = createControlGroup('Fill');
  const fillInput = document.createElement('input');
  fillInput.type = 'checkbox';
  fillInput.className = 'ssv-toolbar-fill';
  fillInput.title = 'Fill shape';
  fillInput.setAttribute('aria-label', 'Fill shape');
  fillGroup.wrapper.appendChild(fillInput);

  controls.append(
    colorGroup.wrapper,
    widthGroup.wrapper,
    fontSizeGroup.wrapper,
    fillGroup.wrapper,
  );

  const historyGroup = document.createElement('div');
  historyGroup.className = 'ssv-toolbar-history';
  historyGroup.setAttribute('role', 'group');
  historyGroup.setAttribute('aria-label', 'Annotation history');
  const undoButton = createButton('Undo', 'Undo annotation change');
  undoButton.className = 'ssv-toolbar-undo';
  undoButton.disabled = true;
  const redoButton = createButton('Redo', 'Redo annotation change');
  redoButton.className = 'ssv-toolbar-redo';
  redoButton.disabled = true;
  historyGroup.append(undoButton, redoButton);

  toolbar.append(toolGroup, controls, historyGroup);
  root.replaceChildren(toolbar);

  let state: ToolState = { ...DEFAULT_STATE };
  let destroyed = false;
  let rovingIndex = TOOL_ORDER.indexOf(state.activeTool);
  const stateListeners = new Set<(state: Readonly<ToolState>) => void>();

  function renderState(): void {
    for (const [index, toolId] of TOOL_ORDER.entries()) {
      const button = toolButtons.get(toolId);
      if (!button) continue;
      const active = state.activeTool === toolId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.tabIndex = index === rovingIndex ? 0 : -1;
    }

    for (const [color, button] of colorButtons) {
      const active = color === state.color;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    widthInput.value = String(state.width);
    fontSizeInput.value = String(state.fontSize);
    fillInput.checked = state.fill;

    const showColor = COLOR_TOOLS.has(state.activeTool);
    colorGroup.wrapper.hidden = !showColor;
    for (const button of colorButtons.values()) button.disabled = !showColor;

    const showWidth = WIDTH_TOOLS.has(state.activeTool);
    widthGroup.wrapper.hidden = !showWidth;
    widthInput.disabled = !showWidth;

    const showFontSize = state.activeTool === 'text';
    fontSizeGroup.wrapper.hidden = !showFontSize;
    fontSizeInput.disabled = !showFontSize;

    const showFill = FILL_TOOLS.has(state.activeTool);
    fillGroup.wrapper.hidden = !showFill;
    fillInput.disabled = !showFill;
  }

  function updateState(nextState: Partial<ToolState>): void {
    if (destroyed) return;

    const previousTool = state.activeTool;
    const next = { ...state, ...nextState };
    const snapshot: Readonly<ToolState> = Object.freeze({ ...next });
    try {
      controller.setTool(snapshot);
    } catch (error) {
      renderState();
      throw error;
    }

    state = next;
    if (state.activeTool !== previousTool) {
      rovingIndex = TOOL_ORDER.indexOf(state.activeTool);
    }
    renderState();
    for (const listener of stateListeners) {
      listener(snapshot);
    }
  }

  for (const [toolId, button] of toolButtons) {
    button.addEventListener('click', () => {
      updateState({ activeTool: toolId });
    }, { signal: listenerController.signal });
  }

  toolGroup.addEventListener('keydown', event => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const currentIndex = TOOL_ORDER.findIndex(toolId => toolButtons.get(toolId) === event.target);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % TOOL_ORDER.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + TOOL_ORDER.length) % TOOL_ORDER.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = TOOL_ORDER.length - 1;
        break;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    rovingIndex = nextIndex;
    renderState();
    toolButtons.get(TOOL_ORDER[nextIndex])?.focus();
  }, { signal: listenerController.signal });

  for (const [color, button] of colorButtons) {
    button.addEventListener('click', () => {
      updateState({ color });
    }, { signal: listenerController.signal });
  }
  widthInput.addEventListener('input', () => {
    updateState({ width: widthInput.valueAsNumber });
  }, { signal: listenerController.signal });
  fontSizeInput.addEventListener('change', () => {
    const fontSize = fontSizeInput.valueAsNumber;
    if (Number.isFinite(fontSize) && fontSize >= 1) {
      updateState({ fontSize });
      void savePdfAnnotationFontSize(fontSize).catch(error => {
        console.error('[ScrollLearn:pdfviewer] failed to save annotation font size:', error);
      });
    } else {
      fontSizeInput.value = String(state.fontSize);
    }
  }, { signal: listenerController.signal });
  fillInput.addEventListener('change', () => {
    updateState({ fill: fillInput.checked });
  }, { signal: listenerController.signal });
  undoButton.addEventListener('click', () => controller.undo(), {
    signal: listenerController.signal,
  });
  redoButton.addEventListener('click', () => controller.redo(), {
    signal: listenerController.signal,
  });

  const handle: AnnotationToolbarHandle = {
    getState: () => ({ ...state }),
    setState: nextState => updateState(nextState),
    onStateChange: listener => {
      if (destroyed) return () => undefined;
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    setHistoryState: (canUndo, canRedo) => {
      if (destroyed) return;
      undoButton.disabled = !canUndo;
      redoButton.disabled = !canRedo;
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      listenerController.abort();
      stateListeners.clear();
      if (activeHandles.get(root) === handle) {
        activeHandles.delete(root);
      }
      if (toolbar.parentElement === root) {
        toolbar.remove();
      }
    },
  };

  renderState();
  try {
    updateState(DEFAULT_STATE);
  } catch (error) {
    handle.destroy();
    throw error;
  }
  activeHandles.set(root, handle);
  void getPdfAnnotationFontSize().then(fontSize => {
    handle.setState({ fontSize });
  });
  return handle;
}
