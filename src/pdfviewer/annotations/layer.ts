import type { Annotation, AnnotationPoint, AnnotationRect } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ANNOTATION_ID_ATTR = 'data-annotation-id';
let nextLayerNamespace = 1;

export interface PageLayerRefs {
  svg: SVGSVGElement;
  html: HTMLDivElement;
}

interface LayerState {
  elements: Map<string, SVGElement | HTMLDivElement>;
  markerIds: Map<string, string>;
  namespace: string;
  nextMarkerId: number;
  interactive: boolean;
  pageEl: HTMLElement;
  svgContent: SVGGElement;
  htmlContent: HTMLDivElement;
  preview: SVGSVGElement;
  selection: SVGSVGElement;
}

const layerStates = new WeakMap<PageLayerRefs, LayerState>();
const pageLayers = new WeakMap<HTMLElement, PageLayerRefs>();
const elementOwners = new WeakMap<Element, { layers: PageLayerRefs; id: string }>();

function setOverlayLayout(element: HTMLElement | SVGElement, zIndex: string): void {
  element.style.position = 'absolute';
  element.style.inset = '0';
  element.style.width = '100%';
  element.style.height = '100%';
  element.style.zIndex = zIndex;
  element.style.pointerEvents = 'none';
}

function createSvgOverlay(
  className: string,
  pointWidth: number,
  pointHeight: number,
  zIndex: string,
): SVGSVGElement {
  const overlay = document.createElementNS(SVG_NS, 'svg');
  overlay.classList.add(className);
  overlay.setAttribute('viewBox', `0 0 ${pointWidth} ${pointHeight}`);
  overlay.setAttribute('preserveAspectRatio', 'none');
  setOverlayLayout(overlay, zIndex);
  return overlay;
}

export function createPageLayers(
  pageEl: HTMLElement,
  pointWidth: number,
  pointHeight: number,
): PageLayerRefs {
  if (!Number.isFinite(pointWidth) || pointWidth <= 0 || !Number.isFinite(pointHeight) || pointHeight <= 0) {
    throw new RangeError('PDF page-point dimensions must be positive finite numbers');
  }

  const svg = createSvgOverlay('ssv-anno-svg', pointWidth, pointHeight, '4');
  const svgContent = document.createElementNS(SVG_NS, 'g');
  svgContent.classList.add('ssv-anno-content');
  svg.appendChild(svgContent);

  const html = document.createElement('div');
  html.className = 'ssv-anno-html';
  setOverlayLayout(html, '5');
  const htmlContent = document.createElement('div');
  htmlContent.className = 'ssv-anno-html-content';
  htmlContent.style.position = 'absolute';
  htmlContent.style.inset = '0';
  htmlContent.style.pointerEvents = 'none';
  html.appendChild(htmlContent);

  const preview = createSvgOverlay('ssv-anno-preview-layer', pointWidth, pointHeight, '6');
  const selection = createSvgOverlay('ssv-anno-selection-layer', pointWidth, pointHeight, '7');
  pageEl.append(svg, html, preview, selection);
  const layers = { svg, html };
  const namespace = `ssv-anno-layer-${nextLayerNamespace}`;
  nextLayerNamespace += 1;
  layerStates.set(layers, {
    elements: new Map(),
    markerIds: new Map(),
    namespace,
    nextMarkerId: 1,
    interactive: false,
    pageEl,
    svgContent,
    htmlContent,
    preview,
    selection,
  });
  pageLayers.set(pageEl, layers);
  return layers;
}

function getLayerState(layers: PageLayerRefs): LayerState {
  const state = layerStates.get(layers);
  if (!state) {
    throw new Error('Annotation layers must be created with createPageLayers');
  }
  return state;
}

function unregisterElement(element: Element): void {
  elementOwners.delete(element);
}

function removeLayerElement(layers: PageLayerRefs, id: string): void {
  const state = layerStates.get(layers);
  if (!state) return;
  const element = state.elements.get(id);
  if (!element) return;

  state.elements.delete(id);
  state.markerIds.delete(id);
  unregisterElement(element);
  element.remove();
}

function registerElement(
  layers: PageLayerRefs,
  id: string,
  element: SVGElement | HTMLDivElement,
): void {
  const state = getLayerState(layers);
  state.elements.set(id, element);
  elementOwners.set(element, { layers, id });
}

function findAnnotationElement(
  layers: PageLayerRefs,
  id: string,
): SVGElement | HTMLDivElement | null {
  const state = getLayerState(layers);
  const element = state.elements.get(id);
  if (!element) return null;
  if (layers.svg.contains(element) || layers.html.contains(element)) return element;

  state.elements.delete(id);
  state.markerIds.delete(id);
  unregisterElement(element);
  return null;
}

export interface AnnotationOverlayRoots {
  preview: SVGSVGElement;
  selection: SVGSVGElement;
}

export function getAnnotationOverlayRoots(layers: PageLayerRefs): AnnotationOverlayRoots {
  const state = getLayerState(layers);
  return { preview: state.preview, selection: state.selection };
}

export function getRenderedAnnotationElement(
  layers: PageLayerRefs,
  id: string,
): SVGElement | HTMLDivElement | null {
  return findAnnotationElement(layers, id);
}

function tagAnnotationElement(element: Element, annotation: Annotation): void {
  element.setAttribute(ANNOTATION_ID_ATTR, annotation.id);
  element.setAttribute('data-annotation-type', annotation.type);
  element.setAttribute('data-annotation-page-index', String(annotation.pageIndex));
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tagName: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName);
}

function setAttributes(element: Element, attributes: Record<string, string | number>): void {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
}

function smoothedPath(points: AnnotationPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const [{ x, y }] = points;
    return `M ${x} ${y} L ${x} ${y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    commands.push(
      `Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`,
    );
  }
  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  commands.push(`Q ${penultimate.x} ${penultimate.y} ${last.x} ${last.y}`);
  return commands.join(' ');
}

function normalizeRect(rect: AnnotationRect): AnnotationRect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

function setRectGeometry(element: SVGRectElement, rect: AnnotationRect): void {
  const normalized = normalizeRect(rect);
  setAttributes(element, {
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
  });
}

function markerIdFor(layers: PageLayerRefs, annotationId: string): string {
  const state = getLayerState(layers);
  const existing = state.markerIds.get(annotationId);
  if (existing) return existing;

  const markerId = `${state.namespace}-arrow-${state.nextMarkerId}`;
  state.nextMarkerId += 1;
  state.markerIds.set(annotationId, markerId);
  return markerId;
}

function resetSvgElement(element: SVGElement): void {
  for (const attribute of Array.from(element.attributes)) {
    if (!attribute.name.startsWith('data-annotation-')) {
      element.removeAttribute(attribute.name);
    }
  }
  element.replaceChildren();
  element.removeAttribute('style');
}

function applyElementInteractivity(layers: PageLayerRefs, element: Element): void {
  const pointerEvents = getLayerState(layers).interactive ? 'auto' : 'none';
  if (element instanceof HTMLElement || element instanceof SVGElement) {
    element.style.pointerEvents = pointerEvents;
  }
}

function expectedSvgTag(annotation: Annotation): keyof SVGElementTagNameMap {
  switch (annotation.type) {
    case 'ink':
      return 'path';
    case 'rect':
      return 'rect';
    case 'ellipse':
      return 'ellipse';
    case 'line':
      return 'line';
    case 'arrow':
    case 'highlight':
      return 'g';
    case 'text':
    case 'note':
      throw new Error(`HTML annotation ${annotation.type} has no SVG tag`);
  }
}

function getOrCreateSvgElement(
  layers: PageLayerRefs,
  annotation: Annotation,
): SVGElement {
  const expectedTag = expectedSvgTag(annotation);
  const existing = findAnnotationElement(layers, annotation.id);
  if (
    existing instanceof SVGElement
    && existing.localName === expectedTag
    && existing.getAttribute('data-annotation-type') === annotation.type
  ) {
    return existing;
  }
  if (existing) removeLayerElement(layers, annotation.id);

  const element = createSvgElement(expectedTag);
  getLayerState(layers).svgContent.appendChild(element);
  registerElement(layers, annotation.id, element);
  return element;
}

function renderSvgAnnotation(layers: PageLayerRefs, annotation: Annotation): SVGElement {
  const element = getOrCreateSvgElement(layers, annotation);
  resetSvgElement(element);
  tagAnnotationElement(element, annotation);
  applyElementInteractivity(layers, element);

  switch (annotation.type) {
    case 'ink': {
      setAttributes(element, {
        d: smoothedPath(annotation.points),
        fill: 'none',
        stroke: annotation.color,
        'stroke-opacity': annotation.opacity ?? 1,
        'stroke-width': annotation.width,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      });
      break;
    }
    case 'rect': {
      const rect = element as SVGRectElement;
      setRectGeometry(rect, annotation.rect);
      setAttributes(rect, {
        fill: annotation.fill ? annotation.color : 'none',
        stroke: annotation.color,
        'stroke-width': annotation.width,
      });
      break;
    }
    case 'ellipse': {
      const ellipse = element as SVGEllipseElement;
      const { x, y, width, height } = normalizeRect(annotation.rect);
      setAttributes(ellipse, {
        cx: x + width / 2,
        cy: y + height / 2,
        rx: width / 2,
        ry: height / 2,
        fill: annotation.fill ? annotation.color : 'none',
        stroke: annotation.color,
        'stroke-width': annotation.width,
      });
      break;
    }
    case 'line': {
      setAttributes(element, {
        x1: annotation.start.x,
        y1: annotation.start.y,
        x2: annotation.end.x,
        y2: annotation.end.y,
        stroke: annotation.color,
        'stroke-width': annotation.width,
        'stroke-linecap': 'round',
      });
      break;
    }
    case 'arrow': {
      const group = element as SVGGElement;
      const markerId = markerIdFor(layers, annotation.id);
      const defs = createSvgElement('defs');
      const marker = createSvgElement('marker');
      setAttributes(marker, {
        id: markerId,
        markerWidth: 8,
        markerHeight: 8,
        refX: 7,
        refY: 4,
        orient: 'auto',
        markerUnits: 'strokeWidth',
      });
      const head = createSvgElement('path');
      setAttributes(head, { d: 'M 0 0 L 8 4 L 0 8 z', fill: annotation.color });
      marker.appendChild(head);
      defs.appendChild(marker);

      const line = createSvgElement('line');
      setAttributes(line, {
        x1: annotation.start.x,
        y1: annotation.start.y,
        x2: annotation.end.x,
        y2: annotation.end.y,
        stroke: annotation.color,
        'stroke-width': annotation.width,
        'stroke-linecap': 'round',
        'marker-end': `url(#${markerId})`,
      });
      group.append(defs, line);
      break;
    }
    case 'highlight': {
      const group = element as SVGGElement;
      group.style.mixBlendMode = 'multiply';
      for (const area of annotation.rects) {
        const rect = createSvgElement('rect');
        setRectGeometry(rect, area);
        setAttributes(rect, {
          fill: annotation.color,
          'fill-opacity': 0.35,
          stroke: 'none',
        });
        group.appendChild(rect);
      }
      break;
    }
    case 'text':
    case 'note':
      throw new Error(`Expected an SVG annotation, received ${annotation.type}`);
  }

  return element;
}

function getOrCreateHtmlElement(
  layers: PageLayerRefs,
  annotation: Annotation,
): HTMLDivElement {
  const existing = findAnnotationElement(layers, annotation.id);
  if (existing instanceof HTMLDivElement) return existing;
  if (existing) removeLayerElement(layers, annotation.id);

  const element = document.createElement('div');
  getLayerState(layers).htmlContent.appendChild(element);
  registerElement(layers, annotation.id, element);
  return element;
}

function renderHtmlAnnotation(
  layers: PageLayerRefs,
  annotation: Extract<Annotation, { type: 'text' | 'note' }>,
  scale: number,
): HTMLDivElement {
  const element = getOrCreateHtmlElement(layers, annotation);
  element.removeAttribute('style');
  element.replaceChildren();
  tagAnnotationElement(element, annotation);
  element.className = annotation.type === 'text' ? 'ssv-anno-text' : 'ssv-anno-note';
  element.style.position = 'absolute';
  element.style.left = `${annotation.x * scale}px`;
  element.style.top = `${annotation.y * scale}px`;
  element.style.color = annotation.color;
  element.style.whiteSpace = 'pre-wrap';
  element.style.overflowWrap = 'anywhere';
  element.textContent = annotation.text;
  applyElementInteractivity(layers, element);

  if (annotation.type === 'text') {
    element.style.fontSize = `${annotation.fontSize * scale}px`;
  } else {
    element.dataset.noteText = annotation.text;
    element.title = annotation.text;
    element.style.fontSize = '';
  }
  return element;
}

export function renderAnnotation(
  layers: PageLayerRefs,
  annotation: Annotation,
  scale: number,
): SVGElement | HTMLDivElement {
  if (annotation.type === 'text' || annotation.type === 'note') {
    return renderHtmlAnnotation(layers, annotation, scale);
  }
  return renderSvgAnnotation(layers, annotation);
}

export function removeAnnotationEl(id: string, layers?: PageLayerRefs): void {
  if (layers) {
    removeLayerElement(layers, id);
    return;
  }

  for (const element of document.querySelectorAll(`[${ANNOTATION_ID_ATTR}]`)) {
    if (element.getAttribute(ANNOTATION_ID_ATTR) !== id) continue;
    const owner = elementOwners.get(element);
    if (owner) {
      removeLayerElement(owner.layers, owner.id);
    } else {
      unregisterElement(element);
      element.remove();
    }
  }
}

export function destroyPageLayers(layers: PageLayerRefs): void {
  const state = layerStates.get(layers);
  if (state) {
    for (const element of state.elements.values()) {
      unregisterElement(element);
    }
    state.elements.clear();
    state.markerIds.clear();
    if (pageLayers.get(state.pageEl) === layers) {
      pageLayers.delete(state.pageEl);
    }
    layerStates.delete(layers);
  }

  layers.svg.remove();
  layers.html.remove();
  state?.preview.remove();
  state?.selection.remove();
}

export function setInteractive(pageEl: HTMLElement, on: boolean): void {
  const layers = pageLayers.get(pageEl);
  if (!layers) return;

  const state = getLayerState(layers);
  state.interactive = on;
  layers.svg.style.pointerEvents = 'none';
  layers.html.style.pointerEvents = 'none';
  state.preview.style.pointerEvents = 'none';
  state.selection.style.pointerEvents = 'none';
  for (const element of state.elements.values()) {
    applyElementInteractivity(layers, element);
  }
}
