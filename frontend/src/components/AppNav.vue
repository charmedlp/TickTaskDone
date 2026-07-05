<script setup lang="ts">
// Top-level navigation between the two app sections. The Projects view is
// specified in a separate brief but the switch exists from now on (brief §10).
</script>

<template>
  <nav class="app-nav">
    <span class="brand">Tick Task Done</span>
    <RouterLink to="/calendar">Calendar</RouterLink>
    <RouterLink to="/projects">Projects</RouterLink>
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
</style>
