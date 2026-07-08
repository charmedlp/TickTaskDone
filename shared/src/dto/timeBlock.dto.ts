// API contract for a planned placement (timeBlock). Belongs to a user.
export interface TimeBlockDto {
  idTimeBlock: number;
  itemOccurrenceId: number;
  userId: number;
  timeStart: string;
  timeEnd: string;
  allDay: boolean;
  isBlocking: boolean;
  timezone: string | null; // IANA id; null = all-day floating
  createdAt: string;
  updatedAt: string;
}
