<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEFAULT_COLOR, type ProjectDto } from '@ticktaskdone/shared';
import CategoryPicker from '@/components/calendar/CategoryPicker.vue';
import ColorPicker from '@/components/ColorPicker.vue';
import ProjectSelect from './ProjectSelect.vue';

// The item's intrinsic, editable core fields — shared by the calendar form and the task
// detail so a field is defined ONCE. Occurrence/scheduling-specific bits (time, due,
// done, blocking, recurrence toggle) stay in each parent. Each field is a named model.
withDefaults(
  defineProps<{
    projects: ProjectDto[];
    showEstimate?: boolean; // hidden for events (calendar), always on for tasks
    showReminder?: boolean; // the "generates reminder" toggle — tasks only
  }>(),
  { showEstimate: true, showReminder: false },
);

const title = defineModel<string>('title', { required: true });
const projectId = defineModel<number | null>('projectId', { required: true });
const description = defineModel<string>('description', { required: true });
const categoryIds = defineModel<number[]>('categoryIds', { required: true });
const estimatedMinutes = defineModel<number | null>('estimatedMinutes', { required: true });
// null = no custom color (inherits the cascade); a hex = a deliberate custom color.
const color = defineModel<string | null>('color', { required: true });
// Whether the task surfaces overdue reminders (and is subject to auto-cancellation).
const generatesReminder = defineModel<boolean>('generatesReminder', { default: true });

const { t } = useI18n();

const hasCustomColor = computed(() => color.value !== null);
const toggleCustomColor = (on: boolean): void => {
  color.value = on ? (color.value ?? DEFAULT_COLOR) : null;
};
const setEstimate = (value: string): void => {
  estimatedMinutes.value = value === '' ? null : Math.max(1, Number(value));
};
</script>

<template>
  <div class="item-core">
    <label class="field">
      <span>{{ t('itemForm.title') }}</span>
      <input v-model="title" type="text" />
    </label>

    <label class="field">
      <span>{{ t('itemForm.project') }}</span>
      <ProjectSelect v-model="projectId" :projects="projects" :none-label="t('itemForm.projectNone')" />
    </label>

    <label class="field">
      <span>{{ t('itemForm.description') }}</span>
      <textarea v-model="description" rows="2" />
    </label>

    <div class="field">
      <span>{{ t('itemForm.categories') }}</span>
      <CategoryPicker v-model="categoryIds" />
    </div>

    <div class="row">
      <label v-if="showEstimate" class="field grow">
        <span>{{ t('itemForm.estimatedMinutes') }}</span>
        <input :value="estimatedMinutes ?? ''" type="number" min="1" step="1" @input="setEstimate(($event.target as HTMLInputElement).value)" />
      </label>
      <div class="field grow color-field">
        <label class="inline">
          <input type="checkbox" :checked="hasCustomColor" @change="toggleCustomColor(($event.target as HTMLInputElement).checked)" />
          {{ t('itemForm.customColor') }}
        </label>
        <ColorPicker v-if="hasCustomColor" v-model="color" />
        <span v-else class="hint">{{ t('itemForm.colorHint') }}</span>
      </div>
    </div>

    <label v-if="showReminder" class="inline reminder">
      <input v-model="generatesReminder" type="checkbox" />
      {{ t('itemForm.generatesReminder') }}
    </label>
  </div>
</template>

<style scoped>
.item-core {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text-muted);
}

.field input[type='text'],
.field input[type='number'],
.field textarea {
  font: inherit;
  font-size: 14px;
  color: var(--text);
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  resize: vertical;
}

.row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.grow {
  flex: 1;
  min-width: 140px;
}

.color-field {
  gap: 6px;
}

.inline {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
}

.hint {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
