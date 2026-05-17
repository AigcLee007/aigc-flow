export type FlowGraphNode = {
  data?: Record<string, unknown>;
  id: string;
  type: string;
};

export type FlowGraphEdge = {
  id?: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
};

export type FlowGraph = {
  edges: FlowGraphEdge[];
  nodes: FlowGraphNode[];
  viewport?: Record<string, unknown>;
};

export type CompiledWorkflowNode = {
  config: Record<string, unknown>;
  dependencies: string[];
  dependents: string[];
  id: string;
  type: string;
};

export type CompiledWorkflowEdge = {
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
};

export type CompiledWorkflow = {
  edges: CompiledWorkflowEdge[];
  entryNodeIds: string[];
  nodes: CompiledWorkflowNode[];
  outputNodeIds: string[];
  schemaVersion: "v2";
};

export class WorkflowGraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowGraphValidationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateGraph(graph: FlowGraph): FlowGraph {
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new WorkflowGraphValidationError("Graph must contain at least one node");
  }

  if (!Array.isArray(graph.edges)) {
    throw new WorkflowGraphValidationError("Graph edges must be an array");
  }

  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node?.id || typeof node.id !== "string") {
      throw new WorkflowGraphValidationError("Each node must have a string id");
    }
    if (nodeIds.has(node.id)) {
      throw new WorkflowGraphValidationError(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
    if (!node.type || typeof node.type !== "string") {
      throw new WorkflowGraphValidationError(`Node ${node.id} must have a string type`);
    }
    if (node.data !== undefined && !isPlainObject(node.data)) {
      throw new WorkflowGraphValidationError(`Node ${node.id} data must be an object when provided`);
    }
  }

  for (const edge of graph.edges) {
    if (!edge?.source || !edge?.target) {
      throw new WorkflowGraphValidationError("Each edge must declare source and target");
    }
    if (!nodeIds.has(edge.source)) {
      throw new WorkflowGraphValidationError(`Edge source does not exist: ${edge.source}`);
    }
    if (!nodeIds.has(edge.target)) {
      throw new WorkflowGraphValidationError(`Edge target does not exist: ${edge.target}`);
    }
    if (edge.source === edge.target) {
      throw new WorkflowGraphValidationError(`Self-loop is not allowed for node: ${edge.source}`);
    }
  }

  return graph;
}
