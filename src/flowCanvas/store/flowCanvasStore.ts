import { create } from 'zustand';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type Node,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  type Viewport,
} from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { FlowEdgeData, FlowNodeData, FlowNodeKind } from '../types';
import { createFlowNode, duplicateFlowNode } from '../utils/nodeFactory';
import { canConnectFlowNodes, canCreateNodeFromSource } from '../rules/connectionRules';

type FlowNode = Node<FlowNodeData>;
type FlowEdge = Edge<FlowEdgeData>;

export type ActiveImageToolType =
  | 'crop'
  | 'resize'
  | 'split'
  | 'annotate'
  | 'repaint'
  | 'erase'
  | 'outpaint'
  | 'lighting'
  | 'multiAngle'
  | 'folder';

export interface ActiveImageToolState {
  nodeId: string;
  tool: ActiveImageToolType;
}

interface HistoryEntry {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowUpstreamImageRef {
  key: string;
  id: string;
  edgeId: string;
  imageUrl: string;
  title: string;
  source: 'upstream';
}

export interface FlowDerivedEditCounts {
  crop: number;
  resize: number;
  split: number;
  annotate: number;
}

export interface FlowGraphIndex {
  upstreamImageRefsByNodeId: Record<string, FlowUpstreamImageRef[]>;
  hasIncomingEdgesByNodeId: Record<string, boolean>;
  childEditCountsByNodeId: Record<string, FlowDerivedEditCounts>;
}

interface FlowProject {
  id: string;
  title: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: Viewport;
  version: number;
  updatedAt: number;
}

interface FlowCanvasState {
  projectId: string;
  projectTitle: string;
  version: number;
  isDirty: boolean;

  nodes: FlowNode[];
  edges: FlowEdge[];
  graphIndex: FlowGraphIndex;
  selectedNodeCount: number;
  viewport: Viewport;

  history: HistoryEntry[];
  historyIndex: number;

  leftPanelOpen: boolean;
  contextMenu: { x: number; y: number; nodeId?: string } | null;
  activeImageTool: ActiveImageToolState | null;
  isNodeDragging: boolean;

  onNodesChange: OnNodesChange<FlowNode>;
  onEdgesChange: OnEdgesChange<FlowEdge>;
  onConnect: OnConnect;

  addNode: (
    kind: FlowNodeKind,
    position: { x: number; y: number },
    overrides?: Partial<FlowNodeData>,
    options?: { selected?: boolean; preserveSelection?: boolean },
  ) => FlowNode;
  addNodeAndEdge: (
    kind: FlowNodeKind,
    position: { x: number; y: number },
    sourceNodeId: string,
    sourceHandle?: string,
    targetHandle?: string,
    overrides?: Partial<FlowNodeData>,
  ) => FlowNode;
  getUpstreamNodes: (nodeId: string) => FlowNode[];
  groupSelectedNodes: () => void;
  ungroupSelectedGroups: () => void;
  layoutSelectedGroup: (layout: 'grid' | 'horizontal') => void;
  deleteSelectedNodes: () => void;
  duplicateSelectedNodes: () => void;
  updateNodeData: (nodeId: string, patch: Partial<FlowNodeData>) => void;
  commitNodePositions: (nodes: FlowNode[]) => void;
  lockNode: (nodeId: string, locked: boolean) => void;
  removeEdgesByIds: (edgeIds: string[]) => void;

  deleteSelectedEdges: () => void;

  selectAll: () => void;
  deselectAll: () => void;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  setProjectTitle: (title: string) => void;
  loadProject: (project: FlowProject) => void;
  getProjectSnapshot: () => FlowProject;
  newProject: () => void;
  markDirty: () => void;
  markClean: () => void;
  setViewport: (viewport: Viewport) => void;
  setNodeDragging: (dragging: boolean) => void;

  toggleLeftPanel: () => void;
  openContextMenu: (x: number, y: number, nodeId?: string) => void;
  closeContextMenu: () => void;
  openImageTool: (nodeId: string, tool: ActiveImageToolType) => void;
  closeImageTool: () => void;
}

const MAX_HISTORY = 50;
const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

const cloneHistoryEntry = (nodes: FlowNode[], edges: FlowEdge[]): HistoryEntry => ({
  nodes: structuredClone(nodes),
  edges: structuredClone(edges),
});

const resetStaleTextGenerationNodes = (nodes: FlowNode[]) =>
  nodes.map((node) => {
    const isTextNode = node.type === 'text' || node.data?.kind === 'text';
    const isRunning = node.data?.generationStatus === 'generating' || node.data?.status === 'running';
    if (!isTextNode || !isRunning) return node;
    return {
      ...node,
      data: {
        ...node.data,
        generationStatus: 'error',
        status: 'error',
        errorMessage: '上次文本生成已中断，请重新生成',
      },
    };
  });

const EMPTY_GRAPH_INDEX: FlowGraphIndex = {
  upstreamImageRefsByNodeId: {},
  hasIncomingEdgesByNodeId: {},
  childEditCountsByNodeId: {},
};

const countSelectedNodes = (nodes: FlowNode[]) => nodes.reduce((count, node) => count + (node.selected ? 1 : 0), 0);

const createEditCounts = (): FlowDerivedEditCounts => ({
  crop: 0,
  resize: 0,
  split: 0,
  annotate: 0,
});

const buildGraphIndex = (nodes: FlowNode[], edges: FlowEdge[]): FlowGraphIndex => {
  if (nodes.length === 0 && edges.length === 0) return EMPTY_GRAPH_INDEX;

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const upstreamImageRefsByNodeId: FlowGraphIndex['upstreamImageRefsByNodeId'] = {};
  const hasIncomingEdgesByNodeId: FlowGraphIndex['hasIncomingEdgesByNodeId'] = {};
  const childEditCountsByNodeId: FlowGraphIndex['childEditCountsByNodeId'] = {};

  for (const edge of edges) {
    hasIncomingEdgesByNodeId[edge.target] = true;

    const sourceNode = nodesById.get(edge.source);
    if (
      sourceNode &&
      (sourceNode.type === 'image' || sourceNode.data.kind === 'image') &&
      sourceNode.data.thumbnailUrl
    ) {
      const refs = upstreamImageRefsByNodeId[edge.target] || [];
      refs.push({
        key: `upstream:${sourceNode.id}`,
        id: sourceNode.id,
        edgeId: edge.id,
        imageUrl: String(sourceNode.data.thumbnailUrl),
        title: String(sourceNode.data.title || '参考图'),
        source: 'upstream',
      });
      upstreamImageRefsByNodeId[edge.target] = refs;
    }

    const targetNode = nodesById.get(edge.target);
    const editType = String(targetNode?.data.lastEditType || '');
    if (!editType) continue;

    const counts = childEditCountsByNodeId[edge.source] || createEditCounts();
    if (editType === 'crop') counts.crop += 1;
    if (editType === 'resize') counts.resize += 1;
    if (editType === 'split') counts.split += 1;
    if (editType === 'annotate') counts.annotate += 1;
    childEditCountsByNodeId[edge.source] = counts;
  }

  return {
    upstreamImageRefsByNodeId,
    hasIncomingEdgesByNodeId,
    childEditCountsByNodeId,
  };
};

const shouldMarkNodeChangesDirty = (changes: Parameters<OnNodesChange<FlowNode>>[0]) =>
  changes.some((change) => {
    if (change.type === 'select') return false;
    if (change.type === 'dimensions') return false;
    if (change.type === 'position') return change.dragging !== true;
    return true;
  });

const shouldRebuildGraphIndexForNodeChanges = (changes: Parameters<OnNodesChange<FlowNode>>[0]) =>
  changes.some((change) => change.type !== 'select' && change.type !== 'position' && change.type !== 'dimensions');

const shouldRecountSelectionForNodeChanges = (changes: Parameters<OnNodesChange<FlowNode>>[0]) =>
  changes.some((change) => change.type === 'select' || change.type === 'add' || change.type === 'remove');

export const useFlowCanvasStore = create<FlowCanvasState>((set, get) => ({
  projectId: nanoid(12),
  projectTitle: '未命名项目',
  version: 1,
  isDirty: false,

  nodes: [],
  edges: [],
  graphIndex: EMPTY_GRAPH_INDEX,
  selectedNodeCount: 0,
  viewport: INITIAL_VIEWPORT,

  history: [],
  historyIndex: -1,

  leftPanelOpen: false,
  contextMenu: null,
  activeImageTool: null,
  isNodeDragging: false,

  onNodesChange: (changes) => {
    const dirty = shouldMarkNodeChangesDirty(changes);
    const rebuildGraphIndex = shouldRebuildGraphIndexForNodeChanges(changes);
    const recountSelection = shouldRecountSelectionForNodeChanges(changes);
    set((state) => {
      const nodes = applyNodeChanges(changes, state.nodes);
      return {
        nodes,
        graphIndex: rebuildGraphIndex ? buildGraphIndex(nodes, state.edges) : state.graphIndex,
        selectedNodeCount: recountSelection ? countSelectedNodes(nodes) : state.selectedNodeCount,
        isDirty: dirty ? true : state.isDirty,
      };
    });
  },

  onEdgesChange: (changes) => {
    const dirty = changes.some((change) => change.type !== 'select');
    set((state) => {
      const edges = applyEdgeChanges(changes, state.edges);
      return {
        edges,
        graphIndex: dirty ? buildGraphIndex(state.nodes, edges) : state.graphIndex,
        isDirty: dirty ? true : state.isDirty,
      };
    });
  },

  onConnect: (connection) => {
    const { nodes, edges } = get();
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (!canConnectFlowNodes(sourceNode, targetNode).ok) return;
    const duplicate = edges.some(
      (edge) =>
        edge.source === connection.source &&
        edge.target === connection.target &&
        edge.sourceHandle === connection.sourceHandle &&
        edge.targetHandle === connection.targetHandle,
    );
    if (duplicate) return;

    get().pushHistory();
    set((state) => {
      const edges = addEdge(
        {
          ...connection,
          id: nanoid(12),
          type: 'smart',
          data: { dataType: 'any' as const } satisfies FlowEdgeData,
        },
        state.edges,
      );
      return {
        edges,
        graphIndex: buildGraphIndex(state.nodes, edges),
        isDirty: true,
      };
    });
  },

  addNode: (kind, position, overrides, options) => {
    get().pushHistory();
    const node = {
      ...createFlowNode(kind, position, overrides),
      selected: !!options?.selected,
    };
    set((state) => {
      const nodes = [
        ...(options?.selected && !options?.preserveSelection
          ? state.nodes.map((item) => (item.selected ? { ...item, selected: false } : item))
          : state.nodes),
        node,
      ];
      return {
        nodes,
        graphIndex: buildGraphIndex(nodes, state.edges),
        selectedNodeCount: countSelectedNodes(nodes),
        isDirty: true,
      };
    });
    return node;
  },

  addNodeAndEdge: (kind, position, sourceNodeId, sourceHandle, targetHandle, overrides) => {
    const sourceNode = get().nodes.find((node) => node.id === sourceNodeId);
    if (!sourceNode || !canCreateNodeFromSource(sourceNode, kind)) {
      throw new Error('该节点不支持生成所选类型');
    }
    get().pushHistory();
    const node = createFlowNode(kind, position, overrides);
    const edge: FlowEdge = {
      id: nanoid(12),
      source: sourceNodeId,
      sourceHandle: sourceHandle || 'right',
      target: node.id,
      targetHandle: targetHandle || 'left',
      type: 'smart',
      data: { dataType: 'any' as const } satisfies FlowEdgeData,
    };
    set((state) => {
      const nodes = [...state.nodes, node];
      const edges = [...state.edges, edge];
      return {
        nodes,
        edges,
        graphIndex: buildGraphIndex(nodes, edges),
        isDirty: true,
      };
    });
    return node;
  },

  getUpstreamNodes: (nodeId) => {
    const { nodes, edges } = get();
    const incomingEdges = edges.filter((edge) => edge.target === nodeId);
    return incomingEdges
      .map((edge) => nodes.find((node) => node.id === edge.source))
      .filter(Boolean) as FlowNode[];
  },

  groupSelectedNodes: () => {
    const { nodes } = get();
    const selected = nodes.filter((node) => node.selected && node.type !== 'group');
    if (selected.length < 2) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    selected.forEach((node) => {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      const width = node.data?.width || 280;
      const height = node.data?.height || 180;
      maxX = Math.max(maxX, node.position.x + width);
      maxY = Math.max(maxY, node.position.y + height);
    });

    const padding = 40;
    const groupX = minX - padding;
    const groupY = minY - padding;
    const groupW = maxX - minX + padding * 2;
    const groupH = maxY - minY + padding * 2;

    const groupNode = createFlowNode('group', { x: groupX, y: groupY }, { title: '新建组' });
    groupNode.style = { width: groupW, height: groupH };
    groupNode.data.width = groupW;
    groupNode.data.height = groupH;
    groupNode.selected = true;

    const updatedSelected = selected.map((node) => ({
      ...node,
      parentId: groupNode.id,
      extent: 'parent' as const,
      position: {
        x: node.position.x - groupX,
        y: node.position.y - groupY,
      },
    }));

    get().pushHistory();
    set((state) => {
      const selectedIds = new Set(selected.map((node) => node.id));
      const otherNodes = state.nodes
        .filter((node) => !selectedIds.has(node.id))
        .map((node) => (node.selected ? { ...node, selected: false } : node));
      const nodes = [groupNode, ...otherNodes, ...updatedSelected.map((node) => ({ ...node, selected: false }))];
      return {
        nodes,
        graphIndex: buildGraphIndex(nodes, state.edges),
        selectedNodeCount: countSelectedNodes(nodes),
        isDirty: true,
      };
    });
  },

  ungroupSelectedGroups: () => {
    const { nodes } = get();
    const selectedGroups = nodes.filter((node) => node.selected && node.type === 'group');
    if (selectedGroups.length === 0) return;

    const groupById = new Map(selectedGroups.map((node) => [node.id, node]));
    const groupIds = new Set(groupById.keys());

    get().pushHistory();
    set((state) => {
      const nodes = state.nodes
        .filter((node) => !groupIds.has(node.id))
        .map((node) => {
          if (!node.parentId || !groupIds.has(node.parentId)) return node;
          const parent = groupById.get(node.parentId);
          return {
            ...node,
            parentId: undefined,
            extent: undefined,
            selected: true,
            position: {
              x: (parent?.position.x || 0) + node.position.x,
              y: (parent?.position.y || 0) + node.position.y,
            },
          };
        });
      return {
        nodes,
        graphIndex: buildGraphIndex(nodes, state.edges),
        selectedNodeCount: countSelectedNodes(nodes),
        isDirty: true,
      };
    });
  },

  layoutSelectedGroup: (layout) => {
    const { nodes } = get();
    const group = nodes.find((node) => node.selected && node.type === 'group');
    if (!group) return;
    const children = nodes.filter((node) => node.parentId === group.id);
    if (children.length === 0) return;

    const gap = 32;
    const padding = 36;
    const childSizes = children.map((node) => ({
      id: node.id,
      width: Number(node.data.width || node.measured?.width || 240),
      height: Number(node.data.height || node.measured?.height || 180),
    }));

    let positions = new Map<string, { x: number; y: number }>();
    let groupW = Number(group.data.width || group.style?.width || 600);
    let groupH = Number(group.data.height || group.style?.height || 400);

    if (layout === 'horizontal') {
      let cursorX = padding;
      let maxH = 0;
      childSizes.forEach((child) => {
        positions.set(child.id, { x: cursorX, y: padding });
        cursorX += child.width + gap;
        maxH = Math.max(maxH, child.height);
      });
      groupW = Math.max(360, cursorX - gap + padding);
      groupH = Math.max(240, maxH + padding * 2);
    } else {
      const columns = Math.ceil(Math.sqrt(children.length));
      const colWidths = Array(columns).fill(0);
      const rowHeights: number[] = [];
      childSizes.forEach((child, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        colWidths[col] = Math.max(colWidths[col], child.width);
        rowHeights[row] = Math.max(rowHeights[row] || 0, child.height);
      });
      childSizes.forEach((child, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = padding + colWidths.slice(0, col).reduce((sum, width) => sum + width + gap, 0);
        const y = padding + rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0);
        positions.set(child.id, { x, y });
      });
      groupW = Math.max(360, padding * 2 + colWidths.reduce((sum, width) => sum + width, 0) + gap * (columns - 1));
      groupH = Math.max(240, padding * 2 + rowHeights.reduce((sum, height) => sum + height, 0) + gap * (rowHeights.length - 1));
    }

    get().pushHistory();
    set((state) => {
      const nodes = state.nodes.map((node) => {
        if (node.id === group.id) {
          return { ...node, data: { ...node.data, width: groupW, height: groupH, updatedAt: Date.now() }, style: { ...node.style, width: groupW, height: groupH } };
        }
        const nextPosition = positions.get(node.id);
        return nextPosition ? { ...node, position: nextPosition } : node;
      });
      return {
        nodes,
        graphIndex: buildGraphIndex(nodes, state.edges),
        isDirty: true,
      };
    });
  },

  deleteSelectedNodes: () => {
    const selectedIds = new Set(get().nodes.filter((node) => node.selected).map((node) => node.id));
    if (selectedIds.size === 0) return;
    get().pushHistory();
    set((state) => {
      const nodes = state.nodes.filter((node) => !selectedIds.has(node.id));
      const edges = state.edges.filter((edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target));
      return {
        nodes,
        edges,
        graphIndex: buildGraphIndex(nodes, edges),
        selectedNodeCount: countSelectedNodes(nodes),
        activeImageTool: state.activeImageTool && selectedIds.has(state.activeImageTool.nodeId) ? null : state.activeImageTool,
        isDirty: true,
      };
    });
  },

  duplicateSelectedNodes: () => {
    const selected = get().nodes.filter((node) => node.selected);
    if (selected.length === 0) return;
    get().pushHistory();
    const newNodes = selected.map((node) => duplicateFlowNode(node));
    set((state) => {
      const nodes = [
        ...state.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
        ...newNodes.map((node) => ({ ...node, selected: true })),
      ];
      return {
        nodes,
        graphIndex: buildGraphIndex(nodes, state.edges),
        selectedNodeCount: countSelectedNodes(nodes),
        isDirty: true,
      };
    });
  },

  updateNodeData: (nodeId, patch) => {
    set((state) => {
      const nodes = state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...patch, updatedAt: Date.now() } }
          : node,
      );
      return {
        nodes,
        graphIndex: buildGraphIndex(nodes, state.edges),
        isDirty: true,
      };
    });
  },

  commitNodePositions: (nextNodes) => {
    const positionById = new Map(nextNodes.map((node) => [node.id, node]));
    set((state) => {
      let changed = false;
      const nodes = state.nodes.map((node) => {
        const next = positionById.get(node.id);
        if (!next) return node;
        const positionChanged =
          node.position.x !== next.position.x ||
          node.position.y !== next.position.y ||
          node.parentId !== next.parentId ||
          node.extent !== next.extent;
        const selectedChanged = !!node.selected !== !!next.selected;
        if (!positionChanged && !selectedChanged) return node;
        changed = true;
        return {
          ...node,
          position: next.position,
          positionAbsolute: next.positionAbsolute,
          parentId: next.parentId,
          extent: next.extent,
          selected: next.selected,
        };
      });
      if (!changed) return state;
      return {
        nodes,
        selectedNodeCount: countSelectedNodes(nodes),
        isDirty: true,
      };
    });
  },

  lockNode: (nodeId, locked) => {
    set((state) => {
      const nodes = state.nodes.map((node) =>
        node.id === nodeId ? { ...node, draggable: !locked, data: { ...node.data, locked } } : node,
      );
      return {
        nodes,
        graphIndex: buildGraphIndex(nodes, state.edges),
        isDirty: true,
      };
    });
  },

  removeEdgesByIds: (edgeIds) => {
    if (edgeIds.length === 0) return;
    const idSet = new Set(edgeIds);
    get().pushHistory();
    set((state) => {
      const edges = state.edges.filter((edge) => !idSet.has(edge.id));
      return {
        edges,
        graphIndex: buildGraphIndex(state.nodes, edges),
        isDirty: true,
      };
    });
  },

  deleteSelectedEdges: () => {
    const hasSelected = get().edges.some((edge) => edge.selected);
    if (!hasSelected) return;
    get().pushHistory();
    set((state) => {
      const edges = state.edges.filter((edge) => !edge.selected);
      return {
        edges,
        graphIndex: buildGraphIndex(state.nodes, edges),
        isDirty: true,
      };
    });
  },

  selectAll: () => {
    set((state) => {
      const nodes = state.nodes.map((node) => ({ ...node, selected: true }));
      return {
        nodes,
        selectedNodeCount: nodes.length,
        edges: state.edges.map((edge) => ({ ...edge, selected: true })),
      };
    });
  },

  deselectAll: () => {
    set((state) => ({
      nodes: state.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
      selectedNodeCount: 0,
      edges: state.edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
    }));
  },

  pushHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const trimmed = history.slice(0, historyIndex + 1);
    const next = [...trimmed, cloneHistoryEntry(nodes, edges)];
    if (next.length > MAX_HISTORY) next.shift();
    set({ history: next, historyIndex: next.length - 1 });
  },

  undo: () => {
    const { historyIndex, history } = get();
    if (historyIndex <= 0) return;
    const previous = history[historyIndex - 1];
    if (!previous) return;
    set({
      nodes: structuredClone(previous.nodes),
      edges: structuredClone(previous.edges),
      graphIndex: buildGraphIndex(previous.nodes, previous.edges),
      selectedNodeCount: countSelectedNodes(previous.nodes),
      historyIndex: historyIndex - 1,
      activeImageTool: null,
      isDirty: true,
    });
  },

  redo: () => {
    const { historyIndex, history } = get();
    if (historyIndex >= history.length - 1) return;
    const next = history[historyIndex + 1];
    if (!next) return;
    set({
      nodes: structuredClone(next.nodes),
      edges: structuredClone(next.edges),
      graphIndex: buildGraphIndex(next.nodes, next.edges),
      selectedNodeCount: countSelectedNodes(next.nodes),
      historyIndex: historyIndex + 1,
      activeImageTool: null,
      isDirty: true,
    });
  },

  setProjectTitle: (title) => set({ projectTitle: title, isDirty: true }),

  loadProject: (project) => {
    const nodes = resetStaleTextGenerationNodes(project.nodes || []);
    const edges = project.edges || [];
    set({
      projectId: project.id,
      projectTitle: project.title || '未命名项目',
      nodes,
      edges,
      graphIndex: buildGraphIndex(nodes, edges),
      selectedNodeCount: countSelectedNodes(nodes),
      viewport: project.viewport || INITIAL_VIEWPORT,
      version: project.version || 1,
      isDirty: false,
      history: [],
      historyIndex: -1,
      contextMenu: null,
      activeImageTool: null,
      isNodeDragging: false,
    });
  },

  getProjectSnapshot: () => {
    const { projectId, projectTitle, nodes, edges, viewport, version } = get();
    return {
      id: projectId,
      title: projectTitle,
      nodes,
      edges,
      viewport,
      version,
      updatedAt: Date.now(),
    };
  },

  newProject: () => {
    set({
      projectId: nanoid(12),
      projectTitle: '未命名项目',
      nodes: [],
      edges: [],
      graphIndex: EMPTY_GRAPH_INDEX,
      selectedNodeCount: 0,
      viewport: INITIAL_VIEWPORT,
      version: 1,
      isDirty: false,
      history: [],
      historyIndex: -1,
      contextMenu: null,
      activeImageTool: null,
      isNodeDragging: false,
    });
  },

  markDirty: () => set((state) => (state.isDirty ? state : { isDirty: true })),
  markClean: () => set({ isDirty: false, version: get().version + 1 }),
  setViewport: (viewport) => set({ viewport }),
  setNodeDragging: (dragging) => set((state) => (state.isNodeDragging === dragging ? state : { isNodeDragging: dragging })),

  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  openContextMenu: (x, y, nodeId) => set({ contextMenu: { x, y, nodeId }, activeImageTool: null }),
  closeContextMenu: () => set({ contextMenu: null }),
  openImageTool: (nodeId, tool) => set({ activeImageTool: { nodeId, tool }, contextMenu: null }),
  closeImageTool: () => set({ activeImageTool: null }),
}));
