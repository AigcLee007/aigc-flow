import { FlowGraph, WorkflowGraphValidationError, validateGraph } from "./graph-schema.js";

export function topologicalSort(graph: FlowGraph): string[] {
  validateGraph(graph);

  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const nodeOrder = new Map<string, number>();

  for (const [index, node] of graph.nodes.entries()) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
    nodeOrder.set(node.id, index);
  }

  for (const edge of graph.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const queue = graph.nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);

  const sorted: string[] = [];
  while (queue.length > 0) {
    queue.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));
    const current = queue.shift();
    if (!current) {
      break;
    }

    sorted.push(current);
    for (const dependent of outgoing.get(current) ?? []) {
      const nextIndegree = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(dependent);
      }
    }
  }

  if (sorted.length !== graph.nodes.length) {
    throw new WorkflowGraphValidationError("Graph must not contain a cycle");
  }

  return sorted;
}
