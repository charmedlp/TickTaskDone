import type { OccurrenceViewDto } from '@ticktaskdone/shared';
import { workspaceId } from '@/config';
import { api } from './client';

// Calendar window feed: virtual + materialized occurrences for [from, to).
export const fetchOccurrences = (from: Date, to: Date): Promise<OccurrenceViewDto[]> =>
  api.get<OccurrenceViewDto[]>(
    `/workspaces/${workspaceId}/occurrences?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
  );
