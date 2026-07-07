// An unscheduled task in the backlog (a non-recurrent task with no timeBlock for
// the current user). Grouped by project and sorted by dueDate on the client.
export interface BacklogTaskDto {
  itemId: number;
  title: string;
  projectId: number | null; // null = ephemeral (no real project)
  resolvedColor: string;
  estimatedMinutes: number | null;
  dueDate: string | null;
}
