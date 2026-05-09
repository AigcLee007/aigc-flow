import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  Baseline,
  Brush,
  ChevronDown,
  Circle,
  Eraser,
  MousePointer2,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { canvasToBlobUrl, getImageNaturalSize } from '../utils/imageUtils';

type Tool = 'select' | 'brush' | 'shape' | 'text' | 'mosaic' | 'eraser';
type ShapeTool = 'arrow' | 'rect' | 'ellipse';
type TextDirection = 'horizontal' | 'vertical';
type TextTransformMode = 'move' | 'rotate' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type Layer =
  | { id: string; type: 'brush'; segments: Array<Array<{ x: number; y: number }>>; color: string; stroke: number }
  | { id: string; type: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; stroke: number }
  | { id: string; type: 'rect'; x: number; y: number; width: number; height: number; color: string; stroke: number }
  | { id: string; type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; color: string; stroke: number }
  | { id: string; type: 'text'; x: number; y: number; width: number; height: number; text: string; color: string; fontSize: number; direction: TextDirection; rotation: number }
  | { id: string; type: 'mosaic'; points: Array<{ x: number; y: number }>; radius: number; blockSize: number };

interface ImageAnnotateOverlayProps {
  imageUrl: string;
  initialWidth?: number;
  initialHeight?: number;
  onConfirm: (resultUrl: string, naturalWidth: number, naturalHeight: number) => void;
  onCancel: () => void;
}

interface DisplayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HistoryEntry {
  layers: Layer[];
  selectedLayerId: string | null;
}

type BrushLayer = Extract<Layer, { type: 'brush' }>;
type LegacyBrushLayer = BrushLayer & { points?: Array<{ x: number; y: number }> };

interface EraserSession {
  snapshot: HistoryEntry;
  changed: boolean;
}

const colors = ['#ff1d1d', '#ffffff', '#111827', '#0ea5e9', '#22c55e', '#f59e0b', '#a855f7'];
const DEFAULT_TEXT_VALUE = '\u6211\u7684\u6587\u672c';
const TEXT_PLACEHOLDER = '\u8f93\u5165\u6587\u5b57';
const TITLE_SELECT = '\u9009\u62e9';
const TITLE_BRUSH = '\u753b\u7b14';
const TITLE_SHAPE = '\u5f62\u72b6';
const TITLE_ARROW = '\u7bad\u5934';
const TITLE_RECT = '\u77e9\u5f62';
const TITLE_ELLIPSE = '\u5706\u5f62';
const TITLE_TEXT = '\u6587\u5b57';
const TITLE_TEXT_HORIZONTAL = '\u6a2a\u5411\u6587\u5b57';
const TITLE_TEXT_VERTICAL = '\u7ad6\u5411\u6587\u5b57';
const TITLE_MOSAIC = '\u9a6c\u8d5b\u514b';
const TITLE_ERASER = '\u6a61\u76ae';
const TITLE_COLOR = '\u989c\u8272';
const TITLE_UNDO = '\u64a4\u9500';
const TITLE_REDO = '\u524d\u8fdb';
const TITLE_DELETE = '\u5220\u9664';
const TITLE_CLEAR_ALL = '\u6e05\u7a7a\u5168\u90e8';
const TITLE_ROTATE_TEXT = '\u65cb\u8f6c\u6587\u5b57';
const ALT_ANNOTATE_IMAGE = '\u6807\u6ce8\u56fe\u7247';
const ERASER_RADIUS = 20;
const MIN_TEXT_BOX_SIZE = 32;

const textHandles: Array<{
  mode: Exclude<TextTransformMode, 'move' | 'rotate'>;
  left: string;
  top: string;
  cursor: React.CSSProperties['cursor'];
}> = [
  { mode: 'nw', left: '-7px', top: '-7px', cursor: 'nwse-resize' },
  { mode: 'n', left: 'calc(50% - 6px)', top: '-7px', cursor: 'ns-resize' },
  { mode: 'ne', left: 'calc(100% - 5px)', top: '-7px', cursor: 'nesw-resize' },
  { mode: 'w', left: '-7px', top: 'calc(50% - 6px)', cursor: 'ew-resize' },
  { mode: 'e', left: 'calc(100% - 5px)', top: 'calc(50% - 6px)', cursor: 'ew-resize' },
  { mode: 'sw', left: '-7px', top: 'calc(100% - 5px)', cursor: 'nesw-resize' },
  { mode: 's', left: 'calc(50% - 6px)', top: 'calc(100% - 5px)', cursor: 'ns-resize' },
  { mode: 'se', left: 'calc(100% - 5px)', top: 'calc(100% - 5px)', cursor: 'nwse-resize' },
];

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

function getBrushSegments(layer: LegacyBrushLayer) {
  if (Array.isArray(layer.segments)) return layer.segments;
  if (Array.isArray(layer.points)) return [layer.points];
  return [];
}

function cloneLayer(layer: Layer): Layer {
  if (layer.type === 'brush') {
    return {
      ...layer,
      segments: getBrushSegments(layer).map((segment) => segment.map((point) => ({ ...point }))),
    };
  }
  if (layer.type === 'mosaic') return { ...layer, points: layer.points.map((point) => ({ ...point })) };
  return { ...layer };
}

function cloneLayers(layers: Layer[]) {
  return layers.map(cloneLayer);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = url;
  });
}

function normalizeRect(startX: number, startY: number, endX: number, endY: number) {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function drawArrow(ctx: CanvasRenderingContext2D, item: Extract<Layer, { type: 'arrow' }>) {
  const angle = Math.atan2(item.y2 - item.y1, item.x2 - item.x1);
  const headLength = Math.max(12, item.stroke * 4);

  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(item.x1, item.y1);
  ctx.lineTo(item.x2, item.y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(item.x2, item.y2);
  ctx.lineTo(
    item.x2 - headLength * Math.cos(angle - Math.PI / 6),
    item.y2 - headLength * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    item.x2 - headLength * Math.cos(angle + Math.PI / 6),
    item.y2 - headLength * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function drawBrushPath(ctx: CanvasRenderingContext2D, item: Extract<Layer, { type: 'brush' }>) {
  ctx.strokeStyle = item.color;
  ctx.lineWidth = item.stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  getBrushSegments(item).forEach((segment) => {
    if (segment.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(segment[0].x, segment[0].y);
    segment.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();
  });
}

function pixelateCircle(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  blockSize: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const x = Math.max(0, Math.round(centerX - radius));
  const y = Math.max(0, Math.round(centerY - radius));
  const width = Math.min(canvasWidth - x, Math.round(radius * 2));
  const height = Math.min(canvasHeight - y, Math.round(radius * 2));
  if (width < 2 || height < 2) return;

  const scale = Math.max(0.04, Math.min(0.22, blockSize / Math.max(width, height)));
  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = Math.max(1, Math.round(width * scale));
  smallCanvas.height = Math.max(1, Math.round(height * scale));
  const smallCtx = smallCanvas.getContext('2d');
  if (!smallCtx) return;

  smallCtx.drawImage(ctx.canvas, x, y, width, height, 0, 0, smallCanvas.width, smallCanvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(smallCanvas, 0, 0, smallCanvas.width, smallCanvas.height, x, y, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.restore();
}

function getLayerBounds(layer: Layer) {
  if (layer.type === 'text') return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  if (layer.type === 'rect') return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  if (layer.type === 'ellipse') return { x: layer.cx - layer.rx, y: layer.cy - layer.ry, width: layer.rx * 2, height: layer.ry * 2 };
  if (layer.type === 'arrow') {
    return {
      x: Math.min(layer.x1, layer.x2),
      y: Math.min(layer.y1, layer.y2),
      width: Math.max(1, Math.abs(layer.x2 - layer.x1)),
      height: Math.max(1, Math.abs(layer.y2 - layer.y1)),
    };
  }
  if (layer.type === 'brush') {
    const points = getBrushSegments(layer).flat();
    if (!points.length) return { x: 0, y: 0, width: 1, height: 1 };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const padding = layer.stroke;
    return {
      x: Math.min(...xs) - padding,
      y: Math.min(...ys) - padding,
      width: Math.max(1, Math.max(...xs) - Math.min(...xs) + padding * 2),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys) + padding * 2),
    };
  }

  const xs = layer.points.map((point) => point.x);
  const ys = layer.points.map((point) => point.y);
  return {
    x: Math.min(...xs) - layer.radius,
    y: Math.min(...ys) - layer.radius,
    width: Math.max(1, Math.max(...xs) - Math.min(...xs) + layer.radius * 2),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys) + layer.radius * 2),
  };
}

function distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

function isPointInTextLayer(point: { x: number; y: number }, item: Extract<Layer, { type: 'text' }>, padding = 12) {
  const centerX = item.x + item.width / 2;
  const centerY = item.y + item.height / 2;
  const angle = (-item.rotation * Math.PI) / 180;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle) + centerX;
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle) + centerY;
  return (
    localX >= item.x - padding &&
    localX <= item.x + item.width + padding &&
    localY >= item.y - padding &&
    localY <= item.y + item.height + padding
  );
}

function hitTestLayer(point: { x: number; y: number }, layer: Layer) {
  if (layer.type === 'text') return isPointInTextLayer(point, layer);
  if (layer.type === 'rect') {
    return point.x >= layer.x - 10 && point.x <= layer.x + layer.width + 10 && point.y >= layer.y - 10 && point.y <= layer.y + layer.height + 10;
  }
  if (layer.type === 'ellipse') {
    const rx = Math.max(1, layer.rx + 10);
    const ry = Math.max(1, layer.ry + 10);
    return (((point.x - layer.cx) ** 2) / (rx ** 2)) + (((point.y - layer.cy) ** 2) / (ry ** 2)) <= 1;
  }
  if (layer.type === 'arrow') {
    return distanceToSegment(point, { x: layer.x1, y: layer.y1 }, { x: layer.x2, y: layer.y2 }) <= Math.max(12, layer.stroke * 2);
  }
  if (layer.type === 'brush') {
    for (const segment of getBrushSegments(layer)) {
      for (let index = 0; index < segment.length - 1; index += 1) {
        if (distanceToSegment(point, segment[index], segment[index + 1]) <= Math.max(12, layer.stroke * 1.6)) {
          return true;
        }
      }
    }
    return false;
  }
  return layer.points.some((mosaicPoint) => Math.hypot(point.x - mosaicPoint.x, point.y - mosaicPoint.y) <= layer.radius + 10);
}

function moveLayer(layer: Layer, deltaX: number, deltaY: number): Layer {
  if (layer.type === 'text') return { ...layer, x: layer.x + deltaX, y: layer.y + deltaY };
  if (layer.type === 'rect') return { ...layer, x: layer.x + deltaX, y: layer.y + deltaY };
  if (layer.type === 'ellipse') return { ...layer, cx: layer.cx + deltaX, cy: layer.cy + deltaY };
  if (layer.type === 'arrow') return { ...layer, x1: layer.x1 + deltaX, y1: layer.y1 + deltaY, x2: layer.x2 + deltaX, y2: layer.y2 + deltaY };
  if (layer.type === 'brush') {
    return {
      ...layer,
      segments: getBrushSegments(layer).map((segment) => segment.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY }))),
    };
  }
  return { ...layer, points: layer.points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY })) };
}

function eraseBrushPoints(layer: Extract<Layer, { type: 'brush' }>, point: { x: number; y: number }, radius: number) {
  let removed = false;
  const nextSegments = getBrushSegments(layer).flatMap((segment) => {
    const denseSegment = densifySegment(segment, Math.max(2, Math.min(radius * 0.35, layer.stroke * 0.5)));
    const keptSegments: Array<Array<{ x: number; y: number }>> = [];
    let current: Array<{ x: number; y: number }> = [];

    denseSegment.forEach((brushPoint) => {
      const keep = Math.hypot(brushPoint.x - point.x, brushPoint.y - point.y) > radius;
      if (keep) {
        current.push(brushPoint);
        return;
      }

      removed = true;
      if (current.length >= 2) keptSegments.push(current);
      current = [];
    });

    if (current.length >= 2) keptSegments.push(current);
    return keptSegments;
  });

  if (!removed) return layer;
  if (!nextSegments.length) return null;
  return { ...layer, segments: nextSegments };
}

function eraseMosaicPoints(layer: Extract<Layer, { type: 'mosaic' }>, point: { x: number; y: number }, radius: number) {
  const keptPoints = layer.points.filter((mosaicPoint) => Math.hypot(mosaicPoint.x - point.x, mosaicPoint.y - point.y) > radius);
  if (!keptPoints.length) return null;
  return { ...layer, points: keptPoints };
}

function eraseAtPoint(layers: Layer[], point: { x: number; y: number }, radius: number) {
  let changed = false;
  const nextLayers: Layer[] = [];

  layers.forEach((layer) => {
    if (layer.type === 'brush') {
      const beforeSegments = getBrushSegments(layer);
      const beforePointCount = beforeSegments.reduce((sum, segment) => sum + segment.length, 0);
      const nextLayer = eraseBrushPoints(layer, point, radius);
      if (!nextLayer) {
        if (beforeSegments.some((segment) => segment.some((brushPoint) => Math.hypot(brushPoint.x - point.x, brushPoint.y - point.y) <= radius))) changed = true;
        return;
      }
      const afterSegments = getBrushSegments(nextLayer);
      const afterPointCount = afterSegments.reduce((sum, segment) => sum + segment.length, 0);
      if (afterPointCount !== beforePointCount || afterSegments.length !== beforeSegments.length) changed = true;
      nextLayers.push(nextLayer);
      return;
    }

    if (layer.type === 'mosaic') {
      const nextLayer = eraseMosaicPoints(layer, point, radius);
      if (!nextLayer) {
        if (layer.points.some((mosaicPoint) => Math.hypot(mosaicPoint.x - point.x, mosaicPoint.y - point.y) <= radius)) changed = true;
        return;
      }
      if (nextLayer.points.length !== layer.points.length) changed = true;
      nextLayers.push(nextLayer);
      return;
    }

    if (hitTestLayer(point, layer)) {
      changed = true;
      return;
    }

    nextLayers.push(layer);
  });

  return { layers: nextLayers, changed };
}

function samplePointsBetween(start: { x: number; y: number }, end: { x: number; y: number }, spacing: number) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (distance <= spacing) return [end];

  const points: Array<{ x: number; y: number }> = [];
  const steps = Math.max(1, Math.ceil(distance / spacing));
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    points.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    });
  }
  return points;
}

function densifySegment(segment: Array<{ x: number; y: number }>, spacing: number) {
  if (segment.length < 2) return segment;
  const points = [segment[0]];
  for (let index = 0; index < segment.length - 1; index += 1) {
    points.push(...samplePointsBetween(segment[index], segment[index + 1], spacing));
  }
  return points;
}

function transformTextLayer(layer: Extract<Layer, { type: 'text' }>, mode: TextTransformMode, deltaX: number, deltaY: number, naturalSize: { width: number; height: number }) {
  if (mode === 'move') {
    return {
      ...layer,
      x: Math.max(0, Math.min(naturalSize.width - layer.width, layer.x + deltaX)),
      y: Math.max(0, Math.min(naturalSize.height - layer.height, layer.y + deltaY)),
    };
  }

  if (mode === 'rotate') return layer;

  let nextX = layer.x;
  let nextY = layer.y;
  let nextWidth = layer.width;
  let nextHeight = layer.height;

  if (mode.includes('e')) nextWidth = Math.max(MIN_TEXT_BOX_SIZE, layer.width + deltaX);
  if (mode.includes('s')) nextHeight = Math.max(MIN_TEXT_BOX_SIZE, layer.height + deltaY);
  if (mode.includes('w')) {
    const right = layer.x + layer.width;
    nextX = Math.min(right - MIN_TEXT_BOX_SIZE, layer.x + deltaX);
    nextWidth = right - nextX;
  }
  if (mode.includes('n')) {
    const bottom = layer.y + layer.height;
    nextY = Math.min(bottom - MIN_TEXT_BOX_SIZE, layer.y + deltaY);
    nextHeight = bottom - nextY;
  }

  nextX = Math.max(0, Math.min(naturalSize.width - MIN_TEXT_BOX_SIZE, nextX));
  nextY = Math.max(0, Math.min(naturalSize.height - MIN_TEXT_BOX_SIZE, nextY));
  nextWidth = Math.max(MIN_TEXT_BOX_SIZE, Math.min(naturalSize.width - nextX, nextWidth));
  nextHeight = Math.max(MIN_TEXT_BOX_SIZE, Math.min(naturalSize.height - nextY, nextHeight));

  return {
    ...layer,
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
    fontSize: layer.direction === 'vertical' ? Math.max(12, nextWidth * 0.68) : Math.max(12, nextHeight * 0.68),
  };
}

function renderShapeIcon(shape: ShapeTool) {
  if (shape === 'arrow') return <ArrowUpRight size={20} />;
  if (shape === 'rect') return <Square size={20} />;
  return <Circle size={20} />;
}

export const ImageAnnotateOverlay: React.FC<ImageAnnotateOverlayProps> = ({
  imageUrl,
  initialWidth,
  initialHeight,
  onConfirm,
  onCancel,
}) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const annotationsRef = useRef<Layer[]>([]);
  const textEditSnapshotRef = useRef<HistoryEntry | null>(null);
  const eraserSessionRef = useRef<EraserSession | null>(null);
  const brushLastPointRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const interactionRef = useRef<{
    type: 'move' | 'text-transform';
    layerId: string;
    snapshot: HistoryEntry;
    startClientX: number;
    startClientY: number;
    startLayer: Layer;
    centerClientX?: number;
    centerClientY?: number;
    startPointerAngle?: number;
    textMode?: TextTransformMode;
    changed: boolean;
  } | null>(null);
  const eraserLastPointRef = useRef<{ x: number; y: number } | null>(null);

  const [naturalSize, setNaturalSize] = useState({ width: initialWidth || 1024, height: initialHeight || 1024 });
  const [displayBox, setDisplayBox] = useState<DisplayBox | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [shapeTool, setShapeTool] = useState<ShapeTool>('arrow');
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [color, setColor] = useState('#ff1d1d');
  const [colorOpen, setColorOpen] = useState(false);
  const [textDirection, setTextDirection] = useState<TextDirection>('horizontal');
  const [stroke, setStroke] = useState(5);
  const [annotations, setAnnotations] = useState<Layer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Layer | null>(null);
  const [hoveredLayerId, setHoveredLayerId] = useState<string | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [isTextEditing, setIsTextEditing] = useState(false);
  const [historyPast, setHistoryPast] = useState<HistoryEntry[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistoryEntry[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const selectedLayer = useMemo(
    () => annotations.find((layer) => layer.id === selectedLayerId) || null,
    [annotations, selectedLayerId],
  );
  const selectedTextLayer = selectedLayer?.type === 'text' ? selectedLayer : null;

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    if (selectedLayerId && !annotations.some((layer) => layer.id === selectedLayerId)) {
      setSelectedLayerId(null);
      setIsTextEditing(false);
    }
  }, [annotations, selectedLayerId]);

  useEffect(() => {
    if (selectedTextLayer) {
      setColor(selectedTextLayer.color);
      setTextDirection(selectedTextLayer.direction);
      setStroke(Math.max(2, Math.min(18, Math.round(selectedTextLayer.fontSize / 8))));
    }
  }, [selectedTextLayer]);

  const viewBox = useMemo(() => `0 0 ${naturalSize.width} ${naturalSize.height}`, [naturalSize]);
  const displayScale = useMemo(() => {
    if (!displayBox) return { x: 1, y: 1, avg: 1 };
    const x = displayBox.width / naturalSize.width;
    const y = displayBox.height / naturalSize.height;
    return { x, y, avg: (x + y) / 2 };
  }, [displayBox, naturalSize.height, naturalSize.width]);

  const measureImage = () => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    setDisplayBox({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  };

  const getHistorySnapshot = (): HistoryEntry => ({
    layers: cloneLayers(annotationsRef.current),
    selectedLayerId,
  });

  const commitSnapshot = (snapshot: HistoryEntry, nextLayers: Layer[], nextSelectedLayerId: string | null) => {
    annotationsRef.current = cloneLayers(nextLayers);
    setAnnotations(nextLayers);
    setSelectedLayerId(nextSelectedLayerId);
    setHistoryPast((items) => [...items, { layers: cloneLayers(snapshot.layers), selectedLayerId: snapshot.selectedLayerId }]);
    setHistoryFuture([]);
  };

  const applyCommittedUpdate = (updater: (layers: Layer[]) => { layers: Layer[]; selectedLayerId?: string | null }) => {
    const snapshot = getHistorySnapshot();
    const result = updater(cloneLayers(annotationsRef.current));
    commitSnapshot(snapshot, result.layers, result.selectedLayerId ?? selectedLayerId);
  };

  const applyTransientLayers = (nextLayers: Layer[]) => {
    annotationsRef.current = cloneLayers(nextLayers);
    setAnnotations(nextLayers);
  };

  const finishTextEditing = () => {
    if (!isTextEditing) return;
    const snapshot = textEditSnapshotRef.current;
    textEditSnapshotRef.current = null;
    setIsTextEditing(false);
    if (!snapshot) return;
    const before = JSON.stringify(snapshot.layers);
    const after = JSON.stringify(annotationsRef.current);
    if (before !== after) {
      setHistoryPast((items) => [...items, { layers: cloneLayers(snapshot.layers), selectedLayerId: snapshot.selectedLayerId }]);
      setHistoryFuture([]);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finishTextEditing();
        onCancel();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        if (!historyPast.length) return;
        const prev = historyPast[historyPast.length - 1];
        setHistoryPast((items) => items.slice(0, -1));
        setHistoryFuture((items) => [{ layers: cloneLayers(annotationsRef.current), selectedLayerId }, ...items]);
        annotationsRef.current = cloneLayers(prev.layers);
        setAnnotations(prev.layers);
        setSelectedLayerId(prev.selectedLayerId);
        setIsTextEditing(false);
      }
      if (
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y')
      ) {
        event.preventDefault();
        if (!historyFuture.length) return;
        const [next, ...rest] = historyFuture;
        setHistoryFuture(rest);
        setHistoryPast((items) => [...items, { layers: cloneLayers(annotationsRef.current), selectedLayerId }]);
        annotationsRef.current = cloneLayers(next.layers);
        setAnnotations(next.layers);
        setSelectedLayerId(next.selectedLayerId);
        setIsTextEditing(false);
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLayerId) {
        event.preventDefault();
        applyCommittedUpdate((layers) => ({
          layers: layers.filter((layer) => layer.id !== selectedLayerId),
          selectedLayerId: null,
        }));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', measureImage);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', measureImage);
    };
  }, [historyFuture, historyPast, onCancel, selectedLayerId]);

  useEffect(() => {
    if (initialWidth && initialHeight) return;
    getImageNaturalSize(imageUrl).then((size) => {
      setNaturalSize({ width: size.w, height: size.h });
    }).catch(() => undefined);
  }, [imageUrl, initialHeight, initialWidth]);

  useEffect(() => {
    if (selectedTextLayer && isTextEditing) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isTextEditing, selectedTextLayer]);

  useEffect(() => {
    if (hoveredLayerId && !annotations.some((layer) => layer.id === hoveredLayerId)) {
      setHoveredLayerId(null);
    }
  }, [annotations, hoveredLayerId]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!interactionRef.current || !displayBox) return;
      const interaction = interactionRef.current;
      const deltaX = ((event.clientX - interaction.startClientX) / displayBox.width) * naturalSize.width;
      const deltaY = ((event.clientY - interaction.startClientY) / displayBox.height) * naturalSize.height;

      if (interaction.type === 'move') {
        const nextLayers = annotationsRef.current.map((layer) => {
          if (layer.id !== interaction.layerId) return layer;
          return moveLayer(interaction.startLayer, deltaX, deltaY);
        });
        interaction.changed = Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5;
        applyTransientLayers(nextLayers);
        return;
      }

      if (
        interaction.type === 'text-transform' &&
        interaction.startLayer.type === 'text' &&
        interaction.textMode === 'rotate' &&
        interaction.centerClientX !== undefined &&
        interaction.centerClientY !== undefined &&
        interaction.startPointerAngle !== undefined
      ) {
        const nextPointerAngle = Math.atan2(event.clientY - interaction.centerClientY, event.clientX - interaction.centerClientX);
        const nextRotation = interaction.startLayer.rotation + ((nextPointerAngle - interaction.startPointerAngle) * 180) / Math.PI;
        const nextLayers = annotationsRef.current.map((layer) => (
          layer.id === interaction.layerId && layer.type === 'text'
            ? { ...interaction.startLayer, rotation: nextRotation }
            : layer
        ));
        interaction.changed = Math.abs(nextRotation - interaction.startLayer.rotation) > 0.2;
        applyTransientLayers(nextLayers);
        return;
      }

      if (interaction.type === 'text-transform' && interaction.startLayer.type === 'text' && interaction.textMode) {
        const nextTextLayer = transformTextLayer(interaction.startLayer, interaction.textMode, deltaX, deltaY, naturalSize);
        interaction.changed =
          Math.abs(nextTextLayer.x - interaction.startLayer.x) > 0.5 ||
          Math.abs(nextTextLayer.y - interaction.startLayer.y) > 0.5 ||
          Math.abs(nextTextLayer.width - interaction.startLayer.width) > 0.5 ||
          Math.abs(nextTextLayer.height - interaction.startLayer.height) > 0.5;
        const nextLayers = annotationsRef.current.map((layer) => (
          layer.id === interaction.layerId && layer.type === 'text' ? nextTextLayer : layer
        ));
        applyTransientLayers(nextLayers);
      }
    };

    const onPointerUp = () => {
      if (!interactionRef.current) return;
      const interaction = interactionRef.current;
      interactionRef.current = null;
      if (!interaction.changed) return;
      setHistoryPast((items) => [...items, { layers: cloneLayers(interaction.snapshot.layers), selectedLayerId: interaction.snapshot.selectedLayerId }]);
      setHistoryFuture([]);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [displayBox, naturalSize]);

  useEffect(() => {
    const onPointerUp = () => {
      if (!eraserSessionRef.current) return;
      const session = eraserSessionRef.current;
      eraserSessionRef.current = null;
      eraserLastPointRef.current = null;
      if (!session.changed) return;
      setHistoryPast((items) => [...items, { layers: cloneLayers(session.snapshot.layers), selectedLayerId: session.snapshot.selectedLayerId }]);
      setHistoryFuture([]);
    };

    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  }, []);

  const toImagePoint = (event: React.PointerEvent | PointerEvent) => {
    if (!displayBox) return null;
    return {
      x: ((event.clientX - displayBox.x) / displayBox.width) * naturalSize.width,
      y: ((event.clientY - displayBox.y) / displayBox.height) * naturalSize.height,
    };
  };

  const toScreenPoint = (x: number, y: number) => {
    if (!displayBox) return { x: 0, y: 0 };
    return {
      x: displayBox.x + (x / naturalSize.width) * displayBox.width,
      y: displayBox.y + (y / naturalSize.height) * displayBox.height,
    };
  };

  const getHitLayer = (point: { x: number; y: number }) => {
    const hitLayer = [...annotationsRef.current].reverse().find((layer) => hitTestLayer(point, layer));
    return hitLayer || null;
  };

  const beginLayerMove = (layer: Layer, event: React.PointerEvent | PointerEvent) => {
    interactionRef.current = {
      type: 'move',
      layerId: layer.id,
      snapshot: getHistorySnapshot(),
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLayer: cloneLayer(layer),
      changed: false,
    };
  };

  const beginTextTransform = (mode: TextTransformMode) => (event: React.PointerEvent) => {
    if (!selectedTextLayer) return;
    event.preventDefault();
    event.stopPropagation();
    finishTextEditing();
    const center = toScreenPoint(selectedTextLayer.x + selectedTextLayer.width / 2, selectedTextLayer.y + selectedTextLayer.height / 2);
    interactionRef.current = {
      type: 'text-transform',
      layerId: selectedTextLayer.id,
      snapshot: getHistorySnapshot(),
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLayer: cloneLayer(selectedTextLayer),
      centerClientX: center.x,
      centerClientY: center.y,
      startPointerAngle: Math.atan2(event.clientY - center.y, event.clientX - center.x),
      textMode: mode,
      changed: false,
    };
  };

  const updateSelectedTextLayer = (updater: (layer: Extract<Layer, { type: 'text' }>) => Extract<Layer, { type: 'text' }>) => {
    if (!selectedTextLayer) return;
    const nextLayers = annotationsRef.current.map((layer) => (
      layer.id === selectedTextLayer.id && layer.type === 'text' ? updater(layer) : layer
    ));
    applyTransientLayers(nextLayers);
  };

  const updateSelectedLayerStyle = (nextColor: string) => {
    if (!selectedLayerId) return;
    applyCommittedUpdate((layers) => ({
      layers: layers.map((layer) => {
        if (layer.id !== selectedLayerId) return layer;
        if ('color' in layer) return { ...layer, color: nextColor };
        return layer;
      }),
    }));
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = toImagePoint(event);
    if (!point) return;
    event.preventDefault();
    const hitLayer = getHitLayer(point);
    setHoveredLayerId(hitLayer?.id ?? null);

    if (tool === 'eraser') {
      const snapshot = getHistorySnapshot();
      const result = eraseAtPoint(cloneLayers(annotationsRef.current), point, ERASER_RADIUS);
      eraserSessionRef.current = { snapshot, changed: result.changed };
      eraserLastPointRef.current = point;
      setSelectedLayerId(null);
      if (result.changed) {
        annotationsRef.current = cloneLayers(result.layers);
        setAnnotations(result.layers);
      }
      return;
    }

    if (tool === 'text') {
      finishTextEditing();
      const fontSize = Math.max(24, stroke * 8);
      const width = textDirection === 'horizontal' ? naturalSize.width * 0.34 : fontSize * 1.7;
      const height = textDirection === 'horizontal' ? fontSize * 1.65 : naturalSize.height * 0.34;
      const x = Math.max(0, Math.min(naturalSize.width - width, point.x - width / 2));
      const y = Math.max(0, Math.min(naturalSize.height - height, point.y - height / 2));
      const nextTextLayer: Extract<Layer, { type: 'text' }> = {
        id: createId(),
        type: 'text',
        x,
        y,
        width,
        height,
        text: DEFAULT_TEXT_VALUE,
        color,
        fontSize,
        direction: textDirection,
        rotation: 0,
      };
      const snapshot = getHistorySnapshot();
      const nextLayers = [...cloneLayers(annotationsRef.current), nextTextLayer];
      commitSnapshot(snapshot, nextLayers, nextTextLayer.id);
      setIsTextEditing(true);
      textEditSnapshotRef.current = snapshot;
      setTool('select');
      return;
    }

    if (tool === 'select') {
      finishTextEditing();
      if (!hitLayer) {
        setSelectedLayerId(null);
        return;
      }
      setSelectedLayerId(hitLayer.id);
      if (hitLayer.type === 'text') {
        setColor(hitLayer.color);
        setTextDirection(hitLayer.direction);
      } else if ('color' in hitLayer) {
        setColor(hitLayer.color);
      }
      beginLayerMove(hitLayer, event);
      return;
    }

    dragStartRef.current = point;
    if (tool === 'brush') {
      setDraft({ id: createId(), type: 'brush', segments: [[point]], color, stroke });
      brushLastPointRef.current = point;
      return;
    }
    if (tool === 'shape') {
      if (shapeTool === 'arrow') {
        setDraft({ id: createId(), type: 'arrow', x1: point.x, y1: point.y, x2: point.x, y2: point.y, color, stroke });
      }
      if (shapeTool === 'rect') {
        setDraft({ id: createId(), type: 'rect', x: point.x, y: point.y, width: 0, height: 0, color, stroke });
      }
      if (shapeTool === 'ellipse') {
        setDraft({ id: createId(), type: 'ellipse', cx: point.x, cy: point.y, rx: 0, ry: 0, color, stroke });
      }
      return;
    }
    if (tool === 'mosaic') {
      setDraft({ id: createId(), type: 'mosaic', points: [point], radius: stroke * 4, blockSize: stroke * 5 });
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = toImagePoint(event);
    if (point) {
      setHoverPoint(point);
      const hitLayer = getHitLayer(point);
      setHoveredLayerId(hitLayer?.id ?? null);
      if (tool === 'eraser' && eraserSessionRef.current) {
        const sampleStart = eraserLastPointRef.current || point;
        const samples = samplePointsBetween(sampleStart, point, Math.max(6, ERASER_RADIUS * 0.4));
        let currentLayers = cloneLayers(annotationsRef.current);
        let changed = false;

        samples.forEach((samplePoint) => {
          const result = eraseAtPoint(currentLayers, samplePoint, ERASER_RADIUS);
          if (result.changed) {
            changed = true;
            currentLayers = result.layers;
          }
        });

        eraserLastPointRef.current = point;
        if (changed) {
          eraserSessionRef.current.changed = true;
          annotationsRef.current = cloneLayers(currentLayers);
          setAnnotations(currentLayers);
          setSelectedLayerId(null);
        }
        return;
      }
    }

    if (!dragStartRef.current || !draft) return;
    if (!point) return;
    const start = dragStartRef.current;

    if (draft.type === 'brush') {
      const lastSegment = draft.segments[draft.segments.length - 1] || [];
      const sampledPoints = brushLastPointRef.current
        ? samplePointsBetween(brushLastPointRef.current, point, Math.max(2, stroke * 0.35))
        : [point];
      const nextSegment = [...lastSegment, ...sampledPoints];
      brushLastPointRef.current = point;
      setDraft({
        ...draft,
        segments: [...draft.segments.slice(0, -1), nextSegment],
      });
      return;
    }
    if (draft.type === 'arrow') {
      setDraft({ ...draft, x2: point.x, y2: point.y });
      return;
    }
    if (draft.type === 'rect') {
      setDraft({ ...draft, ...normalizeRect(start.x, start.y, point.x, point.y) });
      return;
    }
    if (draft.type === 'ellipse') {
      const rect = normalizeRect(start.x, start.y, point.x, point.y);
      setDraft({ ...draft, cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, rx: rect.width / 2, ry: rect.height / 2 });
      return;
    }
    if (draft.type === 'mosaic') {
      setDraft({ ...draft, points: [...draft.points, point] });
    }
  };

  const handlePointerUp = () => {
    if (!draft) return;
    const meaningful =
      draft.type === 'brush'
        ? draft.segments.some((segment) => segment.length > 1)
        : draft.type === 'mosaic'
          ? draft.points.length > 0
          : draft.type === 'arrow'
            ? Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 8
            : draft.type === 'ellipse'
              ? draft.rx > 4 && draft.ry > 4
              : draft.width > 8 && draft.height > 8;

    if (meaningful) {
      const snapshot = getHistorySnapshot();
      const nextLayers = [...cloneLayers(annotationsRef.current), draft];
      commitSnapshot(snapshot, nextLayers, null);
    }

    setDraft(null);
    dragStartRef.current = null;
    brushLastPointRef.current = null;
  };

  const renderLayer = (layer: Layer) => {
    if (layer.type === 'text' && selectedTextLayer?.id === layer.id) return null;

    if (layer.type === 'arrow') {
      return (
        <g key={layer.id}>
          <defs>
            <marker id={`arrow-${layer.id}`} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill={layer.color} />
            </marker>
          </defs>
          <line
            x1={layer.x1}
            y1={layer.y1}
            x2={layer.x2}
            y2={layer.y2}
            stroke={layer.color}
            strokeWidth={layer.stroke}
            strokeLinecap="round"
            markerEnd={`url(#arrow-${layer.id})`}
          />
        </g>
      );
    }

    if (layer.type === 'brush') {
      return (
        <g key={layer.id}>
          {getBrushSegments(layer).map((segment, index) => {
            if (segment.length < 2) return null;
            const path = segment.map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
            return (
              <path
                key={`${layer.id}-${index}`}
                d={path}
                fill="none"
                stroke={layer.color}
                strokeWidth={layer.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </g>
      );
    }

    if (layer.type === 'rect') {
      return <rect key={layer.id} x={layer.x} y={layer.y} width={layer.width} height={layer.height} fill="none" stroke={layer.color} strokeWidth={layer.stroke} rx={2} />;
    }

    if (layer.type === 'ellipse') {
      return <ellipse key={layer.id} cx={layer.cx} cy={layer.cy} rx={layer.rx} ry={layer.ry} fill="none" stroke={layer.color} strokeWidth={layer.stroke} />;
    }

    if (layer.type === 'text') {
      const centerX = layer.x + layer.width / 2;
      const centerY = layer.y + layer.height / 2;
      if (layer.direction === 'vertical') {
        return (
          <g key={layer.id} transform={`rotate(${layer.rotation} ${centerX} ${centerY})`}>
            {Array.from(layer.text).map((char, index) => (
              <text
                key={`${layer.id}-${index}`}
                x={layer.x + layer.width / 2}
                y={layer.y + index * layer.fontSize * 1.05}
                fill={layer.color}
                fontSize={layer.fontSize}
                fontWeight={800}
                dominantBaseline="hanging"
                textAnchor="middle"
              >
                {char}
              </text>
            ))}
          </g>
        );
      }

      return (
        <text
          key={layer.id}
          x={layer.x}
          y={layer.y}
          fill={layer.color}
          fontSize={layer.fontSize}
          fontWeight={800}
          dominantBaseline="hanging"
          transform={`rotate(${layer.rotation} ${centerX} ${centerY})`}
        >
          {layer.text}
        </text>
      );
    }

    return (
      <g key={layer.id}>
        {layer.points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={layer.radius}
            fill="rgba(255,255,255,0.18)"
            stroke="rgba(255,255,255,0.72)"
            strokeWidth={2}
          />
        ))}
      </g>
    );
  };

  const renderSelectionOverlay = () => {
    const highlightLayer = selectedLayer || annotations.find((layer) => layer.id === hoveredLayerId) || null;
    if (!highlightLayer || highlightLayer.type === 'text') return null;
    const bounds = getLayerBounds(highlightLayer);
    const isSelected = selectedLayer?.id === highlightLayer.id;
    const isHovered = !isSelected && hoveredLayerId === highlightLayer.id;
    const strokeColor = isSelected ? 'rgba(191,219,254,0.98)' : 'rgba(191,219,254,0.7)';
    const fillColor = isSelected ? 'rgba(191,219,254,0.06)' : 'rgba(191,219,254,0.03)';
    return (
      <g pointerEvents="none">
        <rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={isSelected ? 1.8 : 1.2}
          strokeDasharray={isSelected ? undefined : '5 5'}
          rx={12}
        />
        {isSelected && [
          { x: bounds.x, y: bounds.y },
          { x: bounds.x + bounds.width / 2, y: bounds.y },
          { x: bounds.x + bounds.width, y: bounds.y },
          { x: bounds.x, y: bounds.y + bounds.height / 2 },
          { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
          { x: bounds.x, y: bounds.y + bounds.height },
          { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
          { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        ].map((point, index) => (
          <g key={index}>
            <rect
              x={point.x - 5}
              y={point.y - 5}
              width={10}
              height={10}
              rx={2.5}
              fill="rgba(15,23,42,0.92)"
              stroke="rgba(191,219,254,0.98)"
              strokeWidth={1.5}
            />
            <rect
              x={point.x - 2}
              y={point.y - 2}
              width={4}
              height={4}
              rx={1}
              fill="rgba(255,255,255,0.75)"
            />
          </g>
        ))}
        {isHovered && !isSelected && (
          <rect
            x={bounds.x}
            y={bounds.y}
            width={bounds.width}
            height={bounds.height}
            fill="none"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth={5}
            rx={12}
          />
        )}
      </g>
    );
  };

  const handleSave = async () => {
    if (isSaving) return;
    finishTextEditing();
    setIsSaving(true);
    try {
      const img = await loadImage(imageUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const scaleX = canvas.width / naturalSize.width;
      const scaleY = canvas.height / naturalSize.height;
      const scaleStroke = (scaleX + scaleY) / 2;

      annotationsRef.current.forEach((layer) => {
        if (layer.type !== 'mosaic') return;
        layer.points.forEach((point) => {
          pixelateCircle(
            ctx,
            point.x * scaleX,
            point.y * scaleY,
            layer.radius * scaleStroke,
            layer.blockSize * scaleStroke,
            canvas.width,
            canvas.height,
          );
        });
      });

      annotationsRef.current.forEach((layer) => {
        if (layer.type === 'mosaic') return;
        if (layer.type === 'brush') {
          drawBrushPath(ctx, {
            ...layer,
            segments: getBrushSegments(layer).map((segment) => segment.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }))),
            stroke: layer.stroke * scaleStroke,
          });
        }
        if (layer.type === 'arrow') {
          drawArrow(ctx, {
            ...layer,
            x1: layer.x1 * scaleX,
            y1: layer.y1 * scaleY,
            x2: layer.x2 * scaleX,
            y2: layer.y2 * scaleY,
            stroke: layer.stroke * scaleStroke,
          });
        }
        if (layer.type === 'rect') {
          ctx.strokeStyle = layer.color;
          ctx.lineWidth = layer.stroke * scaleStroke;
          ctx.strokeRect(layer.x * scaleX, layer.y * scaleY, layer.width * scaleX, layer.height * scaleY);
        }
        if (layer.type === 'ellipse') {
          ctx.strokeStyle = layer.color;
          ctx.lineWidth = layer.stroke * scaleStroke;
          ctx.beginPath();
          ctx.ellipse(layer.cx * scaleX, layer.cy * scaleY, layer.rx * scaleX, layer.ry * scaleY, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (layer.type === 'text') {
          const centerX = (layer.x + layer.width / 2) * scaleX;
          const centerY = (layer.y + layer.height / 2) * scaleY;
          ctx.fillStyle = layer.color;
          ctx.font = `800 ${layer.fontSize * scaleStroke}px sans-serif`;
          ctx.textBaseline = 'top';
          ctx.save();
          ctx.translate(centerX, centerY);
          ctx.rotate((layer.rotation * Math.PI) / 180);
          if (layer.direction === 'vertical') {
            Array.from(layer.text).forEach((char, index) => {
              ctx.textAlign = 'center';
              ctx.fillText(char, 0, -(layer.height * scaleY) / 2 + index * layer.fontSize * scaleStroke * 1.05);
            });
            ctx.textAlign = 'left';
          } else {
            ctx.fillText(layer.text, -(layer.width * scaleX) / 2, -(layer.height * scaleY) / 2);
          }
          ctx.restore();
        }
      });

      const resultUrl = await canvasToBlobUrl(canvas);
      onConfirm(resultUrl, canvas.width, canvas.height);
    } finally {
      setIsSaving(false);
    }
  };

  const textScreenPoint = selectedTextLayer ? toScreenPoint(selectedTextLayer.x, selectedTextLayer.y) : null;
  const textScreenBox = selectedTextLayer
    ? {
        width: selectedTextLayer.width * displayScale.x,
        height: selectedTextLayer.height * displayScale.y,
        fontSize: selectedTextLayer.fontSize * displayScale.avg,
      }
    : null;

  const canRedo = historyFuture.length > 0;
  const canUndo = historyPast.length > 0;

  return createPortal(
    <div
      className="nodrag nopan nowheel"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0,0,0,0.82)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div style={toolbarStyle}>
        <button type="button" onClick={onCancel} style={iconButtonStyle(false)}><X size={22} /></button>
        <div style={dividerStyle} />
        <button type="button" onClick={() => { finishTextEditing(); setTool('select'); }} style={iconButtonStyle(tool === 'select')} title={TITLE_SELECT}><MousePointer2 size={21} /></button>
        <button type="button" onClick={() => { finishTextEditing(); setTool('brush'); }} style={iconButtonStyle(tool === 'brush')} title={TITLE_BRUSH}><Brush size={22} /></button>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => {
              finishTextEditing();
              setTool('shape');
              setShapeMenuOpen((open) => !open);
            }}
            style={{ ...iconButtonStyle(tool === 'shape'), width: 62, gap: 4 }}
            title={TITLE_SHAPE}
          >
            {renderShapeIcon(shapeTool)}
            <ChevronDown size={14} />
          </button>
          {shapeMenuOpen && (
            <div style={shapeMenuStyle}>
              {([
                { key: 'arrow', label: TITLE_ARROW },
                { key: 'rect', label: TITLE_RECT },
                { key: 'ellipse', label: TITLE_ELLIPSE },
              ] as const).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setShapeTool(item.key);
                    setTool('shape');
                    setShapeMenuOpen(false);
                  }}
                  style={shapeMenuItemStyle(shapeTool === item.key)}
                >
                  {renderShapeIcon(item.key)}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => { finishTextEditing(); setTool('text'); }} style={iconButtonStyle(tool === 'text')} title={TITLE_TEXT}><Type size={22} /></button>
        {(tool === 'text' || selectedTextLayer) && (
          <button
            type="button"
            onClick={() => {
              const nextDirection = textDirection === 'horizontal' ? 'vertical' : 'horizontal';
              setTextDirection(nextDirection);
              if (selectedTextLayer) {
                applyCommittedUpdate((layers) => ({
                  layers: layers.map((layer) => {
                    if (layer.id !== selectedTextLayer.id || layer.type !== 'text') return layer;
                    return {
                      ...layer,
                      direction: nextDirection,
                      fontSize: nextDirection === 'vertical' ? Math.max(12, layer.width * 0.68) : Math.max(12, layer.height * 0.68),
                    };
                  }),
                }));
              }
            }}
            style={iconButtonStyle(Boolean(selectedTextLayer) || tool === 'text')}
            title={textDirection === 'horizontal' ? TITLE_TEXT_HORIZONTAL : TITLE_TEXT_VERTICAL}
          >
            <Baseline size={21} style={{ transform: textDirection === 'vertical' ? 'rotate(90deg)' : 'none' }} />
          </button>
        )}
        <button type="button" onClick={() => { finishTextEditing(); setTool('mosaic'); }} style={iconButtonStyle(tool === 'mosaic')} title={TITLE_MOSAIC}><Circle size={21} fill="currentColor" opacity={0.75} /></button>
        <button type="button" onClick={() => { finishTextEditing(); setSelectedLayerId(null); setTool('eraser'); }} style={iconButtonStyle(tool === 'eraser')} title={TITLE_ERASER}><Eraser size={21} /></button>
        <div style={dividerStyle} />
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setColorOpen((open) => !open)}
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.85)',
              background: color,
              cursor: 'pointer',
              boxShadow: '0 0 0 4px rgba(255,255,255,0.08)',
            }}
            title={TITLE_COLOR}
          />
          {colorOpen && (
            <div style={colorPopoverStyle}>
              {colors.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setColor(item);
                    if (selectedLayerId) updateSelectedLayerStyle(item);
                    setColorOpen(false);
                  }}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    border: color === item ? '3px solid #fff' : '1px solid rgba(255,255,255,0.28)',
                    background: item,
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          )}
        </div>
        <div style={dividerStyle} />
        <input
          type="range"
          min={2}
          max={18}
          value={stroke}
          onChange={(event) => {
            const nextStroke = Number(event.target.value);
            setStroke(nextStroke);
            if (selectedTextLayer) {
              applyCommittedUpdate((layers) => ({
                layers: layers.map((layer) => {
                  if (layer.id !== selectedTextLayer.id || layer.type !== 'text') return layer;
                  return {
                    ...layer,
                    fontSize: Math.max(24, nextStroke * 8),
                    height: layer.direction === 'horizontal' ? Math.max(36, nextStroke * 8 * 1.65) : layer.height,
                    width: layer.direction === 'vertical' ? Math.max(36, nextStroke * 8 * 1.7) : layer.width,
                  };
                }),
              }));
            }
          }}
          style={{ width: 112 }}
        />
        <button
          type="button"
          onClick={() => {
            if (!canUndo) return;
            const prev = historyPast[historyPast.length - 1];
            setHistoryPast((items) => items.slice(0, -1));
            setHistoryFuture((items) => [{ layers: cloneLayers(annotationsRef.current), selectedLayerId }, ...items]);
            annotationsRef.current = cloneLayers(prev.layers);
            setAnnotations(prev.layers);
            setSelectedLayerId(prev.selectedLayerId);
            setIsTextEditing(false);
          }}
          disabled={!canUndo}
          style={iconButtonStyle(canUndo)}
          title={TITLE_UNDO}
        >
          <Undo2 size={19} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (!canRedo) return;
            const [next, ...rest] = historyFuture;
            setHistoryFuture(rest);
            setHistoryPast((items) => [...items, { layers: cloneLayers(annotationsRef.current), selectedLayerId }]);
            annotationsRef.current = cloneLayers(next.layers);
            setAnnotations(next.layers);
            setSelectedLayerId(next.selectedLayerId);
            setIsTextEditing(false);
          }}
          disabled={!canRedo}
          style={iconButtonStyle(canRedo)}
          title={TITLE_REDO}
        >
          <Redo2 size={19} />
        </button>
        <button
          type="button"
          onClick={() => {
            finishTextEditing();
            if (selectedLayerId) {
              applyCommittedUpdate((layers) => ({
                layers: layers.filter((layer) => layer.id !== selectedLayerId),
                selectedLayerId: null,
              }));
              return;
            }
            if (!annotationsRef.current.length) return;
            applyCommittedUpdate(() => ({ layers: [], selectedLayerId: null }));
          }}
          style={iconButtonStyle(Boolean(selectedLayerId || annotations.length))}
          title={selectedLayerId ? TITLE_DELETE : TITLE_CLEAR_ALL}
        >
          <Trash2 size={19} />
        </button>
        <button type="button" onClick={handleSave} disabled={isSaving} style={saveButtonStyle(isSaving)}>
          <Save size={18} />
          {isSaving ? 'Saving' : 'Save'}
        </button>
      </div>

      <div style={{ position: 'relative' }}>
        <img
          ref={imgRef}
          src={imageUrl}
          alt={ALT_ANNOTATE_IMAGE}
          draggable={false}
          onLoad={measureImage}
          style={{
            maxWidth: '86vw',
            maxHeight: '74vh',
            objectFit: 'contain',
            display: 'block',
            border: '2px solid rgba(14,165,233,0.75)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
            userSelect: 'none',
          }}
        />
        {displayBox && (
          <svg
            viewBox={viewBox}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => {
              setHoveredLayerId(null);
              setHoverPoint(null);
              handlePointerUp();
            }}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              cursor:
                tool === 'text'
                  ? 'text'
                  : tool === 'select'
                    ? 'default'
                    : tool === 'eraser'
                      ? 'cell'
                      : 'crosshair',
            }}
          >
            {annotations.map(renderLayer)}
            {draft ? renderLayer(draft) : null}
            {renderSelectionOverlay()}
            {tool === 'eraser' && hoverPoint && (
              <g pointerEvents="none">
                <circle
                  cx={hoverPoint.x}
                  cy={hoverPoint.y}
                  r={ERASER_RADIUS}
                  fill="rgba(255,255,255,0.05)"
                  stroke="rgba(255,255,255,0.88)"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
                <circle
                  cx={hoverPoint.x}
                  cy={hoverPoint.y}
                  r={2}
                  fill="rgba(255,255,255,0.95)"
                />
              </g>
            )}
          </svg>
        )}
      </div>

      {selectedTextLayer && textScreenPoint && textScreenBox && (
        <div
          onPointerDown={!isTextEditing ? beginTextTransform('move') : undefined}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!textEditSnapshotRef.current) textEditSnapshotRef.current = getHistorySnapshot();
            setIsTextEditing(true);
          }}
          style={{
            position: 'fixed',
            left: textScreenPoint.x,
            top: textScreenPoint.y,
            zIndex: 10001,
            width: textScreenBox.width,
            height: textScreenBox.height,
            minWidth: 32,
            minHeight: 32,
            border: '1.5px solid rgba(191,219,254,0.98)',
            borderRadius: 6,
            background: isTextEditing ? 'rgba(15,23,42,0.06)' : 'transparent',
            cursor: isTextEditing ? 'default' : 'move',
            transform: `rotate(${selectedTextLayer.rotation}deg)`,
            transformOrigin: 'center center',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.04)',
          }}
        >
          <span
            onPointerDown={beginTextTransform('rotate')}
            style={{
              position: 'absolute',
              left: 'calc(50% - 6px)',
              top: -54,
              width: 12,
              height: 12,
              border: '1.5px solid rgba(191,219,254,0.98)',
              background: 'rgba(15,23,42,0.9)',
              borderRadius: 3,
              cursor: 'grab',
              zIndex: 3,
            }}
            title={TITLE_ROTATE_TEXT}
          />
          <span
            style={{
              position: 'absolute',
              left: '50%',
              top: -43,
              width: 1,
              height: 43,
              background: 'rgba(191,219,254,0.75)',
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
            }}
          />
          {textHandles.map((handle) => (
            <span
              key={handle.mode}
              onPointerDown={beginTextTransform(handle.mode)}
              style={{
                position: 'absolute',
                left: handle.left,
                top: handle.top,
                width: 11,
                height: 11,
                border: '1.5px solid rgba(191,219,254,0.98)',
                background: 'rgba(15,23,42,0.9)',
                borderRadius: 2,
                cursor: handle.cursor,
                zIndex: 2,
              }}
            />
          ))}
          {isTextEditing ? (
            <textarea
              ref={inputRef}
              value={selectedTextLayer.text}
              onChange={(event) => {
                if (!textEditSnapshotRef.current) textEditSnapshotRef.current = getHistorySnapshot();
                updateSelectedTextLayer((layer) => ({ ...layer, text: event.target.value || DEFAULT_TEXT_VALUE }));
              }}
              onBlur={finishTextEditing}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) finishTextEditing();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  finishTextEditing();
                }
              }}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                background: 'transparent',
                color: selectedTextLayer.color,
                padding: 0,
                fontSize: Math.max(12, textScreenBox.fontSize),
                fontWeight: 800,
                lineHeight: 1.08,
                outline: 'none',
                resize: 'none',
                overflow: 'hidden',
                writingMode: selectedTextLayer.direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
                textOrientation: selectedTextLayer.direction === 'vertical' ? 'upright' : 'mixed',
                fontFamily: 'inherit',
                cursor: 'text',
              }}
              placeholder={TEXT_PLACEHOLDER}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                color: selectedTextLayer.color,
                fontSize: Math.max(12, textScreenBox.fontSize),
                fontWeight: 800,
                lineHeight: 1.08,
                whiteSpace: 'pre-wrap',
                overflow: 'hidden',
                writingMode: selectedTextLayer.direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
                textOrientation: selectedTextLayer.direction === 'vertical' ? 'upright' : 'mixed',
                textShadow: '0 1px 1px rgba(0,0,0,0.12)',
                userSelect: 'none',
              }}
            >
              {selectedTextLayer.text || DEFAULT_TEXT_VALUE}
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
};

const toolbarStyle: React.CSSProperties = {
  position: 'fixed',
  top: 38,
  left: '50%',
  transform: 'translateX(-50%)',
  minHeight: 72,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '0 14px',
  borderRadius: 36,
  background: 'rgba(28,28,28,0.96)',
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 18px 56px rgba(0,0,0,0.46)',
  backdropFilter: 'blur(16px)',
  zIndex: 10002,
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 34,
  background: 'rgba(255,255,255,0.13)',
};

const iconButtonStyle = (active: boolean): React.CSSProperties => ({
  width: 48,
  height: 48,
  borderRadius: '50%',
  border: 'none',
  background: active ? 'rgba(255,255,255,0.2)' : 'transparent',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: active ? 'pointer' : 'default',
  opacity: active ? 1 : 0.45,
});

const shapeMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 12px)',
  left: '50%',
  transform: 'translateX(-50%)',
  minWidth: 132,
  padding: 8,
  borderRadius: 18,
  background: 'rgba(28,28,28,0.98)',
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 14px 40px rgba(0,0,0,0.42)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  zIndex: 10004,
};

const shapeMenuItemStyle = (active: boolean): React.CSSProperties => ({
  border: 'none',
  borderRadius: 12,
  background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
});

const colorPopoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 14px)',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 30px)',
  gap: 8,
  padding: 10,
  borderRadius: 16,
  background: 'rgba(28,28,28,0.98)',
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
};

const saveButtonStyle = (disabled: boolean): React.CSSProperties => ({
  border: 'none',
  borderRadius: 28,
  padding: '13px 24px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: disabled ? 'rgba(255,255,255,0.45)' : '#fff',
  color: '#111',
  fontWeight: 700,
  fontSize: 16,
  cursor: disabled ? 'wait' : 'pointer',
});
