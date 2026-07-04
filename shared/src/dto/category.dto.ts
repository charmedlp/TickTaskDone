// API contract for a category. Dates are ISO strings; audit columns are internal.
export interface CategoryDto {
  idCategory: number;
  workspaceId: number;
  parentCategoryId: number | null;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}
