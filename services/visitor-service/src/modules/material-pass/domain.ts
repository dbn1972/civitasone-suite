/**
 * visitor-service: material-pass — pure domain logic.
 *
 * Owns:
 *   - Item declaration at check-in: validates and normalizes the list of
 *     items (laptops, cameras, equipment, documents) a visitor carries in
 *     (Requirement 13.1).
 *   - Exit reconciliation: compares declared items against items actually
 *     present at exit and flags a discrepancy if and only if a declared
 *     item is unaccounted for (Requirements 13.2, 13.3; Property 21).
 *   - Undeclared-item-on-exit handling: detects items presented at exit
 *     that were never declared at entry, tracked separately from the
 *     missing-item discrepancy (Requirement 13.4).
 *
 * This module performs no I/O. Callers (consumer.ts) persist the
 * `material_passes` rows, set `discrepancy`/`reconciled_at`, and publish
 * `securityIncidentCreated` when `discrepancy` is true or undeclared items
 * are detected — see design.md "Material & Vehicle" and Property 21.
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

// ── Item Declaration ──────────────────────────────────────────────────────

export interface DeclareItemInput {
  description: string;
  quantity: number;
  serialNumber?: string;
}

export interface DeclaredItem {
  description: string;
  quantity: number;
  serialNumber: string | null;
}

/**
 * Validates and normalizes a list of items declared at check-in
 * (Requirement 13.1). Each item requires a non-empty `description` and a
 * `quantity` that is a positive integer. `serialNumber` is optional and
 * normalized to `null` when absent or blank.
 *
 * Throws `DomainError` on the first invalid item — callers should surface
 * this as a 400 at the route boundary.
 */
export function declareItems(items: DeclareItemInput[]): DeclaredItem[] {
  return items.map((item) => {
    const description = item.description?.trim() ?? "";
    if (description.length === 0) {
      throw new DomainError(
        "INVALID_ITEM_DESCRIPTION",
        "material item description must not be empty",
      );
    }

    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new DomainError(
        "INVALID_ITEM_QUANTITY",
        `material item quantity must be a positive integer, got ${item.quantity}`,
      );
    }

    const trimmedSerial = item.serialNumber?.trim();

    return {
      description,
      quantity: item.quantity,
      serialNumber: trimmedSerial && trimmedSerial.length > 0 ? trimmedSerial : null,
    };
  });
}

// ── Item Identity & Aggregation ───────────────────────────────────────────

interface PresentItemInput {
  description: string;
  quantity: number;
  serialNumber?: string | null;
}

interface AggregatedItem {
  description: string;
  serialNumber: string | null;
  quantity: number;
}

/**
 * Computes an identity key for a material item so that declared and
 * presented-at-exit items can be matched: items with a serial number match
 * on that serial number (case-insensitive); items without one match on
 * description (case-insensitive, trimmed).
 */
function itemKey(description: string, serialNumber?: string | null): string {
  const trimmedSerial = serialNumber?.trim();
  if (trimmedSerial && trimmedSerial.length > 0) {
    return `sn:${trimmedSerial.toLowerCase()}`;
  }
  return `desc:${description.trim().toLowerCase()}`;
}

/**
 * Aggregates a list of items by identity key, summing quantities. Used so
 * that reconciliation and undeclared-item detection are independent of
 * item ordering and of whether the same item was declared/presented as
 * multiple rows.
 */
function aggregateByKey(
  items: readonly PresentItemInput[],
): Map<string, AggregatedItem> {
  const map = new Map<string, AggregatedItem>();
  for (const item of items) {
    const key = itemKey(item.description, item.serialNumber);
    const existing = map.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      map.set(key, {
        description: item.description,
        serialNumber: item.serialNumber?.trim() || null,
        quantity: item.quantity,
      });
    }
  }
  return map;
}

// ── Exit Reconciliation ───────────────────────────────────────────────────

export interface ReconciliationResult {
  discrepancy: boolean;
  missingItems: DeclaredItem[];
  accountedItems: DeclaredItem[];
}

/**
 * Reconciles declared items against items actually present at exit
 * (Requirements 13.2, 13.3; Property 21).
 *
 * For each declared item, the quantity present at exit (matched by serial
 * number, or by description when no serial number was declared) is
 * compared against the declared quantity:
 *   - If the present quantity is fully accounted for, the item goes into
 *     `accountedItems`.
 *   - If any portion of the declared quantity is missing, the item (with
 *     the missing quantity) goes into `missingItems`.
 *
 * `discrepancy` is `true` if and only if `missingItems` is non-empty —
 * i.e., iff at least one declared item is unaccounted for at exit. This is
 * the property under test in Property 21. Extra/undeclared items present
 * at exit never affect `discrepancy` on their own — see
 * `handleUndeclaredItemOnExit`, which reports them separately.
 */
export function reconcileOnExit(
  declaredItems: readonly DeclaredItem[],
  itemsPresentAtExit: readonly PresentItemInput[],
): ReconciliationResult {
  const declaredAgg = aggregateByKey(declaredItems);
  const presentAgg = aggregateByKey(itemsPresentAtExit);

  const missingItems: DeclaredItem[] = [];
  const accountedItems: DeclaredItem[] = [];

  for (const declared of declaredAgg.values()) {
    const key = itemKey(declared.description, declared.serialNumber);
    const presentQuantity = presentAgg.get(key)?.quantity ?? 0;

    if (presentQuantity >= declared.quantity) {
      accountedItems.push({
        description: declared.description,
        quantity: declared.quantity,
        serialNumber: declared.serialNumber,
      });
    } else {
      missingItems.push({
        description: declared.description,
        quantity: declared.quantity - presentQuantity,
        serialNumber: declared.serialNumber,
      });
    }
  }

  return {
    discrepancy: missingItems.length > 0,
    missingItems,
    accountedItems,
  };
}

// ── Undeclared Item Handling ──────────────────────────────────────────────

export interface UndeclaredItem {
  description: string;
  quantity: number;
  serialNumber: string | null;
}

export interface UndeclaredItemResult {
  undeclaredItems: UndeclaredItem[];
}

/**
 * Detects items present at exit that were never declared at entry, or
 * present in a quantity exceeding what was declared (Requirement 13.4).
 * Reported separately from `reconcileOnExit`'s missing-item discrepancy —
 * a visitor attempting to carry out undeclared items is a distinct
 * security concern (unauthorized removal) from a declared item going
 * missing.
 *
 * For each identity key present at exit, any quantity beyond what was
 * declared for that key (zero, if the item was never declared at all) is
 * reported as undeclared.
 */
export function handleUndeclaredItemOnExit(
  itemsPresentAtExit: readonly PresentItemInput[],
  declaredItems: readonly DeclaredItem[],
): UndeclaredItemResult {
  const declaredAgg = aggregateByKey(declaredItems);
  const presentAgg = aggregateByKey(itemsPresentAtExit);

  const undeclaredItems: UndeclaredItem[] = [];

  for (const present of presentAgg.values()) {
    const key = itemKey(present.description, present.serialNumber);
    const declaredQuantity = declaredAgg.get(key)?.quantity ?? 0;
    const excess = present.quantity - declaredQuantity;

    if (excess > 0) {
      undeclaredItems.push({
        description: present.description,
        quantity: excess,
        serialNumber: present.serialNumber,
      });
    }
  }

  return { undeclaredItems };
}
