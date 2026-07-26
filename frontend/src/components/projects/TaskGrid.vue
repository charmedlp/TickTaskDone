<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CategoryDto, ItemDto, OccurrenceStatus, ProjectDto, TaskSummaryDto } from '@ticktaskdone/shared';
import { deleteItem, updateItem } from '@/api/items';
import { materializeOccurrence, setOccurrenceStatus, updateOccurrence } from '@/api/occurrenceActions';
import { addDays, fromDateInputValue, startOfMonth, startOfWeek, toDateInputValue } from '@/lib/datetime';
import { formatDayHeader, formatFullDay, formatMonthTitle } from '@/lib/format';
import { errorMessage } from '@/lib/errorMessage';
import CategoryPicker from '@/components/calendar/CategoryPicker.vue';
import ProjectSelect from './ProjectSelect.vue';
import TaskGridEntry from './TaskGridEntry.vue';

// A spreadsheet-like editable list of tasks (functionally, not a visual table): each
// cell edits inline and autosaves on commit. The user chooses how the list is grouped
// (subproject, date/week/month, category, or none) and sorted; each group carries its own
// mass-add entry so Enter keeps focus in that group and new tasks inherit its context.
// Deep edits (recurrence, description, planned moments) go to the task detail.
const props = defineProps<{
  tasks: ItemDto[];
  summaryByItem: Map<number, TaskSummaryDto>;
  projects: ProjectDto[];
  categories: CategoryDto[];
  currentProjectId: number | null; // the grid's project (null = Task List)
  showSubproject: boolean; // true when the project has descendants
}>();
const emit = defineEmits<{ changed: []; open: [number]; error: [string] }>();

const { t } = useI18n();

interface Row {
  idItem: number;
  title: string;
  projectId: number | null;
  estimatedMinutes: number | null;
  categoryIds: number[];
  isRecurrent: boolean;
  status: OccurrenceStatus | null; // single-occurrence status (non-recurring)
  dueDateInput: string; // yyyy-mm-dd for <input type=date>
  planned: boolean;
  createdAt: string; // ISO — used by the "date added" sort
  busy: boolean;
}

// Local editable copy — re-seeded when the parent reloads (after structural changes).
// Field edits stay local + autosave, so typing is never interrupted by a refetch.
const rows = ref<Row[]>([]);
const seed = (): void => {
  rows.value = props.tasks.map((item) => {
    const summary = props.summaryByItem.get(item.idItem);
    return {
      idItem: item.idItem,
      title: item.title,
      projectId: item.projectId,
      estimatedMinutes: item.estimatedMinutes,
      categoryIds: [...item.categoryIds],
      isRecurrent: item.rrule !== null,
      status: summary?.status ?? null,
      dueDateInput: summary?.dueDate ? toDateInputValue(new Date(summary.dueDate)) : '',
      planned: summary?.planned ?? false,
      createdAt: item.createdAt,
      busy: false,
    };
  });
};
watch(() => props.tasks, seed, { immediate: true });

// --- Group / sort controls ----------------------------------------------------------
type GroupBy = 'subproject' | 'date' | 'week' | 'month' | 'category' | 'none';
type SortBy = 'alpha' | 'added' | 'estimate' | 'due';
type Direction = 'asc' | 'desc';

const groupByOptions = computed<GroupBy[]>(() =>
  props.showSubproject ? ['subproject', 'date', 'week', 'month', 'category', 'none'] : ['date', 'week', 'month', 'category', 'none'],
);
const sortByOptions: SortBy[] = ['due', 'alpha', 'added', 'estimate'];

const groupBy = ref<GroupBy>(props.showSubproject ? 'subproject' : 'none');
const groupDir = ref<Direction>('asc');
const sortBy = ref<SortBy>('due');
const sortDir = ref<Direction>('asc');
// If the shown project loses/gains subprojects, keep the grouping valid.
watch(groupByOptions, (options) => {
  if (!options.includes(groupBy.value)) {
    groupBy.value = props.showSubproject ? 'subproject' : 'none';
  }
});

// --- Lineage labels -----------------------------------------------------------------
const projectById = computed(() => new Map(props.projects.map((project) => [project.idProject, project])));
const relativeBreadcrumb = (projectId: number | null): string => {
  if (projectId === null || projectId === props.currentProjectId) {
    return t('grid.ownTasks');
  }
  const chain: string[] = [];
  let current = projectById.value.get(projectId);
  while (current && current.idProject !== props.currentProjectId) {
    chain.unshift(current.name);
    current = current.parentProjectId !== null ? projectById.value.get(current.parentProjectId) : undefined;
  }
  return chain.join(' › ');
};
const categoryById = computed(() => new Map(props.categories.map((category) => [category.idCategory, category])));
const categoryAncestry = (id: number): string => {
  const chain: string[] = [];
  let current = categoryById.value.get(id);
  while (current) {
    chain.unshift(current.name);
    current = current.parentCategoryId !== null ? categoryById.value.get(current.parentCategoryId) : undefined;
  }
  return chain.join(' › ');
};

// --- Grouping -----------------------------------------------------------------------
// The context an in-group entry pre-fills a new task with (chosen answer: contextual).
interface EntryContext {
  projectId: number | null;
  categoryIds: number[];
  dueDate: string | null; // yyyy-mm-dd
}
interface Group {
  key: string;
  label: string; // '' hides the header (single 'none' group)
  special: boolean; // "No date" / "Uncategorized" — always last
  order: string; // sort key among normal groups
  context: EntryContext;
  rows: Row[];
}
const baseContext = (): EntryContext => ({ projectId: props.currentProjectId, categoryIds: [], dueDate: null });

const groupBySubproject = (): Group[] => {
  const byProject = new Map<number | null, Row[]>();
  for (const row of rows.value) {
    const list = byProject.get(row.projectId) ?? [];
    list.push(row);
    byProject.set(row.projectId, list);
  }
  return [...byProject.entries()].map(([projectId, groupRows]) => {
    const own = projectId === props.currentProjectId;
    return {
      key: `p${projectId}`,
      label: relativeBreadcrumb(projectId),
      special: false,
      order: own ? '' : relativeBreadcrumb(projectId).toLowerCase(), // own project first
      context: { projectId, categoryIds: [], dueDate: null },
      rows: groupRows,
    };
  });
};

const groupByCategory = (): Group[] => {
  const byCategory = new Map<number, Row[]>();
  const uncategorized: Row[] = [];
  for (const row of rows.value) {
    if (row.categoryIds.length === 0) {
      uncategorized.push(row);
      continue;
    }
    for (const id of row.categoryIds) {
      const list = byCategory.get(id) ?? [];
      list.push(row); // a multi-category task is listed once per category (chosen answer)
      byCategory.set(id, list);
    }
  }
  const out: Group[] = [...byCategory.entries()].map(([id, groupRows]) => {
    const label = categoryAncestry(id);
    return {
      key: `c${id}`,
      label,
      special: false,
      order: label.toLowerCase(),
      context: { projectId: props.currentProjectId, categoryIds: [id], dueDate: null },
      rows: groupRows,
    };
  });
  if (uncategorized.length > 0) {
    out.push({ key: 'uncat', label: t('grid.uncategorized'), special: true, order: '', context: baseContext(), rows: uncategorized });
  }
  return out;
};

const groupByDate = (mode: 'date' | 'week' | 'month'): Group[] => {
  const byKey = new Map<string, { label: string; dueDate: string; rows: Row[] }>();
  const noDate: Row[] = [];
  for (const row of rows.value) {
    if (row.dueDateInput === '') {
      noDate.push(row);
      continue;
    }
    const due = fromDateInputValue(row.dueDateInput);
    const start = mode === 'week' ? startOfWeek(due) : mode === 'month' ? startOfMonth(due) : due;
    const iso = toDateInputValue(start);
    const label = mode === 'month' ? formatMonthTitle(start) : mode === 'week' ? `${formatDayHeader(start)} – ${formatDayHeader(addDays(start, 6))}` : formatFullDay(start);
    const bucket = byKey.get(iso) ?? { label, dueDate: iso, rows: [] };
    bucket.rows.push(row);
    byKey.set(iso, bucket);
  }
  const out: Group[] = [...byKey.entries()].map(([iso, bucket]) => ({
    key: `d${iso}`,
    label: bucket.label,
    special: false,
    order: iso, // yyyy-mm-dd sorts chronologically as a string
    context: { projectId: props.currentProjectId, categoryIds: [], dueDate: bucket.dueDate },
    rows: bucket.rows,
  }));
  if (noDate.length > 0) {
    out.push({ key: 'nodate', label: t('grid.noDate'), special: true, order: '', context: baseContext(), rows: noDate });
  }
  return out;
};

const isEmpty = (value: number | string | null): boolean => value === null || value === '';
const sortRows = (list: Row[]): Row[] => {
  const dir = sortDir.value === 'asc' ? 1 : -1;
  if (sortBy.value === 'alpha') {
    return [...list].sort((a, b) => a.title.localeCompare(b.title) * dir);
  }
  if (sortBy.value === 'added') {
    return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) * dir);
  }
  // estimate / due: comparable rows sorted by direction, empties pinned last either way.
  const get = (row: Row): number | string | null => (sortBy.value === 'estimate' ? row.estimatedMinutes : row.dueDateInput);
  const filled = list.filter((row) => !isEmpty(get(row)));
  const empties = list.filter((row) => isEmpty(get(row)));
  filled.sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    const cmp = sortBy.value === 'estimate' ? (av as number) - (bv as number) : (av as string).localeCompare(bv as string);
    return cmp * dir;
  });
  return [...filled, ...empties];
};

const groups = computed<Group[]>(() => {
  let raw: Group[];
  if (groupBy.value === 'none') {
    raw = [{ key: 'all', label: '', special: false, order: '', context: baseContext(), rows: [...rows.value] }];
  } else if (groupBy.value === 'subproject') {
    raw = groupBySubproject();
  } else if (groupBy.value === 'category') {
    raw = groupByCategory();
  } else {
    raw = groupByDate(groupBy.value);
  }
  if (raw.length === 0) {
    // No tasks yet — still surface one entry row so the grid stays addable.
    raw = [{ key: 'all', label: '', special: false, order: '', context: baseContext(), rows: [] }];
  }
  for (const group of raw) {
    group.rows = sortRows(group.rows);
  }
  const normal = raw.filter((group) => !group.special).sort((a, b) => a.order.localeCompare(b.order));
  if (groupDir.value === 'desc') {
    normal.reverse();
  }
  return [...normal, ...raw.filter((group) => group.special)]; // specials always last
});
const showGroupHeaders = computed(() => groups.value.length > 1);

const gridColumns = computed(() =>
  props.showSubproject
    ? '26px minmax(140px, 1.6fr) minmax(120px, 1.2fr) 88px 132px minmax(120px, 1.2fr) 64px'
    : '26px minmax(140px, 1.6fr) minmax(120px, 1.2fr) 88px 132px 64px',
);

// --- Autosave helpers --------------------------------------------------------------
const run = async (row: Row | null, op: () => Promise<unknown>, structural = false): Promise<void> => {
  if (row) {
    row.busy = true;
  }
  try {
    await op();
    if (structural) {
      emit('changed');
    }
  } catch (cause) {
    emit('error', errorMessage(cause));
  } finally {
    if (row) {
      row.busy = false;
    }
  }
};

const saveTitle = (row: Row): Promise<void> => run(row, () => updateItem(row.idItem, { title: row.title.trim() }));
const saveEstimate = (row: Row): Promise<void> => run(row, () => updateItem(row.idItem, { estimatedMinutes: row.estimatedMinutes }));
const saveCategories = (row: Row, ids: number[]): Promise<void> => {
  row.categoryIds = ids;
  return run(row, () => updateItem(row.idItem, { categoryIds: ids }));
};
const saveProject = (row: Row, projectId: number | null): Promise<void> => {
  row.projectId = projectId;
  return run(row, () => updateItem(row.idItem, { projectId }), true); // moves it to another group
};
const toggleDone = (row: Row): Promise<void> => {
  const next: OccurrenceStatus = row.status === 'done' ? 'todo' : 'done';
  return run(
    row,
    async () => {
      await setOccurrenceStatus(row.idItem, { occurrenceDate: null, status: next });
      row.status = next;
    },
    true, // affects the project's done/total stats
  );
};
const saveDue = (row: Row): Promise<void> =>
  run(row, async () => {
    const dueDate = row.dueDateInput ? fromDateInputValue(row.dueDateInput) : null;
    const occurrence = await materializeOccurrence(row.idItem, { occurrenceDate: null });
    await updateOccurrence(row.idItem, occurrence.idItemOccurrence, { dueDate });
  });
const removeRow = (row: Row): void => {
  if (!window.confirm(t('taskDetail.confirmDeleteTask'))) {
    return;
  }
  void run(row, () => deleteItem(row.idItem), true);
};
</script>

<template>
  <div class="task-grid">
    <!-- Group / sort controls -->
    <div class="grid-toolbar">
      <label class="tool">
        <span>{{ t('grid.groupByLabel') }}</span>
        <select :value="groupBy" @change="groupBy = ($event.target as HTMLSelectElement).value as GroupBy">
          <option v-for="option in groupByOptions" :key="option" :value="option">{{ t(`grid.groupBy.${option}`) }}</option>
        </select>
        <button
          type="button"
          class="dir"
          :title="groupDir === 'asc' ? t('grid.ascending') : t('grid.descending')"
          @click="groupDir = groupDir === 'asc' ? 'desc' : 'asc'"
        >
          {{ groupDir === 'asc' ? '↑' : '↓' }}
        </button>
      </label>
      <label class="tool">
        <span>{{ t('grid.sortByLabel') }}</span>
        <select :value="sortBy" @change="sortBy = ($event.target as HTMLSelectElement).value as SortBy">
          <option v-for="option in sortByOptions" :key="option" :value="option">{{ t(`grid.sortBy.${option}`) }}</option>
        </select>
        <button
          type="button"
          class="dir"
          :title="sortDir === 'asc' ? t('grid.ascending') : t('grid.descending')"
          @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'"
        >
          {{ sortDir === 'asc' ? '↑' : '↓' }}
        </button>
      </label>
    </div>

    <!-- Header (labels aligned with the row cells) -->
    <div class="grid-head" :style="{ gridTemplateColumns: gridColumns }">
      <span class="col-done" :title="t('grid.colDone')">✓</span>
      <span>{{ t('grid.colName') }}</span>
      <span>{{ t('grid.colCategories') }}</span>
      <span>{{ t('grid.colEstimate') }}</span>
      <span>{{ t('grid.colDue') }}</span>
      <span v-if="showSubproject">{{ t('grid.colSubproject') }}</span>
      <span class="col-actions" />
    </div>

    <template v-for="group in groups" :key="group.key">
      <h4 v-if="showGroupHeaders && group.label" class="group-head">{{ group.label }}</h4>
      <div
        v-for="row in group.rows"
        :key="`${group.key}:${row.idItem}`"
        class="grid-row"
        :class="{ 'is-done': row.status === 'done', 'is-busy': row.busy }"
        :style="{ gridTemplateColumns: gridColumns }"
      >
        <span
          v-if="!row.isRecurrent"
          class="cell check"
          :class="{ checked: row.status === 'done' }"
          :title="row.status === 'done' ? t('projects.markTodo') : t('projects.markDone')"
          @click="toggleDone(row)"
        >
          <svg v-if="row.status === 'done'" viewBox="0 0 16 16" class="tick"><path d="M3 8l3.5 3.5L13 5" /></svg>
        </span>
        <span v-else class="cell recur" :title="t('projects.recurring')">⟳</span>

        <input
          class="cell name"
          type="text"
          :value="row.title"
          :disabled="row.busy"
          @change="row.title = ($event.target as HTMLInputElement).value; saveTitle(row)"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />

        <span class="cell categories">
          <CategoryPicker
            :model-value="row.categoryIds"
            :source="categories"
            @update:model-value="saveCategories(row, $event)"
            @changed="emit('changed')"
          />
        </span>

        <input
          class="cell estimate"
          type="number"
          min="1"
          step="1"
          :value="row.estimatedMinutes ?? ''"
          :disabled="row.busy"
          @change="row.estimatedMinutes = ($event.target as HTMLInputElement).value === '' ? null : Math.max(1, Number(($event.target as HTMLInputElement).value)); saveEstimate(row)"
        />

        <input
          class="cell due"
          type="date"
          :value="row.dueDateInput"
          :disabled="row.busy || row.isRecurrent"
          @change="row.dueDateInput = ($event.target as HTMLInputElement).value; saveDue(row)"
        />

        <span v-if="showSubproject" class="cell subproject">
          <ProjectSelect
            :model-value="row.projectId"
            :projects="projects"
            :none-label="t('backlog.taskListLabel')"
            :restrict-to-subtree-of="currentProjectId"
            :allow-none="false"
            @update:model-value="saveProject(row, $event)"
          />
        </span>

        <span class="cell actions">
          <button type="button" class="icon" :title="t('grid.open')" @click="emit('open', row.idItem)">↗</button>
          <button type="button" class="icon danger" :title="t('common.delete')" :disabled="row.busy" @click="removeRow(row)">✕</button>
        </span>
      </div>

      <!-- Mass-add entry for THIS group — inherits the group's context (subproject /
           category / due date). Enter keeps focus in the same group's entry. -->
      <TaskGridEntry
        :project-id="group.context.projectId"
        :category-ids="group.context.categoryIds"
        :due-date="group.context.dueDate"
        :grid-columns="gridColumns"
        :show-subproject="showSubproject"
        @created="emit('changed')"
        @error="emit('error', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.task-grid {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.grid-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding: 2px 8px 6px;
}

.tool {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.tool select {
  font: inherit;
  font-size: 12px;
  color: var(--text);
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
}

.dir {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  line-height: 1;
}

.dir:hover {
  background: var(--surface-hover);
}

.grid-head {
  display: grid;
  align-items: center;
  gap: 8px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.col-done {
  text-align: center;
}

.group-head {
  margin: 8px 2px 2px;
  font-size: 12px;
  color: var(--text-muted);
}

.grid-row {
  display: grid;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.grid-row.is-busy {
  opacity: 0.6;
}

.grid-row.is-done .name {
  text-decoration: line-through;
  color: var(--text-muted);
}

.cell {
  min-width: 0;
}

.cell.name,
.cell.estimate,
.cell.due {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
}

.cell.name:hover,
.cell.estimate:hover,
.cell.due:hover,
.cell.name:focus,
.cell.estimate:focus,
.cell.due:focus {
  border-color: var(--border);
  background: var(--surface);
  outline: none;
}

.check {
  width: 18px;
  height: 18px;
  margin: 0 auto;
  border: 1.5px solid var(--border);
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.check.checked {
  background: var(--accent);
  border-color: var(--accent);
}

.tick {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: #fff;
  stroke-width: 2.5;
}

.recur {
  text-align: center;
  color: var(--text-muted);
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

.entry {
  border-style: dashed;
  background: color-mix(in srgb, var(--surface) 60%, transparent);
}

.entry .name::placeholder {
  color: var(--text-muted);
}
</style>
