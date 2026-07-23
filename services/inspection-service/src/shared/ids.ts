/**
 * ID generation utilities for inspection-service entities.
 */
import { randomUUID } from "node:crypto";

/** Generate a new UUID v4 */
export function newId(): string {
  return randomUUID();
}

/** Generate a batch of UUID v4 identifiers */
export function newIds(count: number): string[] {
  return Array.from({ length: count }, () => randomUUID());
}
