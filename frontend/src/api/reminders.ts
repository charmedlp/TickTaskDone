import type { ReminderDto } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

// Overdue reminders: TASK occurrences still todo whose effective deadline has passed.
export const fetchReminders = (): Promise<ReminderDto[]> =>
  api.get<ReminderDto[]>(`/workspaces/${workspaceId}/reminders`);
