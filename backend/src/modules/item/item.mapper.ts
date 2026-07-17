import type { ItemDto } from '@ticktaskdone/shared';
import type { ItemWithColor } from './item.service';

export const toItemDto = ({ item, resolvedColor, categoryIds }: ItemWithColor): ItemDto => ({
  idItem: item.idItem,
  workspaceId: item.workspaceId,
  type: item.type,
  projectId: item.projectId,
  title: item.title,
  description: item.description,
  color: item.color,
  resolvedColor,
  estimatedMinutes: item.estimatedMinutes,
  rrule: item.rrule,
  recurrenceStart: item.recurrenceStart?.toISOString() ?? null,
  timezone: item.timezone,
  categoryIds,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});
