// DTO / API contracts and Zod validation schemas shared by frontend and backend.
// No database dependency here: types, schemas and pure helpers only.

// Pure helpers
export * from './color/color';

// Validation schemas (single source of truth, reused by the backend middleware)
export * from './validation/category.validation';
export * from './validation/project.validation';
export * from './validation/item.validation';
export * from './validation/itemOccurrence.validation';
export * from './validation/timeBlock.validation';
export * from './validation/occurrence.validation';
export * from './validation/scheduledItem.validation';
export * from './validation/itemCategory.validation';

// DTO contracts
export * from './dto/category.dto';
export * from './dto/project.dto';
export * from './dto/item.dto';
export * from './dto/itemOccurrence.dto';
export * from './dto/timeBlock.dto';
export * from './dto/occurrenceView.dto';
export * from './dto/reminder.dto';
export * from './dto/backlog.dto';
