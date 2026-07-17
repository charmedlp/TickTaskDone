<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import AppNav from '@/components/AppNav.vue';
import { useUserStore } from '@/stores/user';

// Load the user's saved language as soon as the app boots (overrides the best-effort
// locale set in main.ts).
onMounted(() => {
  void useUserStore().load();
});
</script>

<template>
  <div class="app-shell">
    <AppNav />
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
}

.app-main {
  flex: 1;
  min-height: 0;
  padding: 16px;
  box-sizing: border-box;
  overflow: hidden;
}
</style>
