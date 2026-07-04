import { AppError } from './errors';

// Parses a positive-integer route parameter, rejecting anything else with 400.
export const parseId = (raw: string, label: string): number => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, `Invalid ${label}.`);
  }
  return id;
};
