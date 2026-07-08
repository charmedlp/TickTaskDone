import type { TimeLogSource } from '../validation/timeLog.validation';

// API contract for a real time entry (timeLog). Belongs to a user. `endedAt` is null
// while a timer segment is still running.
export interface TimeLogDto {
  idTimeLog: number;
  itemOccurrenceId: number;
  userId: number;
  startedAt: string;
  endedAt: string | null;
  source: TimeLogSource;
  timezone: string | null; // IANA id of the capture timezone
  createdAt: string;
  updatedAt: string;
}
