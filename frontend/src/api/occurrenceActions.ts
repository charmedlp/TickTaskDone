import type {
  ItemOccurrenceDto,
  MaterializeOccurrenceInput,
  MoveOccurrenceInput,
  OccurrenceViewDto,
  ScheduleOccurrenceInput,
  SetOccurrenceStatusInput,
  TimeBlockDto,
  UpdateItemOccurrenceInput,
} from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

// Find-or-create the slot's occurrence (no other change), returning it. Used by the
// timer to obtain a concrete occurrence id before logging real time on a virtual slot.
export const materializeOccurrence = (
  itemId: number,
  input: MaterializeOccurrenceInput,
): Promise<ItemOccurrenceDto> =>
  api.post<ItemOccurrenceDto>(`/workspaces/${workspaceId}/items/${itemId}/occurrences/materialize`, input);

// Schedule an existing item: materialize + ADD a block (split, or new custom
// occurrence for a recurrent item). Returns the assembled occurrence view.
export const scheduleOccurrence = (itemId: number, input: ScheduleOccurrenceInput): Promise<OccurrenceViewDto> =>
  api.post<OccurrenceViewDto>(`/workspaces/${workspaceId}/items/${itemId}/occurrences/schedule`, input);

export const updateOccurrence = (
  itemId: number,
  idItemOccurrence: number,
  input: UpdateItemOccurrenceInput,
): Promise<ItemOccurrenceDto> =>
  api.patch<ItemOccurrenceDto>(
    `/workspaces/${workspaceId}/items/${itemId}/occurrences/${idItemOccurrence}`,
    input,
  );

export const setOccurrenceStatus = (
  itemId: number,
  input: SetOccurrenceStatusInput,
): Promise<ItemOccurrenceDto> =>
  api.post<ItemOccurrenceDto>(`/workspaces/${workspaceId}/items/${itemId}/occurrences/status`, input);

export interface MoveOccurrenceResult {
  occurrence: ItemOccurrenceDto;
  timeBlocks: TimeBlockDto[];
}

export const moveOccurrence = (itemId: number, input: MoveOccurrenceInput): Promise<MoveOccurrenceResult> =>
  api.post<MoveOccurrenceResult>(`/workspaces/${workspaceId}/items/${itemId}/occurrences/move`, input);
