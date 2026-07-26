<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ProjectDto } from '@ticktaskdone/shared';
import { descendantProjectIds } from '@/lib/projectTree';

// Single-select project picker rendered as an indented TREE (like the category picker,
// but one value). Shared by the Projects detail, the calendar form and the tasks grid.
// Stays i18n-agnostic: the parent passes already-translated `noneLabel`/`placeholder`.
const props = withDefaults(
  defineProps<{
    modelValue: number | null;
    projects: ProjectDto[];
    noneLabel: string; // label of the "no project" choice (e.g. "None (Task List)")
    placeholder?: string; // trigger hint when nothing is chosen (defaults to noneLabel)
    // Exclude this project AND its descendants — the re-parent guard (a project can't
    // move under itself/its subtree). Null = no exclusion.
    excludeSubtreeOf?: number | null;
    // Restrict the options to this project and its descendants only (used by the tasks
    // grid's Subproject column — moving a task OUT of the subtree goes via the detail).
    restrictToSubtreeOf?: number | null;
    allowNone?: boolean; // show the "None" choice (false hides it, e.g. the Subproject column)
    disabled?: boolean;
  }>(),
  { placeholder: undefined, excludeSubtreeOf: null, restrictToSubtreeOf: null, allowNone: true, disabled: false },
);
const emit = defineEmits<{ 'update:modelValue': [number | null] }>();

const { t } = useI18n();
const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const byId = computed(() => new Map(props.projects.map((project) => [project.idProject, project])));

const excluded = computed<Set<number>>(() =>
  props.excludeSubtreeOf != null ? descendantProjectIds(props.projects, props.excludeSubtreeOf) : new Set<number>(),
);

// Depth-first flatten (siblings by name); an excluded node drops its whole subtree.
interface Row {
  project: ProjectDto;
  depth: number;
}
const flat = computed<Row[]>(() => {
  const childrenOf = new Map<number | null, ProjectDto[]>();
  for (const project of props.projects) {
    const siblings = childrenOf.get(project.parentProjectId) ?? [];
    siblings.push(project);
    childrenOf.set(project.parentProjectId, siblings);
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name));
  }
  const out: Row[] = [];
  const walk = (parentId: number | null, depth: number): void => {
    for (const project of childrenOf.get(parentId) ?? []) {
      if (excluded.value.has(project.idProject)) {
        continue;
      }
      out.push({ project, depth });
      walk(project.idProject, depth + 1);
    }
  };
  // Restricted to a subtree: that project is the root (depth 0), then its descendants.
  if (props.restrictToSubtreeOf != null) {
    const root = byId.value.get(props.restrictToSubtreeOf);
    if (root) {
      out.push({ project: root, depth: 0 });
      walk(root.idProject, 1);
    }
  } else {
    walk(null, 0);
  }
  return out;
});

// "root › … › leaf" for the chosen project (a compact breadcrumb on the trigger).
const breadcrumb = (idProject: number): string => {
  const chain: string[] = [];
  let current = byId.value.get(idProject);
  while (current) {
    chain.unshift(current.name);
    current = current.parentProjectId !== null ? byId.value.get(current.parentProjectId) : undefined;
  }
  return chain.join(' › ');
};
const selectedLabel = computed(() =>
  props.modelValue !== null && byId.value.has(props.modelValue) ? breadcrumb(props.modelValue) : props.noneLabel,
);

// --- Typeahead / keyboard navigation -----------------------------------------------
const controlRef = ref<HTMLButtonElement | null>(null);
const filterInputRef = ref<HTMLInputElement | null>(null);
const query = ref('');
const highlight = ref(0);

// Rows matching the filter (query hits the project's own name, so typing narrows fast).
const visibleRows = computed<Row[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (q === '') {
    return flat.value;
  }
  return flat.value.filter((row) => row.project.name.toLowerCase().includes(q));
});
// The keyboard-navigable option values: "None" (only when allowed & unfiltered) then the
// visible projects.
const navigable = computed<(number | null)[]>(() => [
  ...(props.allowNone && query.value.trim() === '' ? [null] : []),
  ...visibleRows.value.map((row) => row.project.idProject),
]);
const highlightedValue = computed<number | null | undefined>(() => navigable.value[highlight.value]);

watch(query, () => {
  highlight.value = 0;
});

const openPanel = (): void => {
  if (props.disabled) {
    return;
  }
  open.value = true;
  void nextTick(() => filterInputRef.value?.focus());
};
const closePanel = (refocus = false): void => {
  open.value = false;
  query.value = '';
  if (refocus) {
    void nextTick(() => controlRef.value?.focus());
  }
};
const choose = (idProject: number | null): void => {
  emit('update:modelValue', idProject);
  closePanel(true);
};
const toggle = (): void => {
  if (open.value) {
    closePanel();
  } else {
    openPanel();
  }
};

const onControlKeydown = (event: KeyboardEvent): void => {
  if (open.value) {
    return;
  }
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
    event.preventDefault();
    openPanel();
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    query.value = event.key;
    openPanel();
  }
};
const onFilterKeydown = (event: KeyboardEvent): void => {
  const count = navigable.value.length;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (count > 0) {
      highlight.value = (highlight.value + 1) % count;
    }
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (count > 0) {
      highlight.value = (highlight.value - 1 + count) % count;
    }
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (highlight.value < count) {
      choose(navigable.value[highlight.value]);
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closePanel(true);
  } else if (event.key === 'Tab') {
    open.value = false; // let default Tab move focus onward
  }
};

const onOutside = (event: PointerEvent): void => {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) {
    open.value = false;
  }
};
onMounted(() => document.addEventListener('pointerdown', onOutside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside));
</script>

<template>
  <div ref="rootRef" class="project-select">
    <button
      ref="controlRef"
      type="button"
      class="control"
      :class="{ empty: modelValue === null }"
      :disabled="disabled"
      :aria-expanded="open"
      @click="toggle"
      @keydown="onControlKeydown"
    >
      <span class="label">{{ modelValue === null && placeholder ? placeholder : selectedLabel }}</span>
      <span class="caret" :class="{ up: open }">▾</span>
    </button>

    <div v-if="open" class="panel">
      <input
        ref="filterInputRef"
        v-model="query"
        type="text"
        class="filter"
        :placeholder="t('projectSelect.filter')"
        spellcheck="false"
        @keydown="onFilterKeydown"
      />
      <button
        v-if="allowNone && query.trim() === ''"
        type="button"
        class="option none"
        :class="{ active: modelValue === null, highlighted: highlightedValue === null }"
        @click="choose(null)"
      >
        {{ noneLabel }}
      </button>
      <button
        v-for="row in visibleRows"
        :key="row.project.idProject"
        type="button"
        class="option"
        :class="{ active: modelValue === row.project.idProject, highlighted: highlightedValue === row.project.idProject }"
        :style="{ paddingLeft: `${8 + row.depth * 16}px` }"
        @click="choose(row.project.idProject)"
      >
        {{ row.project.name }}
      </button>
      <p v-if="visibleRows.length === 0 && (!allowNone || query.trim() !== '')" class="option none">—</p>
    </div>
  </div>
</template>

<style scoped>
.project-select {
  position: relative;
}

.control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 5px 8px;
  font: inherit;
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.control:disabled {
  opacity: 0.5;
  cursor: default;
}

.control.empty .label {
  color: var(--text-muted);
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caret {
  flex: none;
  font-size: 11px;
  color: var(--text-muted);
  transition: transform 0.15s ease;
}

.caret.up {
  transform: rotate(180deg);
}

.panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  width: 100%;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.24);
}

.option {
  display: block;
  width: 100%;
  padding: 6px 8px;
  font: inherit;
  font-size: 13px;
  text-align: left;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--text);
  cursor: pointer;
}

.option:hover,
.option.highlighted {
  background: var(--surface-hover);
}

.option.highlighted {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.option.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.option.none {
  color: var(--text-muted);
  font-style: italic;
}

.filter {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 13px;
  padding: 5px 7px;
  margin-bottom: 4px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text);
}

.filter:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
