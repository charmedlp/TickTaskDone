<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CategoryDto } from '@ticktaskdone/shared';
import { createCategory, listCategories } from '@/api/categories';
import { checkedSet as computeCheckedSet, selectCategory, toggleCategory } from '@/lib/categoryTree';

const props = defineProps<{ modelValue: number[] }>();
const emit = defineEmits<{ 'update:modelValue': [number[]]; loaded: [CategoryDto[]] }>();

// Colors are assigned automatically here; editing them happens in the Projects view.
const PALETTE = ['#8844cc', '#3366cc', '#22aa88', '#cc7722', '#cc3366', '#557799'];

const categories = ref<CategoryDto[]>([]);
const open = ref(false);
const adding = ref(false);
const addingParentId = ref<number | null>(null);
const newName = ref('');
const rootRef = ref<HTMLElement | null>(null);

const load = async (): Promise<void> => {
  categories.value = await listCategories().catch(() => []);
  emit('loaded', categories.value); // let the form resolve lineage color (brief §5)
};
onMounted(load);

const byId = computed(() => new Map(categories.value.map((category) => [category.idCategory, category])));

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

const isSelected = (idCategory: number): boolean => checked.value.has(idCategory);

const toggle = (idCategory: number): void => {
  emit('update:modelValue', toggleCategory(categories.value, props.modelValue, idCategory));
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
    color: PALETTE[categories.value.length % PALETTE.length] ?? '#557799',
  });
  await load();
  emit('update:modelValue', selectCategory(categories.value, props.modelValue, created.idCategory)); // auto-select
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
  }
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown));
</script>

<template>
  <div ref="rootRef" class="category-picker">
    <div class="control" @click="open = !open">
      <template v-if="selectedCategories.length > 0">
        <span v-for="category in selectedCategories" :key="category.idCategory" class="tag">
          <span class="tag-dot" :style="{ backgroundColor: category.color }" />
          {{ ancestryLabel(category) }}
          <button type="button" class="tag-remove" @click.stop="toggle(category.idCategory)">×</button>
        </span>
      </template>
      <span v-else class="placeholder">No categories</span>
      <span class="caret" :class="{ up: open }">▾</span>
    </div>

    <div v-if="open" class="panel">
      <p v-if="flat.length === 0 && !adding" class="empty">No categories yet.</p>

      <template v-for="entry in flat" :key="entry.category.idCategory">
        <div class="cat-row" :style="{ paddingLeft: `${entry.depth * 16}px` }">
          <label class="cat-label">
            <input
              type="checkbox"
              :checked="isSelected(entry.category.idCategory)"
              @change="toggle(entry.category.idCategory)"
            />
            <span class="swatch" :style="{ backgroundColor: entry.category.color }" />
            <span class="cat-name">{{ entry.category.name }}</span>
          </label>
          <button type="button" class="add-child" title="Add a child category" @click="startAdd(entry.category.idCategory)">
            +
          </button>
        </div>
        <div v-if="adding && addingParentId === entry.category.idCategory" class="cat-add" :style="{ paddingLeft: `${(entry.depth + 1) * 16}px` }">
          <input v-model="newName" placeholder="Child name" @keyup.enter="confirmAdd" @keyup.esc="cancelAdd" />
          <button type="button" @click="confirmAdd">Add</button>
          <button type="button" class="ghost" @click="cancelAdd">×</button>
        </div>
      </template>

      <div v-if="adding && addingParentId === null" class="cat-add">
        <input v-model="newName" placeholder="Category name" @keyup.enter="confirmAdd" @keyup.esc="cancelAdd" />
        <button type="button" @click="confirmAdd">Add</button>
        <button type="button" class="ghost" @click="cancelAdd">×</button>
      </div>
      <button v-else type="button" class="add-root" @click="startAdd(null)">+ Add category</button>
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

.cat-row:hover {
  background: var(--surface-hover);
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
