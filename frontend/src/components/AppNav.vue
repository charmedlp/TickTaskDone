<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { Locale } from '@ticktaskdone/shared';
import { SUPPORTED_LOCALES } from '@/i18n';
import { useUserStore } from '@/stores/user';

// Top-level navigation between the two app sections, plus the UI language switcher.
const { t } = useI18n();
const userStore = useUserStore();

const onLocaleChange = (event: Event): void => {
  void userStore.changeLocale((event.target as HTMLSelectElement).value as Locale);
};
</script>

<template>
  <nav class="app-nav">
    <span class="brand">{{ t('app.title') }}</span>
    <RouterLink to="/calendar">{{ t('nav.calendar') }}</RouterLink>
    <RouterLink to="/projects">{{ t('nav.projects') }}</RouterLink>
    <label class="lang">
      <span class="visually-hidden">{{ t('nav.language') }}</span>
      <select :value="userStore.locale" :aria-label="t('nav.language')" @change="onLocaleChange">
        <option v-for="locale in SUPPORTED_LOCALES" :key="locale" :value="locale">{{ locale.toUpperCase() }}</option>
      </select>
    </label>
  </nav>
</template>

<style scoped>
.app-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.brand {
  font-weight: 700;
  margin-right: 12px;
}

a {
  padding: 6px 12px;
  border-radius: 6px;
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 600;
}

a:hover {
  background: var(--surface-hover);
}

a.router-link-active {
  color: var(--accent);
  background: var(--accent-soft);
}

.lang {
  margin-left: auto;
}

.lang select {
  font: inherit;
  font-weight: 600;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
