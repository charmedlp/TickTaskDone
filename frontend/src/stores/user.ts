import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Locale } from '@ticktaskdone/shared';
import { fetchCurrentUser, updateCurrentUser } from '@/api/user';
import { setLocale } from '@/i18n';

// The current user's preferences. `locale` is the source of truth for the UI language:
// loaded from the API at startup (persisted per user, cross-device — i18n brief §2.3),
// and updated + persisted when the user switches language.
export const useUserStore = defineStore('user', () => {
  const locale = ref<Locale>('en');

  const load = async (): Promise<void> => {
    try {
      const user = await fetchCurrentUser();
      locale.value = user.locale;
      setLocale(user.locale);
    } catch {
      // Keep the best-effort locale already applied in main.ts (stored/browser/English).
    }
  };

  const changeLocale = async (next: Locale): Promise<void> => {
    locale.value = next;
    setLocale(next); // immediate UI feedback
    try {
      await updateCurrentUser({ locale: next });
    } catch {
      // Persistence failure is non-fatal; the UI already reflects the choice.
    }
  };

  return { locale, load, changeLocale };
});
