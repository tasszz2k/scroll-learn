import {
  getAnnotationOverlayRoots,
  getRenderedAnnotationElement,
  setInteractive,
  type PageLayerRefs,
} from './layer';
import type {
  Annotation,
  AnnotationPoint,
  AnnotationRect,
  InkAnnotation,
  NoteAnnotation,
  TextAnnotation,
  ToolId,
  ToolState,
} from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_DRAG_DISTANCE = 0.5;
const HANDLE_RADIUS = 4;
const NOTE_SIZE = 18;
const GEOMETRY_EPSILON = 1e-6;

export type AnnotationMutation =
  | { type: 'create'; after: Annotation }
  | { type: 'update'; before: Annotation; after: Annotation }
  | { type: 'delete'; before: Annotation };

/**
 * The sink must synchronously update the controller's in-memory annotation source before
 * returning. Persistence behind that source may continue asynchronously.
 */
export type AnnotationCommandSink = (mutations: readonly AnnotationMutation[]) => void;

export interface AnnotationHitTestSource {
  getAnnotations: () => readonly Annotation[];
  hitTest?: (point: AnnotationPoint, event: PointerEvent) => Annotation | null;
}

export interface PageToolBindingOptions {
  docId: string;
  pageIndex: number;
  pointScale: number;
  layers: PageLayerRefs;
  getToolState: () => ToolState;
  annotations: AnnotationHitTestSource;
  command: AnnotationCommandSink;
}

export interface PageToolBinding {
  refresh: () => void;
  clearSelection: () => void;
  getSelectedId: () => string | null;
  teardown: () => void;
}

export interface AnnotationEditorCallbacks<T extends TextAnnotation | NoteAnnotation> {
  onCommit: (annotation: T) => void;
  onCancel?: () => void;
}

export interface AnnotationEditorOptions<T extends TextAnnotation | NoteAnnotation>
  extends AnnotationEditorCallbacks<T> {
  layers: PageLayerRefs;
  annotation: T;
  pointScale: number;
  pointToCss?: (point: AnnotationPoint) => AnnotationPoint;
}

export interface AnnotationEditorHandle {
  element: HTMLDivElement;
  focus: () => void;
  commit: () => void;
  teardown: () => void;
}

interface DragState {
  pointerId: number;
  tool: ToolId;
  start: AnnotationPoint;
  current: AnnotationPoint;
  points: AnnotationPoint[];
  selectionBefore: Annotation | null;
  toolState: Readonly<ToolState>;
}

function clonePoint(point: AnnotationPoint): AnnotationPoint {
  return { x: point.x, y: point.y };
}

function cloneRect(rect: AnnotationRect): AnnotationRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function cloneAnnotation(annotation: Annotation): Annotation {
  switch (annotation.type) {
    case 'ink':
      return { ...annotation, points: annotation.points.map(clonePoint) };
    case 'highlight':
      return { ...annotation, rects: annotation.rects.map(cloneRect) };
    case 'rect':
    case 'ellipse':
      return { ...annotation, rect: cloneRect(annotation.rect) };
    case 'line':
    case 'arrow':
      return {
        ...annotation,
        start: clonePoint(annotation.start),
        end: clonePoint(annotation.end),
      };
    case 'text':
    case 'note':
      return { ...annotation };
  }
}

function annotationId(): string {
  return crypto.randomUUID();
}

function normalizeRect(start: AnnotationPoint, end: AnnotationPoint): AnnotationRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function pointDistance(first: AnnotationPoint, second: AnnotationPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function distanceToSegment(
  point: AnnotationPoint,
  start: AnnotationPoint,
  end: AnnotationPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return pointDistance(point, start);
  const ratio = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  return pointDistance(point, { x: start.x + ratio * dx, y: start.y + ratio * dy });
}

function interpolatePoint(
  start: AnnotationPoint,
  end: AnnotationPoint,
  ratio: number,
): AnnotationPoint {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

function resamplePath(points: readonly AnnotationPoint[], maxSpacing: number): AnnotationPoint[] {
  if (points.length < 2) return points.map(clonePoint);
  const sampled = [clonePoint(points[0])];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const steps = Math.max(1, Math.ceil(pointDistance(start, end) / maxSpacing));
    for (let step = 1; step <= steps; step += 1) {
      sampled.push(interpolatePoint(start, end, step / steps));
    }
  }
  return sampled;
}

function circleIntervalOnSegment(
  start: AnnotationPoint,
  end: AnnotationPoint,
  center: AnnotationPoint,
  radius: number,
): [number, number] | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const offsetX = start.x - center.x;
  const offsetY = start.y - center.y;
  const quadratic = dx * dx + dy * dy;
  const constant = offsetX * offsetX + offsetY * offsetY - radius * radius;
  if (quadratic <= GEOMETRY_EPSILON) return constant <= 0 ? [0, 1] : null;

  const linear = 2 * (offsetX * dx + offsetY * dy);
  const discriminant = linear * linear - 4 * quadratic * constant;
  if (discriminant < 0) return constant <= 0 ? [0, 1] : null;

  const root = Math.sqrt(discriminant);
  const first = (-linear - root) / (2 * quadratic);
  const second = (-linear + root) / (2 * quadratic);
  const from = Math.max(0, Math.min(first, second));
  const to = Math.min(1, Math.max(first, second));
  return to - from > GEOMETRY_EPSILON ? [from, to] : null;
}

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  intervals.sort((first, second) => first[0] - second[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval[0] <= previous[1] + GEOMETRY_EPSILON) {
      previous[1] = Math.max(previous[1], interval[1]);
    } else {
      merged.push([...interval]);
    }
  }
  return merged;
}

function clipInkRuns(
  points: readonly AnnotationPoint[],
  eraserCenters: readonly AnnotationPoint[],
  radius: number,
): AnnotationPoint[][] {
  if (points.length < 2) return [];
  const runs: AnnotationPoint[][] = [];
  let run: AnnotationPoint[] = [];
  const pushUnique = (point: AnnotationPoint): void => {
    const previous = run[run.length - 1];
    if (!previous || pointDistance(previous, point) > GEOMETRY_EPSILON) {
      run.push(point);
    }
  };
  const flush = (): void => {
    if (run.length >= 2 && pointDistance(run[0], run[run.length - 1]) > GEOMETRY_EPSILON) {
      runs.push(run);
    }
    run = [];
  };
  const addVisibleInterval = (
    start: AnnotationPoint,
    end: AnnotationPoint,
    from: number,
    to: number,
  ): void => {
    if (to - from <= GEOMETRY_EPSILON) return;
    const visibleStart = interpolatePoint(start, end, from);
    const visibleEnd = interpolatePoint(start, end, to);
    if (run.length > 0 && pointDistance(run[run.length - 1], visibleStart) > GEOMETRY_EPSILON) {
      flush();
    }
    pushUnique(visibleStart);
    pushUnique(visibleEnd);
  };

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const erased = mergeIntervals(
      eraserCenters
        .map((center) => circleIntervalOnSegment(start, end, center, radius))
        .filter((interval): interval is [number, number] => interval !== null),
    );
    if (erased.length === 0) {
      addVisibleInterval(start, end, 0, 1);
      continue;
    }

    let cursor = 0;
    for (const [from, to] of erased) {
      addVisibleInterval(start, end, cursor, from);
      flush();
      cursor = Math.max(cursor, to);
    }
    addVisibleInterval(start, end, cursor, 1);
  }
  flush();
  return runs;
}

function samePoints(
  first: readonly AnnotationPoint[],
  second: readonly AnnotationPoint[],
): boolean {
  return first.length === second.length
    && first.every((point, index) => pointDistance(point, second[index]) <= GEOMETRY_EPSILON);
}

function rectContains(rect: AnnotationRect, point: AnnotationPoint, padding = 0): boolean {
  return point.x >= rect.x - padding
    && point.x <= rect.x + rect.width + padding
    && point.y >= rect.y - padding
    && point.y <= rect.y + rect.height + padding;
}

function annotationBounds(annotation: Annotation): AnnotationRect {
  switch (annotation.type) {
    case 'ink': {
      const xs = annotation.points.map((point) => point.x);
      const ys = annotation.points.map((point) => point.y);
      const padding = annotation.width / 2;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      return {
        x: minX - padding,
        y: minY - padding,
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
      };
    }
    case 'highlight': {
      const rects = annotation.rects;
      const minX = Math.min(...rects.map((rect) => rect.x));
      const minY = Math.min(...rects.map((rect) => rect.y));
      const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
      const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case 'rect':
    case 'ellipse':
      return cloneRect(annotation.rect);
    case 'line':
      return normalizeRect(annotation.start, annotation.end);
    case 'arrow': {
      const points = [annotation.start, annotation.end, ...arrowHead(annotation)];
      const minX = Math.min(...points.map((point) => point.x));
      const minY = Math.min(...points.map((point) => point.y));
      const maxX = Math.max(...points.map((point) => point.x));
      const maxY = Math.max(...points.map((point) => point.y));
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case 'text':
      return {
        x: annotation.x,
        y: annotation.y,
        width: Math.max(annotation.fontSize, annotation.text.length * annotation.fontSize * 0.6),
        height: annotation.fontSize * 1.3,
      };
    case 'note':
      return { x: annotation.x, y: annotation.y, width: NOTE_SIZE, height: NOTE_SIZE };
  }
}

function inkContains(annotation: InkAnnotation, point: AnnotationPoint, padding: number): boolean {
  const tolerance = annotation.width / 2 + padding;
  for (let index = 1; index < annotation.points.length; index += 1) {
    if (distanceToSegment(point, annotation.points[index - 1], annotation.points[index]) <= tolerance) {
      return true;
    }
  }
  return false;
}

function distanceToRect(point: AnnotationPoint, rect: AnnotationRect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width);
  const dy = Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height);
  return Math.hypot(dx, dy);
}

function distanceToRectBoundary(point: AnnotationPoint, rect: AnnotationRect): number {
  if (!rectContains(rect, point)) return distanceToRect(point, rect);
  return Math.min(
    point.x - rect.x,
    rect.x + rect.width - point.x,
    point.y - rect.y,
    rect.y + rect.height - point.y,
  );
}

function distanceToEllipseBoundary(point: AnnotationPoint, rect: AnnotationRect): number {
  const radiusX = rect.width / 2;
  const radiusY = rect.height / 2;
  if (radiusX <= 0 || radiusY <= 0) return Number.POSITIVE_INFINITY;
  const localX = Math.abs(point.x - rect.x - radiusX);
  const localY = Math.abs(point.y - rect.y - radiusY);
  if (localX <= GEOMETRY_EPSILON && localY <= GEOMETRY_EPSILON) {
    return Math.min(radiusX, radiusY);
  }

  let angle = Math.atan2(localY * radiusX, localX * radiusY);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const ellipseX = radiusX * cosine;
    const ellipseY = radiusY * sine;
    const tangentX = -radiusX * sine;
    const tangentY = radiusY * cosine;
    const value = (ellipseX - localX) * tangentX + (ellipseY - localY) * tangentY;
    const derivative = tangentX * tangentX
      + tangentY * tangentY
      - (ellipseX - localX) * radiusX * cosine
      - (ellipseY - localY) * radiusY * sine;
    if (Math.abs(derivative) <= GEOMETRY_EPSILON) break;
    angle = Math.max(0, Math.min(Math.PI / 2, angle - value / derivative));
  }
  return Math.hypot(radiusX * Math.cos(angle) - localX, radiusY * Math.sin(angle) - localY);
}

function arrowHead(annotation: Extract<Annotation, { type: 'arrow' }>): [
  AnnotationPoint,
  AnnotationPoint,
  AnnotationPoint,
] {
  const dx = annotation.end.x - annotation.start.x;
  const dy = annotation.end.y - annotation.start.y;
  const length = Math.hypot(dx, dy);
  if (length <= GEOMETRY_EPSILON) {
    return [clonePoint(annotation.end), clonePoint(annotation.end), clonePoint(annotation.end)];
  }
  const unitX = dx / length;
  const unitY = dy / length;
  const tip = {
    x: annotation.end.x + unitX * annotation.width,
    y: annotation.end.y + unitY * annotation.width,
  };
  const base = {
    x: annotation.end.x - unitX * annotation.width * 7,
    y: annotation.end.y - unitY * annotation.width * 7,
  };
  const sideX = -unitY * annotation.width * 4;
  const sideY = unitX * annotation.width * 4;
  return [
    tip,
    { x: base.x + sideX, y: base.y + sideY },
    { x: base.x - sideX, y: base.y - sideY },
  ];
}

function pointInTriangle(
  point: AnnotationPoint,
  first: AnnotationPoint,
  second: AnnotationPoint,
  third: AnnotationPoint,
): boolean {
  const sign = (a: AnnotationPoint, b: AnnotationPoint, c: AnnotationPoint): number =>
    (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
  const firstSign = sign(point, first, second);
  const secondSign = sign(point, second, third);
  const thirdSign = sign(point, third, first);
  const hasNegative = firstSign < 0 || secondSign < 0 || thirdSign < 0;
  const hasPositive = firstSign > 0 || secondSign > 0 || thirdSign > 0;
  return !(hasNegative && hasPositive);
}

function diskIntersectsArrowHead(
  annotation: Extract<Annotation, { type: 'arrow' }>,
  point: AnnotationPoint,
  radius: number,
): boolean {
  const [tip, firstBase, secondBase] = arrowHead(annotation);
  return pointInTriangle(point, tip, firstBase, secondBase)
    || distanceToSegment(point, tip, firstBase) <= radius
    || distanceToSegment(point, firstBase, secondBase) <= radius
    || distanceToSegment(point, secondBase, tip) <= radius;
}

function annotationIntersectsDisk(
  annotation: Annotation,
  point: AnnotationPoint,
  radius: number,
): boolean {
  switch (annotation.type) {
    case 'ink':
      return inkContains(annotation, point, radius);
    case 'highlight':
      return annotation.rects.some((rect) => distanceToRect(point, rect) <= radius);
    case 'rect': {
      if (annotation.fill) return distanceToRect(point, annotation.rect) <= radius;
      return distanceToRectBoundary(point, annotation.rect) <= radius + annotation.width / 2;
    }
    case 'ellipse': {
      const { x, y, width, height } = annotation.rect;
      if (width === 0 || height === 0) return false;
      const normalizedX = (point.x - x - width / 2) / (width / 2);
      const normalizedY = (point.y - y - height / 2) / (height / 2);
      const inside = normalizedX * normalizedX + normalizedY * normalizedY <= 1;
      if (annotation.fill && inside) return true;
      return distanceToEllipseBoundary(point, annotation.rect) <= radius + annotation.width / 2;
    }
    case 'line':
      return distanceToSegment(point, annotation.start, annotation.end)
        <= radius + annotation.width / 2;
    case 'arrow':
      return distanceToSegment(point, annotation.start, annotation.end)
        <= radius + annotation.width / 2
        || diskIntersectsArrowHead(annotation, point, radius);
    case 'text':
    case 'note':
      return distanceToRect(point, annotationBounds(annotation)) <= radius;
  }
}

function annotationContains(annotation: Annotation, point: AnnotationPoint): boolean {
  return annotationIntersectsDisk(annotation, point, 3);
}

function translatedAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  const movePoint = (point: AnnotationPoint): AnnotationPoint => ({
    x: point.x + dx,
    y: point.y + dy,
  });
  const moveRect = (rect: AnnotationRect): AnnotationRect => ({
    ...rect,
    x: rect.x + dx,
    y: rect.y + dy,
  });

  switch (annotation.type) {
    case 'ink':
      return { ...annotation, points: annotation.points.map(movePoint) };
    case 'highlight':
      return { ...annotation, rects: annotation.rects.map(moveRect) };
    case 'rect':
    case 'ellipse':
      return { ...annotation, rect: moveRect(annotation.rect) };
    case 'line':
    case 'arrow':
      return { ...annotation, start: movePoint(annotation.start), end: movePoint(annotation.end) };
    case 'text':
    case 'note':
      return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
  }
}

function createEditor<T extends TextAnnotation | NoteAnnotation>(
  options: AnnotationEditorOptions<T>,
): AnnotationEditorHandle {
  const { annotation, layers, pointScale } = options;
  if (!Number.isFinite(pointScale) || pointScale <= 0) {
    throw new RangeError('Annotation editor pointScale must be a positive finite number');
  }

  const editor = document.createElement('div');
  editor.className = annotation.type === 'text'
    ? 'ssv-anno-text-editor'
    : 'ssv-anno-note-editor';
  editor.contentEditable = 'true';
  editor.textContent = annotation.text;
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-multiline', 'true');
  editor.setAttribute('aria-label', annotation.type === 'text' ? 'Edit text annotation' : 'Edit note');
  editor.style.position = 'absolute';
  const cssPosition = options.pointToCss?.({ x: annotation.x, y: annotation.y })
    ?? { x: annotation.x * pointScale, y: annotation.y * pointScale };
  editor.style.left = `${cssPosition.x}px`;
  editor.style.top = `${cssPosition.y}px`;
  editor.style.zIndex = '2';
  editor.style.pointerEvents = 'auto';
  editor.style.resize = 'both';
  editor.style.overflow = 'auto';
  editor.style.whiteSpace = 'pre-wrap';
  editor.style.overflowWrap = 'anywhere';
  editor.style.minWidth = annotation.type === 'text' ? '120px' : '160px';
  editor.style.minHeight = annotation.type === 'text' ? '2.5em' : '96px';
  editor.style.color = annotation.color;
  if (annotation.type === 'text') {
    editor.style.fontSize = `${annotation.fontSize * pointScale}px`;
  }
  layers.html.appendChild(editor);

  let finished = false;
  const finish = (commit: boolean): void => {
    if (finished) return;
    finished = true;
    const text = editor.textContent?.trim() ?? '';
    editor.removeEventListener('blur', onBlur);
    editor.removeEventListener('keydown', onKeyDown);
    editor.remove();
    if (commit && text) {
      options.onCommit({ ...annotation, text });
    } else {
      options.onCancel?.();
    }
  };
  const onBlur = (): void => finish(true);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finish(true);
    }
  };
  editor.addEventListener('blur', onBlur);
  editor.addEventListener('keydown', onKeyDown);

  return {
    element: editor,
    focus: () => {
      editor.focus();
      const selection = document.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    },
    commit: () => finish(true),
    teardown: () => finish(false),
  };
}

export function openTextAnnotationEditor(
  options: AnnotationEditorOptions<TextAnnotation>,
): AnnotationEditorHandle {
  return createEditor(options);
}

export function openNoteAnnotationEditor(
  options: AnnotationEditorOptions<NoteAnnotation>,
): AnnotationEditorHandle {
  return createEditor(options);
}

function createSvg<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function setAttributes(element: Element, attributes: Record<string, string | number>): void {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
}

export function mountPageAnnotationTools(options: PageToolBindingOptions): PageToolBinding {
  const {
    docId,
    pageIndex,
    pointScale,
    layers,
    getToolState,
    annotations,
    command,
  } = options;
  if (!Number.isFinite(pointScale) || pointScale <= 0) {
    throw new RangeError('Annotation tool pointScale must be a positive finite number');
  }

  const pageEl = layers.svg.parentElement;
  if (!pageEl) throw new Error('Annotation layers must be attached to a page element');

  const overlayRoots = getAnnotationOverlayRoots(layers);
  const previewGroup = createSvg('g');
  previewGroup.classList.add('ssv-anno-preview');
  previewGroup.style.pointerEvents = 'none';
  overlayRoots.preview.appendChild(previewGroup);

  const selectionGroup = createSvg('g');
  selectionGroup.classList.add('ssv-anno-selection');
  selectionGroup.style.pointerEvents = 'none';
  selectionGroup.style.display = 'none';
  overlayRoots.selection.appendChild(selectionGroup);

  const previousTabIndex = pageEl.getAttribute('tabindex');
  pageEl.tabIndex = pageEl.tabIndex >= 0 ? pageEl.tabIndex : 0;

  let drag: DragState | null = null;
  let selectedId: string | null = null;
  let activeEditor: AnnotationEditorHandle | null = null;
  let previewFrame: number | null = null;
  let previewInkRenderedPointCount = 0;
  let tornDown = false;

  const currentPageAnnotations = (): readonly Annotation[] => annotations.getAnnotations()
    .filter((annotation) => annotation.docId === docId && annotation.pageIndex === pageIndex);

  const findAnnotation = (id: string): Annotation | null => {
    return currentPageAnnotations().find((annotation) => annotation.id === id) ?? null;
  };

  const eventPoint = (event: PointerEvent): AnnotationPoint => {
    const rect = layers.svg.getBoundingClientRect();
    const viewBox = layers.svg.viewBox.baseVal;
    if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) {
      return { x: viewBox.x, y: viewBox.y };
    }
    return {
      x: viewBox.x + (event.clientX - rect.left) * viewBox.width / rect.width,
      y: viewBox.y + (event.clientY - rect.top) * viewBox.height / rect.height,
    };
  };

  const cssPixelsToPoints = (pixels: number): number => {
    const rect = layers.svg.getBoundingClientRect();
    const viewBox = layers.svg.viewBox.baseVal;
    if (rect.width <= 0 || rect.height <= 0) return pixels / pointScale;
    return pixels * Math.max(viewBox.width / rect.width, viewBox.height / rect.height);
  };

  const pointToCss = (point: AnnotationPoint): AnnotationPoint => {
    const rect = layers.html.getBoundingClientRect();
    const viewBox = layers.svg.viewBox.baseVal;
    if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) {
      return { x: point.x * pointScale, y: point.y * pointScale };
    }
    return {
      x: (point.x - viewBox.x) * rect.width / viewBox.width,
      y: (point.y - viewBox.y) * rect.height / viewBox.height,
    };
  };

  const currentEditorScale = (): number => {
    const rect = layers.html.getBoundingClientRect();
    const viewBox = layers.svg.viewBox.baseVal;
    return rect.width > 0 && viewBox.width > 0 ? rect.width / viewBox.width : pointScale;
  };

  const renderedPageBounds = (annotation: Annotation): AnnotationRect | null => {
    if (annotation.type !== 'text' && annotation.type !== 'note') return null;
    const element = getRenderedAnnotationElement(layers, annotation.id);
    if (!(element instanceof HTMLElement)) return null;
    const elementRect = element.getBoundingClientRect();
    const layerRect = layers.svg.getBoundingClientRect();
    const viewBox = layers.svg.viewBox.baseVal;
    if (layerRect.width <= 0 || layerRect.height <= 0) return null;
    return {
      x: viewBox.x + (elementRect.left - layerRect.left) * viewBox.width / layerRect.width,
      y: viewBox.y + (elementRect.top - layerRect.top) * viewBox.height / layerRect.height,
      width: elementRect.width * viewBox.width / layerRect.width,
      height: elementRect.height * viewBox.height / layerRect.height,
    };
  };

  const hitTest = (point: AnnotationPoint, event: PointerEvent): Annotation | null => {
    const customHit = annotations.hitTest?.(point, event);
    if (customHit?.docId === docId && customHit.pageIndex === pageIndex) {
      const current = findAnnotation(customHit.id);
      if (current) return current;
    }

    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement | SVGElement>('[data-annotation-id]')
      : null;
    const targetId = target?.getAttribute('data-annotation-id');
    if (targetId) {
      const targeted = findAnnotation(targetId);
      if (targeted) return targeted;
    }
    return [...currentPageAnnotations()].reverse().find((annotation) => {
      if (annotation.type === 'text' || annotation.type === 'note') {
        const element = getRenderedAnnotationElement(layers, annotation.id);
        if (element instanceof HTMLElement) {
          const bounds = element.getBoundingClientRect();
          if (
            event.clientX >= bounds.left
            && event.clientX <= bounds.right
            && event.clientY >= bounds.top
            && event.clientY <= bounds.bottom
          ) {
            return true;
          }
        }
      }
      return annotationContains(annotation, point);
    }) ?? null;
  };

  const drawSelection = (annotation: Annotation | null): void => {
    selectionGroup.replaceChildren();
    if (!annotation) {
      selectionGroup.style.display = 'none';
      return;
    }

    const renderedBounds = renderedPageBounds(annotation);
    const bounds = renderedBounds && (annotation.type === 'text' || annotation.type === 'note')
      ? {
          x: annotation.x,
          y: annotation.y,
          width: renderedBounds.width,
          height: renderedBounds.height,
        }
      : annotationBounds(annotation);
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
      selectionGroup.style.display = 'none';
      return;
    }
    selectionGroup.style.display = '';
    const outline = createSvg('rect');
    setAttributes(outline, {
      x: bounds.x,
      y: bounds.y,
      width: Math.max(bounds.width, 1),
      height: Math.max(bounds.height, 1),
      fill: 'none',
      stroke: '#2563eb',
      'stroke-width': cssPixelsToPoints(1),
      'stroke-dasharray': `${cssPixelsToPoints(4)} ${cssPixelsToPoints(3)}`,
    });
    selectionGroup.appendChild(outline);

    const corners = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ];
    for (const corner of corners) {
      const handle = createSvg('circle');
      setAttributes(handle, {
        cx: corner.x,
        cy: corner.y,
        r: cssPixelsToPoints(HANDLE_RADIUS),
        fill: '#ffffff',
        stroke: '#2563eb',
        'stroke-width': cssPixelsToPoints(1),
      });
      selectionGroup.appendChild(handle);
    }
  };

  const select = (annotation: Annotation | null): void => {
    selectedId = annotation?.id ?? null;
    drawSelection(annotation);
  };

  const clearPreview = (): void => {
    if (previewFrame !== null) {
      cancelAnimationFrame(previewFrame);
      previewFrame = null;
    }
    previewInkRenderedPointCount = 0;
    previewGroup.replaceChildren();
  };

  const drawPreview = (state: DragState): void => {
    const toolState = state.toolState;
    if (state.tool === 'pencil' || state.tool === 'highlighter') {
      if (state.points.length < 2) return;
      const firstNewIndex = Math.max(1, previewInkRenderedPointCount);
      if (firstNewIndex >= state.points.length) return;
      const path = createSvg('path');
      const commands = [
        `M ${state.points[firstNewIndex - 1].x} ${state.points[firstNewIndex - 1].y}`,
      ];
      for (let index = firstNewIndex; index < state.points.length; index += 1) {
        commands.push(`L ${state.points[index].x} ${state.points[index].y}`);
      }
      setAttributes(path, {
        d: commands.join(' '),
        fill: 'none',
        stroke: toolState.color,
        'stroke-width': state.tool === 'highlighter' ? toolState.width * 3 : toolState.width,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        opacity: state.tool === 'highlighter' ? 0.35 : 1,
      });
      previewGroup.appendChild(path);
      previewInkRenderedPointCount = state.points.length;
      return;
    }
    previewInkRenderedPointCount = 0;
    previewGroup.replaceChildren();
    if (state.tool === 'rect' || state.tool === 'ellipse' || state.tool === 'highlight') {
      const area = normalizeRect(state.start, state.current);
      const shape = state.tool === 'ellipse' ? createSvg('ellipse') : createSvg('rect');
      if (state.tool === 'ellipse') {
        setAttributes(shape, {
          cx: area.x + area.width / 2,
          cy: area.y + area.height / 2,
          rx: area.width / 2,
          ry: area.height / 2,
        });
      } else {
        setAttributes(shape, {
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
        });
      }
      setAttributes(shape, {
        fill: state.tool === 'highlight' || toolState.fill ? toolState.color : 'none',
        'fill-opacity': state.tool === 'highlight' ? 0.35 : toolState.fill ? 0.2 : 0,
        stroke: toolState.color,
        'stroke-width': toolState.width,
      });
      previewGroup.appendChild(shape);
      return;
    }
    if (state.tool === 'line' || state.tool === 'arrow') {
      const line = createSvg('line');
      setAttributes(line, {
        x1: state.start.x,
        y1: state.start.y,
        x2: state.current.x,
        y2: state.current.y,
        stroke: toolState.color,
        'stroke-width': toolState.width,
        'stroke-linecap': 'round',
      });
      previewGroup.appendChild(line);
    }
  };

  const schedulePreview = (): void => {
    if (previewFrame !== null) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = null;
      if (drag) drawPreview(drag);
    });
  };

  const dispatch = (mutations: readonly AnnotationMutation[]): boolean => {
    const dragBeforeCommand = drag;
    const editorBeforeCommand = activeEditor;
    const selectionBeforeCommand = selectedId;
    command(mutations);
    return !tornDown
      && drag === dragBeforeCommand
      && activeEditor === editorBeforeCommand
      && selectedId === selectionBeforeCommand;
  };

  const emitCreate = (annotation: Annotation): boolean => {
    return dispatch([{ type: 'create', after: cloneAnnotation(annotation) }]);
  };

  const openNewText = (point: AnnotationPoint, state: Readonly<ToolState>): void => {
    activeEditor?.teardown();
    const annotation: TextAnnotation = {
      id: annotationId(),
      docId,
      pageIndex,
      type: 'text',
      x: point.x,
      y: point.y,
      text: '',
      color: state.color,
      fontSize: state.fontSize,
    };
    activeEditor = openTextAnnotationEditor({
      layers,
      annotation,
      pointScale: currentEditorScale(),
      pointToCss,
      onCommit: (committed) => {
        activeEditor = null;
        if (emitCreate(committed)) select(findAnnotation(committed.id));
      },
      onCancel: () => {
        activeEditor = null;
      },
    });
    activeEditor.focus();
  };

  const openNewNote = (point: AnnotationPoint, state: Readonly<ToolState>): void => {
    activeEditor?.teardown();
    const annotation: NoteAnnotation = {
      id: annotationId(),
      docId,
      pageIndex,
      type: 'note',
      x: point.x,
      y: point.y,
      text: '',
      color: state.color,
    };
    activeEditor = openNoteAnnotationEditor({
      layers,
      annotation,
      pointScale: currentEditorScale(),
      pointToCss,
      onCommit: (committed) => {
        activeEditor = null;
        if (emitCreate(committed)) select(findAnnotation(committed.id));
      },
      onCancel: () => {
        activeEditor = null;
      },
    });
    activeEditor.focus();
  };

  const eraseGesture = (state: DragState): void => {
    const radius = Math.max(2, state.toolState.width);
    const eraserCenters = resamplePath(state.points, Math.max(radius / 2, 0.25));

    const mutations: AnnotationMutation[] = [];
    for (const annotation of currentPageAnnotations()) {
      if (annotation.type !== 'ink') {
        const renderedBounds = renderedPageBounds(annotation);
        const intersects = renderedBounds
          ? eraserCenters.some((point) => distanceToRect(point, renderedBounds) <= radius)
          : eraserCenters.some((point) => annotationIntersectsDisk(annotation, point, radius));
        if (intersects) {
          mutations.push({ type: 'delete', before: cloneAnnotation(annotation) });
        }
        continue;
      }

      const runs = clipInkRuns(
        annotation.points,
        eraserCenters,
        radius + annotation.width / 2,
      );
      if (runs.length === 1 && samePoints(runs[0], annotation.points)) continue;
      mutations.push(
        { type: 'delete', before: cloneAnnotation(annotation) },
        ...runs.map((points): AnnotationMutation => ({
          type: 'create',
          after: { ...annotation, id: annotationId(), points },
        })),
      );
    }

    if (mutations.length === 0) return;
    if (!dispatch(mutations)) return;
    if (
      selectedId
      && mutations.some((mutation) => mutation.type === 'delete' && mutation.before.id === selectedId)
    ) {
      select(null);
    }
  };

  const beginDrag = (
    event: PointerEvent,
    toolState: Readonly<ToolState>,
    start: AnnotationPoint,
    selectionBefore: Annotation | null = null,
  ): void => {
    drag = {
      pointerId: event.pointerId,
      tool: toolState.activeTool,
      start,
      current: start,
      points: [start],
      selectionBefore: selectionBefore ? cloneAnnotation(selectionBefore) : null,
      toolState,
    };
    pageEl.setPointerCapture(event.pointerId);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || drag) return;
    if (activeEditor) {
      if (event.target instanceof Node && activeEditor.element.contains(event.target)) return;
      const editor = activeEditor;
      editor.commit();
      if (tornDown || drag) return;
    }
    if (selectedId && !findAnnotation(selectedId)) select(null);

    const toolState: Readonly<ToolState> = Object.freeze({ ...getToolState() });
    const tool = toolState.activeTool;
    if (tool === 'hand') return;

    const point = eventPoint(event);
    if (tool === 'text') {
      event.preventDefault();
      const hit = hitTest(point, event);
      if (hit?.type === 'text') {
        pageEl.focus({ preventScroll: true });
        select(hit);
        beginDrag(event, { ...toolState, activeTool: 'select' }, point, hit);
        return;
      }
      openNewText(point, toolState);
      return;
    }
    if (tool === 'note') {
      event.preventDefault();
      openNewNote(point, toolState);
      return;
    }
    if (tool === 'select') {
      event.preventDefault();
      pageEl.focus({ preventScroll: true });
      const hit = hitTest(point, event);
      select(hit);
      if (hit) beginDrag(event, toolState, point, hit);
      return;
    }
    if (tool === 'eraser') {
      event.preventDefault();
      beginDrag(event, toolState, point);
      return;
    }

    event.preventDefault();
    beginDrag(event, toolState, point);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = eventPoint(event);
    drag.current = point;
    if (drag.tool === 'pencil' || drag.tool === 'highlighter') {
      const previous = drag.points[drag.points.length - 1];
      if (pointDistance(previous, point) >= 0.15) drag.points.push(point);
      schedulePreview();
    } else if (drag.tool === 'select' && drag.selectionBefore) {
      const moved = translatedAnnotation(
        drag.selectionBefore,
        point.x - drag.start.x,
        point.y - drag.start.y,
      );
      drawSelection(moved);
    } else if (drag.tool === 'eraser') {
      const previous = drag.points[drag.points.length - 1];
      if (pointDistance(previous, point) >= 0.15) drag.points.push(point);
    } else {
      schedulePreview();
    }
  };

  const finishDrag = (event: PointerEvent, cancelled: boolean): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const finished = drag;
    if (!cancelled) {
      const finalPoint = eventPoint(event);
      finished.current = finalPoint;
      if (finished.tool === 'pencil' || finished.tool === 'highlighter' || finished.tool === 'eraser') {
        const previous = finished.points[finished.points.length - 1];
        if (pointDistance(previous, finalPoint) > GEOMETRY_EPSILON) {
          finished.points.push(finalPoint);
        }
      }
    }
    drag = null;
    if (pageEl.hasPointerCapture(event.pointerId)) pageEl.releasePointerCapture(event.pointerId);
    clearPreview();
    if (cancelled) {
      if (finished.selectionBefore) select(findAnnotation(finished.selectionBefore.id));
      return;
    }

    const state = finished.toolState;
    const distance = pointDistance(finished.start, finished.current);
    if (finished.tool === 'pencil' || finished.tool === 'highlighter') {
      if (finished.points.length < 2) return;
      emitCreate({
        id: annotationId(),
        docId,
        pageIndex,
        type: 'ink',
        points: finished.points.map(clonePoint),
        color: state.color,
        width: finished.tool === 'highlighter' ? state.width * 3 : state.width,
        opacity: finished.tool === 'highlighter' ? 0.35 : 1,
      });
    } else if (
      finished.tool === 'rect'
      || finished.tool === 'ellipse'
      || finished.tool === 'highlight'
    ) {
      const rect = normalizeRect(finished.start, finished.current);
      if (rect.width < MIN_DRAG_DISTANCE || rect.height < MIN_DRAG_DISTANCE) return;
      if (finished.tool === 'highlight') {
        emitCreate({
          id: annotationId(),
          docId,
          pageIndex,
          type: 'highlight',
          rects: [rect],
          color: state.color,
        });
      } else {
        emitCreate({
          id: annotationId(),
          docId,
          pageIndex,
          type: finished.tool,
          rect,
          color: state.color,
          width: state.width,
          fill: state.fill,
        });
      }
    } else if (finished.tool === 'line' || finished.tool === 'arrow') {
      if (distance < MIN_DRAG_DISTANCE) return;
      emitCreate({
        id: annotationId(),
        docId,
        pageIndex,
        type: finished.tool,
        start: clonePoint(finished.start),
        end: clonePoint(finished.current),
        color: state.color,
        width: state.width,
      });
    } else if (finished.tool === 'select' && finished.selectionBefore && distance > 0) {
      const after = translatedAnnotation(
        finished.selectionBefore,
        finished.current.x - finished.start.x,
        finished.current.y - finished.start.y,
      );
      if (!dispatch([{
        type: 'update',
        before: cloneAnnotation(finished.selectionBefore),
        after: cloneAnnotation(after),
      }])) return;
      select(findAnnotation(after.id));
    } else if (finished.tool === 'eraser') {
      eraseGesture(finished);
    }
  };

  const onPointerUp = (event: PointerEvent): void => finishDrag(event, false);
  const onPointerCancel = (event: PointerEvent): void => finishDrag(event, true);
  const onLostPointerCapture = (event: PointerEvent): void => finishDrag(event, true);

  const isTextEditingTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return target.matches('input, textarea, [contenteditable="true"]')
      || target.closest('input, textarea, [contenteditable="true"]') !== null;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      (event.key !== 'Delete' && event.key !== 'Backspace')
      || !selectedId
      || isTextEditingTarget(event.target)
    ) {
      return;
    }
    const selected = findAnnotation(selectedId);
    if (!selected) {
      select(null);
      return;
    }
    event.preventDefault();
    if (!dispatch([{ type: 'delete', before: cloneAnnotation(selected) }])) return;
    select(null);
  };

  const refresh = (): void => {
    if (tornDown) return;
    setInteractive(pageEl, true);
    if (getToolState().activeTool === 'hand') {
      select(null);
      clearPreview();
    } else if (selectedId) {
      select(findAnnotation(selectedId));
    }
  };

  pageEl.addEventListener('pointerdown', onPointerDown, true);
  pageEl.addEventListener('pointermove', onPointerMove, true);
  pageEl.addEventListener('pointerup', onPointerUp, true);
  pageEl.addEventListener('pointercancel', onPointerCancel, true);
  pageEl.addEventListener('lostpointercapture', onLostPointerCapture, true);
  pageEl.addEventListener('keydown', onKeyDown);
  setInteractive(pageEl, true);

  return {
    refresh,
    clearSelection: () => select(null),
    getSelectedId: () => selectedId,
    teardown: () => {
      if (tornDown) return;
      const activePointerId = drag?.pointerId;
      if (activePointerId !== undefined && pageEl.hasPointerCapture(activePointerId)) {
        try {
          pageEl.releasePointerCapture(activePointerId);
        } catch {
          // The browser may have released capture between the state check and this call.
        }
      }
      tornDown = true;
      activeEditor?.teardown();
      activeEditor = null;
      drag = null;
      clearPreview();
      pageEl.removeEventListener('pointerdown', onPointerDown, true);
      pageEl.removeEventListener('pointermove', onPointerMove, true);
      pageEl.removeEventListener('pointerup', onPointerUp, true);
      pageEl.removeEventListener('pointercancel', onPointerCancel, true);
      pageEl.removeEventListener('lostpointercapture', onLostPointerCapture, true);
      pageEl.removeEventListener('keydown', onKeyDown);
      selectionGroup.remove();
      previewGroup.remove();
      setInteractive(pageEl, false);
      if (previousTabIndex === null) {
        pageEl.removeAttribute('tabindex');
      } else {
        pageEl.setAttribute('tabindex', previousTabIndex);
      }
    },
  };
}
