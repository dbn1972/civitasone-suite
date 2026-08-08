import { DEFAULT_BLOCKS, hiddenBlocksForPattern } from "./designerConstants";

/** Visible block ids for a service pattern, in wizard order. */
export function visibleBlockIds(pattern: string): string[] {
  const hidden = hiddenBlocksForPattern(pattern);
  return DEFAULT_BLOCKS.filter((b) => !hidden.has(b.id)).map((b) => b.id);
}

export function adjacentBlocks(pattern: string, current: string): { prev: string; next: string } {
  const visible = visibleBlockIds(pattern);
  const idx = visible.indexOf(current);
  if (idx < 0) {
    return { prev: visible[0] ?? "b1", next: visible[visible.length - 1] ?? "test" };
  }
  return {
    prev: idx > 0 ? visible[idx - 1]! : visible[0]!,
    next: idx < visible.length - 1 ? visible[idx + 1]! : "test",
  };
}
