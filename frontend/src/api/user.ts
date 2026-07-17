import type { UpdateUserInput, UserDto } from '@ticktaskdone/shared';
import { api } from './client';

// The current user (identity-scoped, not workspace-scoped).
export const fetchCurrentUser = (): Promise<UserDto> => api.get<UserDto>('/me');

export const updateCurrentUser = (input: UpdateUserInput): Promise<UserDto> => api.patch<UserDto>('/me', input);
