import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import type { FlowNodeData, FlowNodeKind } from '../types';
import {
  canConnectFlowNodes,
  canCreateNodeFromSource,
  canNodeReceiveIncoming,
  getConnectionActionsForSource,
} from './connectionRules';

const node = (kind: FlowNodeKind, data: Partial<FlowNodeData> = {}): Node<FlowNodeData> => ({
  id: `${kind}-${Math.random()}`,
  type: kind,
  position: { x: 0, y: 0 },
  data: { kind, ...data },
});

describe('connectionRules', () => {
  it('filters creatable downstream node kinds by source kind', () => {
    expect(getConnectionActionsForSource(node('text')).map((action) => action.kind)).toEqual([
      'text',
      'image',
      'video',
    ]);
    expect(getConnectionActionsForSource(node('image')).map((action) => action.kind)).toEqual([
      'text',
      'image',
      'video',
    ]);
    expect(getConnectionActionsForSource(node('video')).map((action) => action.kind)).toEqual(['text']);
  });

  it('enforces the allowed upstream/downstream matrix for existing nodes', () => {
    const textSource = node('text');
    const textTarget = node('text');
    const imageSource = node('image');
    const imageTarget = node('image');
    const videoSource = node('video');
    const videoTarget = node('video');

    expect(canConnectFlowNodes(textSource, textTarget).ok).toBe(true);
    expect(canConnectFlowNodes(textSource, imageTarget).ok).toBe(true);
    expect(canConnectFlowNodes(textSource, videoTarget).ok).toBe(true);

    expect(canConnectFlowNodes(imageSource, textTarget).ok).toBe(true);
    expect(canConnectFlowNodes(imageSource, imageTarget).ok).toBe(true);
    expect(canConnectFlowNodes(imageSource, videoTarget).ok).toBe(true);

    expect(canConnectFlowNodes(videoSource, textTarget).ok).toBe(true);
    expect(canConnectFlowNodes(videoSource, imageTarget).ok).toBe(false);
    expect(canConnectFlowNodes(videoSource, videoTarget).ok).toBe(false);
    expect(canConnectFlowNodes(textSource, textSource).ok).toBe(false);
  });

  it('hides incoming connections for uploaded image nodes while preserving image downstream actions', () => {
    const uploadedImage = node('image', {
      thumbnailUrl: 'blob:http://localhost/uploaded-image',
    });
    const generatedImage = node('image', {
      thumbnailUrl: 'https://example.com/generated.png',
      lastGenerationSnapshot: { prompt: 'test' },
    } as Partial<FlowNodeData>);

    expect(canNodeReceiveIncoming(uploadedImage)).toBe(false);
    expect(canConnectFlowNodes(node('text'), uploadedImage).ok).toBe(false);
    expect(canCreateNodeFromSource(uploadedImage, 'text')).toBe(true);
    expect(canCreateNodeFromSource(uploadedImage, 'image')).toBe(true);
    expect(canCreateNodeFromSource(uploadedImage, 'video')).toBe(true);

    expect(canNodeReceiveIncoming(generatedImage)).toBe(true);
    expect(canConnectFlowNodes(node('text'), generatedImage).ok).toBe(true);
  });
});
