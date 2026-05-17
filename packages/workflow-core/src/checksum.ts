import { createHash } from "node:crypto";

import type { FlowGraph, FlowGraphEdge, FlowGraphNode } from "./graph-schema.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = stableValue((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }

  return value;
}

function normalizeNode(node: FlowGraphNode) {
  return {
    data: stableValue(node.data ?? {}),
    id: node.id,
    type: node.type,
  };
}

function normalizeEdge(edge: FlowGraphEdge) {
  return {
    id: edge.id ?? null,
    source: edge.source,
    sourceHandle: edge.sourceHandle ?? null,
    target: edge.target,
    targetHandle: edge.targetHandle ?? null,
  };
}

export function checksumGraph(graph: FlowGraph): string {
  const normalized = {
    edges: graph.edges
      .map((edge) => normalizeEdge(edge))
      .sort((left, right) =>
        `${left.source}:${left.sourceHandle ?? ""}->${left.target}:${left.targetHandle ?? ""}:${left.id ?? ""}`.localeCompare(
          `${right.source}:${right.sourceHandle ?? ""}->${right.target}:${right.targetHandle ?? ""}:${right.id ?? ""}`,
        ),
      ),
    nodes: graph.nodes
      .map((node) => normalizeNode(node))
      .sort((left, right) => left.id.localeCompare(right.id)),
    viewport: stableValue(graph.viewport ?? {}),
  };

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
