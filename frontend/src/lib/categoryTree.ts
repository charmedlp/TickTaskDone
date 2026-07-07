// Pure category-tree selection logic (brief §2/§3 + the linked-checkbox rules).
//
// We store only the LEAVES of the checked set (deepest tagged categories); the
// checked state of any node is the ancestor-closure of the stored leaves. Rules:
//  - checking a node checks its whole ancestry (never its children);
//  - unchecking a node unchecks its whole subtree, then removes each ancestor that
//    has no checked child left (a parent can still be checked alone);
//  - a child is never checked without its parents; a parent can be checked alone.
//
// The subtle part, so it is unit-tested separately from the Vue component.

export interface CategoryNode {
  idCategory: number;
  parentCategoryId: number | null;
}

const buildById = (categories: CategoryNode[]): Map<number, CategoryNode> =>
  new Map(categories.map((category) => [category.idCategory, category]));

const buildChildren = (categories: CategoryNode[]): Map<number, CategoryNode[]> => {
  const map = new Map<number, CategoryNode[]>();
  for (const category of categories) {
    if (category.parentCategoryId !== null) {
      const siblings = map.get(category.parentCategoryId) ?? [];
      siblings.push(category);
      map.set(category.parentCategoryId, siblings);
    }
  }
  return map;
};

const ancestorIds = (byId: Map<number, CategoryNode>, id: number): number[] => {
  const result: number[] = [];
  let current = byId.get(id);
  while (current && current.parentCategoryId !== null) {
    result.push(current.parentCategoryId);
    current = byId.get(current.parentCategoryId);
  }
  return result;
};

const descendantIds = (childrenOf: Map<number, CategoryNode[]>, id: number): number[] => {
  const result: number[] = [];
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const category = stack.pop();
    if (!category) {
      break;
    }
    result.push(category.idCategory);
    stack.push(...(childrenOf.get(category.idCategory) ?? []));
  }
  return result;
};

const leavesOf = (childrenOf: Map<number, CategoryNode[]>, set: Set<number>): number[] =>
  [...set].filter((id) => !(childrenOf.get(id) ?? []).some((child) => set.has(child.idCategory)));

// The ancestor-closed checked set derived from the stored leaves.
export const checkedSet = (categories: CategoryNode[], storedLeaves: number[]): Set<number> => {
  const byId = buildById(categories);
  const set = new Set<number>();
  for (const id of storedLeaves) {
    set.add(id);
    for (const ancestor of ancestorIds(byId, id)) {
      set.add(ancestor);
    }
  }
  return set;
};

// Check a node (+ its ancestry); returns the new stored leaves.
export const selectCategory = (categories: CategoryNode[], storedLeaves: number[], id: number): number[] => {
  const byId = buildById(categories);
  const childrenOf = buildChildren(categories);
  const set = checkedSet(categories, storedLeaves);
  set.add(id);
  for (const ancestor of ancestorIds(byId, id)) {
    set.add(ancestor);
  }
  return leavesOf(childrenOf, set);
};

// Uncheck a node (+ its subtree), then prune now-childless ancestors.
export const deselectCategory = (categories: CategoryNode[], storedLeaves: number[], id: number): number[] => {
  const byId = buildById(categories);
  const childrenOf = buildChildren(categories);
  const set = checkedSet(categories, storedLeaves);
  set.delete(id);
  for (const descendant of descendantIds(childrenOf, id)) {
    set.delete(descendant);
  }
  for (const ancestor of ancestorIds(byId, id)) {
    const hasCheckedChild = (childrenOf.get(ancestor) ?? []).some((child) => set.has(child.idCategory));
    if (set.has(ancestor) && !hasCheckedChild) {
      set.delete(ancestor);
    } else {
      break;
    }
  }
  return leavesOf(childrenOf, set);
};

export const toggleCategory = (categories: CategoryNode[], storedLeaves: number[], id: number): number[] =>
  checkedSet(categories, storedLeaves).has(id)
    ? deselectCategory(categories, storedLeaves, id)
    : selectCategory(categories, storedLeaves, id);
