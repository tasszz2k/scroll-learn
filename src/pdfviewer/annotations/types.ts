export interface AnnotationPoint {
  x: number;
  y: number;
}

export interface AnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AnnotationBase {
  id: string;
  docId: string;
  pageIndex: number;
  color: string;
}

export interface InkAnnotation extends AnnotationBase {
  type: 'ink';
  points: AnnotationPoint[];
  width: number;
  opacity?: number;
}

export interface HighlightAnnotation extends AnnotationBase {
  type: 'highlight';
  rects: AnnotationRect[];
}

export interface RectAnnotation extends AnnotationBase {
  type: 'rect';
  rect: AnnotationRect;
  width: number;
  fill: boolean;
}

export interface EllipseAnnotation extends AnnotationBase {
  type: 'ellipse';
  rect: AnnotationRect;
  width: number;
  fill: boolean;
}

export interface LineAnnotation extends AnnotationBase {
  type: 'line';
  start: AnnotationPoint;
  end: AnnotationPoint;
  width: number;
}

export interface ArrowAnnotation extends AnnotationBase {
  type: 'arrow';
  start: AnnotationPoint;
  end: AnnotationPoint;
  width: number;
}

export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export interface NoteAnnotation extends AnnotationBase {
  type: 'note';
  x: number;
  y: number;
  text: string;
}

export type Annotation =
  | InkAnnotation
  | HighlightAnnotation
  | RectAnnotation
  | EllipseAnnotation
  | LineAnnotation
  | ArrowAnnotation
  | TextAnnotation
  | NoteAnnotation;

export type ToolId =
  | 'hand'
  | 'select'
  | 'text'
  | 'highlight'
  | 'note'
  | 'pencil'
  | 'highlighter'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'eraser';

export interface ToolState {
  activeTool: ToolId;
  color: string;
  width: number;
  fontSize: number;
  fill: boolean;
}
