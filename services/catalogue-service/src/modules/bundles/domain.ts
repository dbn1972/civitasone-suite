/**
 * Bundle validation logic.
 * All component products in a bundle must be active for the bundle to be valid.
 */

export interface ProductStatusCheck {
  id: string;
  lifecycleStatus: string;
}

export interface BundleValidationResult {
  valid: boolean;
  invalidProducts: Array<{ id: string; status: string; reason: string }>;
}

/**
 * Validate that all component products are active.
 * Returns validation result with details on any invalid components.
 */
export function validateBundleComponents(
  componentProductIds: string[],
  productStatuses: ProductStatusCheck[],
): BundleValidationResult {
  const statusMap = new Map(productStatuses.map((p) => [p.id, p.lifecycleStatus]));
  const invalidProducts: Array<{ id: string; status: string; reason: string }> = [];

  for (const pid of componentProductIds) {
    const status = statusMap.get(pid);
    if (status === undefined) {
      invalidProducts.push({ id: pid, status: "not_found", reason: "Product not found" });
    } else if (status !== "active") {
      invalidProducts.push({ id: pid, status, reason: `Product is '${status}', must be 'active'` });
    }
  }

  return {
    valid: invalidProducts.length === 0,
    invalidProducts,
  };
}

/**
 * Validate bundle has at least one component.
 */
export function validateBundleSize(componentProductIds: string[]): { valid: boolean; reason?: string } {
  if (componentProductIds.length === 0) {
    return { valid: false, reason: "Bundle must have at least one component product" };
  }
  return { valid: true };
}
