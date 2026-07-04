import { resolveColor, type ItemDto } from '@ticktaskdone/shared';
import type { ItemWithProjectColor } from './item.service';

export const toItemDto = ({ item, projectColor }: ItemWithProjectColor): ItemDto => ({
  idItem: item.idItem,
  workspaceId: item.workspaceId,
  type: item.type,
  projectId: item.projectId,
  title: item.title,
  description: item.description,
  color: item.color,
  resolvedColor: resolveColor(item.color, projectColor),
  estimatedMinutes: item.estimatedMinutes,
  rrule: item.rrule,
  recurrenceStart: item.recurrenceStart?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});
