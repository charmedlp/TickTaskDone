import type { CreateScheduledItemInput, OccurrenceViewDto } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

// Create an item + occurrence + optional timeBlock in one transaction.
export const createScheduledItem = (input: CreateScheduledItemInput): Promise<OccurrenceViewDto> =>
  api.post<OccurrenceViewDto>(`/workspaces/${workspaceId}/scheduled-items`, input);
