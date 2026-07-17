import type { Locale } from '../validation/user.validation';

// The authenticated user, as returned by GET /me. The frontend reads `locale` at
// startup to pick the UI language (i18n brief §2.3).
export interface UserDto {
  idUser: number;
  email: string;
  locale: Locale;
}
