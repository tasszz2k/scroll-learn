import { createAnnotationHistory, type AnnotationPersistenceFailure } from './history';
import {
  renderAnnotation,
  removeAnnotationEl,
  setInteractive,
  type PageLayerRefs,
} from './layer';
import * as annotationStore from './store';
import {
  mountPageAnnotationTools,
  type AnnotationMutation,
  type PageToolBinding,
} from './tools';
import type { Annotation, ToolState } from './types';

const DEFAULT_TOOL_STATE: ToolState = {
  activeTool: 'hand',
  color: '#c96442',
  width: 2,
  fontSize: 16,
  fill: false,
};

export interface AnnotationPageInfo {
  el: HTMLElement;
  scale: number;
  pageIndex: number;
  annotationLayers: PageLayerRefs;
}

export interface AnnotationPluckControls {
  remount: () => void;
  unmount: () => void;
  setHoverEnabled: (enabled: boolean) => void;
}

export type AnnotationHistoryStateListener = (canUndo: boolean, canRedo: boolean) => void;

export interface AnnotationController {
  setTool(state: Readonly<ToolState>): void;
  undo(): void;
  redo(): void;
  setHistoryStateListener(listener: AnnotationHistoryStateListener | null): void;
  destroy(): void;
}

export async function initAnnotationController(
  docId: string,
  pageInfos: readonly AnnotationPageInfo[],
  pluckControls: AnnotationPluckControls,
): Promise<AnnotationController> {
  if (!docId) throw new Error('A PDF fingerprint is required for annotation persistence');

  const pagesByIndex = new Map(pageInfos.map(page => [page.pageIndex, page]));
  let annotations: readonly Annotation[] = await annotationStore.getForDoc(docId);
  let toolState: Readonly<ToolState> = Object.freeze({ ...DEFAULT_TOOL_STATE });
  let historyStateListener: AnnotationHistoryStateListener | null = null;
  let destroyed = false;
  const bindings = new Map<number, PageToolBinding>();

  const reportPersistenceFailure = (failure: AnnotationPersistenceFailure): void => {
    console.error(
      `[ScrollLearn:pdfviewer] annotation ${failure.operation} failed during ${failure.direction}:`,
      failure.error,
    );
  };

  const renderStoredAnnotation = (annotation: Annotation): void => {
    const page = pagesByIndex.get(annotation.pageIndex);
    if (!page || annotation.docId !== docId) return;
    renderAnnotation(page.annotationLayers, annotation, page.scale);
  };

  const renderAllAnnotations = (): void => {
    for (const annotation of annotations) renderStoredAnnotation(annotation);
  };

  const history = createAnnotationHistory({
    source: {
      getAnnotations: () => annotations,
      setAnnotations: next => {
        annotations = next;
        // Re-appending in source order keeps visual stacking aligned with the
        // exact order restored by an atomic undo or redo batch.
        renderAllAnnotations();
      },
    },
    renderer: {
      render: annotation => renderStoredAnnotation(annotation),
      remove: id => removeAnnotationEl(id),
    },
    onPersistenceFailure: reportPersistenceFailure,
  });

  const notifyHistoryState = (): void => {
    historyStateListener?.(history.canUndo(), history.canRedo());
  };

  const refreshBindings = (): void => {
    for (const binding of bindings.values()) binding.refresh();
  };

  const command = (mutations: readonly AnnotationMutation[]): void => {
    if (destroyed) throw new Error('Annotation controller has been destroyed');
    history.push(mutations);
    refreshBindings();
    notifyHistoryState();
  };

  const unmountTools = (): void => {
    for (const binding of bindings.values()) binding.teardown();
    bindings.clear();
    for (const page of pageInfos) setInteractive(page.el, false);
  };

  const mountTools = (): void => {
    for (const page of pageInfos) {
      setInteractive(page.el, true);
      const binding = mountPageAnnotationTools({
        docId,
        pageIndex: page.pageIndex,
        pointScale: page.scale,
        layers: page.annotationLayers,
        getToolState: () => toolState,
        annotations: { getAnnotations: () => annotations },
        command,
      });
      bindings.set(page.pageIndex, binding);
    }
  };

  const enterCurrentMode = (): void => {
    for (const page of pageInfos) {
      page.el.dataset.annotationTool = toolState.activeTool;
    }
    pluckControls.setHoverEnabled(true);
    if (toolState.activeTool === 'hand') {
      unmountTools();
      pluckControls.remount();
      return;
    }

    pluckControls.unmount();
    if (bindings.size === 0) mountTools();
    else refreshBindings();
  };

  renderAllAnnotations();
  enterCurrentMode();

  const controller: AnnotationController = {
    setTool: nextState => {
      if (destroyed) throw new Error('Annotation controller has been destroyed');
      const previousTool = toolState.activeTool;
      toolState = Object.freeze({ ...nextState });
      if (previousTool !== toolState.activeTool) {
        for (const binding of bindings.values()) binding.clearSelection();
      }
      enterCurrentMode();
    },
    undo: () => {
      if (destroyed || !history.undo()) return;
      refreshBindings();
      notifyHistoryState();
    },
    redo: () => {
      if (destroyed || !history.redo()) return;
      refreshBindings();
      notifyHistoryState();
    },
    setHistoryStateListener: listener => {
      if (destroyed) return;
      historyStateListener = listener;
      notifyHistoryState();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      historyStateListener = null;
      unmountTools();
      history.destroy();
      pluckControls.unmount();
      pluckControls.setHoverEnabled(false);
      for (const page of pageInfos) delete page.el.dataset.annotationTool;
    },
  };

  return controller;
}
