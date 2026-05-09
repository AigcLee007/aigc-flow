/**
 * Demo Data Generator for Phase 0 Performance Verification
 *
 * Generates a realistic graph with:
 * - 200 image nodes (with placeholder thumbnails)
 * - 20 text nodes
 * - 10 video poster nodes
 * - 5 group nodes
 * - ~300 edges connecting them
 */
import { type Node, type Edge, Position } from '@xyflow/react';
import type { FlowNodeData, FlowEdgeData } from '../types';

const GRID_COLS = 12;
const NODE_GAP_X = 320;
const NODE_GAP_Y = 280;

// Deterministic pseudo-random using a seed
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

// Generate a placeholder thumbnail URL (colored SVG data URI)
function placeholderThumbnail(index: number, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <rect width="256" height="256" fill="hsl(${hue},60%,20%)" rx="12"/>
    <text x="128" y="128" text-anchor="middle" dominant-baseline="central"
      font-family="sans-serif" font-size="48" fill="hsl(${hue},80%,70%)">${index}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function placeholderVideoPoster(index: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
    <rect width="320" height="180" fill="hsl(260,50%,15%)" rx="12"/>
    <polygon points="140,60 140,120 190,90" fill="hsl(260,80%,65%)" opacity="0.8"/>
    <text x="160" y="155" text-anchor="middle" font-family="sans-serif" font-size="14"
      fill="hsl(260,60%,60%)">Video ${index}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const SAMPLE_PROMPTS = [
  'A serene mountain landscape at golden hour',
  'Cyberpunk city street with neon lights',
  'Watercolor painting of a cat sleeping',
  'Minimalist product photography on white',
  'Fantasy castle floating in the clouds',
  'Abstract geometric pattern in warm tones',
  'Underwater coral reef with tropical fish',
  'Vintage photograph of a steam locomotive',
  'Oil painting of sunflowers in a vase',
  'Aerial view of autumn forest',
];

export function generateDemoData(): {
  nodes: Node<FlowNodeData>[];
  edges: Edge<FlowEdgeData>[];
} {
  const rand = seededRandom(42);
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge<FlowEdgeData>[] = [];
  let nodeIndex = 0;

  // ─── Helper: place node on grid ────────────────────────────
  const placeNode = (
    kind: FlowNodeData['kind'],
    overrides: Partial<FlowNodeData> = {},
  ): Node<FlowNodeData> => {
    const col = nodeIndex % GRID_COLS;
    const row = Math.floor(nodeIndex / GRID_COLS);
    const jitterX = (rand() - 0.5) * 60;
    const jitterY = (rand() - 0.5) * 40;
    const id = `node-${nodeIndex}`;
    nodeIndex++;

    const baseData: FlowNodeData = {
      kind,
      title: `${kind} ${nodeIndex}`,
      width: kind === 'video' ? 320 : kind === 'text' ? 240 : 256,
      height: kind === 'video' ? 220 : kind === 'text' ? 160 : 256,
      status: 'idle' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    Object.assign(baseData, overrides);

    return {
      id,
      type: kind,
      position: {
        x: col * NODE_GAP_X + jitterX,
        y: row * NODE_GAP_Y + jitterY,
      },
      data: baseData,
    };
  };

  // ─── Generate 200 image nodes ──────────────────────────────
  for (let i = 0; i < 200; i++) {
    const hue = Math.floor(rand() * 360);
    nodes.push(
      placeNode('image', {
        title: `Image ${i + 1}`,
        thumbnailUrl: placeholderThumbnail(i + 1, hue),
        status: rand() > 0.8 ? 'success' : 'idle',
      }),
    );
  }

  // ─── Generate 20 text nodes ────────────────────────────────
  for (let i = 0; i < 20; i++) {
    nodes.push(
      placeNode('text', {
        title: `Prompt ${i + 1}`,
        text: SAMPLE_PROMPTS[i % SAMPLE_PROMPTS.length],
      }),
    );
  }

  // ─── Generate 10 video poster nodes ────────────────────────
  for (let i = 0; i < 10; i++) {
    nodes.push(
      placeNode('video', {
        title: `Video ${i + 1}`,
        posterUrl: placeholderVideoPoster(i + 1),
        status: rand() > 0.6 ? 'success' : 'idle',
      }),
    );
  }

  // ─── Generate 5 group nodes ────────────────────────────────
  for (let i = 0; i < 5; i++) {
    const groupId = `group-${i}`;
    const startIdx = i * 8;
    const groupX = (startIdx % GRID_COLS) * NODE_GAP_X - 40;
    const groupY = Math.floor(startIdx / GRID_COLS) * NODE_GAP_Y - 40;

    nodes.push({
      id: groupId,
      type: 'group',
      position: { x: groupX, y: groupY },
      data: {
        kind: 'group',
        title: `Group ${i + 1}`,
        width: NODE_GAP_X * 3 + 80,
        height: NODE_GAP_Y + 80,
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      style: {
        width: NODE_GAP_X * 3 + 80,
        height: NODE_GAP_Y + 80,
      },
    });
  }

  // ─── Generate ~300 edges ───────────────────────────────────
  // Strategy: connect sequential image nodes, text→image, image→video
  const imageNodes = nodes.filter((n) => n.data.kind === 'image');
  const textNodes = nodes.filter((n) => n.data.kind === 'text');
  const videoNodes = nodes.filter((n) => n.data.kind === 'video');

  // Chain image nodes (every node connects to next 1-2 nodes)
  for (let i = 0; i < imageNodes.length - 1; i++) {
    if (rand() > 0.3) {
      edges.push({
        id: `edge-img-${i}`,
        source: imageNodes[i].id,
        target: imageNodes[i + 1].id,
        sourceHandle: 'output',
        targetHandle: 'input',
        type: 'smart',
        data: { dataType: 'image', status: 'idle' },
      });
    }
    // Skip connections for variety
    if (rand() > 0.7 && i + 2 < imageNodes.length) {
      edges.push({
        id: `edge-img-skip-${i}`,
        source: imageNodes[i].id,
        target: imageNodes[i + 2].id,
        sourceHandle: 'output',
        targetHandle: 'input',
        type: 'smart',
        data: { dataType: 'image', status: 'idle' },
      });
    }
  }

  // Connect text nodes to nearby image nodes
  for (let i = 0; i < textNodes.length; i++) {
    const targetIdx = Math.min(i * 10, imageNodes.length - 1);
    edges.push({
      id: `edge-txt-${i}`,
      source: textNodes[i].id,
      target: imageNodes[targetIdx].id,
      sourceHandle: 'output',
      targetHandle: 'input',
      type: 'smart',
      data: { dataType: 'text', status: 'idle' },
    });
    // Extra connection
    if (targetIdx + 1 < imageNodes.length) {
      edges.push({
        id: `edge-txt-extra-${i}`,
        source: textNodes[i].id,
        target: imageNodes[targetIdx + 1].id,
        sourceHandle: 'output',
        targetHandle: 'input',
        type: 'smart',
        data: { dataType: 'text', status: 'idle' },
      });
    }
  }

  // Connect some image nodes to video nodes
  for (let i = 0; i < videoNodes.length; i++) {
    const srcIdx = Math.min(i * 20, imageNodes.length - 1);
    edges.push({
      id: `edge-vid-${i}`,
      source: imageNodes[srcIdx].id,
      target: videoNodes[i].id,
      sourceHandle: 'output',
      targetHandle: 'input',
      type: 'smart',
      data: { dataType: 'image', status: 'idle' },
    });
  }

  return { nodes, edges };
}
