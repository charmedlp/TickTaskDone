import { z } from 'zod';

// Replaces the full set of categories assigned to an item (n-to-n itemCategory).
export const setItemCategoriesInput = z.object({
  categoryIds: z.array(z.number().int().positive()),
});

export type SetItemCategoriesInput = z.infer<typeof setItemCategoriesInput>;
