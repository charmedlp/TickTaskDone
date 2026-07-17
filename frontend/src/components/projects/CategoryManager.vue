<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CategoryDto } from '@ticktaskdone/shared';
import { createCategory, deleteCategory, listCategories, updateCategory } from '@/api/categories';
import { errorMessage } from '@/lib/errorMessage';
import ColorPicker from '@/components/ColorPicker.vue';

const { t } = useI18n();

// The category tree editor (brief §5): create, rename, recolor, move (re-parent) and
// delete categories. The workspace hosts one hierarchical tag tree; assignment to
// projects/items happens elsewhere (the picker). Emits `changed` so callers refresh
// anything that shows category lineage.
const emit = defineEmits<{ changed: [] }>();

const DEFAULT_COLOR = '#557799';

const categories = ref<CategoryDto[]>([]);
const loading = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);

const load = async (): Promise<void> => {
  loading.value = true;
  error.value = null;
  try {
    categories.value = await listCategories();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
};
onMounted(load);

// Flatten to a render list with depth (siblings sorted by name).
const flat = computed(() => {
  const childrenOf = new Map<number | null, CategoryDto[]>();
  for (const category of categories.value) {
    const siblings = childrenOf.get(category.parentCategoryId) ?? [];
    siblings.push(category);
    childrenOf.set(category.parentCategoryId, siblings);
  }
  const out: { category: CategoryDto; depth: number }[] = [];
  const walk = (parentId: number | null, depth: number): void => {
    for (const category of [...(childrenOf.get(parentId) ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ category, depth });
      walk(category.idCategory, depth + 1);
    }
  };
  walk(null, 0);
  return out;
});

// A category plus its descendants — invalid parents when moving (self/subtree).
const descendantIds = (rootId: number): Set<number> => {
  const childrenOf = new Map<number, CategoryDto[]>();
  for (const category of categories.value) {
    if (category.parentCategoryId !== null) {
      const siblings = childrenOf.get(category.parentCategoryId) ?? [];
      siblings.push(category);
      childrenOf.set(category.parentCategoryId, siblings);
    }
  }
  const result = new Set<number>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) {
      break;
    }
    for (const child of childrenOf.get(id) ?? []) {
      if (!result.has(child.idCategory)) {
        result.add(child.idCategory);
        stack.push(child.idCategory);
      }
    }
  }
  return result;
};
const parentOptions = (category: CategoryDto): CategoryDto[] => {
  const invalid = descendantIds(category.idCategory);
  return categories.value.filter((candidate) => !invalid.has(candidate.idCategory)).sort((a, b) => a.name.localeCompare(b.name));
};

const run = async (operation: () => Promise<void>): Promise<void> => {
  if (busy.value) {
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await operation();
    await load();
    emit('changed');
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
};

const addCategory = (parentCategoryId: number | null, color: string | null): Promise<void> =>
  run(async () => {
    await createCategory({ parentCategoryId, name: t('categories.newCategory'), color });
  });

const rename = (category: CategoryDto, name: string): Promise<void> =>
  run(async () => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === category.name) {
      return;
    }
    await updateCategory(category.idCategory, { name: trimmed });
  });

const recolor = (category: CategoryDto, color: string | null): Promise<void> =>
  run(async () => {
    await updateCategory(category.idCategory, { color });
  });

const move = (category: CategoryDto, value: string): Promise<void> =>
  run(async () => {
    await updateCategory(category.idCategory, { parentCategoryId: value === '' ? null : Number(value) });
  });

const remove = (category: CategoryDto): Promise<void> =>
  run(async () => {
    if (!window.confirm(t('categories.deleteConfirm', { name: category.name }))) {
      return;
    }
    await deleteCategory(category.idCategory);
  });
</script>

<template>
  <div class="category-manager">
    <div class="cm-head">
      <h2>{{ t('categories.title') }}</h2>
      <button type="button" class="btn small primary" :disabled="busy" @click="addCategory(null, DEFAULT_COLOR)">
        {{ t('categories.addCategory') }}
      </button>
    </div>
    <p v-if="error" class="banner error">{{ error }}</p>
    <p v-if="loading" class="muted small">{{ t('common.loading') }}</p>
    <p v-else-if="flat.length === 0" class="muted small">{{ t('categories.empty') }}</p>

    <ul class="cm-list">
      <li v-for="{ category, depth } in flat" :key="category.idCategory" class="cm-row" :style="{ paddingLeft: `${depth * 18}px` }">
        <ColorPicker :model-value="category.color" @update:model-value="recolor(category, $event)" />
        <input
          type="text"
          class="cm-name"
          :value="category.name"
          :disabled="busy"
          @change="rename(category, ($event.target as HTMLInputElement).value)"
        />
        <select
          class="cm-parent"
          :value="category.parentCategoryId ?? ''"
          :disabled="busy"
          :aria-label="t('categories.parentAriaLabel')"
          @change="move(category, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ t('categories.topLevel') }}</option>
          <option v-for="option in parentOptions(category)" :key="option.idCategory" :value="option.idCategory">
            {{ option.name }}
          </option>
        </select>
        <button type="button" class="btn tiny" :disabled="busy" @click="addCategory(category.idCategory, null)">
          {{ t('categories.addSub') }}
        </button>
        <button type="button" class="btn tiny danger" :disabled="busy" :title="t('common.delete')" @click="remove(category)">✕</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.category-manager {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cm-head h2 {
  margin: 0;
  font-size: 18px;
}

.banner.error {
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
  padding: 8px 12px;
  border-radius: 8px;
  margin: 0;
}

.muted {
  color: var(--text-muted);
}

.small {
  font-size: 12px;
}

.cm-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.cm-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cm-name {
  flex: 1;
  min-width: 80px;
  font: inherit;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.cm-parent {
  flex: 0 0 auto;
  max-width: 150px;
  font: inherit;
  font-size: 13px;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
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

.btn.small {
  padding: 4px 10px;
  font-size: 13px;
}

.btn.tiny {
  padding: 4px 8px;
  font-size: 12px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
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
</style>
