<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BacklogTaskDto, ProjectDto } from '@ticktaskdone/shared';
import { formatDayHeader } from '@/lib/format';

const props = defineProps<{ tasks: BacklogTaskDto[]; projects: ProjectDto[] }>();
const emit = defineEmits<{ dragstart: [payload: { task: BacklogTaskDto; event: PointerEvent }] }>();

const collapsed = ref(true); // collapsed by default

// Nulls (no due date) sort last, otherwise ascending.
const byDueDate = (left: BacklogTaskDto, right: BacklogTaskDto): number => {
  if (left.dueDate === right.dueDate) return 0;
  if (left.dueDate === null) return 1;
  if (right.dueDate === null) return -1;
  return left.dueDate < right.dueDate ? -1 : 1;
};

const projectName = (projectId: number | null): string =>
  projectId === null ? 'Task List' : (props.projects.find((project) => project.idProject === projectId)?.name ?? 'Project');

// Grouped by project, ephemeral ("Task List") first then alphabetical.
const groups = computed(() => {
  const byProject = new Map<number | null, BacklogTaskDto[]>();
  for (const task of props.tasks) {
    const list = byProject.get(task.projectId) ?? [];
    list.push(task);
    byProject.set(task.projectId, list);
  }
  return [...byProject.entries()]
    .map(([projectId, tasks]) => ({ projectId, name: projectName(projectId), tasks: [...tasks].sort(byDueDate) }))
    .sort((left, right) => {
      if (left.projectId === null) return -1;
      if (right.projectId === null) return 1;
      return left.name.localeCompare(right.name);
    });
});

const formatDue = (dueDate: string): string => formatDayHeader(new Date(dueDate));
</script>

<template>
  <aside class="backlog-panel" :class="{ collapsed }">
    <!-- Collapsed bar (fades in/out; the panel width animates) -->
    <button class="layer bar" aria-label="Show backlog" @click="collapsed = false">
      <span class="chevron">‹</span>
      <span class="vertical">Backlog<span v-if="tasks.length > 0" class="count">{{ tasks.length }}</span></span>
    </button>

    <!-- Expanded panel (fixed width so it does not reflow while the width animates) -->
    <div class="layer expanded">
      <div class="header">
        <h3 class="backlog-title">Backlog</h3>
        <button class="collapse" aria-label="Hide backlog" @click="collapsed = true">›</button>
      </div>

      <p v-if="tasks.length === 0" class="empty">No unscheduled tasks. Drag to plan them.</p>

      <div class="scroll">
        <section v-for="group in groups" :key="String(group.projectId)" class="group">
          <h4 class="group-name">{{ group.name }}</h4>
          <div
            v-for="task in group.tasks"
            :key="task.itemId"
            class="card"
            :style="{ borderLeftColor: task.resolvedColor }"
            @pointerdown="emit('dragstart', { task, event: $event })"
          >
            <span class="card-title">{{ task.title }}</span>
            <span v-if="task.dueDate" class="due">Due {{ formatDue(task.dueDate) }}</span>
          </div>
        </section>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* Single panel whose width animates; the two contents are stacked and cross-fade. */
.backlog-panel {
  position: relative;
  flex: none;
  width: 240px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  transition: width 0.22s ease;
}

.backlog-panel.collapsed {
  width: 34px;
}

.layer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  transition: opacity 0.18s ease;
}

/* Collapsed bar: visible only when collapsed. */
.bar {
  width: 34px;
  border: none;
  background: none;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  color: var(--text-muted);
  opacity: 0;
  pointer-events: none;
}

.backlog-panel.collapsed .bar {
  opacity: 1;
  pointer-events: auto;
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

/* Expanded content: fixed width so it stays laid out while the panel width animates
   (clipped by the panel's overflow); visible only when expanded. */
.expanded {
  width: 240px;
  display: flex;
  flex-direction: column;
  opacity: 1;
}

.backlog-panel.collapsed .expanded {
  opacity: 0;
  pointer-events: none;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 12px;
  border-bottom: 1px solid var(--border);
}

.backlog-title {
  margin: 0;
  font-size: 14px;
}

.collapse {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 16px;
  color: var(--text-muted);
  padding: 2px 6px;
  border-radius: 6px;
}

.collapse:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.empty {
  color: var(--text-muted);
  font-size: 13px;
  padding: 12px;
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
</style>
