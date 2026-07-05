<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import type { MenuAction } from './contextMenu.types';

const props = defineProps<{ open: boolean; x: number; y: number; actions: MenuAction[] }>();
const emit = defineEmits<{ select: [id: string]; close: [] }>();

// Close on any outside interaction or Escape while the menu is open.
const onDocumentPointerDown = (): void => emit('close');
const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    emit('close');
  }
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      // Defer so the opening click itself does not immediately close the menu.
      setTimeout(() => document.addEventListener('pointerdown', onDocumentPointerDown), 0);
      document.addEventListener('keydown', onKeydown);
    } else {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.removeEventListener('keydown', onKeydown);
    }
  },
);

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div
    v-if="open"
    class="context-menu"
    :style="{ top: `${y}px`, left: `${x}px` }"
    @pointerdown.stop
    @contextmenu.prevent.stop
  >
    <button
      v-for="action in actions"
      :key="action.id"
      type="button"
      class="menu-item"
      :class="{ danger: action.danger }"
      @click="emit('select', action.id)"
    >
      {{ action.label }}
    </button>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 100;
  min-width: 160px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  padding: 4px;
}

.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 7px 10px;
  border-radius: 6px;
  font: inherit;
  color: var(--text);
  cursor: pointer;
}

.menu-item:hover {
  background: var(--surface-hover);
}

.menu-item.danger {
  color: #b00020;
}
</style>
