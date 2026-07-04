import { z } from 'zod';

// Workspace scope comes from the URL, never the body — so it is absent here.
export const createCategoryInput = z.object({
  parentCategoryId: z.number().int().positive().nullable(),
  name: z.string().min(1).max(255),
  color: z.string().min(1).max(30),
});

export type CreateCategoryInput = z.infer<typeof createCategoryInput>;

export const updateCategoryInput = createCategoryInput.partial();

export type UpdateCategoryInput = z.infer<typeof updateCategoryInput>;
