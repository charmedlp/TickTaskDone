import type { UserDto } from '@ticktaskdone/shared';
import type { User } from '../../db/schema';

export const toUserDto = (row: User): UserDto => ({
  idUser: row.idUser,
  email: row.email,
  locale: row.locale,
});
