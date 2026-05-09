/**
 * Flow Canvas Node Components - TapNow Style
 *
 * Content nodes with embedded generation prompt bars.
 * No separate generate nodes. Each node can produce content.
 */
import React, { memo, useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, useViewport, useConnection, useReactFlow, type NodeProps, type Node, NodeResizer } from '@xyflow/react';
import { 
  Type, 
  Image as ImageIcon, 
  Video, 
  Music, 
  Upload, 
  Palette, 
  MessageSquare,
  Plus,
  Maximize2,
  Copy,
  Check,
  List,
  ListOrdered,
  Minus,
  Maximize,
  ArrowUp,
  Layers,
  ChevronDown,
  ChevronRight,
  Coins,
  X,
  Bold,
  Italic,
  Crop,
  RotateCcw,
  Paintbrush,
  SunMedium,
  MoreHorizontal,
  Download,
  Expand,
  RefreshCw,
  Box,
  Wand2,
  Flashlight,
  FolderPlus,
  LayoutGrid,
  Rows3,
  Play,
  Ungroup,
  Blocks,
  Star
} from 'lucide-react';
import type { FlowImageGenerationSnapshot, FlowNodeData, FlowNodeKind } from '../types';
import { useFlowCanvasStore, type FlowDerivedEditCounts, type FlowUpstreamImageRef } from '../store/flowCanvasStore';
import { runImageEdit, runNodeGeneration, type ImageEditType } from '../runtime/graphExecutor';
import { useVideoModelCatalog } from '../../hooks/useVideoModelCatalog';
import {
  ensureImageModelCatalogLoaded,
  getImageModelById,
  getImageModelCatalogSnapshot,
  getImageModelSizeOptions,
  shouldShowImageSizeSelector,
  getImageModelExtraAspectRatios,
  subscribeImageModelCatalog,
  type ImageModelCatalogShape,
} from '../../config/imageModels';
import {
  getImageRoutePointCost,
  getImageRoutesByModelFamily,
  getLowestCostImageRouteForModel,
  getSelectedImageRoute,
  type ImageRouteConfig,
} from '../../config/imageRoutes';
import {
  getVideoModelAspectRatioOptions,
  getVideoModelDurationOptions,
  getVideoModelSupportsHd,
} from '../../config/videoModels';
import { DEFAULT_TEXT_MODEL_ID, getTextModelOption, TEXT_MODEL_OPTIONS } from '../../config/textModels';
import { downloadImage, fileToDataUrl, getImageNaturalSize, imageUrlToBlob } from '../utils/imageUtils';
import type { LightDirection } from './ImageLightingOverlay';
import type { MultiAngleId } from './ImageMultiAngleOverlay';
import { ImageMoreMenu, type ImageMoreMenuAction } from './ImageMoreMenu';
import type { OutpaintDirection } from './ImageOutpaintOverlay';
import type { ImageSplitPiece } from './ImageSplitOverlay';
import { PromptLexicalEditor, type PromptLexicalEditorHandle, type PromptReference } from './PromptLexicalEditor';
import { useImageFolderStore, type FlowImageFolder, type FlowImageFolderItem } from '../store/imageFolderStore';
import {
  applySlashCommandToPrompt,
  extractMentionQuery,
  extractSlashQuery,
  IMAGE_SLASH_COMMANDS,
} from '../utils/imagePromptCommands';
import {
  FLOW_NODE_DEFAULT_SIZES,
  fitMediaNodeToShortSide,
  getMediaNodeSizeFromRatioString,
  parseAspectRatio,
} from '../utils/nodeSizing';
import { GoogleLogo, OpenAILogo } from '../../../components/Logos';
import { fetchCurrentAuthSession } from '../../services/accountIdentity';
import { normalizeBackendAssetUrl } from '../../utils/generatedImageStorage';
import { canNodeReceiveIncoming } from '../rules/connectionRules';

type FlowNode = Node<FlowNodeData>;

const ImageAiConfirmOverlay = React.lazy(() =>
  import('./ImageAiConfirmOverlay').then((module) => ({ default: module.ImageAiConfirmOverlay })),
);
const ImageAnnotateOverlay = React.lazy(() =>
  import('./ImageAnnotateOverlay').then((module) => ({ default: module.ImageAnnotateOverlay })),
);
const ImageCropOverlay = React.lazy(() =>
  import('./ImageCropOverlay').then((module) => ({ default: module.ImageCropOverlay })),
);
const ImageFolderOverlay = React.lazy(() =>
  import('./ImageFolderOverlay').then((module) => ({ default: module.ImageFolderOverlay })),
);
const ImageLightingOverlay = React.lazy(() =>
  import('./ImageLightingOverlay').then((module) => ({ default: module.ImageLightingOverlay })),
);
const ImageMultiAngleOverlay = React.lazy(() =>
  import('./ImageMultiAngleOverlay').then((module) => ({ default: module.ImageMultiAngleOverlay })),
);
const ImageOutpaintOverlay = React.lazy(() =>
  import('./ImageOutpaintOverlay').then((module) => ({ default: module.ImageOutpaintOverlay })),
);
const ImageRepaintOverlay = React.lazy(() =>
  import('./ImageRepaintOverlay').then((module) => ({ default: module.ImageRepaintOverlay })),
);
const ImageResizeOverlay = React.lazy(() =>
  import('./ImageResizeOverlay').then((module) => ({ default: module.ImageResizeOverlay })),
);
const ImageSplitOverlay = React.lazy(() =>
  import('./ImageSplitOverlay').then((module) => ({ default: module.ImageSplitOverlay })),
);

const LazyOverlayFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <React.Suspense fallback={null}>{children}</React.Suspense>
);

const stopCanvasKeyboardPropagation = (event: React.KeyboardEvent<HTMLElement>) => {
  event.stopPropagation();
};

const TEXT_MODEL_LOGO_BY_PROVIDER: Record<string, string> = {
  gemini: '/google-gemini-icon.svg',
  openai: '/openai-icon.svg',
  anthropic: '/claude-ai-icon.svg',
};

const EMPTY_UPSTREAM_IMAGE_REFS: FlowUpstreamImageRef[] = [];
const EMPTY_DERIVED_EDIT_COUNTS: FlowDerivedEditCounts = {
  crop: 0,
  resize: 0,
  split: 0,
  annotate: 0,
};
const EMPTY_IMAGE_FOLDERS: FlowImageFolder[] = [];
const EMPTY_IMAGE_FOLDER_ITEMS: FlowImageFolderItem[] = [];

const useSingleNodeSelection = (selected?: boolean) => {
  return !!selected;
};

const useImageModelCatalogWhenNeeded = (enabled: boolean) => {
  const [catalog, setCatalog] = useState<ImageModelCatalogShape>(() => getImageModelCatalogSnapshot());

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const syncCatalog = () => {
      if (active) setCatalog(getImageModelCatalogSnapshot());
    };
    const unsubscribe = subscribeImageModelCatalog(syncCatalog);
    syncCatalog();
    void ensureImageModelCatalogLoaded().then(syncCatalog).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled]);

  return catalog.models;
};

/* Section */

const nodeWrapper: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  // overflow visible so floating panels and labels can escape
};

const EditableNodeTitle: React.FC<{
  nodeId: string;
  icon: React.ReactNode;
  label: string;
  fallbackLabel: string;
  scale?: number;
  compact?: boolean;
}> = ({ nodeId, icon, label, fallbackLabel, scale = 1, compact = false }) => {
  const updateNodeData = useFlowCanvasStore((s) => s.updateNodeData);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  useEffect(() => {
    if (!editing) setDraft(label);
  }, [editing, label]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const save = useCallback(() => {
    const nextTitle = draft.trim() || fallbackLabel;
    updateNodeData(nodeId, { title: nextTitle });
    setDraft(nextTitle);
    setEditing(false);
  }, [draft, fallbackLabel, nodeId, updateNodeData]);

  const cancel = useCallback(() => {
    setDraft(label);
    setEditing(false);
  }, [label]);

  const displayLabel = label || fallbackLabel;

  return (
    <div
      className="nodrag nopan nowheel"
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 4 : 6,
        color: compact ? 'rgba(148,163,184,0.62)' : 'rgba(255, 255, 255, 0.72)',
        fontSize: compact ? 13 : 18,
        fontWeight: compact ? 600 : 500,
        userSelect: editing ? 'text' : 'none',
        pointerEvents: 'auto',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
      }}
      title={editing ? undefined : `${displayLabel}，双击重命名`}
    >
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') save();
            if (event.key === 'Escape') cancel();
          }}
          style={{
            width: '100%',
            minWidth: 0,
            maxWidth: '100%',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.16)',
            borderRadius: compact ? 8 : 10,
            color: '#fff',
            outline: 'none',
            padding: compact ? '3px 6px' : '4px 8px',
            font: 'inherit',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayLabel}
        </span>
      )}
    </div>
  );
};

// Fixed-size label that doesn't scale with zoom
const NodeLabel: React.FC<{
  nodeId: string;
  icon: React.ReactNode;
  label: string;
  fallbackLabel: string;
}> = ({ nodeId, icon, label, fallbackLabel }) => {
  const { zoom } = useViewport();
  const scale = 1 / zoom;
  const constrainedWidth = `${Math.max(0.05, zoom) * 100}%`;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 4px)',
        left: 0,
        width: constrainedWidth,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        transform: `scale(${scale})`,
        transformOrigin: 'bottom left',
        transition: 'transform 0.1s ease-out',
      }}
    >
      <EditableNodeTitle
        nodeId={nodeId}
        icon={icon}
        label={label}
        fallbackLabel={fallbackLabel}
        scale={scale}
      />
    </div>
  );
};

const card = (w: number, h: number, selected?: boolean, magnetic?: boolean, bgColor?: string): React.CSSProperties => ({
  position: 'relative',
  width: w,
  height: h,
  borderRadius: 16,
  background: bgColor || (selected ? '#262626' : '#1e1e1e'), // Support custom background
  border: selected 
    ? '1.5px solid rgba(255,255,255,0.4)' // Subtle white rounded border for selection
    : magnetic 
      ? '1.5px solid rgba(99,102,241,0.8)' 
      : '1.5px solid transparent', 
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: selected
    ? '0 8px 32px rgba(0,0,0,0.5)'
    : magnetic
      ? '0 0 25px rgba(99,102,241,0.4), 0 8px 30px rgba(0,0,0,0.4)'
      : '0 4px 16px rgba(0,0,0,0.15)', 
  transition: 'box-shadow 0.2s, border-color 0.2s, background 0.2s',
  zIndex: 10,
  animation: magnetic ? 'node-flicker 1.5s infinite ease-in-out' : 'none',
});

// Add global styles for animation if not present (handled via style tag in component for simplicity here, 
// or could be in flowCanvas.css)
const flickerStyles = `
@keyframes node-flicker {
  0%, 100% { opacity: 1; border-color: rgba(99,102,241,0.6); box-shadow: 0 0 15px rgba(99,102,241,0.2); }
  50% { opacity: 0.95; border-color: rgba(99,102,241,1); box-shadow: 0 0 30px rgba(99,102,241,0.5); }
}

@keyframes flow-image-sheen {
  0% { transform: translateX(-120%); opacity: 0.1; }
  50% { opacity: 0.3; }
  100% { transform: translateX(140%); opacity: 0.1; }
}

@keyframes flow-image-dot {
  0%, 100% { opacity: 0.4; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.08); }
}

@keyframes flow-filmstrip-in {
  0% { opacity: 0; transform: translateX(-10px) scale(0.985); }
  100% { opacity: 1; transform: translateX(0) scale(1); }
}

@keyframes flow-filmstrip-out {
  0% { opacity: 1; transform: translateX(0) scale(1); }
  100% { opacity: 0; transform: translateX(-8px) scale(0.985); }
}

@keyframes flow-result-badge-breathe {
  0%, 100% { box-shadow: 0 0 0 rgba(56,189,248,0.0); }
  50% { box-shadow: 0 0 0 4px rgba(56,189,248,0.12); }
}

.react-flow__node-resizer__handle {
  background: transparent !important;
  border: none !important;
  width: 34px !important;
  height: 34px !important;
  z-index: 100 !important;
  opacity: 0 !important;
  transition: opacity 120ms ease !important;
}

.react-flow__node-resizer__handle:hover,
.react-flow__node-resizer__handle:active {
  opacity: 1 !important;
}

.react-flow__node-resizer__handle.top,
.react-flow__node-resizer__handle.bottom {
  width: 72px !important;
  height: 18px !important;
}

.react-flow__node-resizer__handle.left,
.react-flow__node-resizer__handle.right {
  width: 18px !important;
  height: 72px !important;
}

.react-flow__node-resizer__handle.top-left,
.react-flow__node-resizer__handle.top-right,
.react-flow__node-resizer__handle.bottom-left,
.react-flow__node-resizer__handle.bottom-right {
  width: 38px !important;
  height: 38px !important;
  background: transparent !important;
}

.react-flow__node-resizer__handle.top-left {
  border-top: 4px solid rgba(255,255,255,0.95) !important;
  border-left: 4px solid rgba(255,255,255,0.95) !important;
  border-radius: 18px 0 0 0 !important;
}

.react-flow__node-resizer__handle.top-right {
  border-top: 4px solid rgba(255,255,255,0.95) !important;
  border-right: 4px solid rgba(255,255,255,0.95) !important;
  border-radius: 0 18px 0 0 !important;
}

.react-flow__node-resizer__handle.bottom-left {
  border-bottom: 4px solid rgba(255,255,255,0.95) !important;
  border-left: 4px solid rgba(255,255,255,0.95) !important;
  border-radius: 0 0 0 18px !important;
}

.react-flow__node-resizer__handle.bottom-right {
  border-bottom: 4px solid rgba(255,255,255,0.95) !important;
  border-right: 4px solid rgba(255,255,255,0.95) !important;
  border-radius: 0 0 18px 0 !important;
}

.react-flow__resize-control.handle {
  width: 34px !important;
  height: 34px !important;
  background: transparent !important;
  border: none !important;
  opacity: 1 !important;
  z-index: 120 !important;
}

.react-flow__resize-control.handle::after {
  content: "" !important;
  position: absolute !important;
  inset: 0 !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 120ms ease !important;
}

.react-flow__resize-control.handle:hover::after,
.react-flow__resize-control.handle:active::after {
  opacity: 1 !important;
}

.react-flow__resize-control.handle.top,
.react-flow__resize-control.handle.bottom {
  width: 78px !important;
  height: 22px !important;
  background: transparent !important;
}

.react-flow__resize-control.handle.left,
.react-flow__resize-control.handle.right {
  width: 22px !important;
  height: 78px !important;
  background: transparent !important;
}

.react-flow__resize-control.handle.top.left,
.react-flow__resize-control.handle.top.right,
.react-flow__resize-control.handle.bottom.left,
.react-flow__resize-control.handle.bottom.right {
  width: 34px !important;
  height: 34px !important;
}

.react-flow__resize-control.handle.top.left::after {
  border-top: 4px solid rgba(255,255,255,0.96) !important;
  border-left: 4px solid rgba(255,255,255,0.96) !important;
  border-radius: 26px 0 0 0 !important;
}

.react-flow__resize-control.handle.top.right::after {
  border-top: 4px solid rgba(255,255,255,0.96) !important;
  border-right: 4px solid rgba(255,255,255,0.96) !important;
  border-radius: 0 26px 0 0 !important;
}

.react-flow__resize-control.handle.bottom.left::after {
  border-bottom: 4px solid rgba(255,255,255,0.96) !important;
  border-left: 4px solid rgba(255,255,255,0.96) !important;
  border-radius: 0 0 0 26px !important;
}

.react-flow__resize-control.handle.bottom.right::after {
  border-bottom: 4px solid rgba(255,255,255,0.96) !important;
  border-right: 4px solid rgba(255,255,255,0.96) !important;
  border-radius: 0 0 26px 0 !important;
}

.react-flow__resize-control.line {
  border-color: rgba(255,255,255,0.42) !important;
}

.flow-rich-prompt-editor:empty::before {
  content: attr(data-placeholder);
  color: #94a3b8;
  pointer-events: none;
}

.flow-image-node {
  overflow: visible;
}

.flow-image-hover-reveal {
  opacity: 0;
  pointer-events: none;
  transform: translateY(-1px);
  transition: opacity 120ms ease, transform 120ms ease, background 120ms ease, border-color 120ms ease;
}

.flow-image-node:hover .flow-image-hover-reveal,
.flow-image-node:focus-within .flow-image-hover-reveal {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.flow-image-replace-btn:hover {
  background: rgba(0,0,0,0.8) !important;
}

.flow-image-toolbar-btn:hover:not(:disabled) {
  border-color: rgba(255,255,255,0.1) !important;
  background: rgba(255,255,255,0.08) !important;
}

.flow-image-toolbar-tooltip {
  opacity: 0;
  transform: translateY(3px);
  transition: opacity 120ms ease, transform 120ms ease;
}

.flow-image-toolbar-item:hover .flow-image-toolbar-tooltip,
.flow-image-toolbar-item:focus-within .flow-image-toolbar-tooltip {
  opacity: 1;
  transform: translateY(0);
}

.flow-reference-chip {
  transition: opacity 140ms ease, transform 140ms ease;
}

.flow-reference-chip:hover {
  transform: translateY(-1px);
}

.flow-reference-chip-preview {
  opacity: 0;
  transform: translate(-50%, 3px);
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease;
}

.flow-reference-chip:hover .flow-reference-chip-preview,
.flow-reference-chip:focus-within .flow-reference-chip-preview {
  opacity: 1;
  transform: translate(-50%, 0);
}

.flow-result-strip-item:hover {
  box-shadow: 0 14px 30px rgba(0,0,0,0.34) !important;
  transform: translateY(-2px) !important;
}

.flow-batch-btn:hover {
  background: rgba(255,255,255,0.1) !important;
}

.flow-batch-option:hover {
  color: #fff !important;
  background: rgba(255,255,255,0.04) !important;
}
`;
if (typeof document !== 'undefined') {
  const existingStyle = document.getElementById('node-flicker-styles');
  if (existingStyle) {
    existingStyle.innerHTML = flickerStyles;
  } else {
  const style = document.createElement('style');
  style.id = 'node-flicker-styles';
  style.innerHTML = flickerStyles;
  document.head.appendChild(style);
  }
}


const topToolbarBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#94a3b8',
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4px',
  transition: 'color 0.15s',
};

const uploadBtn: React.CSSProperties = {
  ...topToolbarBtn,
  gap: 6,
  fontSize: 13,
  fontWeight: 500,
  color: '#e2e8f0',
};

// Bottom floating prompt bar
const bottomFloatingBarBase: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 24px)', // Increased gap
  left: '50%',
  width: 960,
  minHeight: 178,
  background: 'rgba(38,38,38,0.98)', // Uniform color with node
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 26,
  padding: '22px 24px 18px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: 18,
  boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
  backdropFilter: 'blur(20px)',
  zIndex: 30,
};

const FloatingPromptBar: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { zoom } = useViewport();
  const scale = 1 / zoom;
  return (
    <div
      style={{
        ...bottomFloatingBarBase,
        transform: `translateX(-50%) scale(${scale})`,
        transformOrigin: 'top center',
        transition: 'transform 0.1s ease-out',
      }}
      className="nodrag nopan nowheel"
    >
      {children}
    </div>
  );
};

const topFloatingBarBase: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 48px)', // Increased gap to avoid overlapping NodeLabel
  left: '50%',
  background: 'rgba(38,38,38,0.98)', // Uniform color
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 24,
  padding: '6px 16px',
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
  backdropFilter: 'blur(20px)',
  zIndex: 100,
  whiteSpace: 'nowrap',
};

const FloatingToolbar: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { zoom } = useViewport();
  const scale = 1 / zoom;
  return (
    <div
      style={{
        ...topFloatingBarBase,
        transform: `translateX(-50%) scale(${scale})`,
        transformOrigin: 'bottom center',
        transition: 'transform 0.1s ease-out',
      }}
      className="nodrag nopan nowheel"
    >
      {children}
    </div>
  );
};

const formatImageViewerDate = (timestamp?: number) => {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
};

const formatImageViewerBytes = (bytes?: number | null) => {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return '--';
  const value = Number(bytes);
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

const estimateDataUrlBytes = (url: string) => {
  if (!url.startsWith('data:')) return null;
  const [, payload = ''] = url.split(',', 2);
  if (!payload) return null;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0));
};

const formatViewerRatio = (ratio?: string | number, naturalWidth?: number, naturalHeight?: number) => {
  if (typeof ratio === 'string' && ratio.trim()) return ratio.replace(/\s*:\s*/g, ' : ');
  if (typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0) {
    const width = Math.round(ratio * 100);
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width, 100);
    return `${width / divisor} : ${100 / divisor}`;
  }
  if (naturalWidth && naturalHeight) {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(Math.round(naturalWidth), Math.round(naturalHeight));
    return `${Math.round(naturalWidth) / divisor} : ${Math.round(naturalHeight) / divisor}`;
  }
  return '--';
};

const inferImageViewerQuality = (size?: string, naturalWidth?: number, naturalHeight?: number) => {
  const normalized = String(size || '').trim().toUpperCase();
  if (normalized) return normalized;
  const maxSide = Math.max(Number(naturalWidth || 0), Number(naturalHeight || 0));
  if (maxSide >= 3000) return '4K';
  if (maxSide >= 1400) return '2K';
  if (maxSide > 0) return '1K';
  return '--';
};

interface ImageFullscreenOverlayProps {
  imageUrl: string;
  onClose: () => void;
  onDownload: () => void;
  prompt?: string;
  modelLabel?: string;
  size?: string;
  aspectRatio?: string | number;
  naturalWidth?: number;
  naturalHeight?: number;
  createdAt?: number;
  isGenerated?: boolean;
  snapshot?: FlowImageGenerationSnapshot;
}

const ImageFullscreenOverlay: React.FC<ImageFullscreenOverlayProps> = ({
  imageUrl,
  onClose,
  onDownload,
  prompt,
  modelLabel,
  size,
  aspectRatio,
  naturalWidth,
  naturalHeight,
  createdAt,
  isGenerated,
  snapshot,
}) => {
  const [fileSize, setFileSize] = React.useState<string>(formatImageViewerBytes(estimateDataUrlBytes(imageUrl)));
  const [creator, setCreator] = React.useState('当前用户');
  const [copiedVisible, setCopiedVisible] = React.useState(false);
  const [promptHovered, setPromptHovered] = React.useState(false);
  const cleanPrompt = String(prompt || '').trim();
  const displayPrompt = cleanPrompt || '暂无提示词';
  const infoRows = [
    ...(isGenerated ? [{ label: '模型', value: modelLabel || snapshot?.modelId || '--' }] : []),
    { label: '质量', value: inferImageViewerQuality(snapshot?.size || size, naturalWidth, naturalHeight) },
    ...(isGenerated ? [{ label: '宽高比', value: formatViewerRatio(snapshot?.aspectRatio || aspectRatio, naturalWidth, naturalHeight) }] : []),
    { label: '文件大小', value: fileSize },
    { label: '日期', value: formatImageViewerDate(snapshot?.generatedAt || createdAt) },
    { label: '创建者', value: creator },
  ];

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  React.useEffect(() => {
    let disposed = false;
    const estimated = estimateDataUrlBytes(imageUrl);
    if (estimated) {
      setFileSize(formatImageViewerBytes(estimated));
      return;
    }
    void imageUrlToBlob(imageUrl)
      .then((blob) => {
        if (!disposed) setFileSize(formatImageViewerBytes(blob.size));
      })
      .catch(() => {
        if (!disposed) setFileSize('--');
      });
    return () => {
      disposed = true;
    };
  }, [imageUrl]);

  React.useEffect(() => {
    let disposed = false;
    void fetchCurrentAuthSession()
      .then((session) => {
        if (disposed || !session?.user) return;
        setCreator(session.user.displayName || session.user.email || session.user.userId || '当前用户');
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  const handleCopyPrompt = useCallback(() => {
    void navigator.clipboard?.writeText(cleanPrompt || displayPrompt).catch(() => undefined);
    setCopiedVisible(true);
    window.setTimeout(() => setCopiedVisible(false), 1400);
  }, [cleanPrompt, displayPrompt]);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(16px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '30px 36px',
        boxSizing: 'border-box',
      }}
      onClick={onClose}
    >
      <div
        className="nodrag nopan nowheel"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(1848px, calc(100vw - 72px))',
          height: 'min(818px, calc(100dvh - 60px))',
          maxHeight: 'calc(100vh - 60px)',
          minHeight: 0,
          display: 'flex',
          overflow: 'hidden',
          borderRadius: 22,
          border: '1px solid rgba(255,255,255,0.16)',
          background: 'rgba(20,20,20,0.92)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.62)',
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(16,16,16,0.96)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.11,
              backgroundImage: `url("${imageUrl}")`,
              backgroundPosition: 'center',
              backgroundSize: 'cover',
              filter: 'blur(24px)',
              transform: 'scale(1.08)',
            }}
          />
          <img
            src={imageUrl}
            alt="Fullscreen"
            draggable={false}
            style={{
              position: 'relative',
              zIndex: 1,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        </div>

        <aside
          style={{
            width: 420,
            flex: '0 0 420px',
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            minHeight: 0,
            padding: '28px 24px 24px 17px',
            boxSizing: 'border-box',
            background: 'rgba(29,29,29,0.98)',
            borderLeft: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 34, marginBottom: 10 }}>
            <h3 style={{ margin: 0, color: 'rgba(255,255,255,0.62)', fontSize: 22, fontWeight: 700, lineHeight: '34px', letterSpacing: 0 }}>提示词</h3>
            {promptHovered && (
              <div
                style={{
                  padding: '8px 13px',
                  borderRadius: 16,
                  background: 'rgba(48,48,48,0.98)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff',
                  fontSize: 17,
                  fontWeight: 700,
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 8px 18px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
              >
                点击内容复制
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                marginLeft: 'auto',
                width: 34,
                height: 34,
                border: 'none',
                background: 'transparent',
                color: 'rgba(255,255,255,0.86)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
              }}
              title="关闭"
            >
              <X size={25} strokeWidth={1.65} />
            </button>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={handleCopyPrompt}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleCopyPrompt();
              }
            }}
            onMouseEnter={() => setPromptHovered(true)}
            onMouseLeave={() => setPromptHovered(false)}
            title="点击内容复制"
            style={{
              position: 'relative',
              display: 'block',
              appearance: 'none',
              width: 378,
              minHeight: 0,
              height: 270,
              flex: '0 0 270px',
              overflowY: 'auto',
              border: '1px solid rgba(255,255,255,0.035)',
              borderRadius: 16,
              background: promptHovered ? 'rgba(17,17,17,0.98)' : 'rgba(40,40,40,0.96)',
              color: cleanPrompt ? 'rgba(255,255,255,0.86)' : 'rgba(255,255,255,0.86)',
              textAlign: 'left',
              padding: '13px 18px',
              fontSize: 21,
              fontWeight: 400,
              lineHeight: 1.45,
              cursor: 'pointer',
              fontFamily: '"Microsoft YaHei", "PingFang SC", Arial, sans-serif',
              transition: 'background-color 140ms ease, border-color 140ms ease',
            }}
          >
            <span
              style={{
                display: 'block',
                width: '100%',
                margin: 0,
                padding: 0,
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {displayPrompt}
            </span>
            {copiedVisible && (
              <span
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  padding: '9px 14px',
                  borderRadius: 8,
                  background: 'rgba(244,244,245,0.96)',
                  color: '#1f1f1f',
                  fontSize: 18,
                  fontWeight: 700,
                  lineHeight: 1,
                  boxShadow: '0 10px 24px rgba(0,0,0,0.36)',
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                已复制
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0, marginTop: 32 }}>
            <h3 style={{ margin: 0, color: 'rgba(255,255,255,0.62)', fontSize: 22, fontWeight: 700, lineHeight: 1.2, letterSpacing: 0 }}>信息</h3>
            <div
              style={{
                width: 378,
                borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.045)',
                background: 'rgba(40,40,40,0.96)',
                padding: '14px 16px 14px',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                minHeight: 0,
              }}
            >
              {infoRows.map((row) => (
                <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '106px minmax(0, 1fr)', alignItems: 'center', columnGap: 4, minHeight: 31 }}>
                  <span style={{ color: 'rgba(255,255,255,0.38)', fontSize: 21, fontWeight: 400, whiteSpace: 'nowrap', letterSpacing: 0 }}>{row.label}:</span>
                  <span style={{ minWidth: 0, color: 'rgba(255,255,255,0.84)', fontSize: 21, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: 0 }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onDownload}
            style={{
              marginTop: 'auto',
              width: 378,
              height: 48,
              flex: '0 0 48px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(106,106,106,0.96)',
              color: '#fff',
              fontSize: 20,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14)',
            }}
          >
            下载
          </button>
        </aside>
      </div>
    </div>,
    document.body
  );
};

const promptTextarea: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: '#f8fafc',
  fontSize: 20,
  lineHeight: 1.42,
  fontWeight: 400,
  resize: 'none',
  minHeight: 118,
  maxHeight: 400,
  fontFamily: '"Microsoft YaHei", "微软雅黑", Arial, sans-serif',
};

const richPromptShell: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  minHeight: 118,
  maxHeight: 400,
};

const richPromptEditor: React.CSSProperties = {
  width: '100%',
  minHeight: 118,
  maxHeight: 400,
  overflowY: 'auto',
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: '#f8fafc',
  fontSize: 20,
  lineHeight: 1.42,
  fontWeight: 400,
  fontFamily: '"Microsoft YaHei", "微软雅黑", Arial, sans-serif',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const mentionTokenPill = (active?: boolean): React.CSSProperties => ({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  verticalAlign: '-4px',
  gap: 5,
  height: 28,
  maxWidth: 178,
  padding: '3px 7px 3px 4px',
  borderRadius: 7,
  border: active ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.08)',
  background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)',
  color: '#f4f4f5',
  fontSize: 16,
  fontWeight: 750,
  lineHeight: 1,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
});

const mentionTokenRemoveButton: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(0,0,0,0.34)',
  color: '#f8fafc',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
};

const promptExpandButton: React.CSSProperties = {
  position: 'absolute',
  top: 2,
  right: 0,
  width: 32,
  height: 32,
  borderRadius: 10,
  border: 'none',
  background: 'transparent',
  color: '#9ca3af',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};

const COLORS = [
  '#FFFFFF',
  '#FF5F5F',
  '#FFA35F',
  '#FFD75F',
  '#74C774',
  '#5F9EA0',
  '#5F85FF',
  '#A35FFF',
];

const paramRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const promptBottomRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: 4,
};

const paramChip: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: '4px 2px',
  fontSize: 13,
  color: '#94a3b8',
  cursor: 'pointer',
  outline: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const textModelTrigger: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 34,
  padding: '0 10px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.06)',
  color: '#f4f4f5',
  fontSize: 14,
  fontWeight: 650,
  cursor: 'pointer',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
};

const textModelTriggerLogo: React.CSSProperties = {
  width: 16,
  height: 16,
  objectFit: 'contain',
  flex: '0 0 auto',
};

const textModelMenu: React.CSSProperties = {
  position: 'absolute',
  left: -18,
  bottom: 'calc(100% + 10px)',
  width: 360,
  maxHeight: 340,
  overflowY: 'auto',
  padding: 8,
  borderRadius: 18,
  background: 'rgba(45,45,45,0.98)',
  border: '1px solid rgba(255,255,255,0.1)',
  boxShadow: '0 18px 48px rgba(0,0,0,0.48)',
  backdropFilter: 'blur(16px)',
  zIndex: 1200,
};

const textModelMenuItem: React.CSSProperties = {
  width: '100%',
  minHeight: 58,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '9px 10px',
  border: 'none',
  borderRadius: 15,
  color: '#f4f4f5',
  cursor: 'pointer',
  textAlign: 'left',
};

const textModelLogo: React.CSSProperties = {
  width: 38,
  height: 38,
  padding: 9,
  borderRadius: 12,
  objectFit: 'contain',
  background: 'rgba(255,255,255,0.07)',
  flex: '0 0 auto',
};

const textModelMenuLabel: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 650,
  lineHeight: 1.2,
};

const sendBtnOuter: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'rgba(255,255,255,0.06)',
  borderRadius: 20,
  padding: '4px 6px 4px 12px',
  color: '#94a3b8',
  fontSize: 13,
  fontWeight: 500,
};

const sendBtnAction = (active: boolean): React.CSSProperties => ({
  width: 28,
  height: 28,
  borderRadius: '50%',
  border: 'none',
  background: active ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
  color: active ? '#64748b' : '#fff',
  fontSize: 14,
  cursor: active ? 'not-allowed' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'all 0.2s',
});

const invisibleHandle: React.CSSProperties = {
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  background: 'transparent',
  border: 'none',
  padding: 0,
  zIndex: 15,
};

const handleHitArea: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 60,
  height: 100,
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'crosshair',
};

const plusHandleInner: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  background: 'rgba(28,28,34,0.98)',
  border: '1.5px solid rgba(255,255,255,0.12)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  color: 'rgba(255,255,255,0.6)',
  boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
  transition: 'all 0.15s',
};

const placeholderArea = (h: number): React.CSSProperties => ({
  height: h,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'rgba(255,255,255,0.25)',
  fontSize: 40,
  background: 'transparent',
  borderRadius: 16,
});

const contentArea: React.CSSProperties = {
  borderRadius: 16,
  overflow: 'hidden',
  background: 'transparent',
};

const progressBar = (pct: number): React.CSSProperties => ({
  position: 'absolute',
  bottom: 0,
  left: 0,
  height: 2,
  background: `linear-gradient(90deg, #6366f1 ${pct}%, transparent ${pct}%)`,
  transition: 'background 0.3s',
  width: '100%',
});

const textGeneratingOverlay: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  zIndex: 4,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  gap: 18,
  padding: '28px 22px 22px',
  background: 'linear-gradient(180deg, rgba(28,28,28,0.82), rgba(28,28,28,0.94))',
  backdropFilter: 'blur(5px)',
  pointerEvents: 'none',
};

const textGeneratingPill: React.CSSProperties = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  padding: '8px 12px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#e5e7eb',
  fontSize: 13,
  fontWeight: 600,
};

const textSkeletonStack: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const imageGeneratingOverlay: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(180deg, rgba(15,23,42,0.46), rgba(15,23,42,0.68))',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  zIndex: 8,
  overflow: 'hidden',
};

const imageGeneratingPill: React.CSSProperties = {
  position: 'relative',
  zIndex: 2,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(15,23,42,0.58)',
  color: '#e2e8f0',
  fontSize: 12,
  fontWeight: 700,
};

const imageGeneratingDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#f8fafc',
  animation: 'flow-image-dot 1.05s ease-in-out infinite',
};

const imageGeneratingSheen: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  width: '44%',
  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)',
  transform: 'translateX(-120%)',
  animation: 'flow-image-sheen 1.8s linear infinite',
};

const errorBar: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: '50%',
  transform: 'translate(-50%, -8px)',
  padding: '6px 12px',
  fontSize: 12,
  color: '#f87171',
  background: 'rgba(239,68,68,0.1)',
  border: '1px solid rgba(239,68,68,0.2)',
  borderRadius: 8,
  whiteSpace: 'nowrap',
  zIndex: 40,
};

const imageErrorToast: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: '50%',
  transform: 'translate(-50%, -10px)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  padding: '7px 8px 7px 10px',
  borderRadius: 12,
  border: '1px solid rgba(248,113,113,0.35)',
  background: 'rgba(35,10,12,0.92)',
  backdropFilter: 'blur(10px)',
  color: '#fee2e2',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  zIndex: 42,
  maxWidth: 360,
  boxShadow: '0 8px 22px rgba(0,0,0,0.35)',
};

const imageRetryBtn: React.CSSProperties = {
  border: '1px solid rgba(254,202,202,0.28)',
  background: 'rgba(254,202,202,0.12)',
  color: '#fee2e2',
  borderRadius: 9,
  padding: '3px 9px',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'all 140ms ease',
};

const resultCountBadge = (active: boolean, hovered?: boolean, clickable?: boolean): React.CSSProperties => ({
  position: 'absolute',
  top: 8,
  right: 8,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  minWidth: 46,
  height: 24,
  padding: '0 8px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.2)',
  background: active || hovered ? 'rgba(45,45,45,0.86)' : 'rgba(35,35,35,0.72)',
  backdropFilter: 'blur(8px)',
  color: '#e2e8f0',
  fontSize: 12,
  fontWeight: 700,
  cursor: clickable ? 'pointer' : 'default',
  zIndex: 22,
  transition: 'all 160ms ease',
  boxShadow: active || hovered ? '0 6px 14px rgba(0,0,0,0.28)' : '0 4px 10px rgba(0,0,0,0.18)',
  animation: active ? 'flow-result-badge-breathe 1.6s ease-in-out infinite' : 'none',
});

const generatedFavoriteButton = (active?: boolean): React.CSSProperties => ({
  position: 'absolute',
  top: 8,
  left: 8,
  width: 22,
  height: 22,
  borderRadius: 7,
  border: '1px solid rgba(255,255,255,0.22)',
  background: active ? 'rgba(245,158,11,0.86)' : 'rgba(35,35,35,0.62)',
  backdropFilter: 'blur(8px)',
  color: '#f8fafc',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
  zIndex: 22,
  boxShadow: '0 4px 12px rgba(0,0,0,0.22)',
  transition: 'all 140ms ease',
});

const resultExpansionWrap: React.CSSProperties = {
  position: 'absolute',
  top: -48,
  left: 'calc(100% + 16px)',
  padding: 12,
  borderRadius: 18,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(8,8,10,0.76)',
  backdropFilter: 'blur(16px)',
  boxShadow: '0 18px 44px rgba(0,0,0,0.42)',
  zIndex: 34,
};

const resultExpansionRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  overflowX: 'auto',
  maxWidth: 760,
  padding: 2,
};

const resultOverlayButton: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 7,
  border: '1px solid rgba(255,255,255,0.22)',
  background: 'rgba(40,40,40,0.72)',
  color: '#f8fafc',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  cursor: 'pointer',
  backdropFilter: 'blur(8px)',
  boxShadow: '0 4px 10px rgba(0,0,0,0.25)',
};

const setMainResultButton: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.22)',
  background: 'rgba(40,40,40,0.78)',
  color: '#fff',
  height: 24,
  borderRadius: 8,
  padding: '0 9px',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  backdropFilter: 'blur(8px)',
};

const copyToast: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 72,
  transform: 'translateX(-50%)',
  width: 500,
  maxWidth: 'calc(100vw - 48px)',
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  padding: '22px 26px',
  borderRadius: 12,
  background: 'rgba(39,39,42,0.98)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.44)',
  zIndex: 100000,
};

const copyToastIcon: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#14d3a1',
  color: '#041f18',
  flex: '0 0 auto',
};

/* Section */

const ParamSelect: React.FC<{
  value: string;
  options: string[];
  onChange: (v: string) => void;
  prefix?: string;
}> = ({ value, options, onChange, prefix }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    style={{ ...paramChip, appearance: 'none' }}
  >
    {options.map((o) => (
      <option key={o} value={o} style={{ background: '#1e1e28' }}>
        {prefix || ''}{o}
      </option>
    ))}
  </select>
);

const ParamDivider = () => <span style={{ color: 'rgba(255,255,255,0.1)', margin: '0 2px' }}>·</span>;

const IMAGE_NODE_MODEL_IDS = ['nano-banana', 'gemini-flash', 'gpt-image-2'] as const;
const IMAGE_MODEL_ICON_BY_ID: Record<string, React.ReactNode> = {
  'nano-banana': <GoogleLogo />,
  'gemini-flash': <GoogleLogo />,
  'gpt-image-2': <OpenAILogo />,
};

const imageMenuSurface: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  bottom: 'calc(100% + 10px)',
  width: 420,
  maxHeight: 590,
  overflowY: 'auto',
  padding: 10,
  borderRadius: 22,
  background: 'rgba(38,38,38,0.98)',
  border: '1px solid rgba(255,255,255,0.11)',
  boxShadow: '0 22px 56px rgba(0,0,0,0.52)',
  backdropFilter: 'blur(22px)',
  zIndex: 1400,
};

const imageMenuItem = (active: boolean, hovered = false): React.CSSProperties => ({
  width: '100%',
  minHeight: 72,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '12px 14px',
  border: 'none',
  borderRadius: 15,
  background: active || hovered ? 'rgba(255,255,255,0.10)' : 'transparent',
  color: active ? '#f8fafc' : hovered ? '#e5e7eb' : '#a1a1aa',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background 120ms ease, color 120ms ease',
});

const imageMenuSubHeader: React.CSSProperties = {
  margin: '8px 6px 4px',
  color: '#94a3b8',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.2,
};

const menuQualityPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  width: 'fit-content',
  height: 28,
  padding: '0 10px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#a1a1aa',
  fontSize: 14,
  fontWeight: 650,
};

const ratioPreviewStyle = (ratioValue: string, active: boolean): React.CSSProperties => {
  const [rw, rh] = ratioValue.split(':').map((part) => Math.max(1, Number(part) || 1));
  const wide = rw >= rh;
  const maxW = wide ? 24 : 15;
  const maxH = wide ? 13 : 24;
  const scale = Math.min(maxW / rw, maxH / rh);
  return {
    width: Math.max(8, rw * scale),
    height: Math.max(8, rh * scale),
    borderRadius: 3,
    border: active ? '2px solid rgba(255,255,255,0.94)' : '2px solid rgba(255,255,255,0.45)',
    background: active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)',
  };
};

interface ImageModelRouteDropupProps {
  modelOptions: Array<{ id: string; label: string }>;
  currentModelId: string;
  currentRoute: ImageRouteConfig | null;
  size: string;
  onChangeModel: (modelId: string) => void;
  onChangeRoute: (routeId: string) => void;
}

const ImageModelRouteDropup: React.FC<ImageModelRouteDropupProps> = ({
  modelOptions,
  currentModelId,
  currentRoute,
  size,
  onChangeModel,
  onChangeRoute,
}) => {
  const [open, setOpen] = useState(false);
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const currentModel = modelOptions.find((option) => option.id === currentModelId) || modelOptions[0];
  const currentModelMeta = getImageModelById(currentModel?.id);
  const routeFamily = String(currentModelMeta?.routeFamily || 'default').trim() || 'default';
  const routes = getImageRoutesByModelFamily(routeFamily).filter((route) => route.isActive !== false);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="nodrag nopan"
        onClick={() => setOpen((value) => !value)}
        style={textModelTrigger}
        title="选择模型与线路"
      >
        {IMAGE_MODEL_ICON_BY_ID[currentModelId] || <GoogleLogo />}
        <span>{currentModel?.label || currentModelId}</span>
        {currentRoute ? <span style={{ color: '#94a3b8', fontSize: 12 }}>· {String(currentRoute.label || currentRoute.line)}</span> : null}
        <ChevronDown size={14} color="#a1a1aa" />
      </button>

      {open && (
        <div style={imageMenuSurface} className="sleek-scroll-y">
          {modelOptions.map((option) => {
            const active = option.id === currentModelId;
            const hovered = hoveredModelId === option.id;
            const modelSizes = getImageModelSizeOptions(option.id).map((item) => String(item).toUpperCase());
            const maxQuality = modelSizes.includes('4K') ? '4K' : modelSizes.includes('2K') ? '2K' : (modelSizes[0] || '1K');
            return (
              <button
                key={option.id}
                type="button"
                className="nodrag nopan"
                onMouseEnter={() => setHoveredModelId(option.id)}
                onMouseLeave={() => setHoveredModelId(null)}
                onClick={() => {
                  onChangeModel(option.id);
                }}
                style={imageMenuItem(active, hovered)}
              >
                <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 20, fontWeight: 760 }}>
                    {IMAGE_MODEL_ICON_BY_ID[option.id] || <GoogleLogo />}
                    <span>{option.label}</span>
                  </span>
                  <span style={menuQualityPill}>◇ {maxQuality}</span>
                </span>
                {active ? <Check size={15} /> : null}
              </button>
            );
          })}

          {routes.length > 1 && (
            <>
              <div style={imageMenuSubHeader}>线路</div>
              {routes.map((route) => {
                const active = currentRoute?.id === route.id;
                const hovered = hoveredRouteId === route.id;
                const pointCost = getImageRoutePointCost(route, size);
                return (
                  <button
                    key={route.id}
                    type="button"
                    className="nodrag nopan"
                    onMouseEnter={() => setHoveredRouteId(route.id)}
                    onMouseLeave={() => setHoveredRouteId(null)}
                    onClick={() => {
                      onChangeRoute(route.id);
                      setOpen(false);
                    }}
                    style={imageMenuItem(active, hovered)}
                  >
                    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                      <span style={{ fontWeight: 650 }}>{String(route.label || route.line)}</span>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>{route.transport} · {route.mode}</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#facc15', fontSize: 12 }}>{pointCost.toFixed(1)}点</span>
                      {active ? <Check size={15} /> : null}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
};

interface ImageSettingsDropupProps {
  ratio: string;
  size: string;
  ratios: string[];
  sizes: string[];
  onChangeRatio: (value: string) => void;
  onChangeSize: (value: string) => void;
}

const ImageSettingsDropup: React.FC<ImageSettingsDropupProps> = ({
  ratio,
  size,
  ratios,
  sizes,
  onChangeRatio,
  onChangeSize,
}) => {
  const [open, setOpen] = useState(false);
  const [hoveredSize, setHoveredSize] = useState<string | null>(null);
  const [hoveredRatio, setHoveredRatio] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const safeSize = String(size || '1k').toLowerCase();
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button type="button" className="nodrag nopan" onClick={() => setOpen((value) => !value)} style={textModelTrigger}>
        <span style={{ border: '1px solid #cbd5e1', width: 13, height: 13, display: 'inline-block', borderRadius: 2 }} />
        <span>{ratio}</span>
        <span style={{ color: '#94a3b8' }}>· {safeSize.toUpperCase()}</span>
        <ChevronDown size={14} color="#a1a1aa" />
      </button>
      {open && (
        <div style={{ ...imageMenuSurface, width: 480, padding: 18 }}>
          <div style={imageMenuSubHeader}>画质</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, sizes.length)},minmax(0,1fr))`, gap: 10, padding: '8px 0 18px' }}>
            {sizes.map((item) => {
              const active = item === safeSize;
              const hovered = hoveredSize === item;
              return (
                <button
                  key={item}
                  type="button"
                  className="nodrag nopan"
                  onMouseEnter={() => setHoveredSize(item)}
                  onMouseLeave={() => setHoveredSize(null)}
                  onClick={() => onChangeSize(item)}
                  style={{
                    height: 48,
                    borderRadius: 15,
                    border: '1px solid rgba(255,255,255,0.07)',
                    background: active || hovered ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.035)',
                    color: active ? '#f8fafc' : '#cbd5e1',
                    fontSize: 22,
                    fontWeight: 800,
                    cursor: 'pointer',
                    transition: 'background 120ms ease, transform 120ms ease',
                    transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
                  }}
                >
                  {item.toUpperCase()}
                </button>
              );
            })}
          </div>
          <div style={imageMenuSubHeader}>比例</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, padding: '8px 0 0' }}>
            {ratios.map((item) => {
              const active = item === ratio;
              const hovered = hoveredRatio === item;
              return (
                <button
                  key={item}
                  type="button"
                  className="nodrag nopan"
                  onMouseEnter={() => setHoveredRatio(item)}
                  onMouseLeave={() => setHoveredRatio(null)}
                  onClick={() => onChangeRatio(item)}
                  style={{
                    height: 64,
                    borderRadius: 15,
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: active || hovered ? 'rgba(255,255,255,0.11)' : 'transparent',
                    color: active ? '#f8fafc' : hovered ? '#e5e7eb' : '#9ca3af',
                    fontWeight: 650,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                    transition: 'background 120ms ease, color 120ms ease, transform 120ms ease',
                    transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
                  }}
                >
                  <span style={ratioPreviewStyle(item, active)} />
                  <span>{item}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* Section */

const TEXT_COLORS = [
  'transparent',
  '#ae4d4d',
  '#945c2a',
  '#8e8633',
  '#447444',
  '#366e79',
  '#3a538b',
  '#7b438b',
];

const Tooltip = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div 
      style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 12px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(28, 28, 38, 0.98)',
          color: '#fff',
          padding: '6px 12px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 1000,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          {title}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            border: '6px solid transparent',
            borderTopColor: 'rgba(28, 28, 38, 0.98)',
          }} />
        </div>
      )}
    </div>
  );
};

export const TextNodeComponent = memo(function TextNode({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const d = data;
  const updateNodeData = useFlowCanvasStore((s) => s.updateNodeData);
  const isGenerating = d.generationStatus === 'generating';
  const [hovered, setHovered] = useState(false);
  const { connectionNodeId } = useConnection();
  const isTargeting = !!connectionNodeId && connectionNodeId !== id && hovered;
  
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const copyToastTimerRef = useRef<number | null>(null);
  const currentModelId = String(d.modelId || DEFAULT_TEXT_MODEL_ID);
  const currentTextModel = getTextModelOption(currentModelId);
  const selectedInStore = useFlowCanvasStore((s) => !!s.nodes.find((node) => node.id === id)?.selected);
  const showNodeEditor = useSingleNodeSelection(selected || selectedInStore);

  const handleGenerate = () => {
    if (isGenerating) return;
    runNodeGeneration(id);
  };

  const handleCopyText = useCallback(async () => {
    await navigator.clipboard.writeText(d.text || '');
    setCopyToastVisible(true);
    if (copyToastTimerRef.current) {
      window.clearTimeout(copyToastTimerRef.current);
    }
    copyToastTimerRef.current = window.setTimeout(() => {
      setCopyToastVisible(false);
      copyToastTimerRef.current = null;
    }, 1800);
  }, [d.text]);

  const setStyle = (key: keyof FlowNodeData, val: any) => {
    updateNodeData(id, { [key]: val });
  };

  const applyTextAction = (type: 'bullet' | 'number' | 'divider' | 'bold' | 'italic' | 'h1' | 'h2' | 'h3') => {
    const textarea = document.querySelector(`textarea[data-node-id="${id}"]`) as HTMLTextAreaElement;
    const text = d.text || '';
    
    let start = 0;
    let end = 0;
    
    if (textarea) {
      start = textarea.selectionStart;
      end = textarea.selectionEnd;
    } else {
      start = text.length;
      end = text.length;
    }

    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);

    let newText = text;
    let newCursorPos = start;

    if (type === 'divider') {
      const dividerToken = '\n---\n';
      newText = before + dividerToken + after;
      newCursorPos = start + dividerToken.length;
    } else if (type === 'bullet') {
      const lines = selected.length > 0 ? selected.split('\n') : [''];
      const processed = lines.map(l => l.startsWith('• ') ? l.replace(/^• /, '') : '• ' + l).join('\n');
      newText = before + processed + after;
      newCursorPos = start + processed.length;
    } else if (type === 'number') {
      const lines = selected.length > 0 ? selected.split('\n') : [''];
      const processed = lines.map((l, i) => /^\d+\. /.test(l) ? l.replace(/^\d+\. /, '') : `${i + 1}. ` + l).join('\n');
      newText = before + processed + after;
      newCursorPos = start + processed.length;
    } else if (type === 'bold') {
      const isBold = selected.startsWith('**') && selected.endsWith('**');
      const processed = isBold ? selected.substring(2, selected.length - 2) : `**${selected}**`;
      newText = before + processed + after;
      newCursorPos = start + processed.length;
    } else if (type === 'italic') {
      const isItalic = selected.startsWith('_') && selected.endsWith('_');
      const processed = isItalic ? selected.substring(1, selected.length - 1) : `_${selected}_`;
      newText = before + processed + after;
      newCursorPos = start + processed.length;
    } else if (type === 'h1' || type === 'h2' || type === 'h3') {
      const prefix = type === 'h1' ? '# ' : type === 'h2' ? '## ' : '### ';
      const lines = selected.length > 0 ? selected.split('\n') : [''];
      const processed = lines.map(l => l.startsWith(prefix) ? l.replace(prefix, '') : prefix + l).join('\n');
      newText = before + processed + after;
      newCursorPos = start + processed.length;
    }

    updateNodeData(id, { text: newText });

    if (textarea) {
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  // Use undefined for transparent so card() uses default #161616/#222222
  const currentBg = d.backgroundColor === 'transparent' ? undefined : d.backgroundColor;

  const toolbarBtnStyle = (active?: boolean): React.CSSProperties => ({
    ...topToolbarBtn,
    color: active ? '#fff' : '#94a3b8',
    padding: '6px 10px',
    borderRadius: 99,
    background: active ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
  });

  const divider = <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />;

  return (
    <div 
      style={nodeWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setShowColorPicker(false);
        setShowModelMenu(false);
      }}
    >
      <NodeResizer 
        isVisible={selected} 
        minWidth={220} 
        minHeight={220} 
        lineStyle={{ border: 'none' }}
        handleStyle={{ 
          width: 24, 
          height: 24, 
          background: 'transparent', 
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      />
      
      <NodeLabel nodeId={id} icon={<Type size={14} />} label={String(d.title || 'Text')} fallbackLabel="Text" />

      <Handle 
        type="target" 
        position={Position.Left} 
        id="in" 
        style={{ ...invisibleHandle, position: 'absolute', left: -2, top: '50%', transform: 'translateY(-50%)' }}
      >
        <div style={handleHitArea}>
          <div style={{ ...plusHandleInner, opacity: hovered ? 1 : 0 }}><Plus size={14} /></div>
        </div>
      </Handle>

      <div style={{ ...card(0, 0, selected, isTargeting, currentBg as string), width: '100%', height: '100%', minWidth: 220, minHeight: 220 }}>
        <div style={{ position: 'absolute', inset: 0, padding: '18px 20px', overflow: 'hidden', boxSizing: 'border-box' }}>
          <textarea
            data-node-id={id}
            className="nodrag nopan nowheel sleek-scroll-y"
            value={d.text || ''}
            onChange={(e) => updateNodeData(id, { text: e.target.value })}
            onKeyDown={stopCanvasKeyboardPropagation}
            placeholder="开始输入..."
            spellCheck={false}
            style={{
              width: '100%',
              height: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#f8fafc',
              caretColor: '#fff',
              fontSize: d.fontSize === 'h1' ? 18 : d.fontSize === 'h2' ? 15 : d.fontSize === 'h3' ? 13 : 12,
              fontWeight: d.fontWeight === 'bold' ? 700 : 400,
              fontStyle: d.fontStyle === 'italic' ? 'italic' : 'normal',
              lineHeight: 1.48,
              resize: 'none',
              fontFamily: '"Microsoft YaHei", "微软雅黑", Arial, sans-serif',
              position: 'relative',
              zIndex: 2,
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              overflowY: 'auto',
              boxSizing: 'border-box',
              padding: 0,
            }}
          />
          {isGenerating && (
            <div style={textGeneratingOverlay}>
              <div style={textGeneratingPill}>
                <span className="flow-text-loading-dot" />
                <span>正在生成文本</span>
              </div>
              <div style={textSkeletonStack}>
                <span className="flow-text-skeleton" style={{ width: '92%' }} />
                <span className="flow-text-skeleton" style={{ width: '78%' }} />
                <span className="flow-text-skeleton" style={{ width: '86%' }} />
              </div>
            </div>
          )}
        </div>
        {isGenerating && <div style={progressBar(d.progress || 0)} />}
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        id="out" 
        style={{ ...invisibleHandle, position: 'absolute', right: -2, top: '50%', transform: 'translateY(-50%)' }}
      >
        <div style={handleHitArea}>
          <div style={{ ...plusHandleInner, opacity: hovered ? 1 : 0 }}><Plus size={14} /></div>
        </div>
      </Handle>

      {/* Top Floating Toolbar - Force high z-index to stay above AI bar */}
      {showNodeEditor && !isFullscreen && (
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
          <FloatingToolbar>
          <div style={{ position: 'relative' }}>
            <Tooltip title="背景颜色">
              <button 
                onClick={() => setShowColorPicker(!showColorPicker)}
                style={{ 
                  width: 28, 
                  height: 28, 
                  borderRadius: '50%', 
                  background: currentBg, 
                  border: '2px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden'
                }} 
              >
                {currentBg === 'transparent' && (
                  <div style={{ position: 'absolute', top: '50%', left: '-20%', width: '140%', height: 2, background: '#ef4444', transform: 'rotate(45deg)' }} />
                )}
              </button>
            </Tooltip>
            
            {showColorPicker && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 12px)',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(28,28,38,0.98)',
                borderRadius: 16,
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                border: '1px solid rgba(255,255,255,0.08)',
                zIndex: 100,
              }}>
                {TEXT_COLORS.map(c => (
                  <div 
                    key={c} 
                    onClick={() => { setStyle('backgroundColor', c); setShowColorPicker(false); }}
                    style={{ 
                      width: 24, 
                      height: 24, 
                      borderRadius: '50%', 
                      background: c === 'transparent' ? '#fff' : c, 
                      cursor: 'pointer', 
                      border: '2px solid rgba(255,255,255,0.1)',
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    {c === 'transparent' && (
                      <div style={{ position: 'absolute', top: '50%', left: '-20%', width: '140%', height: 2, background: '#ef4444', transform: 'rotate(45deg)' }} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {divider}
          
          <Tooltip title="一级标题"><button onClick={() => applyTextAction('h1')} style={toolbarBtnStyle()}>H1</button></Tooltip>
          <Tooltip title="二级标题"><button onClick={() => applyTextAction('h2')} style={toolbarBtnStyle()}>H2</button></Tooltip>
          <Tooltip title="三级标题"><button onClick={() => applyTextAction('h3')} style={toolbarBtnStyle()}>H3</button></Tooltip>
          
          {divider}
          
          <Tooltip title="粗体"><button onClick={() => applyTextAction('bold')} style={toolbarBtnStyle()}><Bold size={16} /></button></Tooltip>
          <Tooltip title="斜体"><button onClick={() => applyTextAction('italic')} style={toolbarBtnStyle()}><Italic size={16} /></button></Tooltip>
          
          {divider}
          
          <Tooltip title="无序列表"><button onClick={() => applyTextAction('bullet')} style={toolbarBtnStyle(d.listType === 'bullet')}><List size={16} /></button></Tooltip>
          <Tooltip title="有序列表"><button onClick={() => applyTextAction('number')} style={toolbarBtnStyle(d.listType === 'number')}><ListOrdered size={16} /></button></Tooltip>
          
          {divider}
          
          <Tooltip title="分割线"><button onClick={() => applyTextAction('divider')} style={toolbarBtnStyle()}><Minus size={16} /></button></Tooltip>
          <Tooltip title={copyToastVisible ? '已复制' : '复制'}>
            <button
              onClick={handleCopyText}
              style={{
                ...toolbarBtnStyle(copyToastVisible),
                color: copyToastVisible ? '#fff' : toolbarBtnStyle().color,
              }}
            >
              {copyToastVisible ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </Tooltip>
          <Tooltip title="全屏"><button onClick={() => setIsFullscreen(true)} style={toolbarBtnStyle()}><Maximize size={16} /></button></Tooltip>
        </FloatingToolbar>
      </div>
    )}

      {showNodeEditor && !isFullscreen && (
        <FloatingPromptBar>
          <div style={{ position: 'relative' }}>
            <textarea
              className="nodrag nopan nowheel"
              value={d.generationPrompt || ''}
              onChange={(e) => updateNodeData(id, { generationPrompt: e.target.value })}
              onKeyDown={stopCanvasKeyboardPropagation}
              placeholder="描述任何你想要生成的内容"
              style={{ ...promptTextarea, minHeight: promptExpanded ? 360 : 118, fontWeight: 400 }}
            />
            <button 
              onClick={() => setPromptExpanded(!promptExpanded)}
              style={promptExpandButton}
              title={promptExpanded ? '收起' : '展开'}
            >
              <Maximize2 size={18} />
            </button>
          </div>

          <div style={promptBottomRow}>
            <div style={paramRow}>
              <div style={{ position: 'relative' }}>
                {showModelMenu && (
                  <div style={textModelMenu}>
                    {TEXT_MODEL_OPTIONS.map((model) => {
                      const active = model.id === currentModelId;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className="nodrag nopan"
                          onClick={() => {
                            updateNodeData(id, { modelId: model.id });
                            setShowModelMenu(false);
                          }}
                          style={{
                            ...textModelMenuItem,
                            background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                          }}
                        >
                          <img src={TEXT_MODEL_LOGO_BY_PROVIDER[model.provider]} alt="" style={textModelLogo} />
                          <span style={textModelMenuLabel}>{model.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowModelMenu((open) => !open)}
                  className="nodrag nopan"
                  style={textModelTrigger}
                  title="选择文本模型"
                >
                  <img src={TEXT_MODEL_LOGO_BY_PROVIDER[currentTextModel.provider]} alt="" style={textModelTriggerLogo} />
                  <span>{currentTextModel.label}</span>
                  <ChevronDown size={14} color="#a1a1aa" />
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={sendBtnOuter}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Coins size={14} color="#f59e0b" />
                  <span>2</span>
                </span>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  style={sendBtnAction(isGenerating)}
                  title="开始生成"
                >
                  {isGenerating ? '...' : <ArrowUp size={16} />}
                </button>
              </div>
            </div>
          </div>
        </FloatingPromptBar>
      )}

      {/* Fullscreen Modal - Using Portal to escape React Flow transformations */}
      {isFullscreen && createPortal(
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100000, // Very high z-index
        }}>
          <div style={{
            width: '94vw',
            height: '90vh',
            maxWidth: 1400,
            background: '#1a1a1a', // Deeper black for modal
            borderRadius: 24,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 50px 100px rgba(0, 0, 0, 0.8)',
            border: '1px solid rgba(255,255,255,0.08)',
            overflow: 'hidden',
            position: 'relative',
          }}>
            {/* Modal Toolbar - Integrated Top Bar */}
            <div style={{
              height: 72,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 32px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              background: 'rgba(0,0,0,0.1)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Tooltip title="复制全部">
                  <div 
                    style={{ 
                      padding: '8px',
                      borderRadius: '8px',
                      background: 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    onClick={handleCopyText}
                  >
                    <Copy size={18} style={{ color: '#64748b' }} />
                  </div>
                </Tooltip>
              </div>

              {/* Center Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.05)', padding: '6px 12px', borderRadius: 99 }}>
                <button onClick={() => applyTextAction('h1')} style={toolbarBtnStyle()}>H1</button>
                <button onClick={() => applyTextAction('h2')} style={toolbarBtnStyle()}>H2</button>
                <button onClick={() => applyTextAction('h3')} style={toolbarBtnStyle()}>H3</button>
                <button onClick={() => applyTextAction('body')} style={toolbarBtnStyle()}><Type size={16} /></button>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
                <button onClick={() => applyTextAction('bold')} style={toolbarBtnStyle()}><Bold size={16} /></button>
                <button onClick={() => applyTextAction('italic')} style={toolbarBtnStyle()}><Italic size={16} /></button>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
                <button onClick={() => applyTextAction('bullet')} style={toolbarBtnStyle()}><List size={16} /></button>
                <button onClick={() => applyTextAction('number')} style={toolbarBtnStyle()}><ListOrdered size={16} /></button>
                <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
                <button onClick={() => applyTextAction('divider')} style={toolbarBtnStyle()}><Minus size={16} /></button>
              </div>

              <button 
                onClick={() => setIsFullscreen(false)}
                style={{ 
                  width: 40, 
                  height: 40, 
                  borderRadius: '50%', 
                  background: 'rgba(255,255,255,0.05)', 
                  border: 'none', 
                  color: '#94a3b8', 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={20} />
              </button>
            </div>
            
            {/* Header Separator Line - Matching TapNow */}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', width: '100%' }} />

            {/* Modal Content - Wide Editorial Layout */}
            <div style={{ flex: 1, padding: '0 80px', position: 'relative', overflowY: 'auto' }}>
              <div style={{ position: 'relative', minHeight: '100%', padding: '60px 0' }}>
                {/* Rendering Layer */}
                <div style={{
                  display: 'none',
                  position: 'absolute',
                  top: 60,
                  left: 0,
                  right: 0,
                  pointerEvents: 'none',
                  whiteSpace: 'pre-wrap',
                  wordWrap: 'break-word',
                  color: '#f8fafc',
                  fontSize: d.fontSize === 'h1' ? 34 : d.fontSize === 'h2' ? 28 : d.fontSize === 'h3' ? 22 : 15,
                  fontWeight: d.fontWeight === 'bold' ? 700 : 400,
                  fontStyle: d.fontStyle === 'italic' ? 'italic' : 'normal',
                  lineHeight: 1.6,
                  fontFamily: '"Microsoft YaHei", "微软雅黑", Arial, sans-serif',
                  zIndex: 1,
                }}>
                  {d.text?.split('\n').map((line, idx) => {
                    if (line.trim() === '---') {
                      return <div key={idx} style={{ height: '1.6em', display: 'flex', alignItems: 'center' }}>
                        <div style={{ width: '100%', height: 1.5, background: 'rgba(255,255,255,0.15)', borderRadius: 1 }} />
                      </div>;
                    }
                    
                    // Simple Markdown Parser for Line
                    let content: React.ReactNode = line;
                    let fontSize = 15;
                    let fontWeight = 400;

                    if (line.startsWith('# ')) {
                      fontSize = 34; fontWeight = 700; content = line.substring(2);
                    } else if (line.startsWith('## ')) {
                      fontSize = 28; fontWeight = 700; content = line.substring(3);
                    } else if (line.startsWith('### ')) {
                      fontSize = 22; fontWeight = 700; content = line.substring(4);
                    }

                    // Process Bold and Italic within line
                    const processInline = (text: string) => {
                      const parts = text.split(/(\*\*.*?\*\*|_.*?_)/g);
                      return parts.map((part, i) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                          return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
                        }
                        if (part.startsWith('_') && part.endsWith('_')) {
                          return <em key={i} style={{ fontStyle: 'italic' }}>{part.slice(1, -1)}</em>;
                        }
                        return part;
                      });
                    };

                    return (
                      <div key={idx} style={{ 
                        minHeight: '1.6em', 
                        fontSize, 
                        fontWeight,
                      }}>
                        {typeof content === 'string' ? processInline(content) : content}
                      </div>
                    );
                  })}
                </div>

                <textarea
                  autoFocus
                  className="nodrag nopan nowheel"
                  value={d.text || ''}
                  onChange={(e) => updateNodeData(id, { text: e.target.value })}
                  onKeyDown={stopCanvasKeyboardPropagation}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    height: '100%',
                    minHeight: '65vh',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#f8fafc',
                    caretColor: '#fff',
                    fontSize: d.fontSize === 'h1' ? 34 : d.fontSize === 'h2' ? 28 : d.fontSize === 'h3' ? 22 : 15,
                    fontWeight: d.fontWeight === 'bold' ? 700 : 400,
                    fontStyle: d.fontStyle === 'italic' ? 'italic' : 'normal',
                    lineHeight: 1.6,
                    resize: 'none',
                    fontFamily: '"Microsoft YaHei", "微软雅黑", Arial, sans-serif',
                    position: 'relative',
                    zIndex: 2,
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                    overflowY: 'auto',
                    padding: 0,
                  }}
                  placeholder="开始输入..."
                />
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {copyToastVisible && createPortal(
        <div style={copyToast}>
          <div style={copyToastIcon}><Check size={18} /></div>
          <div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>复制成功</div>
            <div style={{ color: '#a1a1aa', fontSize: 15, marginTop: 4 }}>内容已复制到剪贴板</div>
          </div>
        </div>,
        document.body
      )}

      {d.errorMessage && (
        <div style={hasGenerationError ? imageErrorToast : errorBar}>
          <span>⚠{String(d.errorMessage || '')}</span>
          {hasGenerationError && (
            <button
              type="button"
              className="nodrag nopan"
              style={imageRetryBtn}
              onClick={handleGenerate}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = 'rgba(254,202,202,0.2)';
                event.currentTarget.style.borderColor = 'rgba(254,202,202,0.5)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'rgba(254,202,202,0.12)';
                event.currentTarget.style.borderColor = 'rgba(254,202,202,0.28)';
              }}
            >
              重试
            </button>
          )}
        </div>
      )}
    </div>
  );
});

const imageDragCard = (w: number, h: number, selected?: boolean): React.CSSProperties => ({
  position: 'relative',
  width: w,
  height: h,
  borderRadius: 16,
  background: selected ? '#242424' : '#1e1e1e',
  border: selected ? '1.5px solid rgba(255,255,255,0.38)' : '1.5px solid transparent',
  overflow: 'hidden',
  boxShadow: '0 3px 10px rgba(0,0,0,0.18)',
  contain: 'layout paint style',
  willChange: 'transform',
  transform: 'translateZ(0)',
  transition: 'none',
  zIndex: 10,
});

const ImageNodeLite = memo(function ImageNodeLite({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const d = data;
  const displayThumbnailUrl = normalizeBackendAssetUrl(String(d.thumbnailUrl || ''));
  const width = Number(d.width || FLOW_NODE_DEFAULT_SIZES.image.width);
  const height = Number(d.height || FLOW_NODE_DEFAULT_SIZES.image.height);

  return (
    <div
      style={{
        ...nodeWrapper,
        pointerEvents: 'none',
        contain: 'layout paint style',
        willChange: 'transform',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 'calc(100% + 8px)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'rgba(255,255,255,0.72)',
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          textShadow: '0 1px 8px rgba(0,0,0,0.55)',
        }}
      >
        <ImageIcon size={14} />
        <span>{String(d.title || 'Image')}</span>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="in"
        style={{ ...invisibleHandle, position: 'absolute', left: -2, top: '50%', transform: 'translateY(-50%)' }}
      />

      <div style={imageDragCard(width, height, selected)}>
        {displayThumbnailUrl ? (
          <img
            src={displayThumbnailUrl}
            alt=""
            draggable={false}
            decoding="async"
            loading="eager"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
          />
        ) : (
          <div style={{ ...placeholderArea(height), height: '100%' }}>
            <ImageIcon size={42} />
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ ...invisibleHandle, position: 'absolute', right: -2, top: '50%', transform: 'translateY(-50%)' }}
      />
    </div>
  );
});

interface ImageNodeCardProps {
  data: FlowNodeData;
  selected?: boolean;
  isTargeting: boolean;
  displayThumbnailUrl: string;
  isGeneratedImageNode: boolean;
  showNodeEditor: boolean;
  resultCount: number;
  resultStripOpen: boolean;
  canExpandResults: boolean;
  coverResult?: { id: string; url: string; createdAt?: number };
  favoriteResultIds: Set<string>;
  isGenerating: boolean;
  onToggleResultStrip: () => void;
  onToggleFavoriteResult: (resultId: string) => void;
  onUploadClick: () => void;
}

const ImageNodeCard = memo(function ImageNodeCard({
  data: d,
  selected,
  isTargeting,
  displayThumbnailUrl,
  isGeneratedImageNode,
  showNodeEditor,
  resultCount,
  resultStripOpen,
  canExpandResults,
  coverResult,
  favoriteResultIds,
  isGenerating,
  onToggleResultStrip,
  onToggleFavoriteResult,
  onUploadClick,
}: ImageNodeCardProps) {
  return (
    <div
      style={card(d.width || FLOW_NODE_DEFAULT_SIZES.image.width, d.height || FLOW_NODE_DEFAULT_SIZES.image.height, selected, isTargeting)}
    >
      {displayThumbnailUrl ? (
        <div style={{ ...contentArea, height: '100%', position: 'relative' }}>
          <img
            src={displayThumbnailUrl}
            alt=""
            draggable={false}
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          {isGeneratedImageNode && showNodeEditor && resultCount > 0 && (
            <button
              type="button"
              className="nodrag nopan"
              onClick={canExpandResults ? onToggleResultStrip : undefined}
              style={resultCountBadge(resultStripOpen, false, canExpandResults)}
              title={canExpandResults ? '展开本次生成结果' : '本次生成 1 张图'}
            >
              <span>{resultCount}</span>
              {canExpandResults && <ChevronDown size={13} />}
            </button>
          )}
          {isGeneratedImageNode && showNodeEditor && coverResult && (
            <button
              type="button"
              className="nodrag nopan"
              onClick={() => onToggleFavoriteResult(coverResult.id)}
              style={generatedFavoriteButton(favoriteResultIds.has(coverResult.id))}
              title={favoriteResultIds.has(coverResult.id) ? '取消收藏' : '收藏'}
            >
              <Star size={13} fill={favoriteResultIds.has(coverResult.id) ? 'currentColor' : 'none'} />
            </button>
          )}
          {!isGeneratedImageNode && (
            <button
              className="nodrag nopan flow-image-hover-reveal flow-image-replace-btn"
              onClick={onUploadClick}
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(0,0,0,0.65)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 20,
                padding: '6px 14px 6px 10px',
                color: '#fff',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                zIndex: 20,
              }}
            >
              <Upload size={14} /> 替换
            </button>
          )}
        </div>
      ) : (
        <div style={placeholderArea(d.height || FLOW_NODE_DEFAULT_SIZES.image.height)}>
          <ImageIcon size={48} strokeWidth={1} color="rgba(255,255,255,0.2)" />
        </div>
      )}

      {isGenerating && (
        <div style={imageGeneratingOverlay}>
          <div style={imageGeneratingSheen} />
          <div style={imageGeneratingPill}>
            <span style={imageGeneratingDot} />
            <span>正在生成</span>
          </div>
        </div>
      )}
      {isGenerating && <div style={progressBar(d.progress || 0)} />}
    </div>
  );
});

interface ImageResultStripProps {
  data: FlowNodeData;
  resultItems: Array<{ id: string; url: string; createdAt?: number }>;
  activeResultIndex: number;
  favoriteResultIds: Set<string>;
  resultStripOpen: boolean;
  resultStripRef: React.RefObject<HTMLDivElement | null>;
  onToggleFavoriteResult: (resultId: string) => void;
  onApplyResultToCanvas: (imageUrl: string, index: number) => void;
  onDownloadResult: (imageUrl: string, index: number) => void;
  onSelectGeneratedResult: (index: number) => void;
}

const ImageResultStrip = memo(function ImageResultStrip({
  data: d,
  resultItems,
  activeResultIndex,
  favoriteResultIds,
  resultStripOpen,
  resultStripRef,
  onToggleFavoriteResult,
  onApplyResultToCanvas,
  onDownloadResult,
  onSelectGeneratedResult,
}: ImageResultStripProps) {
  return (
    <div
      ref={resultStripRef}
      style={{
        ...resultExpansionWrap,
        animation: resultStripOpen
          ? 'flow-filmstrip-in 180ms ease-out'
          : 'flow-filmstrip-out 160ms ease-in forwards',
        pointerEvents: resultStripOpen ? 'auto' : 'none',
      }}
      className="nodrag nopan nowheel"
    >
      <div style={resultExpansionRow} className="sleek-scroll-x">
        {resultItems.map((item, index) => {
          const active = index === activeResultIndex;
          const favorited = favoriteResultIds.has(item.id);
          const itemWidth = Math.min(Math.max(Number(d.width || FLOW_NODE_DEFAULT_SIZES.image.width), 150), 230);
          const itemHeight = Math.min(Math.max(Number(d.height || FLOW_NODE_DEFAULT_SIZES.image.height), 150), 320);
          return (
            <div
              key={item.id}
              className="nodrag nopan flow-result-strip-item"
              style={{
                position: 'relative',
                width: itemWidth,
                height: itemHeight,
                borderRadius: 12,
                border: active ? '1.5px solid rgba(255,255,255,0.85)' : '1px solid rgba(255,255,255,0.16)',
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.04)',
                boxShadow: active
                  ? '0 12px 26px rgba(0,0,0,0.38), 0 0 0 1px rgba(255,255,255,0.22)'
                  : '0 10px 24px rgba(0,0,0,0.28)',
                flex: '0 0 auto',
                transform: 'translateY(0)',
                transition: 'box-shadow 140ms ease, transform 140ms ease',
              }}
            >
              <img
                src={normalizeBackendAssetUrl(item.url)}
                alt={`result-${index + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  className="nodrag nopan"
                  onClick={() => onToggleFavoriteResult(item.id)}
                  style={resultOverlayButton}
                  title={favorited ? '取消收藏' : '收藏'}
                >
                  <Star size={12} fill={favorited ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  className="nodrag nopan"
                  onClick={() => onApplyResultToCanvas(item.url, index)}
                  style={resultOverlayButton}
                  title="应用到画布"
                >
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  className="nodrag nopan"
                  onClick={() => onDownloadResult(item.url, index)}
                  style={resultOverlayButton}
                  title="下载"
                >
                  <Download size={12} />
                </button>
              </div>
              <button
                type="button"
                className="nodrag nopan"
                onClick={() => onSelectGeneratedResult(index)}
                style={{
                  ...setMainResultButton,
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  opacity: active ? 0.9 : 1,
                }}
                title="设为主图"
              >
                {active ? '主图' : '设为主图'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/* Section */
const ImageNodeHeavy = memo(function ImageNodeHeavy({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const d = data;
  const updateNodeData = useFlowCanvasStore((s) => s.updateNodeData);
  const addNodeAndEdge = useFlowCanvasStore((s) => s.addNodeAndEdge);
  const removeEdgesByIds = useFlowCanvasStore((s) => s.removeEdgesByIds);
  const activeImageTool = useFlowCanvasStore((s) => s.activeImageTool);
  const openImageTool = useFlowCanvasStore((s) => s.openImageTool);
  const closeImageTool = useFlowCanvasStore((s) => s.closeImageTool);
  const setCanvasViewport = useFlowCanvasStore((s) => s.setViewport);
  const pushHistory = useFlowCanvasStore((s) => s.pushHistory);
  const projectId = useFlowCanvasStore((s) => s.projectId);
  const projectTitle = useFlowCanvasStore((s) => s.projectTitle);
  const leftPanelOpen = useFlowCanvasStore((s) => s.leftPanelOpen);
  const upstreamImageRefs = useFlowCanvasStore(
    (s) => s.graphIndex.upstreamImageRefsByNodeId[id] || EMPTY_UPSTREAM_IMAGE_REFS,
  );
  const hasIncomingEdges = useFlowCanvasStore((s) => !!s.graphIndex.hasIncomingEdgesByNodeId[id]);
  const derivedEditCounts = useFlowCanvasStore(
    (s) => s.graphIndex.childEditCountsByNodeId[id] || EMPTY_DERIVED_EDIT_COUNTS,
  );
  const cropResultCount = derivedEditCounts.crop;
  const resizeResultCount = derivedEditCounts.resize;
  const splitResultCount = derivedEditCounts.split;
  const annotateResultCount = derivedEditCounts.annotate;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageNodeRef = useRef<HTMLDivElement>(null);
  const imageCardRef = useRef<HTMLDivElement>(null);
  const promptBarRef = useRef<HTMLDivElement>(null);
  const promptEditorRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const promptLexicalEditorRef = useRef<PromptLexicalEditorHandle>(null);
  const promptSelectionRef = useRef({ start: 0, end: 0 });
  const promptValueRef = useRef(String(d.generationPrompt || ''));
  const pendingPromptCaretRef = useRef<number | null>(null);
  const promptComposingRef = useRef(false);
  const suppressReferenceClickRef = useRef(false);
  const toolOpenTimerRef = useRef<number | null>(null);
  const reactFlow = useReactFlow();
  const [hovered, setHovered] = useState(false);
  const [showBatchSelector, setShowBatchSelector] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [slashQuery, setSlashQuery] = useState('');
  const [assetMenuIndex, setAssetMenuIndex] = useState(0);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [hoveredReferenceKey, setHoveredReferenceKey] = useState<string | null>(null);
  const [draggingReferenceKey, setDraggingReferenceKey] = useState<string | null>(null);
  const selectedInStore = useFlowCanvasStore((s) => !!s.nodes.find((node) => node.id === id)?.selected);
  const showNodeEditor = useSingleNodeSelection(selected || selectedInStore);
  const shouldLoadEditorResources = showNodeEditor || activeImageTool?.nodeId === id || fullscreenOpen || assetMenuOpen || slashMenuOpen;
  const models = useImageModelCatalogWhenNeeded(shouldLoadEditorResources);
  const folders = useImageFolderStore((state) => (shouldLoadEditorResources ? state.folders : EMPTY_IMAGE_FOLDERS));
  const folderItems = useImageFolderStore((state) => (shouldLoadEditorResources ? state.items : EMPTY_IMAGE_FOLDER_ITEMS));

  const [splitInitialGridSize, setSplitInitialGridSize] = useState(2);

  const [repaintMode, setRepaintMode] = useState<'inpaint' | 'erase'>('inpaint');
  const [aiConfirmType, setAiConfirmType] = useState<Extract<ImageEditType, 'enhance' | 'removeBackground'> | null>(null);

  const { connectionNodeId } = useConnection();
  const hasImage = !!d.thumbnailUrl;
  const isGenerating = d.generationStatus === 'generating';
  const isGeneratedImageNode = hasImage && !!d.lastGenerationSnapshot;
  const showInputHandle = canNodeReceiveIncoming({ type: 'image', data: d } as Node<FlowNodeData>);
  const shouldShowUploadToolbar = !hasImage && showNodeEditor && !hasIncomingEdges && !isGenerating;
  const shouldShowPromptEditor = showNodeEditor && (!hasImage || isGeneratedImageNode);
  const isImageToolOpen = useCallback(
    (tool: string) => activeImageTool?.nodeId === id && activeImageTool.tool === tool,
    [activeImageTool, id],
  );
  
  const isTargeting = !!connectionNodeId && connectionNodeId !== id && hovered;

  useEffect(() => () => {
    if (toolOpenTimerRef.current !== null) {
      window.clearTimeout(toolOpenTimerRef.current);
    }
  }, []);

  const modelOptions = (
    models.length
      ? models.filter((model) => (IMAGE_NODE_MODEL_IDS as readonly string[]).includes(model.id))
      : []
  ).map((m) => ({ id: m.id, label: m.label }));
  if (modelOptions.length === 0) {
    modelOptions.push(
      { id: 'nano-banana', label: 'Nano Banana Pro' },
      { id: 'gemini-flash', label: 'Nano Banana 2' },
      { id: 'gpt-image-2', label: 'GPT-image-2' },
    );
  }

  const currentModelId = String(d.modelId || modelOptions[0]?.id || 'nano-banana');

  const sizeOptions = ['1k', '2k', '4k'];
  const showSize = shouldShowImageSizeSelector(currentModelId) && sizeOptions.length > 0;
  const extraRatios = getImageModelExtraAspectRatios(currentModelId);
  const defaultRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
  const aspectOptions = Array.from(new Set([...defaultRatios, ...extraRatios]));

  const p = (d.params || {}) as Record<string, any>;
  const currentSize = String(p.size || sizeOptions[0] || '1k').toLowerCase();
  const currentRatio = String(p.aspect_ratio || aspectOptions[0] || '1:1');
  const routeFamily = String(getImageModelById(currentModelId)?.routeFamily || 'default').trim() || 'default';
  const routeOptions = getImageRoutesByModelFamily(routeFamily).filter((route) => route.isActive !== false);
  const selectedRoute =
    routeOptions.find((route) => route.id === d.routeId) ||
    routeOptions.find((route) => route.id === getSelectedImageRoute(currentModelId).id) ||
    getLowestCostImageRouteForModel(currentModelId, currentSize) ||
    routeOptions[0] ||
    null;

  const currentPointCost = getImageRoutePointCost(selectedRoute, currentSize);
  const referencedAssetItemIds = Array.isArray(d.referenceAssetItemIds)
    ? (d.referenceAssetItemIds as string[])
    : [];
  const recentAssetItemIds = Array.isArray((p.recentReferenceAssetItemIds as unknown[] | undefined))
    ? (p.recentReferenceAssetItemIds as unknown[]).map((item) => String(item || ''))
    : [];
  const referencedAssetItems = referencedAssetItemIds
    .map((itemId) => folderItems.find((item) => item.id === itemId))
    .filter((item): item is (typeof folderItems)[number] => Boolean(item));
  const rawReferenceChips = [
    ...upstreamImageRefs,
    ...referencedAssetItems.map((item) => ({
      key: `asset:${item.id}`,
      id: item.id,
      imageUrl: item.imageUrl,
      title: item.title,
      source: 'asset' as const,
    })),
  ];
  const referenceOrder = Array.isArray(d.referenceOrder)
    ? (d.referenceOrder as string[]).map((item) => String(item))
    : [];
  const referenceChips = useMemo(() => {
    const orderIndex = new Map(referenceOrder.map((key, index) => [key, index]));
    return [...rawReferenceChips].sort((a, b) => {
      const ai = orderIndex.has(a.key) ? orderIndex.get(a.key)! : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(b.key) ? orderIndex.get(b.key)! : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return rawReferenceChips.findIndex((item) => item.key === a.key) - rawReferenceChips.findIndex((item) => item.key === b.key);
    }).map((item, index) => ({
      ...item,
      mentionLabel: `Image ${index + 1}`,
    }));
  }, [rawReferenceChips, referenceOrder]);
  const promptReferences = useMemo<PromptReference[]>(
    () => referenceChips.map((item) => ({
      key: item.key,
      label: item.mentionLabel,
      imageUrl: item.imageUrl,
    })),
    [referenceChips],
  );
  const connectedMentionItems = upstreamImageRefs.filter((item) => {
    const query = mentionQuery.trim().toLowerCase();
    if (!query) return true;
    return item.title.toLowerCase().includes(query);
  });
  const filteredMentionItems = folderItems.filter((item) => {
    const query = mentionQuery.trim().toLowerCase();
    if (!query) return true;
    return `${item.title || ''} ${item.notes || ''}`.toLowerCase().includes(query);
  }).slice(0, 8);
  const filteredRecentMentionItems = recentAssetItemIds
    .map((itemId) => folderItems.find((item) => item.id === itemId))
    .filter((item): item is (typeof folderItems)[number] => Boolean(item))
    .filter((item) => filteredMentionItems.some((candidate) => candidate.id === item.id))
    .slice(0, 4);
  const filteredLibraryMentionItems = filteredMentionItems.filter(
    (item) => !filteredRecentMentionItems.some((recent) => recent.id === item.id),
  );
  const mentionCandidates = [
    ...connectedMentionItems.map((item) => ({ kind: 'upstream' as const, id: item.id })),
    ...filteredRecentMentionItems.map((item) => ({ kind: 'asset' as const, id: item.id })),
    ...filteredLibraryMentionItems.map((item) => ({ kind: 'asset' as const, id: item.id })),
  ];
  const filteredSlashCommands = IMAGE_SLASH_COMMANDS.filter((command) => {
    const query = slashQuery.trim().toLowerCase();
    if (!query) return true;
    return command.label.toLowerCase().includes(query);
  });
  const richPromptParts = useMemo(() => {
    const text = String(d.generationPrompt || '');
    if (!text) return [] as Array<
      | { type: 'text'; text: string; start: number; end: number }
      | { type: 'ref'; ref: (typeof referenceChips)[number]; start: number; end: number; mentionText: string }
    >;
    const refs = [...referenceChips]
      .flatMap((item) => [
        { ref: item, label: item.mentionLabel },
        ...(item.title.trim() && item.title.trim() !== item.mentionLabel ? [{ ref: item, label: item.title.trim() }] : []),
      ])
      .sort((a, b) => b.label.length - a.label.length);
    if (refs.length === 0) return [{ type: 'text' as const, text, start: 0, end: text.length }];

    const parts: Array<
      | { type: 'text'; text: string; start: number; end: number }
      | { type: 'ref'; ref: (typeof referenceChips)[number]; start: number; end: number; mentionText: string }
    > = [];
    let cursor = 0;
    let buffer = '';
    let bufferStart = 0;
    const flushText = () => {
      if (!buffer) return;
      parts.push({ type: 'text', text: buffer, start: bufferStart, end: cursor });
      buffer = '';
    };

    while (cursor < text.length) {
      const match = refs.find((refItem) => {
        const token = `@${refItem.label}`;
        if (!text.startsWith(token, cursor)) return false;
        const next = text[cursor + token.length];
        return !next || /\s|[，。,.!?！？、；;]/.test(next);
      });

      if (match) {
        flushText();
        const start = cursor;
        const tokenEnd = cursor + match.label.length + 1;
        const end = text[tokenEnd] === ' ' ? tokenEnd + 1 : tokenEnd;
        parts.push({ type: 'ref', ref: match.ref, start, end, mentionText: `@${match.ref.mentionLabel} ` });
        cursor = end;
        bufferStart = cursor;
      } else {
        if (!buffer) bufferStart = cursor;
        buffer += text[cursor];
        cursor += 1;
      }
    }
    flushText();
    return parts;
  }, [d.generationPrompt, referenceChips]);
  const generatedResults = Array.isArray(d.generatedResults)
    ? (d.generatedResults as Array<{ id?: string; url?: string; createdAt?: number }>)
        .map((item, index) => ({
          id: String(item?.id || `result-fallback-${index}`),
          url: String(item?.url || '').trim(),
          createdAt: Number(item?.createdAt || Date.now()),
        }))
        .filter((item) => item.url)
    : [];
  const resultItems = generatedResults.length > 0
    ? generatedResults
    : (d.thumbnailUrl
      ? [{ id: 'result-single', url: String(d.thumbnailUrl), createdAt: Date.now() }]
      : []);
  const rawActiveIndex = Number(d.activeResultIndex || 0);
  const activeResultIndex = resultItems.length > 0
    ? Math.min(Math.max(rawActiveIndex, 0), resultItems.length - 1)
    : 0;
  const coverResultId = String(d.coverResultId || '');
  const coverResult = resultItems.find((item) => item.id === coverResultId) || resultItems[activeResultIndex];
  const displayThumbnailUrl = normalizeBackendAssetUrl(coverResult?.url || String(d.thumbnailUrl || ''));
  const resultCount = isGeneratedImageNode ? resultItems.length : 0;
  const canExpandResults = resultCount > 1;
  const favoriteResultIds = useMemo(
    () => new Set(
      Array.isArray(d.favoriteResultIds)
        ? (d.favoriteResultIds as string[]).map((item) => String(item))
        : [],
    ),
    [d.favoriteResultIds],
  );
  const [resultStripOpen, setResultStripOpen] = useState(false);
  const [resultStripMounted, setResultStripMounted] = useState(false);
  const hasGenerationError = d.generationStatus === 'error' && !!d.errorMessage;
  const resultStripRef = useRef<HTMLDivElement>(null);
  const resultStripTimerRef = useRef<number | null>(null);

  const setParam = (key: string, val: any) => {
    const patch: Partial<FlowNodeData> = { params: { ...p, [key]: val } };
    if (key === 'aspect_ratio' && !d.thumbnailUrl) {
      const nextSize = getMediaNodeSizeFromRatioString(val, 4 / 3);
      patch.width = nextSize.width;
      patch.height = nextSize.height;
      patch.aspectRatio = parseAspectRatio(val) || 4 / 3;
    }
    updateNodeData(id, patch);
  };

  const applyModelSelection = useCallback(
    (modelId: string) => {
      const nextSizes = getImageModelSizeOptions(modelId)
        .map((value) => String(value || '').toLowerCase())
        .filter((value) => ['1k', '2k', '4k'].includes(value));
      const nextSize = nextSizes.includes(currentSize) ? currentSize : (nextSizes[0] || '1k');
      const fallbackRoute = getLowestCostImageRouteForModel(modelId, nextSize) || getSelectedImageRoute(modelId);
      updateNodeData(id, {
        modelId,
        routeId: fallbackRoute?.id,
        params: {
          ...p,
          size: nextSize,
        },
      });
    },
    [currentSize, id, p, updateNodeData],
  );

  const applyRouteSelection = useCallback(
    (routeId: string) => {
      updateNodeData(id, { routeId });
    },
    [id, updateNodeData],
  );

  useEffect(() => {
    if (!selectedRoute) return;
    if (d.routeId === selectedRoute.id) return;
    updateNodeData(id, { routeId: selectedRoute.id });
  }, [d.routeId, id, selectedRoute, updateNodeData]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!promptBarRef.current) return;
      if (promptBarRef.current.contains(event.target as Node)) return;
      setAssetMenuOpen(false);
      setSlashMenuOpen(false);
      setMentionQuery('');
      setSlashQuery('');
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, []);

  const closeResultStrip = useCallback(() => {
    setResultStripOpen(false);
    if (resultStripTimerRef.current !== null) {
      window.clearTimeout(resultStripTimerRef.current);
      resultStripTimerRef.current = null;
    }
    resultStripTimerRef.current = window.setTimeout(() => {
      setResultStripMounted(false);
      resultStripTimerRef.current = null;
    }, 170);
  }, []);

  const toggleResultStrip = useCallback(() => {
    if (!canExpandResults) return;
    if (resultStripOpen) {
      closeResultStrip();
      return;
    }
    if (resultStripTimerRef.current !== null) {
      window.clearTimeout(resultStripTimerRef.current);
      resultStripTimerRef.current = null;
    }
    setResultStripMounted(true);
    requestAnimationFrame(() => setResultStripOpen(true));
  }, [canExpandResults, closeResultStrip, resultStripOpen]);

  useEffect(() => {
    if (!canExpandResults || !showNodeEditor) {
      closeResultStrip();
    }
  }, [canExpandResults, closeResultStrip, showNodeEditor]);

  useEffect(
    () => () => {
      if (resultStripTimerRef.current !== null) {
        window.clearTimeout(resultStripTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!resultStripOpen) return;
    const onOutsideDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (imageNodeRef.current?.contains(target)) return;
      if (resultStripRef.current?.contains(target)) return;
      closeResultStrip();
    };
    window.addEventListener('mousedown', onOutsideDown);
    return () => window.removeEventListener('mousedown', onOutsideDown);
  }, [closeResultStrip, resultStripOpen]);

  useEffect(() => {
    if (!resultStripOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeResultStrip();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeResultStrip, resultStripOpen]);

  const handleGenerate = () => {
    if (isGenerating) return;
    const referenceImages = referenceChips.map((item) => item.imageUrl);
    updateNodeData(id, { referenceImages });
    runNodeGeneration(id);
  };

  const handleSelectGeneratedResult = useCallback(
    (index: number) => {
      const target = resultItems[index];
      if (!target) return;
      updateNodeData(id, {
        thumbnailUrl: target.url,
        activeResultIndex: index,
        coverResultId: target.id,
        errorMessage: undefined,
      });
    },
    [id, resultItems, updateNodeData],
  );

  const handleToggleFavoriteResult = useCallback(
    (resultId: string) => {
      const next = new Set(favoriteResultIds);
      if (next.has(resultId)) {
        next.delete(resultId);
      } else {
        next.add(resultId);
      }
      updateNodeData(id, { favoriteResultIds: Array.from(next) });
    },
    [favoriteResultIds, id, updateNodeData],
  );

  const handleDownloadResult = useCallback((url: string, index: number) => {
    void downloadImage(url, `image-${id}-result-${index + 1}-${Date.now()}.png`);
  }, [id]);

  const appendPromptToken = useCallback(
    (nextText: string, patch?: Partial<FlowNodeData>) => {
      promptValueRef.current = nextText;
      updateNodeData(id, { generationPrompt: nextText, ...(patch || {}) });
    },
    [id, updateNodeData],
  );

  useEffect(() => {
    promptValueRef.current = String(d.generationPrompt || '');
  }, [d.generationPrompt]);

  const syncPromptMenus = useCallback(
    (nextText: string, caret: number) => {
      const mentionToken = extractMentionQuery(nextText, caret);
      if (mentionToken !== null) {
        setMentionQuery(mentionToken);
        setAssetMenuOpen(true);
        setAssetMenuIndex((index) => {
          if (mentionCandidates.length === 0) return 0;
          return Math.min(Math.max(index, 0), mentionCandidates.length - 1);
        });
      } else {
        setMentionQuery('');
        setAssetMenuOpen(false);
      }

      const slashToken = extractSlashQuery(nextText, caret);
      if (slashToken !== null) {
        setSlashQuery(slashToken);
        setSlashMenuOpen(true);
        setSlashMenuIndex((index) => {
          if (filteredSlashCommands.length === 0) return 0;
          return Math.min(Math.max(index, 0), filteredSlashCommands.length - 1);
        });
      } else {
        setSlashQuery('');
        setSlashMenuOpen(false);
      }
    },
    [filteredSlashCommands.length, mentionCandidates.length],
  );

  const applyPromptTextChange = useCallback(
    (nextText: string, nextCaret: number) => {
      const safeCaret = Math.max(0, Math.min(nextCaret, nextText.length));
      promptSelectionRef.current = { start: safeCaret, end: safeCaret };
      pendingPromptCaretRef.current = safeCaret;
      appendPromptToken(nextText);
      syncPromptMenus(nextText, safeCaret);
    },
    [appendPromptToken, syncPromptMenus],
  );

  const getPromptDomTextLength = useCallback((node: globalThis.Node): number => {
    if (node.nodeType === globalThis.Node.TEXT_NODE) return node.textContent?.length || 0;
    if (node instanceof HTMLElement) {
      const mentionText = node.dataset.mentionText;
      if (mentionText) return mentionText.length;
      if (node.tagName === 'BR') return 1;
    }
    return Array.from(node.childNodes).reduce((sum, child) => sum + getPromptDomTextLength(child), 0);
  }, []);

  const serializePromptEditor = useCallback((root: HTMLElement | null): string => {
    if (!root) return String(d.generationPrompt || '');
    const read = (node: globalThis.Node): string => {
      if (node.nodeType === globalThis.Node.TEXT_NODE) return node.textContent || '';
      if (node instanceof HTMLElement) {
        const mentionText = node.dataset.mentionText;
        if (mentionText) return mentionText;
        if (node.tagName === 'BR') return '\n';
      }
      return Array.from(node.childNodes).map(read).join('');
    };
    return Array.from(root.childNodes).map(read).join('');
  }, [d.generationPrompt]);

  const getPromptCaretOffset = useCallback((root: HTMLElement | null, targetNode?: globalThis.Node | null, targetOffset?: number) => {
    if (!root || !targetNode) return promptSelectionRef.current.start;
    let offset = 0;
    let found = false;

    const walk = (node: globalThis.Node) => {
      if (found) return;
      if (node === targetNode) {
        if (node.nodeType === globalThis.Node.TEXT_NODE) {
          offset += Math.max(0, Math.min(targetOffset || 0, node.textContent?.length || 0));
        } else {
          const children = Array.from(node.childNodes).slice(0, targetOffset || 0);
          offset += children.reduce((sum, child) => sum + getPromptDomTextLength(child), 0);
        }
        found = true;
        return;
      }
      if (node.nodeType === globalThis.Node.TEXT_NODE) {
        offset += node.textContent?.length || 0;
        return;
      }
      if (node instanceof HTMLElement) {
        const mentionText = node.dataset.mentionText;
        if (mentionText) {
          offset += mentionText.length;
          return;
        }
        if (node.tagName === 'BR') {
          offset += 1;
          return;
        }
      }
      Array.from(node.childNodes).forEach(walk);
    };

    walk(root);
    return offset;
  }, [getPromptDomTextLength]);

  const savePromptSelectionFromDom = useCallback(() => {
    const root = promptEditorRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return promptSelectionRef.current;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return promptSelectionRef.current;
    const start = getPromptCaretOffset(root, range.startContainer, range.startOffset);
    const end = getPromptCaretOffset(root, range.endContainer, range.endOffset);
    promptSelectionRef.current = { start, end };
    return promptSelectionRef.current;
  }, [getPromptCaretOffset]);

  const savePromptSelectionFromTextarea = useCallback(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return promptSelectionRef.current;
    promptSelectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    return promptSelectionRef.current;
  }, []);

  const restorePromptCaret = useCallback((caret: number) => {
    const root = promptEditorRef.current;
    if (!root) return;
    const selection = window.getSelection();
    if (!selection) return;
    const target = Math.max(0, caret);
    let cursor = 0;
    let placed = false;

    const place = (node: globalThis.Node, localOffset: number) => {
      try {
        const range = document.createRange();
        const safeOffset = node.nodeType === globalThis.Node.TEXT_NODE
          ? Math.max(0, Math.min(localOffset, node.textContent?.length || 0))
          : Math.max(0, Math.min(localOffset, node.childNodes.length));
        range.setStart(node, safeOffset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        placed = true;
      } catch {
        placed = true;
      }
    };

    const walk = (node: globalThis.Node) => {
      if (placed) return;
      if (node.nodeType === globalThis.Node.TEXT_NODE) {
        const len = node.textContent?.length || 0;
        if (target <= cursor + len) {
          place(node, Math.max(0, target - cursor));
          return;
        }
        cursor += len;
        return;
      }
      if (node instanceof HTMLElement) {
        const mentionText = node.dataset.mentionText;
        if (mentionText) {
          const parent = node.parentNode;
          if (target <= cursor) {
            if (parent) {
              const index = Array.from(parent.childNodes).indexOf(node);
              place(parent, index);
            }
            return;
          }
          if (target <= cursor + mentionText.length) {
            if (parent) {
              const index = Array.from(parent.childNodes).indexOf(node);
              place(parent, index + 1);
            }
            return;
          }
          cursor += mentionText.length;
          return;
        }
        if (node.tagName === 'BR') {
          const parent = node.parentNode;
          if (target <= cursor) {
            if (parent) place(parent, Array.from(parent.childNodes).indexOf(node));
            return;
          }
          if (target <= cursor + 1) {
            if (parent) place(parent, Array.from(parent.childNodes).indexOf(node) + 1);
            return;
          }
          cursor += 1;
          return;
        }
      }
      Array.from(node.childNodes).forEach(walk);
    };

    walk(root);
    if (!placed) place(root, root.childNodes.length);
    promptSelectionRef.current = { start: target, end: target };
  }, []);

  useLayoutEffect(() => {
    if (pendingPromptCaretRef.current === null) return;
    const caret = pendingPromptCaretRef.current;
    pendingPromptCaretRef.current = null;
    const textarea = promptTextareaRef.current;
    if (textarea) {
      const safeCaret = Math.max(0, Math.min(caret, textarea.value.length));
      textarea.focus();
      textarea.setSelectionRange(safeCaret, safeCaret);
      promptSelectionRef.current = { start: safeCaret, end: safeCaret };
      return;
    }
    restorePromptCaret(caret);
  }, [d.generationPrompt, restorePromptCaret, richPromptParts]);

  const getPromptWithMentionLabel = useCallback((label: string) => {
    const currentPrompt = promptValueRef.current;
    const selection = promptSelectionRef.current;
    const caret = Math.max(0, Math.min(selection.start, currentPrompt.length));
    const before = currentPrompt.slice(0, caret);
    const match = before.match(/@([^\s@/]*)$/);
    if (!match) return currentPrompt;
    const tokenStart = caret - match[0].length;
    const mentionText = `@${label} `;
    const nextPrompt = `${currentPrompt.slice(0, tokenStart)}${mentionText}${currentPrompt.slice(selection.end)}`;
    const nextCaret = tokenStart + mentionText.length;
    pendingPromptCaretRef.current = nextCaret;
    window.setTimeout(() => promptEditorRef.current?.focus(), 0);
    promptSelectionRef.current = { start: nextCaret, end: nextCaret };
    return nextPrompt;
  }, []);

  const insertReferenceMention = useCallback(
    (label: string) => {
      const currentPrompt = promptValueRef.current;
      const selection = promptTextareaRef.current ? savePromptSelectionFromTextarea() : promptSelectionRef.current;
      const start = Math.max(0, Math.min(selection.start, currentPrompt.length));
      const end = Math.max(start, Math.min(selection.end, currentPrompt.length));
      const mentionText = `@${label} `;
      const needsPrefixSpace = start > 0 && !/\s/.test(currentPrompt[start - 1]);
      const nextText = `${currentPrompt.slice(0, start)}${needsPrefixSpace ? ' ' : ''}${mentionText}${currentPrompt.slice(end)}`;
      const nextCaret = start + (needsPrefixSpace ? 1 : 0) + mentionText.length;
      pendingPromptCaretRef.current = nextCaret;
      promptValueRef.current = nextText;
      updateNodeData(id, { generationPrompt: nextText });
      promptSelectionRef.current = { start: nextCaret, end: nextCaret };
    },
    [id, savePromptSelectionFromTextarea, updateNodeData],
  );

  const handlePromptBeforeInput = useCallback(
    (event: React.FormEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      const nativeEvent = event.nativeEvent as InputEvent;
      if (promptComposingRef.current || nativeEvent.isComposing) return;

      const inputType = nativeEvent.inputType;
      const currentPrompt = promptValueRef.current;
      const selection = savePromptSelectionFromDom();
      const start = Math.max(0, Math.min(selection.start, currentPrompt.length));
      const end = Math.max(start, Math.min(selection.end, currentPrompt.length));

      if (inputType === 'insertText') {
        event.preventDefault();
        const text = nativeEvent.data || '';
        if (!text) return;
        const nextText = `${currentPrompt.slice(0, start)}${text}${currentPrompt.slice(end)}`;
        applyPromptTextChange(nextText, start + text.length);
        return;
      }

      if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
        event.preventDefault();
        const nextText = `${currentPrompt.slice(0, start)}\n${currentPrompt.slice(end)}`;
        applyPromptTextChange(nextText, start + 1);
        return;
      }

      if (inputType === 'deleteContentBackward') {
        event.preventDefault();
        if (start !== end) {
          applyPromptTextChange(`${currentPrompt.slice(0, start)}${currentPrompt.slice(end)}`, start);
        } else if (start > 0) {
          applyPromptTextChange(`${currentPrompt.slice(0, start - 1)}${currentPrompt.slice(start)}`, start - 1);
        } else {
          restorePromptCaret(start);
        }
        return;
      }

      if (inputType === 'deleteContentForward') {
        event.preventDefault();
        if (start !== end) {
          applyPromptTextChange(`${currentPrompt.slice(0, start)}${currentPrompt.slice(end)}`, start);
        } else if (start < currentPrompt.length) {
          applyPromptTextChange(`${currentPrompt.slice(0, start)}${currentPrompt.slice(start + 1)}`, start);
        } else {
          restorePromptCaret(start);
        }
      }
    },
    [applyPromptTextChange, restorePromptCaret, savePromptSelectionFromDom],
  );

  const handlePromptPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const text = event.clipboardData.getData('text/plain');
      if (!text) return;
      const currentPrompt = promptValueRef.current;
      const selection = savePromptSelectionFromDom();
      const start = Math.max(0, Math.min(selection.start, currentPrompt.length));
      const end = Math.max(start, Math.min(selection.end, currentPrompt.length));
      const nextText = `${currentPrompt.slice(0, start)}${text}${currentPrompt.slice(end)}`;
      applyPromptTextChange(nextText, start + text.length);
    },
    [applyPromptTextChange, savePromptSelectionFromDom],
  );

  const handlePromptTextareaChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextText = event.target.value;
      const nextCaret = event.target.selectionStart;
      promptValueRef.current = nextText;
      promptSelectionRef.current = { start: nextCaret, end: event.target.selectionEnd };
      updateNodeData(id, { generationPrompt: nextText });
      syncPromptMenus(nextText, nextCaret);
    },
    [id, syncPromptMenus, updateNodeData],
  );

  const handlePromptLexicalChange = useCallback(
    (nextText: string) => {
      promptValueRef.current = nextText;
      updateNodeData(id, { generationPrompt: nextText });
      syncPromptMenus(nextText, nextText.length);
    },
    [id, syncPromptMenus, updateNodeData],
  );

  const handlePromptTextareaKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  const handlePromptInput = useCallback(
    (event: React.FormEvent<HTMLDivElement>) => {
      if (promptComposingRef.current) return;
      const nextText = serializePromptEditor(event.currentTarget);
      const selection = savePromptSelectionFromDom();
      applyPromptTextChange(nextText, selection.start);
    },
    [applyPromptTextChange, savePromptSelectionFromDom, serializePromptEditor],
  );

  const handlePickAssetRef = useCallback(
    (itemId: string) => {
      const item = folderItems.find((candidate) => candidate.id === itemId);
      const itemKey = `asset:${itemId}`;
      const next = Array.from(new Set([...referencedAssetItemIds, itemId]));
      const nextRecent = [itemId, ...recentAssetItemIds.filter((idValue) => idValue !== itemId)].slice(0, 8);
      const nextOrder = Array.from(new Set([...referenceChips.map((refItem) => refItem.key), itemKey]));
      const mentionLabel = referenceChips.find((refItem) => refItem.key === itemKey)?.mentionLabel || `Image ${nextOrder.indexOf(itemKey) + 1}`;
      updateNodeData(id, {
        generationPrompt: item ? getPromptWithMentionLabel(mentionLabel) : d.generationPrompt,
        referenceAssetItemIds: next,
        referenceOrder: nextOrder,
        params: {
          ...p,
          recentReferenceAssetItemIds: nextRecent,
        },
      });
      setAssetMenuOpen(false);
      setMentionQuery('');
      setAssetMenuIndex(0);
    },
    [d.generationPrompt, folderItems, getPromptWithMentionLabel, id, p, recentAssetItemIds, referenceChips, referencedAssetItemIds, updateNodeData],
  );

  const handlePickConnectedRef = useCallback(
    (nodeId: string) => {
      const item = upstreamImageRefs.find((candidate) => candidate.id === nodeId);
      if (!item) return;
      const nextOrder = Array.from(new Set([...referenceChips.map((refItem) => refItem.key), item.key]));
      const mentionLabel = referenceChips.find((refItem) => refItem.key === item.key)?.mentionLabel || `Image ${nextOrder.indexOf(item.key) + 1}`;
      updateNodeData(id, {
        generationPrompt: getPromptWithMentionLabel(mentionLabel),
        referenceOrder: nextOrder,
      });
      setAssetMenuOpen(false);
      setMentionQuery('');
      setAssetMenuIndex(0);
    },
    [getPromptWithMentionLabel, id, referenceChips, upstreamImageRefs, updateNodeData],
  );

  const handleRemoveAssetRef = useCallback(
    (itemId: string) => {
      const itemKey = `asset:${itemId}`;
      updateNodeData(id, {
        referenceAssetItemIds: referencedAssetItemIds.filter((idValue) => idValue !== itemId),
        referenceOrder: referenceOrder.filter((key) => key !== itemKey),
      });
    },
    [id, referenceOrder, referencedAssetItemIds, updateNodeData],
  );

  const handleRemoveReference = useCallback(
    (refItem: (typeof referenceChips)[number]) => {
      if (refItem.source === 'asset') {
        handleRemoveAssetRef(refItem.id);
        return;
      }
      removeEdgesByIds(refItem.edgeId ? [refItem.edgeId] : []);
      updateNodeData(id, {
        referenceOrder: referenceOrder.filter((key) => key !== refItem.key),
      });
    },
    [handleRemoveAssetRef, referenceOrder, removeEdgesByIds, updateNodeData],
  );

  const handleRemovePromptReference = useCallback(
    (refItem: (typeof referenceChips)[number], start: number, end: number) => {
      const currentPrompt = promptValueRef.current;
      const safeStart = Math.max(0, Math.min(start, currentPrompt.length));
      const safeEnd = Math.max(safeStart, Math.min(end, currentPrompt.length));
      const nextPrompt = `${currentPrompt.slice(0, safeStart)}${currentPrompt.slice(safeEnd)}`;
      promptSelectionRef.current = { start: safeStart, end: safeStart };
      pendingPromptCaretRef.current = safeStart;
      promptValueRef.current = nextPrompt;

      if (refItem.source === 'asset') {
        const itemKey = `asset:${refItem.id}`;
        updateNodeData(id, {
          generationPrompt: nextPrompt,
          referenceAssetItemIds: referencedAssetItemIds.filter((idValue) => idValue !== refItem.id),
          referenceOrder: referenceOrder.filter((key) => key !== itemKey),
        });
        return;
      }

      removeEdgesByIds(refItem.edgeId ? [refItem.edgeId] : []);
      updateNodeData(id, {
        generationPrompt: nextPrompt,
        referenceOrder: referenceOrder.filter((key) => key !== refItem.key),
      });
    },
    [id, referenceOrder, referencedAssetItemIds, removeEdgesByIds, updateNodeData],
  );

  const deferRemovePromptReference = useCallback(
    (refItem: (typeof referenceChips)[number], start: number, end: number) => {
      setHoveredReferenceKey(null);
      promptEditorRef.current?.blur();
      window.setTimeout(() => {
        handleRemovePromptReference(refItem, start, end);
      }, 0);
    },
    [handleRemovePromptReference],
  );

  const handleReferenceDrop = useCallback(
    (targetKey: string) => {
      if (!draggingReferenceKey || draggingReferenceKey === targetKey) return;
      const orderedKeys = referenceChips.map((item) => item.key);
      const fromIndex = orderedKeys.indexOf(draggingReferenceKey);
      const toIndex = orderedKeys.indexOf(targetKey);
      if (fromIndex < 0 || toIndex < 0) return;
      const nextOrder = [...orderedKeys];
      const [moved] = nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, moved);
      updateNodeData(id, { referenceOrder: nextOrder });
      setDraggingReferenceKey(null);
    },
    [draggingReferenceKey, id, referenceChips, updateNodeData],
  );

  const handleInsertSlashCommand = useCallback(
    (commandId: string) => {
      const command = IMAGE_SLASH_COMMANDS.find((item) => item.id === commandId);
      if (!command) return;
      const currentPrompt = String(d.generationPrompt || '').trim();
      const nextPrompt = currentPrompt ? `${currentPrompt}\n${command.prompt}` : command.prompt;
      appendPromptToken(nextPrompt, { activeCommandId: command.id });
      setSlashMenuOpen(false);
      setSlashQuery('');
      setSlashMenuIndex(0);
    },
    [appendPromptToken, d.generationPrompt],
  );

  const handlePromptKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      event.stopPropagation();

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        const currentPrompt = promptValueRef.current;
        const selection = savePromptSelectionFromDom();
        const start = Math.max(0, Math.min(selection.start, currentPrompt.length));
        const end = Math.max(start, Math.min(selection.end, currentPrompt.length));
        let nextText = currentPrompt;
        let nextCaret = start;

        if (start !== end) {
          nextText = `${currentPrompt.slice(0, start)}${currentPrompt.slice(end)}`;
        } else if (event.key === 'Backspace' && start > 0) {
          nextText = `${currentPrompt.slice(0, start - 1)}${currentPrompt.slice(start)}`;
          nextCaret = start - 1;
        } else if (event.key === 'Delete' && start < currentPrompt.length) {
          nextText = `${currentPrompt.slice(0, start)}${currentPrompt.slice(start + 1)}`;
        } else {
          pendingPromptCaretRef.current = start;
          requestAnimationFrame(() => restorePromptCaret(start));
          return;
        }

        applyPromptTextChange(nextText, nextCaret);
        return;
      }

      if (event.key === 'Escape') {
        if (assetMenuOpen || slashMenuOpen) {
          event.preventDefault();
          setAssetMenuOpen(false);
          setSlashMenuOpen(false);
          setMentionQuery('');
          setSlashQuery('');
        }
        return;
      }

      if (slashMenuOpen && filteredSlashCommands.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSlashMenuIndex((index) => (index + 1) % filteredSlashCommands.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSlashMenuIndex((index) => (index - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          const target = filteredSlashCommands[slashMenuIndex] || filteredSlashCommands[0];
          if (target) handleInsertSlashCommand(target.id);
          return;
        }
      }

      if (assetMenuOpen && mentionCandidates.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setAssetMenuIndex((index) => (index + 1) % mentionCandidates.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setAssetMenuIndex((index) => (index - 1 + mentionCandidates.length) % mentionCandidates.length);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          const target = mentionCandidates[assetMenuIndex] || mentionCandidates[0];
          if (target?.kind === 'upstream') handlePickConnectedRef(target.id);
          if (target?.kind === 'asset') handlePickAssetRef(target.id);
        }
      }
    },
    [
      assetMenuIndex,
      assetMenuOpen,
      mentionCandidates,
      filteredSlashCommands,
      handleInsertSlashCommand,
      handlePickAssetRef,
      handlePickConnectedRef,
      applyPromptTextChange,
      restorePromptCaret,
      savePromptSelectionFromDom,
      slashMenuIndex,
      slashMenuOpen,
    ],
  );

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = await fileToDataUrl(file);

    const img = new Image();
    img.onload = () => {
      const naturalWidth = img.naturalWidth || img.width;
      const naturalHeight = img.naturalHeight || img.height;
      const { width, height } = fitMediaNodeToShortSide(naturalWidth, naturalHeight);

      updateNodeData(id, { 
        thumbnailUrl: url,
        width,
        height,
        naturalWidth,
        naturalHeight,
        aspectRatio: naturalWidth / naturalHeight,
        originalImageUrl: url,
        editHistory: [],
        lastEditType: undefined,
        imageFolderIds: [],
        errorMessage: undefined,
        generationStatus: 'done',
        status: 'success',
        generatedResults: undefined,
        activeResultIndex: undefined,
        coverResultId: undefined,
        favoriteResultIds: undefined,
        lastGenerationSnapshot: undefined,
      });
    };
    img.src = url;
  };

  const handleDownload = useCallback(() => {
    if (!d.thumbnailUrl) return;
    void downloadImage(String(d.thumbnailUrl), `image-${id}-${Date.now()}.png`);
  }, [d.thumbnailUrl, id]);

  const handleStepBack = useCallback(async () => {
    const history = Array.isArray(d.editHistory) ? (d.editHistory as string[]) : [];
    const previousUrl = history[history.length - 1];
    if (!previousUrl) return;

    const nextHistory = history.slice(0, -1);
    pushHistory();

    try {
      const natural = await getImageNaturalSize(previousUrl);
      const displaySize = fitMediaNodeToShortSide(natural.w, natural.h);
      updateNodeData(id, {
        thumbnailUrl: previousUrl,
        width: displaySize.width,
        height: displaySize.height,
        naturalWidth: natural.w,
        naturalHeight: natural.h,
        aspectRatio: natural.w / natural.h,
        editHistory: nextHistory,
        lastEditType: nextHistory.length ? d.lastEditType : 'revert',
        generationStatus: 'done',
        status: 'success',
        progress: 100,
        errorMessage: undefined,
      });
    } catch {
      updateNodeData(id, {
        thumbnailUrl: previousUrl,
        editHistory: nextHistory,
        lastEditType: nextHistory.length ? d.lastEditType : 'revert',
        generationStatus: 'done',
        status: 'success',
        progress: 100,
        errorMessage: undefined,
      });
    }
  }, [d.editHistory, d.lastEditType, id, pushHistory, updateNodeData]);

  const handleFolderAdded = useCallback((folderId: string) => {
    const current = Array.isArray(d.imageFolderIds) ? (d.imageFolderIds as string[]) : [];
    updateNodeData(id, {
      imageFolderIds: Array.from(new Set([...current, folderId])),
    });
  }, [d.imageFolderIds, id, updateNodeData]);

  const getDerivedNodeBase = useCallback(() => {
    const currentNode = useFlowCanvasStore.getState().nodes.find((node) => node.id === id);
    const sourceWidth = Number(d.width || currentNode?.measured?.width || FLOW_NODE_DEFAULT_SIZES.image.width);
    const sourceHeight = Number(d.height || currentNode?.measured?.height || FLOW_NODE_DEFAULT_SIZES.image.height);
    const sourcePosition = currentNode?.position || { x: 0, y: 0 };
    const previousUrl = String(d.thumbnailUrl || '');
    const history = Array.isArray(d.editHistory) ? (d.editHistory as string[]) : [];

    return { sourceWidth, sourceHeight, sourcePosition, previousUrl, history };
  }, [d.editHistory, d.height, d.thumbnailUrl, d.width, id]);

  const addDerivedImageNode = useCallback(
    (
      editType: string,
      title: string,
      imageUrl: string,
      naturalWidth: number,
      naturalHeight: number,
      position?: { x: number; y: number },
    ) => {
      const { sourceWidth, sourceHeight, sourcePosition, previousUrl, history } = getDerivedNodeBase();
      const displaySize = fitMediaNodeToShortSide(naturalWidth, naturalHeight);

      addNodeAndEdge(
        'image',
        position || {
          x: sourcePosition.x + sourceWidth + 160,
          y: sourcePosition.y + Math.max(0, (sourceHeight - displaySize.height) / 2),
        },
        id,
        'out',
        'in',
        {
          title,
          thumbnailUrl: imageUrl,
          width: displaySize.width,
          height: displaySize.height,
          originalImageUrl: String(d.originalImageUrl || previousUrl),
          editHistory: previousUrl ? [...history, previousUrl] : history,
          lastEditType: editType,
          naturalWidth,
          naturalHeight,
          aspectRatio: naturalWidth / naturalHeight,
        },
      );
    },
    [addNodeAndEdge, d.originalImageUrl, getDerivedNodeBase, id],
  );

  const handleApplyResultToCanvas = useCallback(
    async (imageUrl: string, index: number) => {
      try {
        const natural = await getImageNaturalSize(imageUrl);
        addDerivedImageNode('generated-result', `生成结果${index + 1}`, imageUrl, natural.w, natural.h);
      } catch {
        const fallbackWidth = Number(d.naturalWidth || d.width || FLOW_NODE_DEFAULT_SIZES.image.width);
        const fallbackHeight = Number(d.naturalHeight || d.height || FLOW_NODE_DEFAULT_SIZES.image.height);
        addDerivedImageNode('generated-result', `生成结果${index + 1}`, imageUrl, fallbackWidth, fallbackHeight);
      }
    },
    [addDerivedImageNode, d.height, d.naturalHeight, d.naturalWidth, d.width],
  );

  const handleCropConfirm = useCallback(
    (croppedUrl: string, width: number, height: number, naturalWidth: number, naturalHeight: number) => {
      addDerivedImageNode('crop', `裁剪后的${cropResultCount + 1}`, croppedUrl, naturalWidth, naturalHeight);
      closeImageTool();
    },
    [addDerivedImageNode, cropResultCount],
  );

  const handleResizeConfirm = useCallback(
    (resultUrl: string, naturalWidth: number, naturalHeight: number) => {
      addDerivedImageNode('resize', `调整后的${resizeResultCount + 1}`, resultUrl, naturalWidth, naturalHeight);
      closeImageTool();
    },
    [addDerivedImageNode, resizeResultCount],
  );

  const handleSplitConfirm = useCallback(
    (pieces: ImageSplitPiece[], gridSize: number) => {
      const { sourceWidth, sourcePosition } = getDerivedNodeBase();
      const gap = 28;
      const displaySizes = pieces.map((piece) => fitMediaNodeToShortSide(piece.naturalWidth, piece.naturalHeight));
      const cellWidth = Math.max(...displaySizes.map((size) => size.width));
      const cellHeight = Math.max(...displaySizes.map((size) => size.height));
      const startX = sourcePosition.x + sourceWidth + 160;
      const startY = sourcePosition.y;
      const batchIndex = splitResultCount + 1;

      pieces.forEach((piece, index) => {
        const displaySize = displaySizes[index];
        const position = {
          x: startX + piece.col * (cellWidth + gap) + Math.max(0, (cellWidth - displaySize.width) / 2),
          y: startY + piece.row * (cellHeight + gap) + Math.max(0, (cellHeight - displaySize.height) / 2),
        };
        addDerivedImageNode(
          'split',
          `切片${batchIndex}-${piece.row + 1}-${piece.col + 1}`,
          piece.url,
          piece.naturalWidth,
          piece.naturalHeight,
          position,
        );
      });
      closeImageTool();
    },
    [addDerivedImageNode, getDerivedNodeBase, splitResultCount],
  );

  const handleAnnotateConfirm = useCallback(
    (resultUrl: string, naturalWidth: number, naturalHeight: number) => {
      addDerivedImageNode('annotate', `标注后的${annotateResultCount + 1}`, resultUrl, naturalWidth, naturalHeight);
      closeImageTool();
    },
    [addDerivedImageNode, annotateResultCount],
  );

  const openRepaintOverlay = useCallback((mode: 'inpaint' | 'erase') => {
    setRepaintMode(mode);
    openImageTool(id, mode === 'erase' ? 'erase' : 'repaint');
  }, [id, openImageTool]);

  const openAnchoredPreviewTool = useCallback((tool: 'lighting' | 'multiAngle') => {
    const currentNode = useFlowCanvasStore.getState().nodes.find((node) => node.id === id);
    if (typeof window === 'undefined' || !currentNode) {
      openImageTool(id, tool);
      return;
    }

    if (toolOpenTimerRef.current !== null) {
      window.clearTimeout(toolOpenTimerRef.current);
      toolOpenTimerRef.current = null;
    }

    closeImageTool();

    const panel = tool === 'lighting'
      ? { width: 720, height: 404 }
      : { width: 640, height: 386 };
    const nodeWidth = Number(d.width || currentNode.measured?.width || FLOW_NODE_DEFAULT_SIZES.image.width);
    const nodeHeight = Number(d.height || currentNode.measured?.height || FLOW_NODE_DEFAULT_SIZES.image.height);
    const topSafe = 64;
    const bottomSafe = 70;
    const gap = 12;
    const leftSafe = leftPanelOpen ? 286 : 28;
    const rightSafe = 28;
    const availableWidth = Math.max(320, window.innerWidth - leftSafe - rightSafe);
    const availableImageHeight = Math.max(160, window.innerHeight - topSafe - bottomSafe - panel.height - gap);
    const maxImageWidth = Math.min(470, availableWidth * 0.58);
    const maxImageHeight = Math.min(tool === 'lighting' ? 220 : 230, availableImageHeight);
    const zoom = Math.max(
      0.18,
      Math.min(1.85, maxImageWidth / nodeWidth, maxImageHeight / nodeHeight),
    );
    const screenWidth = nodeWidth * zoom;
    const screenHeight = nodeHeight * zoom;
    const totalHeight = screenHeight + gap + panel.height;
    const targetLeft = leftSafe + Math.max(0, (availableWidth - screenWidth) / 2);
    const targetTop = Math.max(topSafe, Math.min(window.innerHeight - bottomSafe - totalHeight, (window.innerHeight - totalHeight) / 2 - 4));
    const nextViewport = {
      x: targetLeft - currentNode.position.x * zoom,
      y: targetTop - currentNode.position.y * zoom,
      zoom,
    };

    reactFlow.setViewport(nextViewport, { duration: 180 });
    setCanvasViewport(nextViewport);
    toolOpenTimerRef.current = window.setTimeout(() => {
      openImageTool(id, tool);
      toolOpenTimerRef.current = null;
    }, 190);
  }, [closeImageTool, d.height, d.width, id, leftPanelOpen, openImageTool, reactFlow, setCanvasViewport]);

  const handleRepaintConfirm = useCallback(
    async ({ mask, prompt, maskMode }: { mask: string; prompt: string; maskMode: string }) => {
      const editType: ImageEditType = repaintMode === 'erase' ? 'erase' : 'inpaint';
      await runImageEdit(id, editType, {
        mask,
        prompt,
        modelId: String(d.modelId || currentModelId),
        routeId: typeof d.routeId === 'string' ? d.routeId : undefined,
        params: { ...((d.params || {}) as Record<string, any>), maskMode },
      });
      closeImageTool();
    },
    [currentModelId, d.modelId, d.params, d.routeId, id, repaintMode],
  );

  const handleOutpaintConfirm = useCallback(
    async ({
      image,
      mask,
      prompt,
      direction,
      maskMode,
    }: {
      image: string;
      mask: string;
      prompt: string;
      direction: OutpaintDirection;
      maskMode: string;
    }) => {
      await runImageEdit(id, 'outpaint', {
        image,
        mask,
        prompt,
        direction,
        modelId: String(d.modelId || currentModelId),
        routeId: typeof d.routeId === 'string' ? d.routeId : undefined,
        params: { ...((d.params || {}) as Record<string, any>), maskMode },
      });
      closeImageTool();
    },
    [currentModelId, d.modelId, d.params, d.routeId, id],
  );

  const handleLightingConfirm = useCallback(
    async ({
      prompt,
      brightness,
      colorTemperature,
      direction,
      rimLight,
    }: {
      prompt: string;
      brightness: number;
      colorTemperature: number;
      direction: LightDirection;
      rimLight: boolean;
    }) => {
      await runImageEdit(id, 'relight', {
        prompt,
        modelId: String(d.modelId || currentModelId),
        routeId: typeof d.routeId === 'string' ? d.routeId : undefined,
        params: {
          ...((d.params || {}) as Record<string, any>),
          relight: {
            brightness,
            colorTemperature,
            direction,
            rimLight,
            rimLightSetup: rimLight
              ? {
                  mode: 'back-three-point-projection',
                  lockedMainLightPositions: ['front', 'left', 'right', 'top', 'bottom', 'standard-45-degree'],
                  projectionPoints: ['rear-left', 'rear-right', 'rear-top'],
                  instruction: 'Use rear three-point projection to create subject edge separation without changing the chosen main light.',
                }
              : null,
          },
        },
      });
      closeImageTool();
    },
    [currentModelId, d.modelId, d.params, d.routeId, id],
  );

  const handleMultiAngleConfirm = useCallback(
    async ({
      prompt,
      angleId,
      angleLabel,
      mode,
      rotation,
      tilt,
      zoom,
      zoomLabel,
    }: {
      prompt: string;
      angleId: MultiAngleId;
      angleLabel: string;
      mode: 'subject' | 'camera';
      rotation: number;
      tilt: number;
      zoom: number;
      zoomLabel: string;
    }) => {
      await runImageEdit(id, 'multiAngle', {
        prompt,
        modelId: String(d.modelId || currentModelId),
        routeId: typeof d.routeId === 'string' ? d.routeId : undefined,
        params: {
          ...((d.params || {}) as Record<string, any>),
          multiAngle: {
            angleId,
            angleLabel,
            mode,
            rotation,
            tilt,
            zoom,
            zoomLabel,
          },
        },
      });
      closeImageTool();
    },
    [currentModelId, d.modelId, d.params, d.routeId, id],
  );

  const runQuickAiEdit = useCallback(
    async (editType: ImageEditType) => {
      await runImageEdit(id, editType, {
        modelId: String(d.modelId || currentModelId),
        routeId: typeof d.routeId === 'string' ? d.routeId : undefined,
        params: (d.params || {}) as Record<string, any>,
      });
    },
    [currentModelId, d.modelId, d.params, d.routeId, id],
  );

  const handleMoreMenuSelect = useCallback((action: ImageMoreMenuAction, payload?: { gridSize?: number }) => {
    setMoreMenuOpen(false);
    if (action === 'resize') {
      openImageTool(id, 'resize');
    }
    if (action === 'split') {
      setSplitInitialGridSize(payload?.gridSize || 2);
      openImageTool(id, 'split');
    }
    if (action === 'annotate') {
      openImageTool(id, 'annotate');
    }
    if (action === 'outpaint') {
      openImageTool(id, 'outpaint');
    }
    if (action === 'erase') {
      openRepaintOverlay('erase');
    }
    if (action === 'enhance') {
      setAiConfirmType('enhance');
    }
    if (action === 'removeBackground') {
      setAiConfirmType('removeBackground');
    }
  }, [id, openImageTool, openRepaintOverlay]);

  const handleToolAction = useCallback(
    (toolId: string) => {
      if (!d.thumbnailUrl) return;
      if (toolId !== 'more') setMoreMenuOpen(false);

      if (toolId === 'crop') {
        openImageTool(id, 'crop');
        return;
      }
      if (toolId === 'repaint') {
        openRepaintOverlay('inpaint');
        return;
      }
      if (toolId === 'lighting') {
        openAnchoredPreviewTool('lighting');
        return;
      }
      if (toolId === 'multiAngle') {
        openAnchoredPreviewTool('multiAngle');
        return;
      }
      if (toolId === 'download') {
        handleDownload();
        return;
      }
      if (toolId === 'historyBack') {
        void handleStepBack();
        return;
      }
      if (toolId === 'folder') {
        openImageTool(id, 'folder');
        return;
      }
      if (toolId === 'fullscreen') {
        setFullscreenOpen(true);
        return;
      }
      if (toolId === 'more') {
        setMoreMenuOpen((open) => !open);
      }
    },
    [d.thumbnailUrl, handleDownload, handleStepBack, id, openAnchoredPreviewTool, openImageTool, openRepaintOverlay],
  );

  return (
    <div
      ref={imageNodeRef}
      style={nodeWrapper}
      className="flow-image-node"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <NodeLabel nodeId={id} icon={<ImageIcon size={14} />} label={String(d.title || 'Image')} fallbackLabel="Image" />

      {showInputHandle && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          style={{ ...invisibleHandle, position: 'absolute', left: -2, top: '50%', transform: 'translateY(-50%)' }}
        >
          <div style={handleHitArea}>
            <div className="flow-image-hover-reveal" style={plusHandleInner}><Plus size={14} /></div>
          </div>
        </Handle>
      )}

      <div ref={imageCardRef}>
        <ImageNodeCard
          data={d}
          selected={selected}
          isTargeting={isTargeting}
          displayThumbnailUrl={displayThumbnailUrl}
          isGeneratedImageNode={isGeneratedImageNode}
          showNodeEditor={showNodeEditor}
          resultCount={resultCount}
          resultStripOpen={resultStripOpen}
          canExpandResults={canExpandResults}
          coverResult={coverResult}
          favoriteResultIds={favoriteResultIds}
          isGenerating={isGenerating}
          onToggleResultStrip={toggleResultStrip}
          onToggleFavoriteResult={handleToggleFavoriteResult}
          onUploadClick={handleUploadClick}
        />
      </div>

      {isGeneratedImageNode && showNodeEditor && resultStripMounted && canExpandResults && (
        <ImageResultStrip
          data={d}
          resultItems={resultItems}
          activeResultIndex={activeResultIndex}
          favoriteResultIds={favoriteResultIds}
          resultStripOpen={resultStripOpen}
          resultStripRef={resultStripRef}
          onToggleFavoriteResult={handleToggleFavoriteResult}
          onApplyResultToCanvas={handleApplyResultToCanvas}
          onDownloadResult={handleDownloadResult}
          onSelectGeneratedResult={handleSelectGeneratedResult}
        />
      )}

      <Handle 
        type="source" 
        position={Position.Right} 
        id="out" 
        style={{ ...invisibleHandle, position: 'absolute', right: -2, top: '50%', transform: 'translateY(-50%)' }}
      >
        <div style={handleHitArea}>
          <div className="flow-image-hover-reveal" style={plusHandleInner}><Plus size={14} /></div>
        </div>
      </Handle>

      {/* Hidden file input for upload/replace */}
      <input 
        type="file" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        accept="image/*"
        onChange={handleFileChange}
      />

      {/* Section */}
      {hasImage && showNodeEditor && (() => {
        const tools = [
          { id: 'crop', icon: <Crop size={22} strokeWidth={1.5} />, label: '裁剪' },
          { id: 'multiAngle', icon: <Box size={22} strokeWidth={1.5} />, label: '多角度' },
          { id: 'repaint', icon: <Wand2 size={22} strokeWidth={1.5} />, label: '重绘' },
          { id: 'lighting', icon: <Flashlight size={22} strokeWidth={1.5} />, label: '打光' },
          { id: 'more', icon: <MoreHorizontal size={22} strokeWidth={1.5} />, label: '更多' },
        ];
        const hasEditHistory = Array.isArray(d.editHistory) && d.editHistory.length > 0;
        const actions = [
          { id: 'historyBack', icon: <RotateCcw size={22} strokeWidth={1.5} />, label: '回退上一步', disabled: !hasEditHistory },
          { id: 'folder', icon: <FolderPlus size={22} strokeWidth={1.5} />, label: '添加到文件夹' },
          { id: 'download', icon: <Download size={22} strokeWidth={1.5} />, label: '下载' },
          { id: 'fullscreen', icon: <Expand size={22} strokeWidth={1.5} />, label: '全屏查看' },
        ];
        return (
          <FloatingToolbar>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px' }}>
              {tools.map((t) => (
                <div key={t.id} className="flow-image-toolbar-item" style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                  <div className="flow-image-toolbar-tooltip" style={{
                      position: 'absolute',
                      bottom: 'calc(100% + 14px)',
                      background: 'rgba(40,40,40,0.95)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 16,
                      padding: '6px 14px',
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      zIndex: 200,
                      pointerEvents: 'none',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                    }}>
                      {t.label}
                  </div>
                  <button
                    className="nodrag nopan flow-image-toolbar-btn"
                    onClick={() => handleToolAction(t.id)}
                    style={{
                      position: 'relative',
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      border: '1px solid transparent',
                      background: 'transparent',
                      color: '#e2e8f0',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}
                  >
                    {t.icon}
                    {t.id === 'more' && (
                      <div style={{ 
                        position: 'absolute', 
                        top: 6, 
                        right: 8, 
                        width: 6, 
                        height: 6, 
                        borderRadius: '50%', 
                        background: '#0ea5e9',
                        boxShadow: '0 0 4px #0ea5e9'
                      }} />
                    )}
                  </button>
                  {t.id === 'more' && moreMenuOpen && (
                    <ImageMoreMenu onSelect={handleMoreMenuSelect} />
                  )}
                </div>
              ))}

              {/* Divider */}
              <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.12)', margin: '0 6px' }} />

              {actions.map((t) => (
                <div key={t.id} className="flow-image-toolbar-item" style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                  <div className="flow-image-toolbar-tooltip" style={{
                      position: 'absolute',
                      bottom: 'calc(100% + 14px)',
                      background: 'rgba(40,40,40,0.95)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 16,
                      padding: '6px 14px',
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      zIndex: 200,
                      pointerEvents: 'none',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                    }}>
                      {t.label}
                  </div>
                  <button
                    className="nodrag nopan flow-image-toolbar-btn"
                    onClick={() => {
                      if (!t.disabled) handleToolAction(t.id);
                    }}
                    disabled={t.disabled}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      border: '1px solid transparent',
                      background: 'transparent',
                      color: t.disabled ? 'rgba(148,163,184,0.35)' : '#e2e8f0',
                      cursor: t.disabled ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: t.disabled ? 0.48 : 1,
                      transition: 'all 0.15s',
                    }}
                  >
                    {t.icon}
                  </button>
                </div>
              ))}
            </div>
          </FloatingToolbar>
        );
      })()}

      <LazyOverlayFrame>
        {isImageToolOpen('crop') && d.thumbnailUrl && (
          <ImageCropOverlay
            imageUrl={String(d.thumbnailUrl)}
            onConfirm={handleCropConfirm}
            onCancel={closeImageTool}
          />
        )}

        {fullscreenOpen && d.thumbnailUrl && (
          <ImageFullscreenOverlay
            imageUrl={String(d.thumbnailUrl)}
            onClose={() => setFullscreenOpen(false)}
            onDownload={handleDownload}
            prompt={isGeneratedImageNode ? String((d.lastGenerationSnapshot as FlowImageGenerationSnapshot | undefined)?.prompt || d.generationPrompt || '') : ''}
            modelLabel={modelOptions.find((model) => model.id === String((d.lastGenerationSnapshot as FlowImageGenerationSnapshot | undefined)?.modelId || currentModelId))?.label || String((d.lastGenerationSnapshot as FlowImageGenerationSnapshot | undefined)?.modelId || currentModelId)}
            size={String((d.lastGenerationSnapshot as FlowImageGenerationSnapshot | undefined)?.size || currentSize)}
            aspectRatio={String((d.lastGenerationSnapshot as FlowImageGenerationSnapshot | undefined)?.aspectRatio || currentRatio)}
            naturalWidth={typeof d.naturalWidth === 'number' ? d.naturalWidth : undefined}
            naturalHeight={typeof d.naturalHeight === 'number' ? d.naturalHeight : undefined}
            createdAt={typeof d.createdAt === 'number' ? d.createdAt : undefined}
            isGenerated={isGeneratedImageNode}
            snapshot={d.lastGenerationSnapshot as FlowImageGenerationSnapshot | undefined}
          />
        )}

        {isImageToolOpen('resize') && d.thumbnailUrl && (
          <ImageResizeOverlay
            imageUrl={String(d.thumbnailUrl)}
            initialWidth={typeof d.naturalWidth === 'number' ? d.naturalWidth : undefined}
            initialHeight={typeof d.naturalHeight === 'number' ? d.naturalHeight : undefined}
            onConfirm={handleResizeConfirm}
            onCancel={closeImageTool}
          />
        )}

        {isImageToolOpen('split') && d.thumbnailUrl && (
          <ImageSplitOverlay
            key={splitInitialGridSize}
            imageUrl={String(d.thumbnailUrl)}
            initialGridSize={splitInitialGridSize}
            onConfirm={handleSplitConfirm}
            onCancel={closeImageTool}
          />
        )}

        {isImageToolOpen('annotate') && d.thumbnailUrl && (
          <ImageAnnotateOverlay
            imageUrl={String(d.thumbnailUrl)}
            initialWidth={typeof d.naturalWidth === 'number' ? d.naturalWidth : undefined}
            initialHeight={typeof d.naturalHeight === 'number' ? d.naturalHeight : undefined}
            onConfirm={handleAnnotateConfirm}
            onCancel={closeImageTool}
          />
        )}
        {(isImageToolOpen('repaint') || isImageToolOpen('erase')) && d.thumbnailUrl && (
          <ImageRepaintOverlay
            imageUrl={String(d.thumbnailUrl)}
            mode={repaintMode}
            onConfirm={handleRepaintConfirm}
            onCancel={closeImageTool}
          />
        )}

        {isImageToolOpen('outpaint') && d.thumbnailUrl && (
          <ImageOutpaintOverlay
            imageUrl={String(d.thumbnailUrl)}
            onConfirm={handleOutpaintConfirm}
            onCancel={closeImageTool}
          />
        )}

        {isImageToolOpen('lighting') && d.thumbnailUrl && (
          <ImageLightingOverlay
            imageUrl={String(d.thumbnailUrl)}
            anchorRect={imageCardRef.current?.getBoundingClientRect() || imageNodeRef.current?.getBoundingClientRect()}
            onConfirm={handleLightingConfirm}
            onCancel={closeImageTool}
          />
        )}

        {isImageToolOpen('multiAngle') && d.thumbnailUrl && (
          <ImageMultiAngleOverlay
            imageUrl={String(d.thumbnailUrl)}
            anchorRect={imageCardRef.current?.getBoundingClientRect() || imageNodeRef.current?.getBoundingClientRect()}
            onConfirm={handleMultiAngleConfirm}
            onCancel={closeImageTool}
          />
        )}

        {isImageToolOpen('folder') && d.thumbnailUrl && (
          <ImageFolderOverlay
            imageUrl={String(d.thumbnailUrl)}
            nodeId={id}
            title={String(d.title || '图片素材')}
            projectId={projectId}
            projectTitle={projectTitle}
            originalImageUrl={typeof d.originalImageUrl === 'string' ? d.originalImageUrl : undefined}
            lastEditType={typeof d.lastEditType === 'string' ? d.lastEditType : undefined}
            naturalWidth={typeof d.naturalWidth === 'number' ? d.naturalWidth : undefined}
            naturalHeight={typeof d.naturalHeight === 'number' ? d.naturalHeight : undefined}
            onAdded={handleFolderAdded}
            onCancel={closeImageTool}
          />
        )}

        {aiConfirmType && d.thumbnailUrl && (
          <ImageAiConfirmOverlay
            editType={aiConfirmType}
            imageUrl={String(d.thumbnailUrl)}
            modelLabel={modelOptions.find((model) => model.id === currentModelId)?.label || currentModelId}
            onConfirm={async () => {
              await runQuickAiEdit(aiConfirmType);
              setAiConfirmType(null);
            }}
            onCancel={() => setAiConfirmType(null)}
          />
        )}
      </LazyOverlayFrame>

      {/* Section */}
      {shouldShowUploadToolbar && (
        <FloatingToolbar>
          <button style={uploadBtn} onClick={handleUploadClick}>
            <Upload size={16} /> 上传
          </button>
        </FloatingToolbar>
      )}

      {shouldShowPromptEditor && (
        <FloatingPromptBar>
          <div ref={promptBarRef} style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, minHeight: 42 }}>
            <button
              type="button"
              className="nodrag nopan"
              style={{ ...topToolbarBtn, background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.08)' }}
              onClick={() => setAssetMenuOpen((value) => !value)}
              title="引用素材"
            >
              <ImageIcon size={16} />
            </button>
            {referenceChips.slice(0, 8).map((refItem) => (
              <div
                key={refItem.key}
                draggable
                onClick={() => {
                  if (suppressReferenceClickRef.current) return;
                  if (promptLexicalEditorRef.current) {
                    promptLexicalEditorRef.current.insertReference(refItem.mentionLabel);
                  } else {
                    insertReferenceMention(refItem.mentionLabel);
                  }
                }}
                onDragStart={(event) => {
                  event.stopPropagation();
                  suppressReferenceClickRef.current = true;
                  setDraggingReferenceKey(refItem.key);
                  event.dataTransfer.setData('application/x-flow-reference-chip', refItem.key);
                  event.dataTransfer.setData('text/plain', refItem.key);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleReferenceDrop(refItem.key);
                }}
                onDragEnd={() => {
                  setDraggingReferenceKey(null);
                  window.setTimeout(() => {
                    suppressReferenceClickRef.current = false;
                  }, 0);
                }}
                onMouseEnter={() => setHoveredReferenceKey(refItem.key)}
                onMouseLeave={() => setHoveredReferenceKey(null)}
                style={{
                  position: 'relative',
                  width: 44,
                  height: 44,
                  borderRadius: 13,
                  cursor: draggingReferenceKey === refItem.key ? 'grabbing' : 'pointer',
                  opacity: draggingReferenceKey === refItem.key ? 0.55 : 1,
                  transition: 'opacity 140ms ease, transform 140ms ease',
                  transform: hoveredReferenceKey === refItem.key ? 'translateY(-1px)' : 'translateY(0)',
                }}
              >
                <img
                  src={refItem.imageUrl}
                  alt={refItem.title}
                  style={{ width: 44, height: 44, borderRadius: 13, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 8px 20px rgba(0,0,0,0.3)' }}
                />
                {hoveredReferenceKey === refItem.key && (
                  <>
                    <div
                      style={{
                        position: 'absolute',
                        left: '50%',
                        bottom: 'calc(100% + 10px)',
                        transform: 'translateX(-50%)',
                        width: 112,
                        padding: 4,
                        borderRadius: 15,
                        background: 'rgba(35,35,35,0.82)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        boxShadow: '0 14px 34px rgba(0,0,0,0.44)',
                        backdropFilter: 'blur(12px)',
                        zIndex: 1200,
                        pointerEvents: 'none',
                      }}
                    >
                      <img src={refItem.imageUrl} alt="" style={{ width: '100%', height: 96, borderRadius: 12, objectFit: 'cover', display: 'block' }} />
                      <div style={{ marginTop: 4, color: '#fff', fontSize: 13, fontWeight: 800, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        @{refItem.mentionLabel}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="nodrag nopan"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRemoveReference(refItem);
                      }}
                      style={{
                        position: 'absolute',
                        top: -7,
                        right: -7,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,0.24)',
                        background: 'rgba(12,12,14,0.92)',
                        color: '#f8fafc',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 16,
                        lineHeight: 1,
                        cursor: 'pointer',
                        padding: 0,
                        zIndex: 1201,
                        boxShadow: '0 6px 14px rgba(0,0,0,0.38)',
                      }}
                      title={refItem.source === 'upstream' ? '删除引用并切断连线' : '删除素材引用'}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            ))}
            <button
              type="button"
              className="nodrag nopan"
              style={{ ...topToolbarBtn, background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.08)' }}
              onClick={() => setAssetMenuOpen(true)}
              title="添加更多素材"
            >
              <Plus size={16} />
            </button>
            {referenceChips.length === 0 && (
              <span style={{ fontSize: 13, color: '#94a3b8' }}>暂无引用，输入 @ 添加素材</span>
            )}
          </div>

          {(assetMenuOpen || slashMenuOpen) && (
            <div
              className="sleek-scroll-y"
              style={{
                position: 'absolute',
                left: -80,
                top: 54,
                width: assetMenuOpen ? 480 : 420,
                maxHeight: assetMenuOpen ? 540 : 240,
                overflowY: 'auto',
                borderRadius: 18,
                border: '1px solid rgba(255,255,255,0.11)',
                background: 'rgba(47,47,47,0.98)',
                marginBottom: 0,
                padding: assetMenuOpen ? '10px 10px 14px' : 8,
                boxShadow: '0 18px 48px rgba(0,0,0,0.42)',
                backdropFilter: 'blur(18px)',
                zIndex: 1600,
              }}
            >
              {slashMenuOpen && (
                <>
                  {filteredSlashCommands.map((command) => (
                    <button
                      key={command.id}
                      type="button"
                      className="nodrag nopan"
                      onClick={() => handleInsertSlashCommand(command.id)}
                      style={{
                        width: '100%',
                        border: 'none',
                        borderRadius: 10,
                        background: filteredSlashCommands[slashMenuIndex]?.id === command.id ? 'rgba(255,255,255,0.09)' : 'transparent',
                        color: '#e2e8f0',
                        textAlign: 'left',
                        padding: '8px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700 }}>/ {command.label}</div>
                      <div style={{ marginTop: 2, fontSize: 11, color: '#94a3b8' }}>{command.prompt}</div>
                    </button>
                  ))}
                </>
              )}
              {assetMenuOpen && (
                <>
                  {connectedMentionItems.length > 0 && (
                    <>
                      <div style={{ padding: '2px 0 6px', color: 'rgba(255,255,255,0.48)', fontSize: 14, fontWeight: 800 }}>已连接节点</div>
                      <div style={{ borderTop: '4px solid #ff455a', background: 'rgba(255,255,255,0.03)', margin: '0 -4px 12px', padding: '8px 4px 6px' }}>
                        {connectedMentionItems.map((item) => {
                          const active = mentionCandidates[assetMenuIndex]?.kind === 'upstream' && mentionCandidates[assetMenuIndex]?.id === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className="nodrag nopan"
                              onClick={() => handlePickConnectedRef(item.id)}
                              style={{
                                width: '100%',
                                height: 56,
                                border: 'none',
                                borderRadius: 12,
                                background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                                color: '#f8fafc',
                                textAlign: 'left',
                                padding: '7px 8px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 14,
                              }}
                            >
                              <img src={item.imageUrl} alt="" style={{ width: 36, height: 36, borderRadius: 7, objectFit: 'cover' }} />
                              <span style={{ flex: 1, fontSize: 22, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title || '参考图'}</span>
                              <ImageIcon size={20} color="rgba(255,255,255,0.45)" />
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <div style={{ padding: '0 0 8px', color: 'rgba(255,255,255,0.48)', fontSize: 14, fontWeight: 800 }}>个人素材库</div>
                  {folders.slice(0, 3).map((folder, index) => (
                    <button
                      key={folder.id}
                      type="button"
                      className="nodrag nopan"
                      style={{
                        width: '100%',
                        height: 56,
                        border: 'none',
                        borderRadius: 12,
                        background: 'transparent',
                        color: '#f8fafc',
                        textAlign: 'left',
                        padding: '7px 8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                      }}
                    >
                      <span style={{ width: 36, height: 28, borderRadius: 6, background: 'linear-gradient(#d7d7d7,#9d9d9d)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55)' }} />
                      <span style={{ flex: 1, fontSize: 22, fontWeight: 760 }}>{folder.name || ['Favorites', 'Character', 'Scene'][index] || '素材夹'}</span>
                      <ChevronRight size={22} color="rgba(255,255,255,0.45)" />
                    </button>
                  ))}
                  {(filteredRecentMentionItems.length > 0 || filteredLibraryMentionItems.length > 0) && (
                    <>
                      <div style={{ padding: '8px 8px 4px', color: 'rgba(255,255,255,0.42)', fontSize: 15, fontWeight: 760 }}>… 还有 {filteredMentionItems.length} 个结果</div>
                      {[...filteredRecentMentionItems, ...filteredLibraryMentionItems].slice(0, 6).map((item) => {
                        const active = mentionCandidates[assetMenuIndex]?.kind === 'asset' && mentionCandidates[assetMenuIndex]?.id === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className="nodrag nopan"
                            onClick={() => handlePickAssetRef(item.id)}
                            style={{
                              width: '100%',
                              height: 48,
                              border: 'none',
                              borderRadius: 12,
                              background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                              color: '#f8fafc',
                              textAlign: 'left',
                              padding: '6px 8px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                            }}
                          >
                            <img src={item.imageUrl} alt="" style={{ width: 34, height: 34, borderRadius: 7, objectFit: 'cover' }} />
                            <span style={{ flex: 1, fontSize: 17, fontWeight: 760, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title || '素材'}</span>
                            <ImageIcon size={18} color="rgba(255,255,255,0.45)" />
                          </button>
                        );
                      })}
                    </>
                  )}
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '12px 0' }} />
                  <div style={{ padding: '0 0 4px', color: 'rgba(255,255,255,0.48)', fontSize: 14, fontWeight: 800 }}>团队素材库</div>
                </>
              )}
            </div>
          )}

          <div style={richPromptShell}>
            <PromptLexicalEditor
              ref={promptLexicalEditorRef}
              value={String(d.generationPrompt || '')}
              references={promptReferences}
              onChange={handlePromptLexicalChange}
              onKeyDown={handlePromptTextareaKeyDown}
              placeholder="描述任何你想要生成的内容，按 @ 引用素材"
            />
          </div>

          <div style={promptBottomRow}>
            <div style={paramRow}>
              <ImageModelRouteDropup
                modelOptions={modelOptions}
                currentModelId={currentModelId}
                currentRoute={selectedRoute}
                size={currentSize}
                onChangeModel={applyModelSelection}
                onChangeRoute={applyRouteSelection}
              />
              {showSize && (
                <ImageSettingsDropup
                  ratio={currentRatio}
                  size={currentSize}
                  ratios={aspectOptions}
                  sizes={sizeOptions}
                  onChangeRatio={(value) => setParam('aspect_ratio', value)}
                  onChangeSize={(value) => setParam('size', value)}
                />
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              
              {/* Batch Count Selector (TapNow Style) */}
              <div 
                style={{ position: 'relative' }}
              >
                {showBatchSelector && (
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 12px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(28, 28, 38, 0.98)',
                    backdropFilter: 'blur(12px)',
                    borderRadius: 16,
                    padding: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                    zIndex: 1000,
                    minWidth: 44,
                  }}>
                    {[4, 3, 2, 1].map(num => (
                      <button
                        key={num}
                        onClick={() => {
                          updateNodeData(id, { batchCount: num });
                          setShowBatchSelector(false);
                        }}
                        className="flow-batch-option"
                        style={{
                          background: (d.batchCount || 1) === num ? 'rgba(255,255,255,0.08)' : 'transparent',
                          border: 'none',
                          color: (d.batchCount || 1) === num ? '#fff' : '#64748b',
                          fontSize: 13,
                          fontWeight: 500,
                          padding: '8px 0',
                          borderRadius: 10,
                          cursor: 'pointer',
                          textAlign: 'center',
                          transition: 'all 0.2s',
                        }}
                      >
                        {num}x
                      </button>
                    ))}
                  </div>
                )}
                
                <button
                  onClick={() => setShowBatchSelector(!showBatchSelector)}
                  className="flow-batch-btn"
                  title="生成数量"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.04)',
                    color: '#e2e8f0',
                    fontSize: 14,
                    fontWeight: 600,
                    padding: '6px 14px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    minWidth: 44,
                    transition: 'all 0.2s',
                  }}
                >
                  {d.batchCount || 1}x
                </button>
              </div>

              <div style={sendBtnOuter}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 14 }}>点数</span> {currentPointCost.toFixed(1)}
                </span>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  style={sendBtnAction(isGenerating)}
                  title="开始生成"
                >
                  {isGenerating ? '...' : '↑'}
                </button>
              </div>
            </div>
          </div>
          </div>
        </FloatingPromptBar>
      )}

      {d.errorMessage && <div style={errorBar}>⚠{d.errorMessage}</div>}
    </div>
  );
});

export const ImageNodeComponent = memo(function ImageNodeComponent(props: NodeProps<FlowNode>) {
  return <ImageNodeHeavy {...props} />;
});

/* Section */
export const VideoNodeComponent = memo(function VideoNode({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const d = data;
  const updateNodeData = useFlowCanvasStore((s) => s.updateNodeData);
  const { models } = useVideoModelCatalog();
  const [hovered, setHovered] = useState(false);
  const [showBatchSelector, setShowBatchSelector] = useState(false);
  const [showBatchTooltip, setShowBatchTooltip] = useState(false);
  const { connectionNodeId } = useConnection();
  const showNodeEditor = useSingleNodeSelection(selected);
  
  const isTargeting = !!connectionNodeId && connectionNodeId !== id && hovered;

  const modelOptions = models.length
    ? models.map((m) => ({ id: m.id, label: m.label }))
    : [{ id: 'veo3.1-fast', label: 'Veo 3.1 Fast' }];

  const currentModelId = String(d.modelId || modelOptions[0]?.id || 'veo3.1-fast');
  const isGenerating = d.generationStatus === 'generating';

  const aspectOptions = getVideoModelAspectRatioOptions(currentModelId);
  const durationOptions = getVideoModelDurationOptions(currentModelId);
  const supportsHd = getVideoModelSupportsHd(currentModelId);

  const p = (d.params || {}) as Record<string, any>;
  const currentRatio = String(p.aspect_ratio || aspectOptions[0] || '16:9');
  const currentDuration = String(p.duration || durationOptions[0] || '4');

  const setParam = (key: string, val: any) => {
    const patch: Partial<FlowNodeData> = { params: { ...p, [key]: val } };
    if (key === 'aspect_ratio' && !d.posterUrl) {
      const nextSize = getMediaNodeSizeFromRatioString(val, 16 / 9);
      patch.width = nextSize.width;
      patch.height = nextSize.height;
      patch.aspectRatio = parseAspectRatio(val) || 16 / 9;
    }
    updateNodeData(id, patch);
  };

  const handleGenerate = () => {
    if (isGenerating) return;
    runNodeGeneration(id);
  };

  return (
    <div 
      style={nodeWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <NodeResizer 
        isVisible={selected} 
        minWidth={160} 
        minHeight={160} 
        lineStyle={{ border: 'none' }}
      />

      <NodeLabel nodeId={id} icon={<Video size={14} />} label={String(d.title || 'Video')} fallbackLabel="Video" />

      <Handle 
        type="target" 
        position={Position.Left} 
        id="in" 
        style={{ ...invisibleHandle, position: 'absolute', left: -2, top: '50%', transform: 'translateY(-50%)' }}
      >
        <div style={handleHitArea}>
          <div style={{ ...plusHandleInner, opacity: hovered ? 1 : 0 }}><Plus size={14} /></div>
        </div>
      </Handle>

      <div style={card(d.width || FLOW_NODE_DEFAULT_SIZES.video.width, d.height || FLOW_NODE_DEFAULT_SIZES.video.height, selected, isTargeting)}>
        {d.posterUrl ? (
          <div style={{ ...contentArea, height: '100%' }}>
            <video
              src={d.posterUrl}
              controls
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }}
            />
          </div>
        ) : (
          <div style={placeholderArea(d.height || FLOW_NODE_DEFAULT_SIZES.video.height)}><Video size={48} strokeWidth={1} color="rgba(255,255,255,0.2)" /></div>
        )}

        {isGenerating && <div style={progressBar(d.progress || 0)} />}
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        id="out" 
        style={{ ...invisibleHandle, position: 'absolute', right: -2, top: '50%', transform: 'translateY(-50%)' }}
      >
        <div style={handleHitArea}>
          <div style={{ ...plusHandleInner, opacity: hovered ? 1 : 0 }}><Plus size={14} /></div>
        </div>
      </Handle>

      {showNodeEditor && (
        <FloatingToolbar>
          <button style={uploadBtn}>
            <span style={{ fontSize: 16 }}>↑</span> 上传
          </button>
        </FloatingToolbar>
      )}

      {showNodeEditor && (
        <FloatingPromptBar>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button style={{ ...topToolbarBtn, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '6px 12px' }}>首尾帧</button>
            <button style={{ ...topToolbarBtn, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '6px 12px' }}>+</button>
          </div>

          <textarea
            value={d.generationPrompt || ''}
            onChange={(e) => updateNodeData(id, { generationPrompt: e.target.value })}
            placeholder="描述任何你想要生成的内容"
            style={promptTextarea}
          />

          <div style={promptBottomRow}>
            <div style={paramRow}>
              <span style={{ fontSize: 14, color: '#94a3b8', marginRight: 4 }}>模型</span>
              <select
                value={currentModelId}
                onChange={(e) => updateNodeData(id, { modelId: e.target.value })}
                style={{ ...paramChip, appearance: 'none', fontWeight: 500, color: '#e2e8f0' }}
              >
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id} style={{ background: '#1e1e28' }}>{m.label}</option>
                ))}
              </select>

              <span style={{ color: 'rgba(255,255,255,0.1)', margin: '0 8px' }}>|</span>

              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8', fontSize: 13 }}>
                <span style={{ color: '#e2e8f0' }}>首尾帧</span>
                <ParamDivider />
                <ParamSelect value={currentRatio} options={aspectOptions} onChange={(v) => setParam('aspect_ratio', v)} />
                <ParamDivider />
                <span>1080p</span>
                <ParamDivider />
                <ParamSelect value={currentDuration} options={durationOptions} onChange={(v) => setParam('duration', v)} prefix="" />
                <span>s</span>
                <ParamDivider />
                <span>高清</span>
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              
              {/* Batch Count Selector (TapNow Style) */}
              <div 
                style={{ position: 'relative' }}
                onMouseEnter={() => setShowBatchTooltip(true)}
                onMouseLeave={() => setShowBatchTooltip(false)}
              >
                {/* Tooltip on Hover */}
                {showBatchTooltip && !showBatchSelector && (
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 12px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#1f1f1f',
                    borderRadius: 8,
                    padding: '6px 12px',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    zIndex: 1001,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.08)'
                  }}>
                    生成数量
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      border: '6px solid transparent',
                      borderTopColor: '#1f1f1f'
                    }} />
                  </div>
                )}

                {showBatchSelector && (
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 12px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(28, 28, 38, 0.98)',
                    backdropFilter: 'blur(12px)',
                    borderRadius: 16,
                    padding: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                    zIndex: 1000,
                    minWidth: 44,
                  }}>
                    {[4, 3, 2, 1].map(num => (
                      <button
                        key={num}
                        onClick={() => {
                          updateNodeData(id, { batchCount: num });
                          setShowBatchSelector(false);
                          setShowBatchTooltip(false);
                        }}
                        style={{
                          background: (d.batchCount || 1) === num ? 'rgba(255,255,255,0.08)' : 'transparent',
                          border: 'none',
                          color: (d.batchCount || 1) === num ? '#fff' : '#64748b',
                          fontSize: 13,
                          fontWeight: 500,
                          padding: '8px 0',
                          borderRadius: 10,
                          cursor: 'pointer',
                          textAlign: 'center',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          if ((d.batchCount || 1) !== num) {
                            e.currentTarget.style.color = '#fff';
                            e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if ((d.batchCount || 1) !== num) {
                            e.currentTarget.style.color = '#64748b';
                            e.currentTarget.style.background = 'transparent';
                          }
                        }}
                      >
                        {num}x
                      </button>
                    ))}
                  </div>
                )}
                
                <button
                  onClick={() => setShowBatchSelector(!showBatchSelector)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.04)',
                    color: '#e2e8f0',
                    fontSize: 14,
                    fontWeight: 600,
                    padding: '6px 14px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    minWidth: 44,
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  }}
                >
                  {d.batchCount || 1}x
                </button>
              </div>

              <div style={sendBtnOuter}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 14 }}>点数</span> 112
                </span>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  style={sendBtnAction(isGenerating)}
                  title="开始生成"
                >
                  {isGenerating ? '...' : '↑'}
                </button>
              </div>
            </div>
          </div>
        </FloatingPromptBar>
      )}

      {d.errorMessage && <div style={errorBar}>⚠{d.errorMessage}</div>}
    </div>
  );
});

/* Section */
export const AudioNodeComponent = memo(function AudioNode({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const d = data;
  const [hovered, setHovered] = useState(false);
  const { connectionNodeId } = useConnection();
  const isTargeting = !!connectionNodeId && connectionNodeId !== id && hovered;

  return (
    <div 
      style={nodeWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <NodeResizer 
        isVisible={selected} 
        minWidth={160} 
        minHeight={160} 
        lineStyle={{ border: 'none' }}
      />
      <NodeLabel nodeId={id} icon={<Music size={14} />} label={String(d.title || 'Audio')} fallbackLabel="Audio" />

      <Handle 
        type="target" 
        position={Position.Left} 
        id="in" 
        style={{ ...invisibleHandle, position: 'absolute', left: -2, top: '50%', transform: 'translateY(-50%)' }}
      >
        <div style={handleHitArea}>
          <div style={{ ...plusHandleInner, opacity: hovered ? 1 : 0 }}><Plus size={14} /></div>
        </div>
      </Handle>

      <div style={card(d.width || FLOW_NODE_DEFAULT_SIZES.audio.width, d.height || FLOW_NODE_DEFAULT_SIZES.audio.height, selected, isTargeting)}>
        <div style={placeholderArea(Math.max(120, (d.height || FLOW_NODE_DEFAULT_SIZES.audio.height) - 64))}><Music size={40} strokeWidth={1} color="rgba(255,255,255,0.2)" /></div>
        <div style={{ padding: '0 16px 24px', textAlign: 'center' }}>
          <span style={{
            fontSize: 12,
            color: '#64748b',
            background: 'transparent',
          }}>
            音频生成 · 开发中
          </span>
        </div>
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        id="out" 
        style={{ ...invisibleHandle, position: 'absolute', right: -2, top: '50%', transform: 'translateY(-50%)' }}
      >
        <div style={handleHitArea}>
          <div style={{ ...plusHandleInner, opacity: hovered ? 1 : 0 }}><Plus size={14} /></div>
        </div>
      </Handle>
    </div>
  );
});

/* Section */
export const ImageEditorNodeComponent = memo(function ImageEditorNode({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const d = data;
  const [hovered, setHovered] = useState(false);
  const { connectionNodeId } = useConnection();
  const isTargeting = !!connectionNodeId && connectionNodeId !== id && hovered;

  return (
    <div 
      style={nodeWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <NodeResizer 
        isVisible={selected} 
        minWidth={220} 
        minHeight={220} 
        lineStyle={{ border: 'none' }}
      />
      <NodeLabel nodeId={id} icon={<Palette size={14} />} label={String(d.title || 'Image Editor')} fallbackLabel="Image Editor" />

      <Handle 
        type="target" 
        position={Position.Left} 
        id="in" 
        style={{ ...invisibleHandle, position: 'absolute', left: -2, top: '50%', transform: 'translateY(-50%)' }}
      >
        <div style={handleHitArea}>
          <div style={{ ...plusHandleInner, opacity: hovered ? 1 : 0 }}><Plus size={14} /></div>
        </div>
      </Handle>

      <div style={card(d.width || 220, d.height || 220, selected, isTargeting)}>
        <div style={{ ...placeholderArea(120), flexDirection: 'column', gap: 12, fontSize: 14 }}>
          <Palette size={40} strokeWidth={1} color="rgba(255,255,255,0.2)" />
          <button style={{
            background: 'rgba(99,102,241,0.1)',
            border: 'none',
            borderRadius: 8,
            padding: '8px 20px',
            color: '#a5b4fc',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}>
            打开编辑器</button>
        </div>
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        id="out" 
        style={{ ...invisibleHandle, position: 'absolute', right: -2, top: '50%', transform: 'translateY(-50%)' }}
      >
        <div style={handleHitArea}>
          <div style={{ ...plusHandleInner, opacity: hovered ? 1 : 0 }}><Plus size={14} /></div>
        </div>
      </Handle>
    </div>
  );
});

/* Section */
export const UploadNodeComponent = memo(function UploadNode({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const d = data;
  const [hovered, setHovered] = useState(false);
  const { connectionNodeId } = useConnection();
  const isTargeting = !!connectionNodeId && connectionNodeId !== id && hovered;

  return (
    <div 
      style={nodeWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <NodeResizer 
        isVisible={selected} 
        minWidth={160} 
        minHeight={160} 
        lineStyle={{ border: 'none' }}
      />
      <NodeLabel nodeId={id} icon={<Upload size={14} />} label={String(d.title || 'Upload')} fallbackLabel="Upload" />

      <div style={card(d.width || FLOW_NODE_DEFAULT_SIZES.upload.width, d.height || FLOW_NODE_DEFAULT_SIZES.upload.height, selected, isTargeting)}>
        <div style={{
          ...placeholderArea(d.height || FLOW_NODE_DEFAULT_SIZES.upload.height),
          background: 'transparent',
          flexDirection: 'column',
          gap: 12,
          fontSize: 13,
          color: 'rgba(255,255,255,0.3)',
          cursor: 'pointer',
        }}>
          <Upload size={32} strokeWidth={1.5} color="rgba(255,255,255,0.2)" />
          <span>点击或拖拽上传</span>
        </div>
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        id="out" 
        style={{ ...plusHandle, opacity: hovered ? 1 : 0, position: 'absolute', right: -18, top: '50%', transform: 'translateY(-50%)' }}
      >
        <div style={plusHandleInner}><Plus size={14} /></div>
      </Handle>
    </div>
  );
});

/* Section */
export const GroupNodeComponent = memo(function GroupNode({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const d = data;
  const updateNodeData = useFlowCanvasStore((s) => s.updateNodeData);
  const ungroupSelectedGroups = useFlowCanvasStore((s) => s.ungroupSelectedGroups);
  const layoutSelectedGroup = useFlowCanvasStore((s) => s.layoutSelectedGroup);
  const allNodes = useFlowCanvasStore((s) => s.nodes);
  const childNodes = allNodes.filter((node) => node.parentId === id);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [templateCopied, setTemplateCopied] = useState(false);
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const layoutButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showColorPicker && !showLayoutMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (
        target &&
        (colorButtonRef.current?.contains(target) || layoutButtonRef.current?.contains(target))
      ) {
        return;
      }
      setShowColorPicker(false);
      setShowLayoutMenu(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [showColorPicker, showLayoutMenu]);

  const groupBg = String(d.backgroundColor || 'rgba(64,64,64,0.58)');
  const executeGroup = () => {
    childNodes
      .filter((node) => ['text', 'image', 'video'].includes(String(node.type || node.data.kind)))
      .forEach((node) => {
        if (node.data.generationPrompt) {
          void runNodeGeneration(node.id);
        }
      });
  };
  const createTemplate = async () => {
    const template = {
      title: d.title || '新建组',
      nodes: childNodes.map((node) => ({
        type: node.type,
        position: node.position,
        data: {
          kind: node.data.kind,
          title: node.data.title,
          generationPrompt: node.data.generationPrompt,
          modelId: node.data.modelId,
          params: node.data.params,
          width: node.data.width,
          height: node.data.height,
        },
      })),
    };
    await navigator.clipboard.writeText(JSON.stringify(template, null, 2));
    setTemplateCopied(true);
    window.setTimeout(() => setTemplateCopied(false), 1600);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minWidth: 300, minHeight: 200 }}>
      <NodeResizer 
        isVisible={selected} 
        minWidth={300} 
        minHeight={200} 
        keepAspectRatio={false}
        lineStyle={{ border: 'none' }}
        onResizeEnd={(_, params) => {
          updateNodeData(id, { width: params.width, height: params.height });
        }}
      />

      {selected && (
        <FloatingToolbar>
          <div style={{ position: 'relative' }}>
            <Tooltip title="颜色">
              <button
                ref={colorButtonRef}
                type="button"
                onClick={() => {
                  setShowLayoutMenu(false);
                  setShowColorPicker((open) => !open);
                }}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: groupBg === 'transparent' ? '#fff' : groupBg,
                  cursor: 'pointer',
                }}
              />
            </Tooltip>
            {showColorPicker && createPortal(
              <div style={getGroupDropdownPortalStyle(colorButtonRef.current)}>
                {TEXT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => {
                      updateNodeData(id, { backgroundColor: color === 'transparent' ? 'rgba(64,64,64,0.28)' : color });
                      setShowColorPicker(false);
                    }}
                    style={groupColorMenuItemStyle}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: color === 'transparent' ? '#fff' : color,
                      }}
                    />
                  </button>
                ))}
              </div>,
              document.body,
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <Tooltip title="布局">
              <button
                ref={layoutButtonRef}
                type="button"
                style={groupToolbarButtonStyle}
                onClick={() => {
                  setShowColorPicker(false);
                  setShowLayoutMenu((open) => !open);
                }}
              >
                <LayoutGrid size={19} />
              </button>
            </Tooltip>
            {showLayoutMenu && createPortal(
              <div style={{ ...getGroupDropdownPortalStyle(layoutButtonRef.current), minWidth: 132, alignItems: 'stretch' }}>
                <button
                  type="button"
                  style={groupPopupButtonStyle}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    layoutSelectedGroup('grid');
                    setShowLayoutMenu(false);
                  }}
                >
                  <LayoutGrid size={16} /> 宫格布局
                </button>
                <button
                  type="button"
                  style={groupPopupButtonStyle}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    layoutSelectedGroup('horizontal');
                    setShowLayoutMenu(false);
                  }}
                >
                  <Rows3 size={16} /> 水平布局
                </button>
              </div>,
              document.body,
            )}
          </div>

          {toolbarDivider}
          <Tooltip title="整组执行">
            <button type="button" style={groupToolbarTextButtonStyle} onClick={executeGroup}>
              <Play size={18} fill="currentColor" /> 整组执行
            </button>
          </Tooltip>
          <Tooltip title="创建模板">
            <button type="button" style={groupToolbarTextButtonStyle} onClick={createTemplate}>
              {templateCopied ? <Check size={18} /> : <Blocks size={18} />} {templateCopied ? '已创建' : '创建模板'}
            </button>
          </Tooltip>
          <Tooltip title="解组">
            <button type="button" style={groupToolbarTextButtonStyle} onClick={ungroupSelectedGroups}>
              <Ungroup size={18} /> 解组
            </button>
          </Tooltip>
        </FloatingToolbar>
      )}

      <div style={{ position: 'absolute', left: 2, bottom: 'calc(100% + 8px)', width: 'calc(100% - 4px)', minWidth: 0, zIndex: 20 }}>
        <EditableNodeTitle
          nodeId={id}
          icon={<Layers size={14} />}
          label={String(d.title || '新建组')}
          fallbackLabel="新建组"
          compact
        />
      </div>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 12,
          border: selected ? '1.5px solid rgba(255,255,255,0.62)' : '1.5px solid rgba(255,255,255,0.18)',
          background: groupBg,
          boxShadow: selected ? '0 12px 36px rgba(0,0,0,0.36)' : 'none',
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.13) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
    </div>
  );
});

const toolbarDivider: React.ReactNode = <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.16)' }} />;

const groupToolbarButtonStyle: React.CSSProperties = {
  ...topToolbarBtn,
  color: '#f8fafc',
  width: 32,
  height: 32,
  borderRadius: 12,
  background: 'rgba(255,255,255,0.06)',
};

const groupToolbarTextButtonStyle: React.CSSProperties = {
  ...topToolbarBtn,
  color: '#f8fafc',
  gap: 10,
  fontSize: 16,
  fontWeight: 700,
  padding: '8px 4px',
};

const getGroupDropdownPortalStyle = (anchor: HTMLElement | null): React.CSSProperties => {
  const rect = anchor?.getBoundingClientRect();
  return {
    position: 'fixed',
    top: rect ? rect.bottom + 12 : 120,
    left: rect ? rect.left + rect.width / 2 : 120,
    transform: 'translateX(-50%)',
    zIndex: 10000,
    ...groupDropdownBaseStyle,
  };
};

const groupDropdownBaseStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 8,
  borderRadius: 14,
  background: 'rgba(28,28,32,0.98)',
  border: '1px solid rgba(255,255,255,0.1)',
  boxShadow: '0 16px 40px rgba(0,0,0,0.48)',
};

const groupColorMenuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 34,
  height: 34,
  border: 'none',
  borderRadius: 10,
  background: 'transparent',
  cursor: 'pointer',
  padding: 0,
};

const groupPopupButtonStyle: React.CSSProperties = {
  ...topToolbarBtn,
  justifyContent: 'flex-start',
  gap: 8,
  color: '#f8fafc',
  fontSize: 13,
  padding: '8px 10px',
  borderRadius: 10,
  background: 'transparent',
};


