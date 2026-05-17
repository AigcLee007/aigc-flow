import { describe, expect, test } from "vitest";

import {
  checksumGraph,
  compileGraph,
  topologicalSort,
  validateGraph,
  WorkflowGraphValidationError,
  type FlowGraph,
} from "../src/index.js";

function createValidGraph(): FlowGraph {
  return {
    edges: [
      { source: "input", target: "generate" },
      { source: "generate", target: "output" },
    ],
    nodes: [
      { id: "input", type: "input", data: { prompt: "hello" } },
      { id: "generate", type: "text.generate", data: { model: "demo" } },
      { id: "output", type: "output" },
    ],
    viewport: { x: 10, y: 20, zoom: 1.2 },
  };
}

describe("@aigc-flow/workflow-core", () => {
  test("valid graph compile succeeds", () => {
    const compiled = compileGraph(createValidGraph());
    expect(compiled.schemaVersion).toBe("v2");
    expect(compiled.entryNodeIds).toEqual(["input"]);
    expect(compiled.outputNodeIds).toEqual(["output"]);
    expect(compiled.nodes).toEqual([
      {
        config: { prompt: "hello" },
        dependencies: [],
        dependents: ["generate"],
        id: "input",
        type: "input",
      },
      {
        config: { model: "demo" },
        dependencies: ["input"],
        dependents: ["output"],
        id: "generate",
        type: "text.generate",
      },
      {
        config: {},
        dependencies: ["generate"],
        dependents: [],
        id: "output",
        type: "output",
      },
    ]);
  });

  test("duplicate node id fails", () => {
    const graph = createValidGraph();
    graph.nodes.push({ id: "input", type: "duplicate" });
    expect(() => validateGraph(graph)).toThrowError(WorkflowGraphValidationError);
  });

  test("edge referencing missing node fails", () => {
    const graph = createValidGraph();
    graph.edges.push({ source: "missing", target: "output" });
    expect(() => validateGraph(graph)).toThrow("Edge source does not exist: missing");
  });

  test("self-loop fails", () => {
    const graph = createValidGraph();
    graph.edges.push({ source: "generate", target: "generate" });
    expect(() => validateGraph(graph)).toThrow("Self-loop is not allowed");
  });

  test("cycle fails", () => {
    const graph = createValidGraph();
    graph.edges.push({ source: "output", target: "input" });
    expect(() => topologicalSort(graph)).toThrow("Graph must not contain a cycle");
  });

  test("topological sort is correct", () => {
    expect(topologicalSort(createValidGraph())).toEqual(["input", "generate", "output"]);
  });

  test("checksum is stable for equivalent graph objects", () => {
    const first: FlowGraph = {
      edges: [
        {
          id: "edge-a",
          source: "a",
          sourceHandle: "out",
          target: "b",
          targetHandle: "in",
        },
      ],
      nodes: [
        {
          data: {
            alpha: 1,
            nested: {
              x: true,
              y: "z",
            },
          },
          id: "a",
          type: "input",
        },
        {
          data: {
            beta: 2,
          },
          id: "b",
          type: "output",
        },
      ],
      viewport: {
        x: 1,
        y: 2,
        zoom: 1,
      },
    };

    const second: FlowGraph = {
      edges: [
        {
          id: "edge-a",
          source: "a",
          sourceHandle: "out",
          target: "b",
          targetHandle: "in",
        },
      ],
      nodes: [
        {
          data: {
            nested: {
              y: "z",
              x: true,
            },
            alpha: 1,
          },
          id: "a",
          type: "input",
        },
        {
          data: {
            beta: 2,
          },
          id: "b",
          type: "output",
        },
      ],
      viewport: {
        zoom: 1,
        y: 2,
        x: 1,
      },
    };

    expect(checksumGraph(first)).toBe(checksumGraph(second));
  });
});
