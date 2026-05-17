import { z } from "zod";

export const auditLogsQuerySchema = z.object({
  action: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  resourceId: z.string().trim().min(1).optional(),
  resourceType: z.string().trim().min(1).optional(),
});

export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
