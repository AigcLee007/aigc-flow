// @vitest-environment node

import { describe, expect, test } from "vitest";

import { buildProjectMigrationPlan, stableUuid } from "../mapping.ts";

describe("legacy migration mapping", () => {
  test("stable ids stay deterministic", () => {
    expect(stableUuid("project", "legacy-project-1")).toBe(stableUuid("project", "legacy-project-1"));
    expect(stableUuid("project", "legacy-project-1")).not.toBe(stableUuid("project", "legacy-project-2"));
  });

  test("project migration plan compiles valid graphs and keeps stable version ids", () => {
    const plan = buildProjectMigrationPlan({
      edges: [{ source: "a", target: "b" }],
      id: "legacy-project-1",
      nodes: [
        { id: "a", type: "input", data: {} },
        { id: "b", type: "output", data: {} },
      ],
      title: "Legacy Project",
      viewport: { x: 0, y: 0, zoom: 1 },
    });

    expect(plan.compileError).toBeNull();
    expect(plan.compiledGraph).toMatchObject({
      entryNodeIds: ["a"],
      outputNodeIds: ["b"],
      schemaVersion: "v2",
    });
    expect(plan.flowVersionId).toBe(buildProjectMigrationPlan({
      edges: [{ source: "a", target: "b" }],
      id: "legacy-project-1",
      nodes: [
        { id: "a", type: "input", data: {} },
        { id: "b", type: "output", data: {} },
      ],
      title: "Legacy Project",
      viewport: { x: 0, y: 0, zoom: 1 },
    }).flowVersionId);
  });
});
