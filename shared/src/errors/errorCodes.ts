// Stable, locale-independent error identifiers (i18n brief §2.4). The backend returns
// them as `{ error: <CODE>, details? }`; the frontend maps each to a translated message
// (an unknown code falls back to a generic translated message).
export const errorCodes = [
  'VALIDATION_FAILED', // Zod body validation; `details` = the issue list
  'NOT_FOUND', // `details` = { entity }
  'INVALID_PARAM', // malformed path/query param; `details` = { param }
  'INVALID_DATE_WINDOW', // calendar window query is malformed
  'RRULE_RECURRENCE_MISMATCH', // rrule and recurrenceStart must be both set or both null
  'ONLY_TASKS_CAN_RECUR',
  'TASK_ALREADY_RECURRING',
  'TASK_NOT_RECURRING',
  'CATEGORIES_WRONG_WORKSPACE',
  'BLOCKING_OVERLAP', // `details` = { title } of the clashing block
  'TIME_END_BEFORE_START',
  'LOG_END_BEFORE_START',
  'DEV_USER_MISSING', // dev-only: the seeded user is absent
  'INTERNAL_ERROR', // opaque 500
] as const;

export type ErrorCode = (typeof errorCodes)[number];

// The wire shape of every error response.
export interface ApiErrorBody {
  error: ErrorCode | string;
  details?: unknown;
}
