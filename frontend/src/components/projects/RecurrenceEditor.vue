<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { WEEKDAYS, type Frequency, type RecurrenceModel, type Weekday } from '@/lib/recurrenceModel';

// The shared recurrence RULE inputs (frequency / interval / weekdays / count) — the
// part duplicated between the calendar form and the task detail. Context-specific bits
// (the "starting" anchor, the make/update/remove buttons) stay in the parent, which
// wraps this. Emits a fresh model on every change (works with reactive or ref state).
const props = defineProps<{ modelValue: RecurrenceModel; showSupersede?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [RecurrenceModel] }>();

// Recurring TASKS only (showSupersede): checked = keep a single active instance
// (auto-cancel older undone ones); unchecked = accumulate every missed instance.
const supersedeStale = defineModel<boolean>('supersedeStale', { default: true });

const { t } = useI18n();

const FREQUENCIES: Frequency[] = ['none', 'daily', 'weekly', 'monthly'];

const patch = (change: Partial<RecurrenceModel>): void => {
  emit('update:modelValue', { ...props.modelValue, ...change });
};
const setFreq = (value: string): void => patch({ freq: value as Frequency });
const setInterval = (value: string): void => patch({ interval: Number(value) > 0 ? Number(value) : 1 });
const setCount = (value: string): void => patch({ count: value === '' ? null : Math.max(1, Number(value)) });
const toggleWeekday = (day: Weekday): void => {
  patch({
    weekdays: props.modelValue.weekdays.includes(day)
      ? props.modelValue.weekdays.filter((value) => value !== day)
      : [...props.modelValue.weekdays, day],
  });
};
</script>

<template>
  <div class="recurrence-editor">
    <select class="rc-freq" :value="modelValue.freq" @change="setFreq(($event.target as HTMLSelectElement).value)">
      <option v-for="frequency in FREQUENCIES" :key="frequency" :value="frequency">
        {{ t('recurrence.freq.' + frequency) }}
      </option>
    </select>

    <template v-if="modelValue.freq !== 'none'">
      <label class="inline">
        {{ t('recurrence.every') }}
        <input
          :value="modelValue.interval"
          type="number"
          min="1"
          step="1"
          class="narrow"
          @input="setInterval(($event.target as HTMLInputElement).value)"
        />
      </label>

      <div v-if="modelValue.freq === 'weekly'" class="rc-weekdays">
        <button
          v-for="day in WEEKDAYS"
          :key="day.value"
          type="button"
          class="rc-weekday"
          :class="{ on: modelValue.weekdays.includes(day.value) }"
          @click="toggleWeekday(day.value)"
        >
          {{ t('weekday.' + day.value) }}
        </button>
      </div>

      <label class="inline">
        {{ t('recurrence.for') }}
        <input
          :value="modelValue.count ?? ''"
          type="number"
          min="1"
          step="1"
          class="narrow"
          placeholder="∞"
          @input="setCount(($event.target as HTMLInputElement).value)"
        />
        {{ t('recurrence.times') }}
      </label>

      <label v-if="showSupersede" class="inline supersede" :title="t('recurrence.supersedeHint')">
        <input v-model="supersedeStale" type="checkbox" />
        {{ t('recurrence.supersede') }}
      </label>
    </template>
  </div>
</template>

<style scoped>
.recurrence-editor {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text);
}

.rc-freq {
  font: inherit;
  font-size: 13px;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.inline {
  display: flex;
  align-items: center;
  gap: 6px;
}

.narrow {
  width: 56px;
  font: inherit;
  font-size: 13px;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

.rc-weekdays {
  display: flex;
  gap: 3px;
}

.rc-weekday {
  min-width: 28px;
  padding: 4px 0;
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
}

.rc-weekday.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
</style>
