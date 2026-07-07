import type { ItemType } from '../validation/item.validation';

// API contract for an item. `resolvedColor` is the cascade result (item -> project
// -> default) computed server-side so the client renders without extra lookups.
export interface ItemDto {
  idItem: number;
  workspaceId: number;
  type: ItemType;
  projectId: number | null;
  title: string;
  description: string | null;
  color: string | null;
  resolvedColor: string;
  estimatedMinutes: number | null;
  rrule: string | null;
  recurrenceStart: string | null;
  categoryIds: number[]; // the stored leaves; ancestors are deduced client-side
  createdAt: string;
  updatedAt: string;
}
