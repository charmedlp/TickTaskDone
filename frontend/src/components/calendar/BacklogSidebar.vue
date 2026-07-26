<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BacklogTaskDto, ProjectDto } from '@ticktaskdone/shared';
import { formatDayHeader } from '@/lib/format';

// Two separate collapsible bars. Folded (default): the panel is a narrow strip holding
// two distinct vertical bars — "En attente" (backlog) on top, "Récurrentes" (recurring
// tasks absent from the window) below. Clicking a bar's ‹ opens that tray to full width
// AND full height — it animates OVER the other bar (which stays underneath). Its ‹ folds
// back. One open at a time.
const props = defineProps<{ tasks: BacklogTaskDto[]; recurring: BacklogTaskDto[]; projects: ProjectDto[] }>();
const emit = defineEmits<{
  dragstart: [payload: { task: BacklogTaskDto; event: PointerEvent }];
  recurringDragstart: [payload: { task: BacklogTaskDto; event: PointerEvent }];
}>();

const { t } = useI18n();
const open = ref<'backlog' | 'recurring' | null>(null); // null = both folded (two narrow bars)

// Nulls (no due date) sort last, otherwise ascending.
const byDueDate = (left: BacklogTaskDto, right: BacklogTaskDto): number => {
  if (left.dueDate === right.dueDate) return 0;
  if (left.dueDate === null) return 1;
  if (right.dueDate === null) return -1;
  return left.dueDate < right.dueDate ? -1 : 1;
};

// projectId null = the virtual "Task List" group (no stored project — Task List brief §1).
const projectName = (projectId: number | null): string =>
  projectId === null
    ? t('backlog.taskListLabel')
    : (props.projects.find((project) => project.idProject === projectId)?.name ?? t('backlog.project'));

// Grouped by project, the virtual Task List first then alphabetical.
const buildGroups = (list: BacklogTaskDto[]) => {
  const byProject = new Map<number | null, BacklogTaskDto[]>();
  for (const task of list) {
    const group = byProject.get(task.projectId) ?? [];
    group.push(task);
    byProject.set(task.projectId, group);
  }
  return [...byProject.entries()]
    .map(([projectId, tasks]) => ({ projectId, name: projectName(projectId), tasks: [...tasks].sort(byDueDate) }))
    .sort((left, right) => {
      if (left.projectId === null) return -1;
      if (right.projectId === null) return 1;
      return left.name.localeCompare(right.name);
    });
};
const backlogGroups = computed(() => buildGroups(props.tasks));
const recurringGroups = computed(() => buildGroups(props.recurring));

const formatDue = (dueDate: string): string => formatDayHeader(new Date(dueDate));
</script>

<template>
  <aside class="sidebar" :class="{ wide: open !== null }">
    <!-- Top bar: En attente -->
    <div class="tray top" :class="{ open: open === 'backlog' }">
      <button v-show="open !== 'backlog'" type="button" class="bar" :aria-label="t('backlog.show')" @click="open = 'backlog'">
        <span class="chevron">‹</span>
        <span class="vertical">{{ t('backlog.title') }}<span v-if="tasks.length > 0" class="count">{{ tasks.length }}</span></span>
      </button>
      <div v-show="open === 'backlog'" class="panel">
        <div class="header">
          <button class="fold" :aria-label="t('backlog.hide')" @click="open = null">‹</button>
          <h3 class="panel-title">{{ t('backlog.title') }}</h3>
        </div>
        <div class="scroll">
          <p v-if="tasks.length === 0" class="empty">{{ t('backlog.empty') }}</p>
          <section v-for="group in backlogGroups" :key="String(group.projectId)" class="group">
            <h4 class="group-name">{{ group.name }}</h4>
            <div
              v-for="task in group.tasks"
              :key="task.itemId"
              class="card"
              :style="{ borderLeftColor: task.resolvedColor }"
              @pointerdown="emit('dragstart', { task, event: $event })"
            >
              <span class="card-title">{{ task.title }}</span>
              <span v-if="task.dueDate" class="due">{{ t('backlog.due', { date: formatDue(task.dueDate) }) }}</span>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- Bottom bar: Récurrentes -->
    <div class="tray bottom" :class="{ open: open === 'recurring' }">
      <button v-show="open !== 'recurring'" type="button" class="bar" :aria-label="t('backlog.show')" @click="open = 'recurring'">
        <span class="chevron">‹</span>
        <span class="vertical">{{ t('backlog.recurringTitle') }}<span v-if="recurring.length > 0" class="count">{{ recurring.length }}</span></span>
      </button>
      <div v-show="open === 'recurring'" class="panel">
        <div class="header">
          <button class="fold" :aria-label="t('backlog.hide')" @click="open = null">‹</button>
          <h3 class="panel-title">{{ t('backlog.recurringTitle') }}</h3>
        </div>
        <div class="scroll">
          <p v-if="recurring.length === 0" class="empty">{{ t('backlog.recurringEmpty') }}</p>
          <section v-for="group in recurringGroups" :key="String(group.projectId)" class="group">
            <h4 class="group-name">{{ group.name }}</h4>
            <div
              v-for="task in group.tasks"
              :key="task.itemId"
              class="card"
              :style="{ borderLeftColor: task.resolvedColor }"
              @pointerdown="emit('recurringDragstart', { task, event: $event })"
            >
              <span class="card-title">{{ task.title }}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* Flush to the right edge, no margin. Width animates (34 ↔ 240) when a tray opens. */
.sidebar {
  flex: none;
  position: relative;
  width: 34px;
  height: 100%;
  min-height: 0;
  margin-right: -16px; /* break out of the calendar's padding so it hugs the window edge */
  transition: width 0.22s ease;
}

.sidebar.wide {
  width: 240px;
}

/* Each tray is its own box (two distinct bars), pinned to the right (flush). A folded
   tray stays a narrow 34px bar in its half; opening one animates BOTH width (→240) and
   height (→100%) so it visibly grows OVER the other bar, which stays underneath. */
.tray {
  position: absolute;
  right: 0;
  width: 34px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-right: none;
  border-radius: 6px 0 0 6px; /* square, flush right edge */
  background: var(--surface);
  transition:
    top 0.22s ease,
    height 0.22s ease,
    width 0.22s ease;
}

.tray.top {
  top: 0;
  height: calc(50% - 4px);
}

.tray.bottom {
  top: calc(50% + 4px);
  height: calc(50% - 4px);
}

.tray.open {
  top: 0;
  height: 100%;
  width: 240px;
  z-index: 3; /* rides over the other bar */
}

/* Folded bar: the ‹ hint + the vertical label. */
.bar {
  width: 100%;
  height: 100%;
  border: none;
  background: none;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 0;
  color: var(--text-muted);
}

.bar:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.chevron {
  font-size: 16px;
}

.vertical {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.count {
  background: var(--accent);
  color: #fff;
  border-radius: 8px;
  padding: 1px 5px;
  font-size: 11px;
  writing-mode: horizontal-tb;
  transform: rotate(180deg); /* undo the parent's 180° so the number reads upright */
}

/* Open tray: header + scrolling list. */
.panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 8px 8px 2px;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.fold {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 18px;
  color: var(--text-muted);
  padding: 0 6px;
  border-radius: 6px;
}

.fold:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.panel-title {
  margin: 0;
  font-size: 14px;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.group {
  margin-bottom: 12px;
}

.group-name {
  margin: 4px 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.card {
  border: 1px solid var(--border);
  border-left: 4px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 5px;
  cursor: grab;
  touch-action: none;
  user-select: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--surface);
}

.card:hover {
  background: var(--surface-hover);
}

.card:active {
  cursor: grabbing;
}

.card-title {
  font-size: 13px;
  font-weight: 500;
}

.due {
  font-size: 11px;
  color: var(--text-muted);
}

.empty {
  color: var(--text-muted);
  font-size: 13px;
  padding: 12px;
}
</style>
