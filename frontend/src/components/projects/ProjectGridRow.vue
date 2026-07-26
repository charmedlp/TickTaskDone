<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CategoryDto, ProjectDto, ProjectStatus } from '@ticktaskdone/shared';
import { projectStatuses } from '@ticktaskdone/shared';
import { deleteProject, updateProject } from '@/api/projects';
import { errorMessage } from '@/lib/errorMessage';
import CategoryPicker from '@/components/calendar/CategoryPicker.vue';
import ColorPicker from '@/components/ColorPicker.vue';

// One subproject row of the grid, isolated into its own component so that typing in the
// entry row (or editing a sibling) never re-renders it — its `project` prop keeps the
// same reference unless it actually changes.
const props = defineProps<{ project: ProjectDto; categories: CategoryDto[] }>();
const emit = defineEmits<{
  updated: [ProjectDto];
  deleted: [number];
  open: [number];
  error: [string];
  categoriesChanged: [];
}>();

const { t } = useI18n();

const statusLabel = (status: ProjectStatus): string =>
  ({
    active: t('projects.statusActive'),
    onHold: t('projects.statusOnHold'),
    done: t('projects.statusDone'),
    cancelled: t('projects.statusCancelled'),
    archived: t('projects.statusArchived'),
  })[status];

// Local editable draft, re-seeded only when the row's identity changes.
const draft = reactive<{ name: string; status: ProjectStatus; color: string | null; categoryIds: number[] }>({
  name: '',
  status: 'active',
  color: null,
  categoryIds: [],
});
watch(
  () => props.project.idProject,
  () => {
    draft.name = props.project.name;
    draft.status = props.project.status;
    draft.color = props.project.color;
    draft.categoryIds = [...props.project.categoryIds];
  },
  { immediate: true },
);

const busy = ref(false);
const save = async (patch: Parameters<typeof updateProject>[1]): Promise<void> => {
  busy.value = true;
  try {
    emit('updated', await updateProject(props.project.idProject, patch));
  } catch (cause) {
    emit('error', errorMessage(cause));
  } finally {
    busy.value = false;
  }
};

const saveName = (): Promise<void> => save({ name: draft.name.trim() });
const saveStatus = (): Promise<void> => save({ status: draft.status });
const saveColor = (color: string | null): Promise<void> => {
  draft.color = color;
  return save({ color });
};
const saveCategories = (ids: number[]): Promise<void> => {
  draft.categoryIds = ids;
  return save({ categoryIds: ids });
};
const removeRow = async (): Promise<void> => {
  if (!window.confirm(t('projects.confirmDelete'))) {
    return;
  }
  busy.value = true;
  try {
    await deleteProject(props.project.idProject);
    emit('deleted', props.project.idProject);
  } catch (cause) {
    emit('error', errorMessage(cause));
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <div class="grid-row" :class="{ 'is-busy': busy }">
    <span class="cell color">
      <ColorPicker :model-value="draft.color" @update:model-value="saveColor($event)" />
    </span>
    <input
      class="cell name"
      type="text"
      :value="draft.name"
      :disabled="busy"
      @change="draft.name = ($event.target as HTMLInputElement).value; saveName()"
      @keyup.enter="($event.target as HTMLInputElement).blur()"
    />
    <select
      class="cell status"
      :value="draft.status"
      :disabled="busy"
      @change="draft.status = ($event.target as HTMLSelectElement).value as ProjectStatus; saveStatus()"
    >
      <option v-for="status in projectStatuses" :key="status" :value="status">{{ statusLabel(status) }}</option>
    </select>
    <span class="cell categories">
      <CategoryPicker :model-value="draft.categoryIds" :source="categories" @update:model-value="saveCategories($event)" @changed="emit('categoriesChanged')" />
    </span>
    <span class="cell actions">
      <button type="button" class="icon" :title="t('projectGrid.open')" @click="emit('open', project.idProject)">↗</button>
      <button type="button" class="icon danger" :title="t('common.delete')" :disabled="busy" @click="removeRow">✕</button>
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
  border: 1px solid var(--border);
  border-radius: 6px;
}

.grid-row.is-busy {
  opacity: 0.6;
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
  gap: 2px;
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

.icon.danger:hover {
  color: #dc2626;
}

.icon:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
