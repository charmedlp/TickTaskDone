<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ColorNode, ItemDto, ProjectDto, ProjectStatus } from '@ticktaskdone/shared';
import { DEFAULT_COLOR as CASCADE_DEFAULT, lineageColor, projectStatuses } from '@ticktaskdone/shared';
import type { CategoryDto, TaskSummaryDto } from '@ticktaskdone/shared';
import { createProject, deleteProject, listProjects, updateProject } from '@/api/projects';
import { createItem, fetchTaskSummaries, listItems } from '@/api/items';
import { listCategories } from '@/api/categories';
import { setOccurrenceStatus } from '@/api/occurrenceActions';
import { errorMessage } from '@/lib/errorMessage';
import { buildProjectTree, descendantProjectIds, flattenVisibleProjects } from '@/lib/projectTree';
import TaskDetail from '@/components/projects/TaskDetail.vue';
import CategoryManager from '@/components/projects/CategoryManager.vue';
import CategoryPicker from '@/components/calendar/CategoryPicker.vue';
import ColorPicker from '@/components/ColorPicker.vue';

// The Projects view is a management home (brief §1): a project tree on the left, the
// selected node's detail on the right — a project, the ephemeral Task List, the
// category-tree editor, or one task's full detail (fields + planned moments).
type Selection =
  | { kind: 'none' }
  | { kind: 'tasklist' }
  | { kind: 'categories' }
  | { kind: 'project'; id: number }
  | { kind: 'task'; id: number };

const { t } = useI18n();

const DEFAULT_COLOR = '#6b7280';
const STATUS_LABELS = computed<Record<ProjectStatus, string>>(() => ({
  active: t('projects.statusActive'),
  onHold: t('projects.statusOnHold'),
  done: t('projects.statusDone'),
  cancelled: t('projects.statusCancelled'),
  archived: t('projects.statusArchived'),
}));

const projects = ref<ProjectDto[]>([]);
const items = ref<ItemDto[]>([]);
const summaries = ref<TaskSummaryDto[]>([]);
const categories = ref<CategoryDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const selected = ref<Selection>({ kind: 'none' });
const collapsed = ref<Set<number>>(new Set());
const showArchived = ref(false);

const reload = async (): Promise<void> => {
  error.value = null;
  try {
    const [projectRows, itemRows, summaryRows, categoryRows] = await Promise.all([
      listProjects(),
      listItems(),
      fetchTaskSummaries(),
      listCategories(),
    ]);
    projects.value = projectRows;
    items.value = itemRows;
    summaries.value = summaryRows;
    categories.value = categoryRows;
  } catch (cause) {
    error.value = errorMessage(cause);
  }
};

onMounted(async () => {
  loading.value = true;
  await reload();
  loading.value = false;
});

// "Task List" is a VIRTUAL group — the tasks with projectId = null — not a stored
// project (Task List brief §1). It is pinned in the tree and is not editable as a
// project. Every real project is an ordinary tree node.
const treeProjects = computed(() => projects.value);

const tree = computed(() => buildProjectTree(treeProjects.value));
const visibleNodes = computed(() => flattenVisibleProjects(tree.value, collapsed.value, showArchived.value));
const hasArchived = computed(() => treeProjects.value.some((project) => project.status === 'archived'));

const projectById = (id: number): ProjectDto | undefined => projects.value.find((project) => project.idProject === id);
const selectedProject = computed(() => (selected.value.kind === 'project' ? projectById(selected.value.id) : undefined));

// --- Color cascade: a node with no own color inherits its nearest colored ancestor's,
// falling back to the shared default (guide §7). Same resolver as the backend/items.
const projectColorNodes = computed<Map<number, ColorNode>>(
  () => new Map(projects.value.map((project) => [project.idProject, { parentId: project.parentProjectId, color: project.color }])),
);
const categoryColorNodes = computed<Map<number, ColorNode>>(
  () => new Map(categories.value.map((category) => [category.idCategory, { parentId: category.parentCategoryId, color: category.color }])),
);
const effectiveProjectColor = (id: number): string => lineageColor(id, projectColorNodes.value) ?? CASCADE_DEFAULT;
const effectiveCategoryColor = (id: number): string => lineageColor(id, categoryColorNodes.value) ?? CASCADE_DEFAULT;

// --- Categories: lineage label + inheritance from ancestor projects ----------
const categoryById = computed(() => new Map(categories.value.map((category) => [category.idCategory, category])));
// "root › … › leaf" for a category, deduced from its parent chain (brief §2/§3).
const ancestryLabel = (idCategory: number): string => {
  const chain: string[] = [];
  let current = categoryById.value.get(idCategory);
  while (current) {
    chain.unshift(current.name);
    current = current.parentCategoryId !== null ? categoryById.value.get(current.parentCategoryId) : undefined;
  }
  return chain.join(' › ');
};
// Categories inherited from ANCESTOR projects (read-only): they apply to the child
// too. Excludes the project's own leaves so nothing is shown twice.
const inheritedCategoryIds = computed<number[]>(() => {
  if (selected.value.kind !== 'project') {
    return [];
  }
  const own = new Set(draft.categoryIds);
  const inherited = new Set<number>();
  let parentId = projectById(selected.value.id)?.parentProjectId ?? null;
  while (parentId !== null) {
    const parent = projectById(parentId);
    if (!parent) {
      break;
    }
    for (const categoryId of parent.categoryIds) {
      if (!own.has(categoryId)) {
        inherited.add(categoryId);
      }
    }
    parentId = parent.parentProjectId;
  }
  return [...inherited];
});

const childrenOf = (id: number): ProjectDto[] =>
  projects.value.filter((project) => project.parentProjectId === id).sort((a, b) => a.name.localeCompare(b.name));
const hasChildren = (id: number): boolean => projects.value.some((project) => project.parentProjectId === id);

const tasksOf = (projectId: number): ItemDto[] =>
  items.value.filter((item) => item.type === 'task' && item.projectId === projectId);
const ephemeralTasks = computed(() =>
  items.value.filter(
    (item) => item.type === 'task' && item.projectId === null,
  ),
);

// --- Per-task rollups (row enrichment + project stats, brief §2/§4) ----------
const summaryByItem = computed(() => new Map(summaries.value.map((summary) => [summary.itemId, summary])));
const summaryFor = (itemId: number): TaskSummaryDto | undefined => summaryByItem.value.get(itemId);
const formatHours = (minutes: number): string => `${(minutes / 60).toFixed(1)}h`;
const formatDue = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Task items joined with their rollup, for the enriched list rows.
interface EnrichedTask {
  item: ItemDto;
  summary: TaskSummaryDto | undefined;
}
const enrichedTasksOf = (projectId: number): EnrichedTask[] =>
  tasksOf(projectId).map((item) => ({ item, summary: summaryFor(item.idItem) }));
const enrichedEphemeral = computed<EnrichedTask[]>(() =>
  ephemeralTasks.value.map((item) => ({ item, summary: summaryFor(item.idItem) })),
);

// §4 stats over a project's DIRECT tasks only — NO recursion into subprojects
// (recursive rollups + hourly rate are Phase 7).
const projectStats = computed(() => {
  if (selected.value.kind !== 'project') {
    return null;
  }
  const id = selected.value.id;
  const rows = summaries.value.filter((summary) => summary.projectId === id);
  const total = rows.length;
  const done = rows.filter((summary) => summary.status === 'done').length;
  const plannedMinutes = rows.reduce((sum, summary) => sum + summary.plannedMinutes, 0);
  const estimatedMinutes = rows.reduce((sum, summary) => sum + (summary.estimatedMinutes ?? 0), 0);
  const loggedMinutes = rows.reduce((sum, summary) => sum + summary.loggedMinutes, 0);
  return {
    total,
    done,
    remaining: total - done,
    plannedMinutes,
    estimatedMinutes,
    loggedMinutes,
    pctCount: total > 0 ? Math.round((done / total) * 100) : 0,
    pctHours: plannedMinutes > 0 ? Math.round((loggedMinutes / plannedMinutes) * 100) : 0,
  };
});

// --- Detail draft (edit a project's fields, save explicitly) ----------------
const draft = reactive<{
  name: string;
  color: string | null;
  status: ProjectStatus;
  income: number;
  parentProjectId: number | null;
  categoryIds: number[];
}>({ name: '', color: DEFAULT_COLOR, status: 'active', income: 0, parentProjectId: null, categoryIds: [] });

watch(
  selectedProject,
  (project) => {
    if (project) {
      draft.name = project.name;
      draft.color = project.color;
      draft.status = project.status;
      draft.income = project.income;
      draft.parentProjectId = project.parentProjectId;
      draft.categoryIds = [...project.categoryIds];
    }
  },
  { immediate: true },
);

// Valid parents when re-parenting the selected project: everything but itself and
// its own subtree (the DB trigger guards too, but hiding them avoids a sure error).
const parentOptions = computed<ProjectDto[]>(() => {
  if (selected.value.kind !== 'project') {
    return [];
  }
  const invalid = descendantProjectIds(projects.value, selected.value.id);
  return treeProjects.value.filter((project) => !invalid.has(project.idProject)).sort((a, b) => a.name.localeCompare(b.name));
});

// --- Selection / tree interactions ------------------------------------------
const selectProject = (id: number): void => {
  selected.value = { kind: 'project', id };
};
const selectTaskList = (): void => {
  selected.value = { kind: 'tasklist' };
};
const selectCategories = (): void => {
  selected.value = { kind: 'categories' };
};
const selectTask = (id: number): void => {
  selected.value = { kind: 'task', id };
};
const selectedTaskItem = computed(() =>
  selected.value.kind === 'task' ? items.value.find((item) => item.idItem === (selected.value as { id: number }).id) : undefined,
);
// Back from a task to its home (its project, or the Task List for an ephemeral task).
const backFromTask = (): void => {
  const task = selectedTaskItem.value;
  if (task && task.projectId !== null) {
    selectProject(task.projectId);
  } else {
    selectTaskList();
  }
};
// A de-recurrence deletes the task (it split into separate tasks); leave the detail
// and refresh so the resulting tasks appear.
const onTaskRemoved = (): void => {
  backFromTask();
  void reload();
};
const toggleCollapse = (id: number): void => {
  const next = new Set(collapsed.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  collapsed.value = next;
};

// --- Mutations --------------------------------------------------------------
const busy = ref(false);
const run = async (operation: () => Promise<void>): Promise<void> => {
  if (busy.value) {
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await operation();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
};

// Toggle a non-recurring task's done state from its row checkbox.
const toggleTaskDone = (task: ItemDto): Promise<void> =>
  run(async () => {
    const next = summaryFor(task.idItem)?.status === 'done' ? 'todo' : 'done';
    await setOccurrenceStatus(task.idItem, { occurrenceDate: null, status: next });
    await reload();
  });

const newProject = (parentProjectId: number | null): Promise<void> =>
  run(async () => {
    // A subproject is created WITHOUT its own color (null) so it inherits its parent's
    // dynamically (guide §7); a root gets the default, still erasable.
    const created = await createProject({
      parentProjectId,
      name: t('projects.newProjectName'),
      color: parentProjectId === null ? DEFAULT_COLOR : null,
    });
    await reload();
    if (parentProjectId !== null) {
      collapsed.value = new Set([...collapsed.value].filter((id) => id !== parentProjectId));
    }
    selectProject(created.idProject);
  });

// Create a bare task (no schedule) and open it so the user renames/edits it. A null
// projectId lands it in the ephemeral Task List; a project id files it under that project.
const newTask = (projectId: number | null): Promise<void> =>
  run(async () => {
    const created = await createItem({
      type: 'task',
      projectId,
      title: t('projects.newTaskName'),
      description: null,
      color: null,
      estimatedMinutes: null,
      rrule: null,
      recurrenceStart: null,
      timezone: null,
    });
    await reload();
    selectTask(created.idItem);
  });

const saveProject = (): Promise<void> =>
  run(async () => {
    if (selected.value.kind !== 'project') {
      return;
    }
    await updateProject(selected.value.id, {
      name: draft.name,
      color: draft.color,
      status: draft.status,
      income: draft.income,
      parentProjectId: draft.parentProjectId,
      categoryIds: draft.categoryIds,
    });
    await reload();
  });

const archiveProject = (): Promise<void> =>
  run(async () => {
    if (selected.value.kind !== 'project') {
      return;
    }
    await updateProject(selected.value.id, { status: 'archived' });
    await reload();
  });

const removeProject = (): Promise<void> =>
  run(async () => {
    if (selected.value.kind !== 'project') {
      return;
    }
    if (!window.confirm(t('projects.confirmDelete'))) {
      return;
    }
    await deleteProject(selected.value.id);
    selected.value = { kind: 'none' };
    await reload();
  });

const onParentChange = (value: string): void => {
  draft.parentProjectId = value === '' ? null : Number(value);
};
</script>

<template>
  <section class="projects">
    <p v-if="error" class="banner error">{{ error }}</p>

    <div class="master-detail">
      <!-- Left: the project tree -->
      <aside class="tree-panel">
        <header class="tree-head">
          <button type="button" class="btn primary" :disabled="busy" @click="newProject(null)">{{ t('projects.addProject') }}</button>
          <label v-if="hasArchived" class="archived-toggle">
            <input v-model="showArchived" type="checkbox" />
            {{ t('projects.statusArchived') }}
          </label>
        </header>

        <ul class="tree">
          <li>
            <button
              type="button"
              class="node tasklist"
              :class="{ selected: selected.kind === 'tasklist' }"
              @click="selectTaskList"
            >
              <span class="twist" />
              <span class="dot" style="background: var(--text-muted)" />
              <span class="node-name">{{ t('backlog.taskListLabel') }}</span>
            </button>
          </li>
          <li v-for="node in visibleNodes" :key="node.project.idProject">
            <button
              type="button"
              class="node"
              :class="{ selected: selected.kind === 'project' && selected.id === node.project.idProject }"
              :style="{ paddingLeft: `${8 + node.depth * 16}px` }"
              @click="selectProject(node.project.idProject)"
            >
              <span
                v-if="hasChildren(node.project.idProject)"
                class="twist open"
                :class="{ collapsed: collapsed.has(node.project.idProject) }"
                @click.stop="toggleCollapse(node.project.idProject)"
              >
                ▸
              </span>
              <span v-else class="twist" />
              <span class="dot" :style="{ background: effectiveProjectColor(node.project.idProject) }" />
              <span class="node-name">{{ node.project.name }}</span>
              <span v-if="node.project.status !== 'active'" class="node-status">{{ STATUS_LABELS[node.project.status] }}</span>
            </button>
          </li>

          <!-- A management entry, not a project/task container — pinned to the bottom. -->
          <li class="management-item">
            <button
              type="button"
              class="node management"
              :class="{ selected: selected.kind === 'categories' }"
              @click="selectCategories"
            >
              <span class="twist">⚙</span>
              <span class="node-name">{{ t('projects.categoriesManagement') }}</span>
            </button>
          </li>
        </ul>
      </aside>

      <!-- Right: the detail -->
      <div class="detail-panel">
        <p v-if="loading" class="muted">{{ t('common.loading') }}</p>

        <p v-else-if="selected.kind === 'none'" class="muted">{{ t('projects.selectPrompt') }}</p>

        <!-- Ephemeral tasks home -->
        <div v-else-if="selected.kind === 'tasklist'" class="detail">
          <div class="detail-head">
            <div>
              <h2>{{ t('backlog.taskListLabel') }}</h2>
              <p class="muted small">{{ t('projects.ephemeralHint') }}</p>
            </div>
            <button type="button" class="btn small primary" :disabled="busy" @click="newTask(null)">{{ t('projects.addTask') }}</button>
          </div>
          <ul class="task-list">
            <li
              v-for="row in enrichedEphemeral"
              :key="row.item.idItem"
              class="task-row"
              :class="{ 'is-done': row.summary?.status === 'done' }"
            >
              <span
                v-if="!row.summary?.isRecurrent"
                class="task-check"
                :class="{ checked: row.summary?.status === 'done' }"
                :title="row.summary?.status === 'done' ? t('projects.markTodo') : t('projects.markDone')"
                @click="toggleTaskDone(row.item)"
              >
                <svg v-if="row.summary?.status === 'done'" viewBox="0 0 16 16" class="tick"><path d="M3 8l3.5 3.5L13 5" /></svg>
              </span>
              <span v-else class="task-recur" :title="t('projects.recurring')">⟳</span>
              <button type="button" class="task-open" @click="selectTask(row.item.idItem)">{{ row.item.title }}</button>
              <span v-if="row.summary?.dueDate" class="task-due">{{ formatDue(row.summary.dueDate) }}</span>
              <span class="task-badge" :class="row.summary?.planned ? 'planned' : 'backlog'">
                {{ row.summary?.planned ? t('projects.planned') : t('projects.backlog') }}
              </span>
            </li>
            <li v-if="enrichedEphemeral.length === 0" class="muted small">{{ t('projects.noEphemeralTasks') }}</li>
          </ul>
        </div>

        <!-- Category tree editor (§5) -->
        <div v-else-if="selected.kind === 'categories'" class="detail">
          <CategoryManager @changed="reload" />
        </div>

        <!-- Task detail -->
        <div v-else-if="selected.kind === 'task' && selectedTaskItem" class="detail">
          <button type="button" class="back" @click="backFromTask">← {{ t('projects.back') }}</button>
          <TaskDetail :item="selectedTaskItem" @changed="reload" @removed="onTaskRemoved" />
        </div>

        <!-- Project detail -->
        <div v-else-if="selectedProject" class="detail">
          <div class="detail-form">
            <div class="row">
              <ColorPicker v-model="draft.color" />
              <input v-model="draft.name" type="text" class="name-input" :placeholder="t('projects.projectName')" />
            </div>
            <div class="row wrap">
              <label class="field">
                <span>{{ t('projects.status') }}</span>
                <select v-model="draft.status">
                  <option v-for="status in projectStatuses" :key="status" :value="status">{{ STATUS_LABELS[status] }}</option>
                </select>
              </label>
              <label class="field">
                <span>{{ t('projects.income') }}</span>
                <input v-model.number="draft.income" type="number" min="0" step="0.01" />
              </label>
              <label class="field grow">
                <span>{{ t('projects.parent') }}</span>
                <select :value="draft.parentProjectId ?? ''" @change="onParentChange(($event.target as HTMLSelectElement).value)">
                  <option value="">{{ t('projects.noneTopLevel') }}</option>
                  <option v-for="option in parentOptions" :key="option.idProject" :value="option.idProject">{{ option.name }}</option>
                </select>
              </label>
            </div>
            <div class="row">
              <span class="field-label">{{ t('projects.categories') }}</span>
              <CategoryPicker v-model="draft.categoryIds" :disabled-ids="inheritedCategoryIds" />
            </div>
            <div v-if="inheritedCategoryIds.length > 0" class="row inherited-row">
              <span class="field-label">{{ t('projects.inherited') }}</span>
              <span class="inherited-chips">
                <span
                  v-for="id in inheritedCategoryIds"
                  :key="id"
                  class="inherited-chip"
                  :title="t('projects.inheritedFrom', { label: ancestryLabel(id) })"
                >
                  <span class="dot" :style="{ background: effectiveCategoryColor(id) }" />
                  {{ ancestryLabel(id) }}
                </span>
              </span>
            </div>
            <div class="row actions">
              <button type="button" class="btn primary" :disabled="busy" @click="saveProject">{{ t('common.save') }}</button>
              <button type="button" class="btn" :disabled="busy" @click="newTask(selectedProject.idProject)">{{ t('projects.addTaskShort') }}</button>
              <button type="button" class="btn" :disabled="busy" @click="newProject(selectedProject.idProject)">{{ t('projects.addSubproject') }}</button>
              <button
                type="button"
                class="btn"
                :disabled="busy || draft.status === 'archived'"
                @click="archiveProject"
              >
                {{ t('projects.archive') }}
              </button>
              <button type="button" class="btn danger" :disabled="busy" @click="removeProject">{{ t('common.delete') }}</button>
            </div>
          </div>

          <section class="block">
            <h3>{{ t('projects.subprojects') }}</h3>
            <ul class="sub-list">
              <li v-for="child in childrenOf(selectedProject.idProject)" :key="child.idProject">
                <button type="button" class="link-row" @click="selectProject(child.idProject)">
                  <span class="dot" :style="{ background: effectiveProjectColor(child.idProject) }" />
                  <span>{{ child.name }}</span>
                  <span v-if="child.status !== 'active'" class="node-status">{{ STATUS_LABELS[child.status] }}</span>
                </button>
              </li>
              <li v-if="childrenOf(selectedProject.idProject).length === 0" class="muted small">{{ t('projects.noSubprojects') }}</li>
            </ul>
          </section>

          <!-- Direct-task stats (§4 placeholder — no subproject recursion) -->
          <section v-if="projectStats" class="block stats">
            <h3>{{ t('projects.statsDirectTasks') }}</h3>
            <div class="stat-grid">
              <div class="stat"><span class="stat-num">{{ projectStats.done }}/{{ projectStats.total }}</span><span class="stat-lbl">{{ t('projects.doneStat', { pct: projectStats.pctCount }) }}</span></div>
              <div class="stat"><span class="stat-num">{{ projectStats.remaining }}</span><span class="stat-lbl">{{ t('projects.remaining') }}</span></div>
              <div class="stat"><span class="stat-num">{{ formatHours(projectStats.plannedMinutes) }}</span><span class="stat-lbl">{{ t('projects.plannedStat') }}</span></div>
              <div class="stat"><span class="stat-num">{{ formatHours(projectStats.estimatedMinutes) }}</span><span class="stat-lbl">{{ t('projects.estimated') }}</span></div>
              <div class="stat"><span class="stat-num">{{ formatHours(projectStats.loggedMinutes) }}</span><span class="stat-lbl">{{ t('projects.loggedStat', { pct: projectStats.pctHours }) }}</span></div>
            </div>
            <p class="muted small">{{ t('projects.statsHint') }}</p>
          </section>

          <section class="block">
            <h3>{{ t('projects.tasks') }}</h3>
            <ul class="task-list">
              <li
                v-for="row in enrichedTasksOf(selectedProject.idProject)"
                :key="row.item.idItem"
                class="task-row"
                :class="{ 'is-done': row.summary?.status === 'done' }"
              >
                <span
                  v-if="!row.summary?.isRecurrent"
                  class="task-check"
                  :class="{ checked: row.summary?.status === 'done' }"
                  :title="row.summary?.status === 'done' ? t('projects.markTodo') : t('projects.markDone')"
                  @click="toggleTaskDone(row.item)"
                >
                  <svg v-if="row.summary?.status === 'done'" viewBox="0 0 16 16" class="tick"><path d="M3 8l3.5 3.5L13 5" /></svg>
                </span>
                <span v-else class="task-recur" :title="t('projects.recurring')">⟳</span>
                <button type="button" class="task-open" @click="selectTask(row.item.idItem)">{{ row.item.title }}</button>
                <span v-if="row.summary?.dueDate" class="task-due">{{ formatDue(row.summary.dueDate) }}</span>
                <span class="task-badge" :class="row.summary?.planned ? 'planned' : 'backlog'">
                  {{ row.summary?.planned ? t('projects.planned') : t('projects.backlog') }}
                </span>
              </li>
              <li v-if="enrichedTasksOf(selectedProject.idProject).length === 0" class="muted small">{{ t('projects.noTasks') }}</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.projects {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.banner.error {
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
  padding: 8px 12px;
  border-radius: 8px;
  margin: 0 0 10px;
}

.master-detail {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
}

.tree-panel {
  flex: 0 0 280px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  overflow: hidden;
}

.tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.archived-toggle {
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

.tree {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
}

.node {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  font: inherit;
  text-align: left;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text);
  cursor: pointer;
}

.node:hover {
  background: var(--border-subtle, rgba(127, 127, 127, 0.12));
}

.node.selected {
  background: var(--accent);
  color: #fff;
}

.node.tasklist {
  font-style: italic;
}

/* Categories Management: a settings-style entry, separated at the bottom. */
.management-item {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.node.management {
  color: var(--text-muted);
  font-size: 13px;
}

.twist {
  flex: 0 0 12px;
  width: 12px;
  font-size: 9px;
  color: var(--text-muted);
  transition: transform 0.12s;
}

.twist.open {
  transform: rotate(90deg);
  cursor: pointer;
}

.twist.open.collapsed {
  transform: rotate(0deg);
}

.node.selected .twist {
  color: rgba(255, 255, 255, 0.8);
}

.dot {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.node-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-status {
  flex: 0 0 auto;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.7;
}

.detail-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  padding: 16px;
}

.muted {
  color: var(--text-muted);
}

.small {
  font-size: 12px;
}

.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.detail-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.row.wrap {
  flex-wrap: wrap;
}

.name-input {
  flex: 1;
  font: inherit;
  font-size: 18px;
  font-weight: 600;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text-muted);
}

.field.grow {
  flex: 1;
  min-width: 160px;
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
}

.inherited-row {
  align-items: flex-start;
}

.inherited-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* Read-only tags inherited from a parent project — dimmed and dashed to signal they
   are not editable here (they live on the parent). */
.inherited-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
  padding: 3px 8px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  cursor: default;
}

.field select,
.field input {
  font: inherit;
  font-size: 14px;
  color: var(--text);
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

.actions {
  flex-wrap: wrap;
}

.btn {
  font: inherit;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn.small {
  padding: 5px 12px;
  font-size: 13px;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn.danger {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.4);
}

.block {
  margin-top: 16px;
}

.block h3 {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 8px;
}

.sub-list,
.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.link-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  font: inherit;
  text-align: left;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: none;
  color: var(--text);
  cursor: pointer;
}

.link-row:hover {
  background: var(--border-subtle, rgba(127, 127, 127, 0.12));
}

.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.task-row.is-done {
  opacity: 0.6;
}

.task-row.is-done .task-open {
  text-decoration: line-through;
}

.task-open {
  flex: 1;
  min-width: 0;
  font: inherit;
  text-align: left;
  padding: 0;
  border: none;
  background: none;
  color: var(--text);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-open:hover {
  text-decoration: underline;
}

.task-check {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  border: 1.5px solid var(--text-muted);
  border-radius: 3px;
  cursor: pointer;
}

.task-check.checked {
  background: var(--accent);
  border-color: var(--accent);
}

.tick {
  width: 100%;
  height: 100%;
  fill: none;
  stroke: #fff;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.task-recur {
  flex: 0 0 auto;
  width: 15px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.task-due {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.task-badge {
  flex: 0 0 auto;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 2px 6px;
  border-radius: 10px;
}

.task-badge.planned {
  background: rgba(34, 170, 136, 0.15);
  color: #22aa88;
}

.task-badge.backlog {
  background: var(--border-subtle, rgba(127, 127, 127, 0.15));
  color: var(--text-muted);
}

.stat-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 8px;
}

.stat {
  display: flex;
  flex-direction: column;
  min-width: 70px;
}

.stat-num {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stat-lbl {
  font-size: 11px;
  color: var(--text-muted);
}

.back {
  font: inherit;
  font-size: 13px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 0 8px;
}

.task-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-meta {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
