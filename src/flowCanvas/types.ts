/**
 * Flow Canvas Type Definitions
 * TapNow-style: content nodes with embedded generation
 */

// ─── Node Kinds ──────────────────────────────────────────────
export type FlowNodeKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'upload'
  | 'image_editor'
  | 'group';

// ─── Node Status ─────────────────────────────────────────────
export type FlowNodeStatus =
  | 'idle'
  | 'pending'
  | 'queued'
  | 'runnable'
  | 'running'
  | 'waiting_provider'
  | 'success'
  | 'succeeded'
  | 'error'
  | 'failed'
  | 'stale'
  | 'cancelled'
  | 'canceled';

// ─── Generation Status (embedded in content nodes) ───────────
export type FlowGenerationStatus = 'idle' | 'generating' | 'done' | 'error';

export interface FlowImageResultItem {
  id: string;
  url: string;
  createdAt: number;
}

export interface FlowRuntimeAssetRef {
  assetId: string;
  downloadUrl?: string;
  expiresAt?: string | null;
  height?: number | null;
  kind: string;
  mimeType: string;
  width?: number | null;
}

export interface FlowRuntimeNodeOutput {
  assets?: FlowRuntimeAssetRef[];
  errorMessage?: string | null;
  output?: Record<string, unknown> | null;
  providerTask?: Record<string, unknown> | null;
  text?: string | null;
}

export interface FlowImageGenerationSnapshot {
  modelId: string;
  routeId?: string;
  prompt: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  n?: number;
  referenceImageCount: number;
  activeCommandId?: string;
  generatedAt: number;
}

// ─── Edge Data Types ─────────────────────────────────────────
export type FlowEdgeDataType = 'text' | 'image' | 'video' | 'audio' | 'json' | 'any';

// ─── Node Data ───────────────────────────────────────────────
export interface FlowNodeData {
  /** Index signature required by React Flow's Node<Record<string, unknown>> */
  [key: string]: unknown;

  kind: FlowNodeKind;
  title: string;

  // UI
  width: number;
  height: number;
  collapsed?: boolean;
  locked?: boolean;

  // Workflow status
  status: FlowNodeStatus;
  progress?: number;
  errorMessage?: string;

  // Assets
  assetIds?: string[];
  thumbnailUrl?: string;
  posterUrl?: string;
  originalImageUrl?: string;
  editHistory?: string[];
  lastEditType?: string;
  editSourceNodeId?: string;
  editPrompt?: string;
  imageFolderIds?: string[];
  naturalWidth?: number;
  naturalHeight?: number;
  aspectRatio?: number;

  // Embedded generation (TapNow-style)
  generationPrompt?: string;
  generationStatus?: FlowGenerationStatus;
  modelId?: string;
  routeId?: string;
  referenceAssetItemIds?: string[];
  referenceOrder?: string[];
  activeCommandId?: string;
  generatedResults?: FlowImageResultItem[];
  activeResultIndex?: number;
  coverResultId?: string;
  favoriteResultIds?: string[];
  lastGenerationSnapshot?: FlowImageGenerationSnapshot;
  params?: Record<string, unknown>;

  // Text content
  text?: string;
  backgroundColor?: string;
  fontSize?: 'h1' | 'h2' | 'h3' | 'body';
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  listType?: 'none' | 'bullet' | 'number';

  // Batch Generation
  batchCount?: number;

  // Timestamps
  createdAt: number;
  updatedAt: number;
}

// ─── Edge Data ───────────────────────────────────────────────
export interface FlowEdgeData {
  /** Index signature required by React Flow's Edge<Record<string, unknown>> */
  [key: string]: unknown;

  dataType: FlowEdgeDataType;
  status?: 'idle' | 'running' | 'success' | 'error';
}

// ─── Handle Definitions ─────────────────────────────────────
export interface HandleConfig {
  id: string;
  type: 'source' | 'target';
  position: 'top' | 'bottom' | 'left' | 'right';
  dataType: FlowEdgeDataType;
  label?: string;
}

// ─── Node Config ─────────────────────────────────────────────
export interface NodeKindConfig {
  kind: FlowNodeKind;
  label: string;
  icon: string;
  color: string;
  defaultWidth: number;
  defaultHeight: number;
  inputs: HandleConfig[];
  outputs: HandleConfig[];
}
