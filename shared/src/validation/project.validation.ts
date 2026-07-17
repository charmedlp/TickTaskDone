import { z } from 'zod';

export const projectStatuses = ['active', 'onHold', 'done', 'cancelled', 'archived'] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

// Workspace scope comes from the URL, never the body — so it is absent here.
export const createProjectInput = z.object({
  parentProjectId: z.number().int().positive().nullable(),
  name: z.string().min(1).max(255),
  color: z.string().min(1).max(30).nullable(), // null = no own color, inherits from ancestors (§7)
  income: z.number().nonnegative().optional(),
  status: z.enum(projectStatuses).optional(),
  categoryIds: z.array(z.number().int().positive()).optional(), // stored leaves (brief §2)
});

export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const updateProjectInput = createProjectInput.partial();

export type UpdateProjectInput = z.infer<typeof updateProjectInput>;
