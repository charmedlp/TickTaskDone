<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CategoryDto, ColorNode } from '@ticktaskdone/shared';
import { DEFAULT_COLOR, lineageColor } from '@ticktaskdone/shared';
import { createCategory, listCategories } from '@/api/categories';
import { checkedSet as computeCheckedSet, selectCategory, toggleCategory } from '@/lib/categoryTree';

const { t } = useI18n();

// `disabledIds` are categories that cannot be picked here because they already apply
// through another channel — e.g. a child project inheriting a parent's category
// (guide §7). They render checked-but-locked so the user sees they are covered
// without being able to store a duplicate.
// `source` lets a parent supply the category list (avoids one fetch per instance when
// many pickers are on screen, e.g. the tasks grid); when omitted the picker self-fetches.
const props = withDefaults(defineProps<{ modelValue: number[]; disabledIds?: number[]; source?: CategoryDto[] }>(), {
  disabledIds: () => [],
  source: undefined,
});
const emit = defineEmits<{ 'update:modelValue': [number[]]; loaded: [CategoryDto[]]; changed: [] }>();

// Colors are assigned automatically here; editing them happens in the Projects view.
const PALETTE = ['#8844cc', '#3366cc', '#22aa88', '#cc7722', '#cc3366', '#557799'];

const fetched = ref<CategoryDto[]>([]);
const categories = computed<CategoryDto[]>(() => props.source ?? fetched.value);
const open = ref(false);
const adding = ref(false);
const addingParentId = ref<number | null>(null);
const newName = ref('');
const rootRef = ref<HTMLElement | null>(null);

const load = async (): Promise<void> => {
  fetched.value = await listCategories().catch(() => []);
  emit('loaded', fetched.value); // let the form resolve lineage color (brief §5)
};
onMounted(() => {
  if (props.source === undefined) {
    void load();
  }
});

const byId = computed(() => new Map(categories.value.map((category) => [category.idCategory, category])));

// A category with no own color inherits its nearest colored ancestor's (guide §7).
const colorNodes = computed<Map<number, ColorNode>>(
  () => new Map(categories.value.map((category) => [category.idCategory, { parentId: category.parentCategoryId, color: category.color }])),
);
const effectiveColor = (idCategory: number): string => lineageColor(idCategory, colorNodes.value) ?? DEFAULT_COLOR;

// Only the stored LEAVES are shown as tags (deepest tagged categories); their
// ancestors are deduced, not shown separately.
const selectedCategories = computed(() =>
  props.modelValue.map((id) => byId.value.get(id)).filter((category): category is CategoryDto => category !== undefined),
);

// Ancestor-closed checked set (see lib/categoryTree, unit-tested).
const checked = computed(() => computeCheckedSet(categories.value, props.modelValue));

// The full lineage of a category (root › … › leaf) — deduced, never stored (§3).
const ancestryLabel = (category: CategoryDto): string => {
  const chain: string[] = [];
  let current: CategoryDto | undefined = category;
  while (current) {
    chain.unshift(current.name);
    current = current.parentCategoryId !== null ? byId.value.get(current.parentCategoryId) : undefined;
  }
  return chain.join(' › ');
};

interface FlatCategory {
  category: CategoryDto;
  depth: number;
}

// Depth-first flatten of the hierarchy, each branch sorted by name.
const flat = computed<FlatCategory[]>(() => {
  const byParent = new Map<number | null, CategoryDto[]>();
  for (const category of categories.value) {
    const siblings = byParent.get(category.parentCategoryId) ?? [];
    siblings.push(category);
    byParent.set(category.parentCategoryId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name));
  }
  const result: FlatCategory[] = [];
  const walk = (parentId: number | null, depth: number): void => {
    for (const category of byParent.get(parentId) ?? []) {
      result.push({ category, depth });
      walk(category.idCategory, depth + 1);
    }
  };
  walk(null, 0);
  return result;
});

const disabledSet = computed(() => new Set(props.disabledIds));
const isDisabled = (idCategory: number): boolean => disabledSet.value.has(idCategory);
const isSelected = (idCategory: number): boolean => checked.value.has(idCategory) || isDisabled(idCategory);

const toggle = (idCategory: number): void => {
  if (isDisabled(idCategory)) {
    return; // inherited elsewhere — locked to avoid a duplicate
  }
  emit('update:modelValue', toggleCategory(categories.value, props.modelValue, idCategory));
};

// --- Typeahead / keyboard navigation (fully keyboard-operable) ----------------------
const controlRef = ref<HTMLElement | null>(null);
const filterInputRef = ref<HTMLInputElement | null>(null);
const query = ref('');
const highlight = ref(0);

// Rows matching the filter (query hits the full lineage, so a parent name reveals its
// children too). Disabled (inherited) rows still show but are not keyboard-navigable.
const visible = computed<FlatCategory[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (q === '') {
    return flat.value;
  }
  return flat.value.filter((entry) => ancestryLabel(entry.category).toLowerCase().includes(q));
});
const navigable = computed<FlatCategory[]>(() => visible.value.filter((entry) => !isDisabled(entry.category.idCategory)));
const highlightedId = computed<number | null>(() => navigable.value[highlight.value]?.category.idCategory ?? null);

watch(query, () => {
  highlight.value = 0;
});

const openPanel = (): void => {
  open.value = true;
  void nextTick(() => filterInputRef.value?.focus());
};
const closePanel = (refocus = false): void => {
  open.value = false;
  if (refocus) {
    void nextTick(() => controlRef.value?.focus());
  }
};

// Keyboard on the (focused, closed) control: type-to-open, Enter/Space/Down to open.
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

// Keyboard inside the filter input: arrows move the highlight, Enter toggles it (stays
// open for multi-select), Escape closes, Tab closes and lets focus flow to the next cell.
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
    const row = navigable.value[highlight.value];
    if (row) {
      toggle(row.category.idCategory);
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closePanel(true);
  } else if (event.key === 'Tab') {
    open.value = false; // let default Tab move focus to the next field
  }
};

const startAdd = (parentId: number | null): void => {
  adding.value = true;
  addingParentId.value = parentId;
  newName.value = '';
};
const cancelAdd = (): void => {
  adding.value = false;
};

const confirmAdd = async (): Promise<void> => {
  const name = newName.value.trim();
  if (name === '') {
    return;
  }
  const created = await createCategory({
    name,
    parentCategoryId: addingParentId.value,
    // A child category inherits its parent's color dynamically (null); a root gets a
    // distinct palette color so top-level tags stay visually separable (guide §7).
    color: addingParentId.value === null ? (PALETTE[categories.value.length % PALETTE.length] ?? '#557799') : null,
  });
  if (props.source === undefined) {
    await load();
    emit('update:modelValue', selectCategory(categories.value, props.modelValue, created.idCategory)); // auto-select
  } else {
    // Parent owns the list: select the new leaf optimistically and ask it to refresh.
    emit('update:modelValue', [...new Set([...props.modelValue, created.idCategory])]);
    emit('changed');
  }
  adding.value = false;
  newName.value = '';
};

// Close the dropdown on an outside click.
const onDocumentPointerDown = (event: PointerEvent): void => {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) {
    open.value = false;
  }
};
watch(open, (isOpen) => {
  if (isOpen) {
    setTimeout(() => document.addEventListener('pointerdown', onDocumentPointerDown), 0);
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown);
    adding.value = false;
    query.value = ''; // reset the filter for the next open
  }
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown));
</script>

<template>
  <div ref="rootRef" class="category-picker">
    <div
      ref="controlRef"
      class="control"
      tabindex="0"
      role="combobox"
      :aria-expanded="open"
      @click="open ? closePanel() : openPanel()"
      @keydown="onControlKeydown"
    >
      <template v-if="selectedCategories.length > 0">
        <span v-for="category in selectedCategories" :key="category.idCategory" class="tag">
          <span class="tag-dot" :style="{ backgroundColor: effectiveColor(category.idCategory) }" />
          {{ ancestryLabel(category) }}
          <button type="button" class="tag-remove" @click.stop="toggle(category.idCategory)">×</button>
        </span>
      </template>
      <span v-else class="placeholder">{{ t('categoryPicker.none') }}</span>
      <span class="caret" :class="{ up: open }">▾</span>
    </div>

    <div v-if="open" class="panel">
      <input
        ref="filterInputRef"
        v-model="query"
        type="text"
        class="filter"
        :placeholder="t('categoryPicker.filter')"
        spellcheck="false"
        @keydown="onFilterKeydown"
      />
      <p v-if="visible.length === 0 && !adding" class="empty">{{ t('categoryPicker.empty') }}</p>

      <template v-for="entry in visible" :key="entry.category.idCategory">
        <div
          class="cat-row"
          :class="{ 'is-inherited': isDisabled(entry.category.idCategory), highlighted: entry.category.idCategory === highlightedId }"
          :style="{ paddingLeft: `${entry.depth * 16}px` }"
        >
          <label class="cat-label">
            <input
              type="checkbox"
              tabindex="-1"
              :checked="isSelected(entry.category.idCategory)"
              :disabled="isDisabled(entry.category.idCategory)"
              @change="toggle(entry.category.idCategory)"
            />
            <span class="swatch" :style="{ backgroundColor: effectiveColor(entry.category.idCategory) }" />
            <span class="cat-name">{{ entry.category.name }}</span>
            <span v-if="isDisabled(entry.category.idCategory)" class="inherited-tag">{{ t('categoryPicker.inherited') }}</span>
          </label>
          <button type="button" class="add-child" :title="t('categoryPicker.addChildTitle')" @click="startAdd(entry.category.idCategory)">
            +
          </button>
        </div>
        <div v-if="adding && addingParentId === entry.category.idCategory" class="cat-add" :style="{ paddingLeft: `${(entry.depth + 1) * 16}px` }">
          <input v-model="newName" :placeholder="t('categoryPicker.childName')" @keyup.enter="confirmAdd" @keyup.esc="cancelAdd" />
          <button type="button" @click="confirmAdd">{{ t('common.add') }}</button>
          <button type="button" class="ghost" @click="cancelAdd">×</button>
        </div>
      </template>

      <div v-if="adding && addingParentId === null" class="cat-add">
        <input v-model="newName" :placeholder="t('categoryPicker.categoryName')" @keyup.enter="confirmAdd" @keyup.esc="cancelAdd" />
        <button type="button" @click="confirmAdd">{{ t('common.add') }}</button>
        <button type="button" class="ghost" @click="cancelAdd">×</button>
      </div>
      <button v-else type="button" class="add-root" @click="startAdd(null)">{{ t('categoryPicker.addCategory') }}</button>
    </div>
  </div>
</template>

<style scoped>
.category-picker {
  position: relative;
}

.control {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  cursor: pointer;
}

.placeholder {
  color: var(--text-muted);
  font-size: 13px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  padding: 1px 4px 1px 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-hover);
}

.tag-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.tag-remove {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}

.tag-remove:hover {
  color: #b00020;
}

.caret {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
  transition: transform 0.15s;
}

.caret.up {
  transform: rotate(180deg);
}

.panel {
  margin-top: 4px;
  max-height: 220px;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.filter {
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

.empty {
  color: var(--text-muted);
  font-size: 12px;
  margin: 4px;
}

.cat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  border-radius: 4px;
}

.cat-row:hover,
.cat-row.highlighted {
  background: var(--surface-hover);
}

.cat-row.highlighted {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.cat-label {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  font-weight: 500;
  cursor: pointer;
  padding: 2px 0;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: 0 0 auto;
}

.cat-name {
  font-size: 13px;
}

/* Inherited from a parent project: checked-but-locked, so it reads as "already
   covered" rather than pickable. */
.cat-row.is-inherited .cat-label {
  cursor: default;
  color: var(--text-muted);
}

.inherited-tag {
  font-size: 11px;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 0 6px;
}

.add-child {
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
}

.add-child:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.cat-add {
  display: flex;
  gap: 4px;
  padding: 3px 0;
}

.cat-add input {
  flex: 1;
  font: inherit;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.cat-add button,
.add-root {
  font: inherit;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 6px;
  padding: 3px 8px;
  cursor: pointer;
}

.add-root {
  align-self: flex-start;
  color: var(--accent);
  border-color: var(--accent);
  margin-top: 2px;
}

.cat-add .ghost {
  border: none;
}
</style>
