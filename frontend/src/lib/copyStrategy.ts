import type { ItemType, OccurrenceStatus } from '@ticktaskdone/shared';

// ALT-copy / "Duplicate" decision tree (brief §2), evaluated in this exact order.
// The gesture never depends on the drop distance, only on the source's
// type / status / recurrence / project.
export type CopyStrategy =
  | 'simpleCopy' // new item (event, or closed/ephemeral task) with its own occurrence + block
  | 'customOccurrence' // recurrent task: one extra off-rule instance at the destination
  | 'split'; // active non-recurrent project task: one more timeBlock on the same occurrence

export interface CopySource {
  type: ItemType;
  status: OccurrenceStatus;
  isRecurrent: boolean;
  projectId: number | null; // null = ephemeral (no real project)
}

export const resolveCopyStrategy = (source: CopySource): CopyStrategy => {
  // 1. An event (recurrent or not) -> simple copy.
  if (source.type === 'event') {
    return 'simpleCopy';
  }
  // 2. A done/cancelled non-recurrent task -> simple copy (do not reopen a closed chapter).
  if (!source.isRecurrent && (source.status === 'done' || source.status === 'cancelled')) {
    return 'simpleCopy';
  }
  // 3. A recurrent task -> one extra custom occurrence off the recurrence rule.
  if (source.isRecurrent) {
    return 'customOccurrence';
  }
  // 4. An ephemeral non-recurrent task -> simple copy (ephemerals do not split).
  if (source.projectId === null) {
    return 'simpleCopy';
  }
  // 5. An active non-recurrent project task -> split (another block on the same occurrence).
  return 'split';
};
