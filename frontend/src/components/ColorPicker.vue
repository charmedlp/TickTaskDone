<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

// A small, modern color picker: a swatch that opens a popover with a preset palette,
// a hex text field (the whole point — type "#rrggbb" or "rgb"), the OS spectrum
// picker as an optional fallback, and a "No color" action that clears the color so
// the element inherits from its nearest colored ancestor (guide §7). Emits on a real
// commit (preset click, spectrum change, Enter/blur on the hex field, or clear) — not
// on every keystroke — so callers that persist on change are not spammed. A null
// model value means "no own color" (the swatch shows a hollow, inherit state).
const props = defineProps<{ modelValue: string | null }>();
const emit = defineEmits<{ 'update:modelValue': [string | null] }>();

const PRESETS = [
  '#8844cc', '#6366f1', '#3366cc', '#0ea5e9', '#22aa88', '#10b981',
  '#f59e0b', '#cc7722', '#dc2626', '#cc3366', '#ec4899', '#557799',
  '#6b7280', '#111827',
];

// Accept "#rgb", "rgb", "#rrggbb", "rrggbb" -> canonical "#rrggbb" (lowercase), else null.
const normalize = (value: string): string | null => {
  let hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = hex
      .split('')
      .map((char) => char + char)
      .join('');
  }
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : null;
};

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const hexText = ref('');

watch(
  () => props.modelValue,
  (value) => {
    hexText.value = (value ?? '').replace(/^#/, '');
  },
  { immediate: true },
);

const nativeValue = computed(() => normalize(props.modelValue ?? '') ?? '#000000');
const previewColor = computed(() => normalize(hexText.value));
const isActive = (color: string): boolean =>
  props.modelValue !== null && normalize(color) === normalize(props.modelValue);

const commit = (value: string): void => {
  const canonical = normalize(value);
  if (canonical) {
    emit('update:modelValue', canonical);
  }
};
const commitHex = (): void => {
  const canonical = normalize(hexText.value);
  if (canonical) {
    emit('update:modelValue', canonical);
  } else {
    hexText.value = (props.modelValue ?? '').replace(/^#/, ''); // revert an invalid entry
  }
};
const clear = (): void => {
  emit('update:modelValue', null);
  open.value = false;
};

const toggle = (): void => {
  open.value = !open.value;
  if (open.value) {
    hexText.value = (props.modelValue ?? '').replace(/^#/, '');
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
  <div ref="rootRef" class="color-picker">
    <button
      type="button"
      class="swatch"
      :class="{ 'is-empty': modelValue === null }"
      :style="modelValue === null ? {} : { background: modelValue }"
      :title="modelValue === null ? t('colorPicker.noColorInheritsTitle') : modelValue"
      :aria-label="t('colorPicker.pickAria')"
      @click="toggle"
    />

    <div v-if="open" class="popover">
      <div class="presets">
        <button
          v-for="preset in PRESETS"
          :key="preset"
          type="button"
          class="preset"
          :class="{ active: isActive(preset) }"
          :style="{ background: preset }"
          :title="preset"
          @click="commit(preset)"
        />
      </div>

      <div class="hex-row">
        <span class="preview" :style="{ background: previewColor ?? 'transparent' }" />
        <span class="hash">#</span>
        <input
          v-model="hexText"
          type="text"
          class="hex-input"
          maxlength="6"
          spellcheck="false"
          :placeholder="t('colorPicker.hexPlaceholder')"
          @keydown.enter.prevent="commitHex"
          @blur="commitHex"
        />
        <label class="native" :title="t('colorPicker.fullSpectrum')">
          <input type="color" :value="nativeValue" @input="commit(($event.target as HTMLInputElement).value)" />
          <span aria-hidden="true">🎨</span>
        </label>
      </div>

      <button type="button" class="clear-row" :class="{ active: modelValue === null }" @click="clear">
        <span class="clear-swatch" aria-hidden="true" />
        {{ t('colorPicker.noColor') }} <span class="clear-hint">{{ t('colorPicker.inherits') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.color-picker {
  position: relative;
  display: inline-block;
}

.swatch {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

/* No own color: a hollow swatch with a red diagonal (the "no fill" convention). */
.swatch.is-empty,
.clear-swatch {
  background:
    linear-gradient(
      to top right,
      transparent calc(50% - 1px),
      #dc2626 calc(50% - 1px),
      #dc2626 calc(50% + 1px),
      transparent calc(50% + 1px)
    ),
    var(--surface);
}

.popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  width: 208px;
  padding: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
}

.presets {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  margin-bottom: 10px;
}

.preset {
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}

.preset.active {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.hex-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.preview {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 1px solid var(--border);
}

.hash {
  color: var(--text-muted);
  font-size: 13px;
}

.hex-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-transform: lowercase;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.native {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  position: relative;
  overflow: hidden;
}

.clear-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  margin-top: 10px;
  padding: 6px 8px;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}

.clear-row.active {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.clear-hint {
  color: var(--text-muted);
}

.clear-swatch {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border: 1px solid var(--border);
  border-radius: 5px;
}

/* The native input drives the OS spectrum picker but is visually replaced by the 🎨. */
.native input[type='color'] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  padding: 0;
  border: none;
}
</style>
