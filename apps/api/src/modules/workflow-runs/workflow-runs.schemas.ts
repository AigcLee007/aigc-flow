import { z } from "zod";

export const flowIdParamsSchema = z.object({
  flowId: z.string().uuid(),
});

export const runIdParamsSchema = z.object({
  runId: z.string().uuid(),
});

export const createWorkflowRunSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});

export const workflowRunEventsQuerySchema = z.object({
  afterSequence: z.coerce.number().int().nonnegative().optional(),
});

export type CreateWorkflowRunInput = z.infer<typeof createWorkflowRunSchema>;
export type FlowIdParams = z.infer<typeof flowIdParamsSchema>;
export type RunIdParams = z.infer<typeof runIdParamsSchema>;
export type WorkflowRunEventsQuery = z.infer<typeof workflowRunEventsQuerySchema>;
