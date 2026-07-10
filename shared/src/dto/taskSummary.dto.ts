import type { OccurrenceStatus } from '../validation/itemOccurrence.validation';

// A per-task rollup for the Projects view: enriches task rows (checkbox / due date /
// planned-vs-backlog) and feeds the project stats block (brief §2/§4). Aggregates are
// over ALL of the task's occurrences (the current user's blocks/logs). Non-recurring
// tasks expose their single occurrence's status + dueDate; recurring tasks have many
// occurrences, so those are null (a recurring task has no single status/due).
export interface TaskSummaryDto {
  itemId: number;
  projectId: number | null;
  title: string;
  isRecurrent: boolean;
  status: OccurrenceStatus | null; // the single occurrence's status (non-recurring)
  dueDate: string | null; // the single occurrence's dueDate (non-recurring)
  planned: boolean; // has at least one timeBlock (else it lives in the backlog)
  estimatedMinutes: number | null;
  plannedMinutes: number; // Σ timed block durations
  loggedMinutes: number; // Σ closed timeLog durations (real time)
}
