/**
 * Main React Flow canvas component.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  SelectionMode,
  type Connection,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  useReactFlow,
} from '@xyflow/react';
import { Blocks, CircleHelp, Crosshair, FolderPlus, Grip, MapPinned, MessageSquareWarning } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import '../flowCanvas.css';

import {
  AudioNodeComponent,
  GroupNodeComponent,
  ImageEditorNodeComponent,
  ImageNodeComponent,
  TextNodeComponent,
  UploadNodeComponent,
  VideoNodeComponent,
} from '../nodes/FlowNodes';
import { SmartEdgeComponent } from '../edges/SmartEdge';
import { useFlowCanvasStore } from '../store/flowCanvasStore';
import { ConnectionMenu } from './ConnectionMenu';
import { FlowContextMenu } from './FlowContextMenu';
import { FlowLeftAddPanel } from './FlowLeftAddPanel';
import type { FlowNodeData } from '../types';
import { fitMediaNodeToShortSide } from '../utils/nodeSizing';
import { fileToDataUrl } from '../utils/imageUtils';
import { canConnectFlowNodes } from '../rules/connectionRules';

const CANVAS_MIN_ZOOM = 0.3;
const CANVAS_MAX_ZOOM = 2.35;
const CONNECTION_MENU_WIDTH = 432;
const CONNECTION_MENU_HEIGHT = 488;
const CONNECTION_MENU_MARGIN = 28;
const clampZoom = (zoom: number) => Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, zoom));

const isBrowserZoomShortcut = (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey)) return false;
  const key = event.key.toLowerCase();
  return key === '+' || key === '=' || key === '-' || key === '_' || key === '0';
};

const getBrowserZoomShortcutZoom = (event: KeyboardEvent, currentZoom: number) => {
  const key = event.key.toLowerCase();
  if (key === '0') return 1;
  if (key === '+' || key === '=') return currentZoom * 1.12;
  return currentZoom / 1.12;
};

const clampScreenValue = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const getConnectionMenuLayout = (x: number, y: number) => {
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
  const opensRight = x + CONNECTION_MENU_WIDTH + CONNECTION_MENU_MARGIN <= viewportWidth;
  const rawLeft = opensRight ? x + CONNECTION_MENU_MARGIN : x - CONNECTION_MENU_WIDTH - CONNECTION_MENU_MARGIN;
  const rawTop = y - 72;
  const left = clampScreenValue(rawLeft, CONNECTION_MENU_MARGIN, Math.max(CONNECTION_MENU_MARGIN, viewportWidth - CONNECTION_MENU_WIDTH - CONNECTION_MENU_MARGIN));
  const top = clampScreenValue(rawTop, CONNECTION_MENU_MARGIN, Math.max(CONNECTION_MENU_MARGIN, viewportHeight - CONNECTION_MENU_HEIGHT - CONNECTION_MENU_MARGIN));
  const anchorX = opensRight ? left : left + CONNECTION_MENU_WIDTH;
  const anchorY = clampScreenValue(y, top + 86, top + CONNECTION_MENU_HEIGHT - 64);

  return { left, top, anchorX, anchorY };
};

const nodeTypes: NodeTypes = {
  text: TextNodeComponent,
  image: ImageNodeComponent,
  video: VideoNodeComponent,
  audio: AudioNodeComponent,
  upload: UploadNodeComponent,
  image_editor: ImageEditorNodeComponent,
  group: GroupNodeComponent,
};

const edgeTypes: EdgeTypes = {
  smart: SmartEdgeComponent,
};

type ImportedImageSource = {
  url: string;
  title: string;
  originalImageUrl?: string;
  file?: File;
};

const IMAGE_FILE_RE = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const INTERNAL_REFERENCE_DRAG_TYPE = 'application/x-flow-reference-chip';

const isImageFile = (file: File) => file.type.startsWith('image/') || IMAGE_FILE_RE.test(file.name);

const isEditableElement = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tagName = element.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || element.isContentEditable) return true;
  return !!element.closest('input, textarea, select, [contenteditable="true"]');
};

const hasImageTransfer = (dataTransfer: DataTransfer | null) => {
  if (!dataTransfer) return false;
  if (Array.from(dataTransfer.types || []).includes(INTERNAL_REFERENCE_DRAG_TYPE)) return false;
  if (Array.from(dataTransfer.files || []).some(isImageFile)) return true;
  return Array.from(dataTransfer.types || []).some((type) => ['Files', 'text/html', 'text/uri-list'].includes(type));
};

const getImportedImageSize = (url: string) =>
  new Promise<{ naturalWidth: number; naturalHeight: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({
      naturalWidth: img.naturalWidth || img.width || 1,
      naturalHeight: img.naturalHeight || img.height || 1,
    });
    img.onerror = reject;
    img.src = url;
  });

const titleFromFileName = (name: string, fallback = '图片') => {
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/\.[^.]+$/, '') || fallback;
};

const collectImageSources = (data: DataTransfer | ClipboardEvent['clipboardData'] | null): ImportedImageSource[] => {
  if (!data) return [];
  const sources: ImportedImageSource[] = [];
  const seen = new Set<string>();

  const addUrl = (url: string, title = '图片') => {
    const clean = url.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    sources.push({ url: clean, title });
  };

  Array.from(data.files || []).forEach((file) => {
    if (!isImageFile(file)) return;
    const url = URL.createObjectURL(file);
    sources.push({
      url,
      title: titleFromFileName(file.name),
      originalImageUrl: url,
      file,
    });
  });

  if (sources.length === 0 && 'items' in data && data.items) {
    Array.from(data.items).forEach((item) => {
      if (item.kind !== 'file') return;
      const file = item.getAsFile();
      if (!file || !isImageFile(file)) return;
      const url = URL.createObjectURL(file);
      sources.push({
        url,
        title: titleFromFileName(file.name),
        originalImageUrl: url,
        file,
      });
    });
  }

  const html = data.getData('text/html');
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('img').forEach((img) => {
      if (img.src) addUrl(img.src, img.alt || img.title || '网页图片');
    });
  }

  const uri = data.getData('text/uri-list').split(/\r?\n/).find((line) => line && !line.startsWith('#'));
  if (uri) addUrl(uri, titleFromFileName(uri.split('/').pop() || '', '网页图片'));

  return sources;
};

interface AiFlowCanvasProps {
  cullingEnabled: boolean;
}

export const AiFlowCanvas: React.FC<AiFlowCanvasProps> = ({ cullingEnabled }) => {
  const nodes = useFlowCanvasStore((s) => s.nodes);
  const edges = useFlowCanvasStore((s) => s.edges);
  const viewport = useFlowCanvasStore((s) => s.viewport);
  const onNodesChange = useFlowCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowCanvasStore((s) => s.onEdgesChange);
  const onConnect = useFlowCanvasStore((s) => s.onConnect);
  const setViewport = useFlowCanvasStore((s) => s.setViewport);
  const openContextMenu = useFlowCanvasStore((s) => s.openContextMenu);
  const closeContextMenu = useFlowCanvasStore((s) => s.closeContextMenu);
  const closeImageTool = useFlowCanvasStore((s) => s.closeImageTool);
  const leftPanelOpen = useFlowCanvasStore((s) => s.leftPanelOpen);
  const pushHistory = useFlowCanvasStore((s) => s.pushHistory);
  const setNodeDragging = useFlowCanvasStore((s) => s.setNodeDragging);
  const addNode = useFlowCanvasStore((s) => s.addNode);
  const groupSelectedNodes = useFlowCanvasStore((s) => s.groupSelectedNodes);
  const deleteSelectedNodes = useFlowCanvasStore((s) => s.deleteSelectedNodes);
  const deleteSelectedEdges = useFlowCanvasStore((s) => s.deleteSelectedEdges);
  const reactFlow = useReactFlow();
  const { screenToFlowPosition } = reactFlow;
  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedEdges = edges.filter((edge) => edge.selected);

  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(false);
  const [connMenu, setConnMenu] = useState<{
    x: number;
    y: number;
    flowX: number;
    flowY: number;
    sourceNodeId: string;
  } | null>(null);

  const connectingNodeRef = useRef<string | null>(null);
  const canvasRootRef = useRef<HTMLDivElement>(null);

  const handleNodeDragStart = useCallback((_event: React.MouseEvent, node: Node) => {
    pushHistory();
    setNodeDragging(true);
  }, [pushHistory, setNodeDragging]);

  const handleNodeDragStop = useCallback(() => {
    setNodeDragging(false);
  }, [setNodeDragging]);

  const handleIsValidConnection = useCallback((connection: Connection) => {
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    return canConnectFlowNodes(sourceNode, targetNode).ok;
  }, [nodes]);

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(event.clientX, event.clientY, node.id);
    },
    [openContextMenu],
  );

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      openContextMenu('clientX' in event ? event.clientX : 0, 'clientY' in event ? event.clientY : 0);
    },
    [openContextMenu],
  );

  const handlePaneClick = useCallback(() => {
    closeContextMenu();
    closeImageTool();
    setConnMenu(null);
  }, [closeContextMenu, closeImageTool]);

  const handleCanvasDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest('.react-flow')) return;
      if (target.closest('.react-flow__node, .react-flow__edge, .react-flow__handle, .nodrag, .nopan, button, input, textarea, select')) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      closeImageTool();
      setConnMenu(null);
      openContextMenu(event.clientX, event.clientY);
    },
    [closeImageTool, openContextMenu],
  );

  const handleMoveEnd = useCallback(
    (_event: any, nextViewport: { x: number; y: number; zoom: number }) => {
      setViewport(nextViewport);
    },
    [setViewport],
  );

  const zoomCanvasTo = useCallback(
    (zoom: number, origin?: { clientX: number; clientY: number }, duration = 0) => {
      const nextZoom = clampZoom(zoom);
      const currentViewport = reactFlow.getViewport();
      let nextViewport = { ...currentViewport, zoom: nextZoom };

      if (origin && canvasRootRef.current) {
        const rect = canvasRootRef.current.getBoundingClientRect();
        const flowPoint = screenToFlowPosition({ x: origin.clientX, y: origin.clientY });
        nextViewport = {
          x: origin.clientX - rect.left - flowPoint.x * nextZoom,
          y: origin.clientY - rect.top - flowPoint.y * nextZoom,
          zoom: nextZoom,
        };
      }

      setViewport(nextViewport);
      void reactFlow.setViewport(nextViewport, { duration }).then(() => {
        setViewport(reactFlow.getViewport());
      });
    },
    [reactFlow, screenToFlowPosition, setViewport],
  );

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const currentViewport = reactFlow.getViewport();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomCanvasTo(currentViewport.zoom * factor, { clientX: event.clientX, clientY: event.clientY });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isBrowserZoomShortcut(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = canvasRootRef.current?.getBoundingClientRect();
      const currentViewport = reactFlow.getViewport();
      const origin = rect
        ? { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
        : undefined;
      zoomCanvasTo(getBrowserZoomShortcutZoom(event, currentViewport.zoom), origin, 80);
    };

    const preventGestureZoom = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('gesturestart', preventGestureZoom, { capture: true, passive: false } as AddEventListenerOptions);
    window.addEventListener('gesturechange', preventGestureZoom, { capture: true, passive: false } as AddEventListenerOptions);
    window.addEventListener('gestureend', preventGestureZoom, { capture: true, passive: false } as AddEventListenerOptions);

    return () => {
      window.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('gesturestart', preventGestureZoom, { capture: true } as EventListenerOptions);
      window.removeEventListener('gesturechange', preventGestureZoom, { capture: true } as EventListenerOptions);
      window.removeEventListener('gestureend', preventGestureZoom, { capture: true } as EventListenerOptions);
    };
  }, [reactFlow, zoomCanvasTo]);

  const handleConnectStart = useCallback((_event: any, params: { nodeId: string | null; handleId: string | null }) => {
    connectingNodeRef.current = params.nodeId;
  }, []);

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const sourceId = connectingNodeRef.current;
      if (!sourceId) return;

      const clientX = 'clientX' in event ? event.clientX : (event as TouchEvent).touches?.[0]?.clientX || 0;
      const clientY = 'clientY' in event ? event.clientY : (event as TouchEvent).touches?.[0]?.clientY || 0;
      const flowPos = screenToFlowPosition({ x: clientX, y: clientY });

      const targetNode = nodes.find((node) => {
        const width = node.measured?.width ?? 240;
        const height = node.measured?.height ?? 200;
        return (
          flowPos.x >= node.position.x &&
          flowPos.x <= node.position.x + width &&
          flowPos.y >= node.position.y &&
          flowPos.y <= node.position.y + height
        );
      });

      if (targetNode && targetNode.id !== sourceId) {
        onConnect({ source: sourceId, target: targetNode.id, sourceHandle: 'out', targetHandle: 'in' });
      } else {
        const target = event.target as HTMLElement;
        const isPane = target.classList.contains('react-flow__pane');
        if (isPane) {
          setConnMenu({ x: clientX, y: clientY, flowX: flowPos.x, flowY: flowPos.y, sourceNodeId: sourceId });
        }
      }

      connectingNodeRef.current = null;
    },
    [nodes, onConnect, screenToFlowPosition],
  );

  const createUploadedImageNodes = useCallback(
    async (sources: ImportedImageSource[], center: { x: number; y: number }) => {
      const loaded = await Promise.all(
        sources.map(async (source) => {
          try {
            const stableUrl = source.file ? await fileToDataUrl(source.file) : source.url;
            const natural = await getImportedImageSize(stableUrl);
            const displaySize = fitMediaNodeToShortSide(natural.naturalWidth, natural.naturalHeight);
            return {
              source: {
                ...source,
                url: stableUrl,
                originalImageUrl: source.file ? stableUrl : (source.originalImageUrl || stableUrl),
              },
              natural,
              displaySize,
            };
          } catch (error) {
            console.warn('[FlowCanvas] Failed to import image:', source.url, error);
            return null;
          }
        }),
      );
      const valid = loaded.filter((item): item is NonNullable<(typeof loaded)[number]> => Boolean(item));
      if (valid.length === 0) return;

      const gap = 32;
      const cols = Math.ceil(Math.sqrt(valid.length));
      const rows = Math.ceil(valid.length / cols);
      const cellWidth = Math.max(...valid.map((item) => item.displaySize.width));
      const cellHeight = Math.max(...valid.map((item) => item.displaySize.height));
      const startX = center.x - (cols * cellWidth + (cols - 1) * gap) / 2;
      const startY = center.y - (rows * cellHeight + (rows - 1) * gap) / 2;

      valid.forEach((item, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const x = startX + col * (cellWidth + gap) + Math.max(0, (cellWidth - item.displaySize.width) / 2);
        const y = startY + row * (cellHeight + gap) + Math.max(0, (cellHeight - item.displaySize.height) / 2);

        addNode(
          'image',
          { x, y },
          {
            title: item.source.title || '图片',
            thumbnailUrl: item.source.url,
            originalImageUrl: item.source.originalImageUrl || item.source.url,
            width: item.displaySize.width,
            height: item.displaySize.height,
            naturalWidth: item.natural.naturalWidth,
            naturalHeight: item.natural.naturalHeight,
            aspectRatio: item.natural.naturalWidth / item.natural.naturalHeight,
            editHistory: [],
            imageFolderIds: [],
            status: 'success',
            generationStatus: 'done',
            generatedResults: undefined,
            activeResultIndex: undefined,
            coverResultId: undefined,
            favoriteResultIds: undefined,
            lastGenerationSnapshot: undefined,
            errorMessage: undefined,
          },
          { selected: true, preserveSelection: index > 0 },
        );
      });
    },
    [addNode],
  );

  const getCanvasCenterFlowPosition = useCallback(() => {
    const rect = canvasRootRef.current?.getBoundingClientRect();
    return screenToFlowPosition({
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    });
  }, [screenToFlowPosition]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasImageTransfer(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      const sources = collectImageSources(event.dataTransfer);
      if (sources.length === 0) return;
      void createUploadedImageNodes(sources, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [createUploadedImageNodes, screenToFlowPosition],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditableElement(event.target)) return;
      const sources = collectImageSources(event.clipboardData);
      if (sources.length === 0) return;
      event.preventDefault();
      void createUploadedImageNodes(sources, getCanvasCenterFlowPosition());
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [createUploadedImageNodes, getCanvasCenterFlowPosition]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (isEditableElement(event.target)) return;
      if (selectedNodes.length === 0 && selectedEdges.length === 0) return;
      event.preventDefault();
      deleteSelectedNodes();
      deleteSelectedEdges();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedEdges, deleteSelectedNodes, selectedEdges.length, selectedNodes.length]);

  const miniMapNodeColor = useCallback((node: Node) => {
    const data = node.data as FlowNodeData;
    switch (data?.kind) {
      case 'text': return '#94a3b8';
      case 'image': return '#38bdf8';
      case 'video': return '#a78bfa';
      case 'audio': return '#f59e0b';
      case 'image_editor': return '#ec4899';
      case 'group': return 'rgba(99,102,241,0.32)';
      default: return '#475569';
    }
  }, []);

  return (
    <div
      ref={canvasRootRef}
      className="flow-canvas-root"
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onDragOverCapture={handleDragOver}
      onDropCapture={handleDrop}
      onDoubleClickCapture={handleCanvasDoubleClick}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu(event.clientX, event.clientY);
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={handleIsValidConnection}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        onPaneClick={handlePaneClick}
        onMoveEnd={handleMoveEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.5 }}
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={CANVAS_MAX_ZOOM}
        defaultEdgeOptions={{ type: 'smart' }}
        selectionMode={SelectionMode.Partial}
        selectNodesOnDrag={false}
        panOnDrag={[1, 2]}
        selectionOnDrag
        snapToGrid={gridSnapEnabled}
        snapGrid={[24, 24]}
        panOnScroll
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        multiSelectionKeyCode={['Control', 'Shift', 'Meta']}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
        style={{ background: '#09090f' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={gridSnapEnabled ? 1.25 : 1}
          color={gridSnapEnabled ? 'rgba(255,255,255,0.22)' : 'rgba(100,116,139,0.11)'}
        />
        {miniMapOpen && (
          <MiniMap
            position="bottom-left"
            nodeColor={miniMapNodeColor}
            nodeStrokeWidth={1}
            nodeStrokeColor="rgba(255,255,255,0.16)"
            style={{ ...miniMapStyle, left: leftPanelOpen ? 276 : 24 }}
            maskColor="rgba(255,255,255,0.055)"
            maskStrokeColor="rgba(255,255,255,0.26)"
            maskStrokeWidth={1}
            pannable
            zoomable
          />
        )}
      </ReactFlow>

      <FlowLeftAddPanel />
      {selectedNodes.length > 1 && (
        <MultiSelectionToolbar
          selectedNodes={selectedNodes}
          onGroup={groupSelectedNodes}
        />
      )}
      <CanvasViewportControls
        miniMapOpen={miniMapOpen}
        gridSnapEnabled={gridSnapEnabled}
        onToggleMiniMap={() => setMiniMapOpen((open) => !open)}
        onToggleGridSnap={() => setGridSnapEnabled((enabled) => !enabled)}
        zoom={viewport.zoom}
        onFitView={() => reactFlow.fitView({ padding: 0.28, duration: 220 })}
        onZoomChange={(zoom) => {
          const nextZoom = clampZoom(zoom);
          const currentViewport = reactFlow.getViewport();
          setViewport({ ...currentViewport, zoom: nextZoom });
          void reactFlow.zoomTo(nextZoom, { duration: 80 }).then(() => {
            setViewport(reactFlow.getViewport());
          });
        }}
      />
      <FlowContextMenu />

      {connMenu && (
        (() => {
          const menuLayout = getConnectionMenuLayout(connMenu.x, connMenu.y);
          return (
            <>
              <ConnectionLinePersistent
                sourceNodeId={connMenu.sourceNodeId}
                targetX={menuLayout.anchorX}
                targetY={menuLayout.anchorY}
              />
              <ConnectionMenu
                x={menuLayout.left}
                y={menuLayout.top}
                flowX={connMenu.flowX}
                flowY={connMenu.flowY}
                sourceNodeId={connMenu.sourceNodeId}
                onClose={() => setConnMenu(null)}
              />
            </>
          );
        })()
      )}
    </div>
  );
};

const MultiSelectionToolbar: React.FC<{
  selectedNodes: Node[];
  onGroup: () => void;
}> = ({ selectedNodes, onGroup }) => {
  const { flowToScreenPosition } = useReactFlow();
  const bounds = selectedNodes.reduce(
    (acc, node) => {
      const width = Number((node.data as FlowNodeData)?.width || node.measured?.width || 240);
      const height = Number((node.data as FlowNodeData)?.height || node.measured?.height || 180);
      const x = node.parentId ? node.positionAbsolute?.x ?? node.position.x : node.position.x;
      const y = node.parentId ? node.positionAbsolute?.y ?? node.position.y : node.position.y;
      return {
        minX: Math.min(acc.minX, x),
        minY: Math.min(acc.minY, y),
        maxX: Math.max(acc.maxX, x + width),
        maxY: Math.max(acc.maxY, y + height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const topCenter = flowToScreenPosition({ x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY });

  return (
    <div
      className="nodrag nopan nowheel"
      style={{
        position: 'fixed',
        left: topCenter.x,
        top: Math.max(18, topCenter.y - 76),
        transform: 'translateX(-50%)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '14px 24px',
        borderRadius: 28,
        background: 'rgba(38,38,38,0.98)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(18px)',
      }}
    >
      <button type="button" style={selectionToolbarButtonStyle}>
        <FolderPlus size={22} />
        保存到素材库
      </button>
      <button type="button" style={selectionToolbarButtonStyle} onClick={onGroup}>
        <Blocks size={22} />
        打组
      </button>
      <button type="button" style={selectionToolbarButtonStyle}>
        <MessageSquareWarning size={22} />
        问题反馈
      </button>
    </div>
  );
};

const selectionToolbarButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  border: 'none',
  background: 'transparent',
  color: '#f8fafc',
  fontSize: 17,
  fontWeight: 700,
  cursor: 'pointer',
  padding: '4px 0',
};

const CanvasViewportControls: React.FC<{
  miniMapOpen: boolean;
  gridSnapEnabled: boolean;
  zoom: number;
  onToggleMiniMap: () => void;
  onToggleGridSnap: () => void;
  onFitView: () => void;
  onZoomChange: (zoom: number) => void;
}> = ({ miniMapOpen, gridSnapEnabled, zoom, onToggleMiniMap, onToggleGridSnap, onFitView, onZoomChange }) => (
  <div className="nodrag nopan nowheel" style={viewportControlsShellStyle}>
    <div style={viewportControlsStyle}>
      <ControlTooltip title={miniMapOpen ? '关闭小地图' : '打开小地图'}>
        <button type="button" style={controlButtonStyle(miniMapOpen)} onClick={onToggleMiniMap}>
          <MapPinned size={20} />
        </button>
      </ControlTooltip>
      <ControlTooltip title="网格吸附">
        <button type="button" style={controlButtonStyle(gridSnapEnabled)} onClick={onToggleGridSnap}>
          <Grip size={20} />
        </button>
      </ControlTooltip>
      <ControlTooltip title="重置">
        <button type="button" style={controlButtonStyle()} onClick={onFitView}>
          <Crosshair size={19} />
        </button>
      </ControlTooltip>
      <ControlTooltip title="放大/缩小画布（Ctrl/⌘ + 0）">
        <div
          style={zoomSliderWrapStyle}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        >
          <input
            className="canvas-zoom-range"
            type="range"
            min={CANVAS_MIN_ZOOM}
            max={CANVAS_MAX_ZOOM}
            step={0.01}
            value={clampZoom(zoom)}
            onChange={(event) => onZoomChange(Number(event.target.value))}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            style={zoomRangeStyle}
          />
        </div>
      </ControlTooltip>
    </div>
    <ControlTooltip title={`缩放 ${Math.round(zoom * 100)}%`}>
      <button type="button" style={helpButtonStyle}>
        <CircleHelp size={24} />
      </button>
    </ControlTooltip>
  </div>
);

const ControlTooltip: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div
      style={controlTooltipHostStyle}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div style={controlTooltipStyle}>
          {title}
          <span style={controlTooltipArrowStyle} />
        </div>
      )}
    </div>
  );
};

const ConnectionLinePersistent: React.FC<{ sourceNodeId: string; targetX: number; targetY: number }> = ({
  sourceNodeId,
  targetX,
  targetY,
}) => {
  const { getNode, flowToScreenPosition } = useReactFlow();
  const sourceNode = getNode(sourceNodeId);
  if (!sourceNode) return null;

  const width = sourceNode.measured?.width ?? 220;
  const height = sourceNode.measured?.height ?? 220;
  const sourceFlowX = sourceNode.position.x + width;
  const sourceFlowY = sourceNode.position.y + height / 2;
  const screenStart = flowToScreenPosition({ x: sourceFlowX, y: sourceFlowY });
  if (!screenStart) return null;

  const dx = targetX - screenStart.x;
  const cp1x = screenStart.x + dx * 0.5;
  const cp2x = targetX - dx * 0.5;
  const path = `M ${screenStart.x} ${screenStart.y} C ${cp1x} ${screenStart.y} ${cp2x} ${targetY} ${targetX} ${targetY}`;

  return (
    <svg style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 900 }}>
      <path d={path} stroke="rgba(255,255,255,0.24)" strokeWidth={3} fill="none" />
      <circle cx={screenStart.x} cy={screenStart.y} r={3.5} fill="rgba(255,255,255,0.34)" />
    </svg>
  );
};

const viewportControlsShellStyle: React.CSSProperties = {
  position: 'absolute',
  left: 24,
  bottom: 18,
  zIndex: 45,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const viewportControlsStyle: React.CSSProperties = {
  height: 50,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '0 14px',
  borderRadius: 25,
  background: 'rgba(34,34,39,0.96)',
  border: '1px solid rgba(255,255,255,0.09)',
  boxShadow: '0 18px 48px rgba(0,0,0,0.46)',
  backdropFilter: 'blur(18px)',
};

const controlButtonStyle = (active = false): React.CSSProperties => ({
  width: 32,
  height: 32,
  borderRadius: 12,
  border: '1px solid transparent',
  background: active ? 'rgba(255,255,255,0.11)' : 'transparent',
  color: active ? '#fff' : 'rgba(229,231,235,0.78)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  padding: 0,
  transition: 'background 160ms ease, color 160ms ease',
});

const helpButtonStyle: React.CSSProperties = {
  width: 50,
  height: 50,
  borderRadius: '50%',
  border: '1px solid rgba(255,255,255,0.09)',
  background: 'rgba(34,34,39,0.96)',
  color: '#e5e7eb',
  display: 'grid',
  placeItems: 'center',
  cursor: 'help',
  padding: 0,
  boxShadow: '0 18px 48px rgba(0,0,0,0.46)',
  backdropFilter: 'blur(18px)',
};

const zoomSliderWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: 98,
  height: 34,
  padding: '0 1px',
};

const zoomRangeStyle: React.CSSProperties = {
  width: '100%',
  accentColor: '#fff',
  cursor: 'pointer',
  margin: 0,
};

const controlTooltipHostStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const controlTooltipStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 14px)',
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(39,39,42,0.98)',
  color: '#fff',
  padding: '9px 16px',
  borderRadius: 13,
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  boxShadow: '0 16px 44px rgba(0,0,0,0.45)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const controlTooltipArrowStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 0,
  height: 0,
  borderLeft: '6px solid transparent',
  borderRight: '6px solid transparent',
  borderTop: '6px solid rgba(39,39,42,0.98)',
};

const miniMapStyle: React.CSSProperties = {
  background: 'rgba(20,20,28,0.92)',
  borderRadius: 18,
  border: '1px solid rgba(255,255,255,0.09)',
  boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
  left: 24,
  bottom: 78,
  width: 300,
  height: 218,
  zIndex: 58,
};
