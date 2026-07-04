// Color resolution cascade (see guide §7):
//   item.color -> project color (walked up the hierarchy, resolved by the caller)
//   -> default. `item.color` is auto-filled from the first chosen category only
//   when the item has no project (handled at item creation, not here).
export const DEFAULT_COLOR = '#808080';

// Pure resolver: the caller supplies the already-resolved project color (the
// nearest non-null color found while climbing the project ancestry, or null).
export const resolveColor = (itemColor: string | null, projectColor: string | null): string =>
  itemColor ?? projectColor ?? DEFAULT_COLOR;
