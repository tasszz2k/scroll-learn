import * as annotationStore from './store';
import type { AnnotationMutation } from './tools';
import type { Annotation, AnnotationPoint, AnnotationRect } from './types';

export interface AnnotationHistorySource {
  getAnnotations: () => readonly Annotation[];
  setAnnotations: (annotations: readonly Annotation[]) => void;
}

export interface AnnotationHistoryRenderer {
  render: (annotation: Annotation, index: number) => void;
  remove: (id: string) => void;
}

export interface AnnotationHistoryPersistence {
  put: (annotation: Annotation) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export type AnnotationHistoryDirection = 'push' | 'undo' | 'redo';

export interface AnnotationPersistenceFailure {
  error: unknown;
  operation: 'put' | 'remove';
  annotationId: string;
  direction: AnnotationHistoryDirection;
}

export interface AnnotationHistoryOptions {
  source: AnnotationHistorySource;
  renderer: AnnotationHistoryRenderer;
  persistence?: AnnotationHistoryPersistence;
  onPersistenceFailure?: (failure: AnnotationPersistenceFailure) => void;
}

type HistoryMutation =
  | { type: 'create'; after: Annotation; sourceIndex: number }
  | { type: 'update'; before: Annotation; after: Annotation; sourceIndex: number }
  | { type: 'delete'; before: Annotation; sourceIndex: number };

interface HistoryEntry {
  mutations: readonly HistoryMutation[];
}

interface PersistenceOperation {
  type: 'put' | 'remove';
  annotation?: Annotation;
  annotationId: string;
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

function freezeAnnotation(annotation: Annotation): Annotation {
  switch (annotation.type) {
    case 'ink':
      annotation.points.forEach(Object.freeze);
      Object.freeze(annotation.points);
      break;
    case 'highlight':
      annotation.rects.forEach(Object.freeze);
      Object.freeze(annotation.rects);
      break;
    case 'rect':
    case 'ellipse':
      Object.freeze(annotation.rect);
      break;
    case 'line':
    case 'arrow':
      Object.freeze(annotation.start);
      Object.freeze(annotation.end);
      break;
    case 'text':
    case 'note':
      break;
  }
  return Object.freeze(annotation);
}

function snapshot(annotation: Annotation): Annotation {
  return freezeAnnotation(cloneAnnotation(annotation));
}

function annotationIndex(annotations: readonly Annotation[], id: string): number {
  return annotations.findIndex(annotation => annotation.id === id);
}

function requireAnnotationIndex(annotations: readonly Annotation[], id: string): number {
  const index = annotationIndex(annotations, id);
  if (index < 0) throw new Error(`Annotation ${id} is missing from the history source`);
  return index;
}

function insertAt(annotations: Annotation[], annotation: Annotation, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > annotations.length) {
    throw new RangeError(`Annotation history index ${index} is outside the current source`);
  }
  annotations.splice(index, 0, annotation);
}

function captureEntry(
  mutations: readonly AnnotationMutation[],
  currentAnnotations: readonly Annotation[],
): HistoryEntry {
  const annotations = [...currentAnnotations];
  const snapshots: HistoryMutation[] = [];

  for (const mutation of mutations) {
    switch (mutation.type) {
      case 'create': {
        const after = snapshot(mutation.after);
        if (annotationIndex(annotations, after.id) >= 0) {
          throw new Error(`Annotation ${after.id} already exists in the history source`);
        }
        const sourceIndex = annotations.length;
        snapshots.push(Object.freeze({ type: 'create', after, sourceIndex }));
        annotations.push(after);
        break;
      }
      case 'update': {
        const before = snapshot(mutation.before);
        const after = snapshot(mutation.after);
        const sourceIndex = requireAnnotationIndex(annotations, before.id);
        snapshots.push(Object.freeze({ type: 'update', before, after, sourceIndex }));
        annotations[sourceIndex] = after;
        break;
      }
      case 'delete': {
        const before = snapshot(mutation.before);
        const sourceIndex = requireAnnotationIndex(annotations, before.id);
        snapshots.push(Object.freeze({ type: 'delete', before, sourceIndex }));
        annotations.splice(sourceIndex, 1);
        break;
      }
    }
  }

  return Object.freeze({ mutations: Object.freeze(snapshots) });
}

export class AnnotationHistory {
  private readonly source: AnnotationHistorySource;
  private readonly renderer: AnnotationHistoryRenderer;
  private readonly persistence: AnnotationHistoryPersistence;
  private readonly onPersistenceFailure?: (failure: AnnotationPersistenceFailure) => void;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private persistenceTail: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor(options: AnnotationHistoryOptions) {
    this.source = options.source;
    this.renderer = options.renderer;
    this.persistence = options.persistence ?? annotationStore;
    this.onPersistenceFailure = options.onPersistenceFailure;
  }

  push(mutations: readonly AnnotationMutation[]): void {
    this.assertActive();
    if (mutations.length === 0) return;

    const entry = captureEntry(mutations, this.source.getAnnotations());
    this.apply(entry, false, 'push');
    this.undoStack.push(entry);
    this.redoStack.length = 0;
  }

  undo(): boolean {
    if (this.destroyed) return false;
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry) return false;

    this.apply(entry, true, 'undo');
    this.undoStack.pop();
    this.redoStack.push(entry);
    return true;
  }

  redo(): boolean {
    if (this.destroyed) return false;
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry) return false;

    this.apply(entry, false, 'redo');
    this.redoStack.pop();
    this.undoStack.push(entry);
    return true;
  }

  canUndo(): boolean {
    return !this.destroyed && this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return !this.destroyed && this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clear();
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new Error('Annotation history has been destroyed');
    }
  }

  private apply(
    entry: HistoryEntry,
    reverse: boolean,
    direction: AnnotationHistoryDirection,
  ): void {
    const mutations = reverse ? [...entry.mutations].reverse() : entry.mutations;
    const annotations = [...this.source.getAnnotations()];
    const persistenceOperations: PersistenceOperation[] = [];

    for (const mutation of mutations) {
      if (mutation.type === 'create') {
        if (reverse) {
          const currentIndex = annotationIndex(annotations, mutation.after.id);
          if (currentIndex >= 0) annotations.splice(currentIndex, 1);
          persistenceOperations.push({ type: 'remove', annotationId: mutation.after.id });
        } else {
          insertAt(annotations, mutation.after, mutation.sourceIndex);
          persistenceOperations.push({
            type: 'put',
            annotation: mutation.after,
            annotationId: mutation.after.id,
          });
        }
      } else if (mutation.type === 'delete') {
        if (reverse) {
          insertAt(annotations, mutation.before, mutation.sourceIndex);
          persistenceOperations.push({
            type: 'put',
            annotation: mutation.before,
            annotationId: mutation.before.id,
          });
        } else {
          const currentIndex = annotationIndex(annotations, mutation.before.id);
          if (currentIndex >= 0) annotations.splice(currentIndex, 1);
          persistenceOperations.push({ type: 'remove', annotationId: mutation.before.id });
        }
      } else {
        const removedId = reverse ? mutation.after.id : mutation.before.id;
        const currentIndex = annotationIndex(annotations, removedId);
        if (currentIndex >= 0) annotations.splice(currentIndex, 1);
        const annotation = reverse ? mutation.before : mutation.after;
        insertAt(annotations, annotation, mutation.sourceIndex);
        if (removedId !== annotation.id) {
          persistenceOperations.push({ type: 'remove', annotationId: removedId });
        }
        persistenceOperations.push({
          type: 'put',
          annotation,
          annotationId: annotation.id,
        });
      }
    }

    this.source.setAnnotations(Object.freeze(annotations));

    for (const operation of persistenceOperations) {
      if (operation.type === 'put' && operation.annotation) {
        this.renderer.render(
          operation.annotation,
          annotationIndex(annotations, operation.annotationId),
        );
      } else {
        this.renderer.remove(operation.annotationId);
      }
    }

    this.enqueuePersistence(persistenceOperations, direction);
  }

  private enqueuePersistence(
    operations: readonly PersistenceOperation[],
    direction: AnnotationHistoryDirection,
  ): void {
    const persist = async (): Promise<void> => {
      for (const operation of operations) {
        try {
          if (operation.type === 'put' && operation.annotation) {
            await this.persistence.put(operation.annotation);
          } else {
            await this.persistence.remove(operation.annotationId);
          }
        } catch (error) {
          try {
            this.onPersistenceFailure?.({
              error,
              operation: operation.type,
              annotationId: operation.annotationId,
              direction,
            });
          } catch {
            // A reporting callback must not break persistence ordering for later commands.
          }
        }
      }
    };

    this.persistenceTail = this.persistenceTail.then(persist, persist);
  }
}

export function createAnnotationHistory(options: AnnotationHistoryOptions): AnnotationHistory {
  return new AnnotationHistory(options);
}
