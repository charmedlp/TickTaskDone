import type { ItemType, UpdateItemInput } from '@ticktaskdone/shared';
import type { RecurrenceModel } from '@/lib/recurrenceModel';

// Seed used to open the create/edit form pre-filled.
export interface FormSeed {
  mode: 'create' | 'edit';
  timeStart: Date;
  timeEnd: Date;
  idItem?: number;
  idItemOccurrence?: number | null;
  timeBlockId?: number | null;
  type: ItemType;
  title: string;
  projectId: number | null;
  description: string | null;
  color: string | null;
  estimatedMinutes: number | null;
  dueDate: Date | null;
  isBlocking: boolean;
  allDay: boolean;
  recurrence: RecurrenceModel;
  categoryIds: number[];
}

// Emitted when the form schedules an EXISTING item (no new item created): only
// occurrence/timeBlock data. The caller materializes + places it.
export interface ScheduleSubmit {
  itemId: number;
  isRecurrent: boolean;
  timeStart: Date;
  timeEnd: Date;
  allDay: boolean;
  isBlocking: boolean;
  dueDate: Date | null;
  timezone: string | null;
}

// Normalized edit payload emitted by the form; the caller applies the parts that
// exist (item fields — including categoryIds — always; occurrence dueDate and block
// flags when materialized).
export interface UpdateSubmit {
  idItem: number;
  item: UpdateItemInput;
  idItemOccurrence: number | null;
  dueDate: Date | null;
  timeBlockId: number | null;
  // New block bounds (editable in the edit form); null when there is no block.
  timeStart: Date | null;
  timeEnd: Date | null;
  allDay: boolean;
  isBlocking: boolean;
  timezone: string | null; // block tz (null when all-day)
}
