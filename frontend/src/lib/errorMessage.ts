import { ApiError } from '@/api/client';
import { i18n } from '@/i18n';

// Turns any thrown value into a translated, user-facing message (i18n brief §2.4):
// a backend ApiError's stable code maps to `errors.<CODE>` (with its details as
// interpolation params), and an unknown code / non-ApiError falls back to a generic
// translated message.
export const errorMessage = (cause: unknown): string => {
  const { t, te } = i18n.global;
  if (cause instanceof ApiError) {
    const key = `errors.${cause.code}`;
    const params = cause.details !== null && typeof cause.details === 'object' ? (cause.details as Record<string, unknown>) : {};
    if (te(key)) {
      return t(key, params);
    }
  }
  return t('errors.generic');
};
