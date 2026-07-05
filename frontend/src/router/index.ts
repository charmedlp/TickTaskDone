import { createRouter, createWebHistory } from 'vue-router';
import CalendarView from '@/views/CalendarView.vue';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    // Calendar is the default view of the application (guide §2, brief §1).
    { path: '/', redirect: '/calendar' },
    { path: '/calendar', name: 'calendar', component: CalendarView },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('@/views/ProjectsView.vue'),
    },
  ],
});

export default router;
