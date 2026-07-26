<script setup lang="ts">
import { nextTick, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CategoryDto, ProjectDto, ProjectStatus } from '@ticktaskdone/shared';
import { projectStatuses } from '@ticktaskdone/shared';
import { createProject } from '@/api/projects';
import { errorMessage } from '@/lib/errorMessage';
import CategoryPicker from '@/components/calendar/CategoryPicker.vue';
import ColorPicker from '@/components/ColorPicker.vue';

// The mass-add entry row, isolated so typing here re-renders ONLY this row — never the
// (potentially many) existing subproject rows. That is the fix for the typing lag.
const props = defineProps<{ parentProjectId: number; categories: CategoryDto[] }>();
const emit = defineEmits<{ created: [ProjectDto]; categoriesChanged: []; error: [string] }>();

const { t } = useI18n();

const statusLabel = (status: ProjectStatus): string =>
  ({
    active: t('projects.statusActive'),
    onHold: t('projects.statusOnHold'),
    done: t('projects.statusDone'),
    cancelled: t('projects.statusCancelled'),
    archived: t('projects.statusArchived'),
  })[status];

const draft = reactive<{ name: string; status: ProjectStatus; color: string | null; categoryIds: number[] }>({
  name: '',
  status: 'active',
  color: null,
  categoryIds: [],
});
const nameRef = ref<HTMLInputElement | null>(null);
const busy = ref(false);

const commit = async (): Promise<void> => {
  const name = draft.name.trim();
  if (name === '' || busy.value) {
    return;
  }
  busy.value = true;
  let created: ProjectDto | null = null;
  try {
    created = await createProject({
      parentProjectId: props.parentProjectId,
      name,
      color: draft.color, // null = inherits its parent's color (guide §7)
      status: draft.status,
      categoryIds: [...draft.categoryIds],
    });
    emit('created', created);
  } catch (cause) {
    emit('error', errorMessage(cause));
  } finally {
    busy.value = false; // re-enable the input BEFORE refocusing (a disabled input can't take focus)
  }
  if (created) {
    draft.name = '';
    draft.status = 'active';
    draft.color = null;
    draft.categoryIds = [];
    await nextTick();
    nameRef.value?.focus(); // keep going: keyboard-only mass entry
  }
};
</script>

<template>
  <div class="grid-row entry">
    <span class="cell color">
      <ColorPicker v-model="draft.color" />
    </span>
    <input
      ref="nameRef"
      class="cell name"
      type="text"
      :placeholder="t('projectGrid.newPlaceholder')"
      :value="draft.name"
      :disabled="busy"
      @input="draft.name = ($event.target as HTMLInputElement).value"
      @keyup.enter="commit"
    />
    <select class="cell status" :value="draft.status" @change="draft.status = ($event.target as HTMLSelectElement).value as ProjectStatus">
      <option v-for="status in projectStatuses" :key="status" :value="status">{{ statusLabel(status) }}</option>
    </select>
    <span class="cell categories">
      <CategoryPicker :model-value="draft.categoryIds" :source="categories" @update:model-value="draft.categoryIds = $event" @changed="emit('categoriesChanged')" />
    </span>
    <span class="cell actions">
      <button type="button" class="icon add" :title="t('common.add')" :disabled="busy" @click="commit">+</button>
    </span>
  </div>
</template>

<style scoped>
.grid-row {
  display: grid;
  grid-template-columns: 40px minmax(140px, 1.6fr) 130px minmax(120px, 1.2fr) 64px;
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

.cell.name {
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
.cell.name:focus {
  border-color: var(--border);
  background: var(--surface);
  outline: none;
}

.cell.status {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
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
