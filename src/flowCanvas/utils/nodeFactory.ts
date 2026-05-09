/**
 * Node Factory - Creates new node instances with default data.
 * TapNow-style: simplified node types.
 */
import { nanoid } from 'nanoid';
import type { Node } from '@xyflow/react';
import type { FlowNodeData, FlowNodeKind } from '../types';
import { FLOW_NODE_DEFAULT_SIZES } from './nodeSizing';
import { DEFAULT_TEXT_MODEL_ID } from '../../config/textModels';

const NODE_DEFAULTS: Record<
  FlowNodeKind,
  { label: string; width: number; height: number; color: string }
> = {
  text: { label: '文本', ...FLOW_NODE_DEFAULT_SIZES.text, color: '#94a3b8' },
  image: { label: '图片', ...FLOW_NODE_DEFAULT_SIZES.image, color: '#94a3b8' },
  video: { label: '视频', ...FLOW_NODE_DEFAULT_SIZES.video, color: '#94a3b8' },
  audio: { label: '音频', ...FLOW_NODE_DEFAULT_SIZES.audio, color: '#94a3b8' },
  upload: { label: '上传', ...FLOW_NODE_DEFAULT_SIZES.upload, color: '#94a3b8' },
  image_editor: { label: '图片编辑器', ...FLOW_NODE_DEFAULT_SIZES.imageEditor, color: '#94a3b8' },
  group: { label: '分组', width: 600, height: 400, color: '#6366f1' },
};

export function getNodeDefaults(kind: FlowNodeKind) {
  return NODE_DEFAULTS[kind] || NODE_DEFAULTS.text;
}

export function createFlowNode(
  kind: FlowNodeKind,
  position: { x: number; y: number },
  overrides: Partial<FlowNodeData> = {},
): Node<FlowNodeData> {
  const defaults = getNodeDefaults(kind);
  const now = Date.now();

  const data: FlowNodeData = {
    kind,
    title: overrides.title || defaults.label,
    width: defaults.width,
    height: defaults.height,
    status: 'idle',
    generationStatus: 'idle',
    modelId: kind === 'text' ? DEFAULT_TEXT_MODEL_ID : undefined,
    createdAt: now,
    updatedAt: now,
  };
  Object.assign(data, overrides);

  return {
    id: nanoid(12),
    type: kind,
    position,
    data,
    ...(kind === 'group'
      ? {
          style: { width: defaults.width, height: defaults.height },
        }
      : {}),
  };
}

export function duplicateFlowNode(
  original: Node<FlowNodeData>,
  offset = { x: 40, y: 40 },
): Node<FlowNodeData> {
  const now = Date.now();
  return {
    ...original,
    id: nanoid(12),
    position: {
      x: original.position.x + offset.x,
      y: original.position.y + offset.y,
    },
    selected: false,
    data: {
      ...original.data,
      title: `${original.data.title} (copy)`,
      status: 'idle',
      generationStatus: 'idle',
      createdAt: now,
      updatedAt: now,
    },
  };
}
