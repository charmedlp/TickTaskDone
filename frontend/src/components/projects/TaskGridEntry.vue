<script setup lang="ts">
import { nextTick, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { createItem } from '@/api/items';
import { materializeOccurrence, updateOccurrence } from '@/api/occurrenceActions';
import { fromDateInputValue } from '@/lib/datetime';
import { errorMessage } from '@/lib/errorMessage';

// The mass-add entry row for ONE group. Isolated so typing here re-renders only this row
// (never the group's task rows) and so each group carries its own draft — pressing Enter
// keeps the focus in the SAME group's entry. The group's context (subproject, category,
// due date) is applied automatically on create; deeper edits go through the task row.
const props = defineProps<{
  projectId: number | null; // the task's owner project (a subproject, or the current project)
  categoryIds: number[]; // pre-assigned category (when grouping by category)
  dueDate: string | null; // yyyy-mm-dd pre-assigned due date (when grouping by date/week/month)
  gridColumns: string;
  showSubproject: boolean;
}>();
const emit = defineEmits<{ created: []; error: [string] }>();

const { t } = useI18n();

const draft = reactive<{ title: string; estimatedMinutes: number | null }>({ title: '', estimatedMinutes: null });
const nameRef = ref<HTMLInputElement | null>(null);
const busy = ref(false);

const commit = async (): Promise<void> => {
  const title = draft.title.trim();
  if (title === '' || busy.value) {
    return;
  }
  busy.value = true;
  let ok = false;
  try {
    const created = await createItem({
      type: 'task',
      projectId: props.projectId,
      title,
      description: null,
      color: null,
      estimatedMinutes: draft.estimatedMinutes,
      rrule: null,
      recurrenceStart: null,
      timezone: null,
      categoryIds: [...props.categoryIds],
    });
    if (props.dueDate) {
      const occurrence = await materializeOccurrence(created.idItem, { occurrenceDate: null });
      await updateOccurrence(created.idItem, occurrence.idItemOccurrence, { dueDate: fromDateInputValue(props.dueDate) });
    }
    ok = true;
    emit('created');
  } catch (cause) {
    emit('error', errorMessage(cause));
  } finally {
    busy.value = false; // re-enable before refocusing (a disabled input can't take focus)
  }
  if (ok) {
    draft.title = '';
    draft.estimatedMinutes = null;
    await nextTick();
    nameRef.value?.focus(); // keyboard-only mass entry, staying in this group
  }
};
</script>

<template>
  <div class="grid-row entry" :style="{ gridTemplateColumns: gridColumns }">
    <span class="cell" />
    <input
      ref="nameRef"
      class="cell name"
      type="text"
      :placeholder="t('grid.newTaskPlaceholder')"
      :value="draft.title"
      :disabled="busy"
      @input="draft.title = ($event.target as HTMLInputElement).value"
      @keyup.enter="commit"
    />
    <span class="cell" />
    <input
      class="cell estimate"
      type="number"
      min="1"
      step="1"
      :value="draft.estimatedMinutes ?? ''"
      :disabled="busy"
      @input="draft.estimatedMinutes = ($event.target as HTMLInputElement).value === '' ? null : Math.max(1, Number(($event.target as HTMLInputElement).value))"
      @keyup.enter="commit"
    />
    <span class="cell" />
    <span v-if="showSubproject" class="cell" />
    <span class="cell actions">
      <button type="button" class="icon add" :title="t('common.add')" :disabled="busy" @click="commit">+</button>
    </span>
  </div>
</template>

<style scoped>
.grid-row {
  display: grid;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface) 60%, transparent);
}

.cell {
  min-width: 0;
}

.cell.name,
.cell.estimate {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
}

.cell.name::placeholder {
  color: var(--text-muted);
}

.cell.name:hover,
.cell.estimate:hover,
.cell.name:focus,
.cell.estimate:focus {
  border-color: var(--border);
  background: var(--surface);
  outline: none;
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.icon {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 14px;
  padding: 3px 5px;
  border-radius: 5px;
}

.icon:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.icon:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
