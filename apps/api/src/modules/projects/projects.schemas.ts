import { z } from "zod";

export const projectIdParamsSchema = z.object({
  projectId: z.string().uuid(),
});

export const createProjectSchema = z.object({
  description: z.string().trim().max(2000).nullable().optional(),
  name: z.string().trim().min(1).max(255),
});

export const updateProjectSchema = z
  .object({
    description: z.string().trim().max(2000).nullable().optional(),
    name: z.string().trim().min(1).max(255).optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: "At least one field must be provided",
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type ProjectIdParams = z.infer<typeof projectIdParamsSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
