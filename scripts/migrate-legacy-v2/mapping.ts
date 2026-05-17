import { createHash } from "node:crypto";

import { checksumGraph, compileGraph, type FlowGraph } from "../../packages/workflow-core/src/index.ts";

import type {
  LegacyFlowProjectRecord,
  ProjectMigrationPlan,
} from "./types.ts";

const NAMESPACE = "aigc-flow-v2-legacy-migration";

function stableDigest(parts: string[]): Buffer {
  return createHash("sha256").update(parts.join("::")).digest();
}

export function stableUuid(kind: string, legacyKey: string): string {
  const digest = stableDigest([NAMESPACE, kind, legacyKey]);
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function buildLegacyFlowKey(project: LegacyFlowProjectRecord): string {
  return `flow:${project.id}`;
}

export function normalizeGraph(project: LegacyFlowProjectRecord): FlowGraph {
  return {
    edges: Array.isArray(project.edges) ? (project.edges as FlowGraph["edges"]) : [],
    nodes: Array.isArray(project.nodes) ? (project.nodes as FlowGraph["nodes"]) : [],
    viewport:
      project.viewport && typeof project.viewport === "object" && !Array.isArray(project.viewport)
        ? project.viewport
        : {},
  };
}

export function buildProjectMigrationPlan(project: LegacyFlowProjectRecord): ProjectMigrationPlan {
  const graph = normalizeGraph(project);
  const checksum = checksumGraph(graph);
  const projectId = stableUuid("project", project.id);
  const flowId = stableUuid("flow", buildLegacyFlowKey(project));
  const flowVersionId = stableUuid("flow-version", `${buildLegacyFlowKey(project)}:${checksum}`);

  try {
    const compiledGraph = compileGraph(graph);
    return {
      checksum,
      compileError: null,
      compiledGraph: compiledGraph as unknown as Record<string, unknown>,
      flowId,
      flowVersionId,
      graph: graph as unknown as Record<string, unknown>,
      legacyProjectId: project.id,
      legacyUserId: project.userId ?? null,
      projectId,
      title: String(project.title || "").trim() || `Legacy Flow ${project.id}`,
      updatedAt: project.updatedAt ?? project.createdAt ?? null,
    };
  } catch (error) {
    return {
      checksum,
      compileError: error instanceof Error ? error.message : "Graph compilation failed",
      compiledGraph: null,
      flowId,
      flowVersionId,
      graph: graph as unknown as Record<string, unknown>,
      legacyProjectId: project.id,
      legacyUserId: project.userId ?? null,
      projectId,
      title: String(project.title || "").trim() || `Legacy Flow ${project.id}`,
      updatedAt: project.updatedAt ?? project.createdAt ?? null,
    };
  }
}
