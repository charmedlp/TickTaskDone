// Color resolution cascade (see guide §7):
//   item.color (custom) -> effective project color -> effective color of the first
//   category -> default. Each "effective" color is the nearest non-null color found
//   while climbing that node's ancestry (resolved by the caller via `lineageColor`).
//   Categories only matter when the item has no custom color AND no (effective)
//   project color. Assigning a category NEVER writes item.color.
export const DEFAULT_COLOR = '#808080';

// Pure resolver: the caller supplies the already-resolved project color and the
// already-resolved color of the item's first category (each the nearest non-null
// color while climbing the respective ancestry, or null). The category tier is
// optional so older two-arg callers keep working.
export const resolveColor = (
  itemColor: string | null,
  projectColor: string | null,
  categoryColor: string | null = null,
): string => itemColor ?? projectColor ?? categoryColor ?? DEFAULT_COLOR;

// A node in a project/category hierarchy for color inheritance.
export interface ColorNode {
  parentId: number | null;
  color: string | null;
}

// The effective color of a node: its own color, else the nearest ancestor's color
// while climbing `parentId`, else null (the caller falls back to DEFAULT_COLOR). Used
// by both the projects/categories views and the calendar item-color cascade so a
// color-less node inherits from the first ancestor that has one. Cycle-safe.
export const lineageColor = (id: number | null, byId: Map<number, ColorNode>): string | null => {
  const seen = new Set<number>();
  let current = id;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const node = byId.get(current);
    if (!node) {
      break;
    }
    if (node.color !== null) {
      return node.color;
    }
    current = node.parentId;
  }
  return null;
};
