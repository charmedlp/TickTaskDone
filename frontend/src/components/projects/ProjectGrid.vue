<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CategoryDto, ProjectDto } from '@ticktaskdone/shared';
import ProjectGridRow from './ProjectGridRow.vue';
import ProjectGridEntry from './ProjectGridEntry.vue';

// Inline editable list of a project's DIRECT subprojects. A thin orchestrator: each row
// and the entry are isolated components (their own local state), so typing a new
// subproject re-renders ONLY the entry — never the existing rows. Deeper edits (income,
// tasks, stats) open the subproject's page. The parent is not editable here.
const props = defineProps<{ subprojects: ProjectDto[]; parentProjectId: number; categories: CategoryDto[] }>();
const emit = defineEmits<{
  created: [ProjectDto];
  updated: [ProjectDto];
  deleted: [number];
  categoriesChanged: [];
  open: [number];
  error: [string];
}>();

const { t } = useI18n();

// The rendered list, seeded only when the shown project changes; create/delete patch it
// directly. Row edits keep the same DTO reference, so sibling rows never re-render.
const rows = ref<ProjectDto[]>([]);
watch(
  () => props.parentProjectId,
  () => {
    rows.value = [...props.subprojects];
  },
  { immediate: true },
);

const onCreated = (project: ProjectDto): void => {
  rows.value = [...rows.value, project];
  emit('created', project);
};
const onUpdated = (project: ProjectDto): void => emit('updated', project); // row owns its display; just sync the parent
const onDeleted = (idProject: number): void => {
  rows.value = rows.value.filter((project) => project.idProject !== idProject);
  emit('deleted', idProject);
};
</script>

<template>
  <div class="project-grid">
    <div class="grid-head">
      <span class="col-color">{{ t('projectGrid.colColor') }}</span>
      <span>{{ t('projectGrid.colName') }}</span>
      <span>{{ t('projectGrid.colStatus') }}</span>
      <span>{{ t('projectGrid.colCategories') }}</span>
      <span class="col-actions" />
    </div>

    <ProjectGridRow
      v-for="row in rows"
      :key="row.idProject"
      :project="row"
      :categories="categories"
      @updated="onUpdated"
      @deleted="onDeleted"
      @open="emit('open', $event)"
      @error="emit('error', $event)"
      @categories-changed="emit('categoriesChanged')"
    />

    <ProjectGridEntry
      :parent-project-id="parentProjectId"
      :categories="categories"
      @created="onCreated"
      @categories-changed="emit('categoriesChanged')"
      @error="emit('error', $event)"
    />
  </div>
</template>

<style scoped>
.project-grid {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.grid-head {
  display: grid;
  grid-template-columns: 40px minmax(140px, 1.6fr) 130px minmax(120px, 1.2fr) 64px;
  align-items: center;
  gap: 8px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.col-color {
  text-align: center;
}
</style>
