import { z } from "zod";

export const billingListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  page: z.coerce.number().int().positive().optional(),
});

export type BillingListQuery = z.infer<typeof billingListQuerySchema>;
