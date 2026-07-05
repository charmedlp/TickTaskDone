<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppNav from '@/components/AppNav.vue';
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
