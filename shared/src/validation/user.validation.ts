import { z } from 'zod';

// Supported UI languages (i18n brief §2.2). English is the base locale.
export const locales = ['en', 'fr'] as const;
export type Locale = (typeof locales)[number];

// Update the current user's preferences. Only the locale is user-editable for now.
export const updateUserInput = z.object({
  locale: z.enum(locales),
});

export type UpdateUserInput = z.infer<typeof updateUserInput>;
