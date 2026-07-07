import { describe, expect, it } from 'vitest';
import { checkedSet, selectCategory, toggleCategory, type CategoryNode } from './categoryTree';

// Personnel(1) › Ménage(2) › Salle de bain(3) ; Personnel(1) › Cuisine(4) ; Travail(5)
const tree: CategoryNode[] = [
  { idCategory: 1, parentCategoryId: null },
  { idCategory: 2, parentCategoryId: 1 },
  { idCategory: 3, parentCategoryId: 2 },
  { idCategory: 4, parentCategoryId: 1 },
  { idCategory: 5, parentCategoryId: null },
];

const checked = (leaves: number[]): number[] => [...checkedSet(tree, leaves)].sort((a, b) => a - b);

describe('categoryTree selection', () => {
  it('stores only leaves; checked state closes over ancestry', () => {
    expect(checked([2])).toEqual([1, 2]); // Ménage checked -> Personnel checked
    expect(checked([1])).toEqual([1]); // Personnel alone
  });

  it('checking a child selects it (leaf), implying ancestors', () => {
    // From nothing, check Ménage(2): stored = [2], Personnel(1) deduced.
    expect(toggleCategory(tree, [], 2)).toEqual([2]);
    expect(checked(toggleCategory(tree, [], 2))).toEqual([1, 2]);
  });

  it('checking a parent alone stores just the parent', () => {
    expect(toggleCategory(tree, [], 1)).toEqual([1]);
  });

  it('checking a child replaces the parent leaf (single breadcrumb)', () => {
    // Personnel(1) selected, then check Ménage(2) -> stored becomes [2] (1 deduced).
    expect(toggleCategory(tree, [1], 2)).toEqual([2]);
  });

  it('checking a parent does NOT check its children', () => {
    const leaves = selectCategory(tree, [], 1);
    expect(checkedSet(tree, leaves).has(2)).toBe(false);
    expect(checkedSet(tree, leaves).has(4)).toBe(false);
  });

  it('unchecking a parent unchecks its whole subtree', () => {
    // Salle de bain(3) checked -> stored [3], closure {1,2,3}. Uncheck Personnel(1).
    expect(toggleCategory(tree, [3], 1)).toEqual([]);
  });

  it('unchecking a child prunes a parent that has nothing else checked', () => {
    // Ménage(2) checked -> [2]. Uncheck Ménage -> Personnel(1) has no other checked child -> gone.
    expect(toggleCategory(tree, [2], 2)).toEqual([]);
  });

  it('unchecking a child keeps a parent that still has another checked child', () => {
    // Ménage(2) and Cuisine(4) checked -> stored [2,4]. Uncheck Ménage(2) -> [4] (Personnel kept via Cuisine).
    const result = toggleCategory(tree, [2, 4], 2);
    expect(result.sort((a, b) => a - b)).toEqual([4]);
    expect(checked(result)).toEqual([1, 4]);
  });

  it('a deep leaf carries its full lineage', () => {
    expect(checked([3])).toEqual([1, 2, 3]);
  });
});
