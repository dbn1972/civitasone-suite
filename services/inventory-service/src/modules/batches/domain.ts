/**
 * batches module — pure domain logic for batch and serial tracking.
 *
 * Key rules:
 *   - Reject issue from a batch whose expiryDate < postingDate (BATCH_EXPIRED)
 *   - Serial numbers must be unique per item per tenant
 *
 * Validates: Requirements 14.5, 14.6
 */
import { DomainError } from "../../shared/domain.js";

/**
 * Validates that a batch has not expired relative to the posting date.
 *
 * @param expiryDate - The batch's expiry date (YYYY-MM-DD string or Date).
 * @param postingDate - The posting date for the issue (YYYY-MM-DD string or Date).
 * @throws DomainError with code "BATCH_EXPIRED" if the batch has expired.
 */
export function validateBatchNotExpired(expiryDate: string | Date, postingDate: string | Date): void {
  const expiry = typeof expiryDate === "string" ? new Date(expiryDate) : expiryDate;
  const posting = typeof postingDate === "string" ? new Date(postingDate) : postingDate;

  // Compare dates at day-level precision (strip time component)
  const expiryDay = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  const postingDay = new Date(posting.getFullYear(), posting.getMonth(), posting.getDate());

  if (expiryDay < postingDay) {
    throw new DomainError(
      "BATCH_EXPIRED",
      `Batch expired on ${expiryDate.toString()} but posting date is ${postingDate.toString()}`,
    );
  }
}

/**
 * Validates that a serial number is not already present in the existing set.
 *
 * @param serialNumber - The serial number to validate.
 * @param existingSerials - Set of existing serial numbers for the same item+tenant.
 * @throws DomainError with code "SERIAL_DUPLICATE" if the serial already exists.
 */
export function validateSerialUnique(serialNumber: string, existingSerials: Set<string>): void {
  if (existingSerials.has(serialNumber)) {
    throw new DomainError(
      "SERIAL_DUPLICATE",
      `Serial number '${serialNumber}' already exists for this item`,
    );
  }
}

/** Batch status lifecycle. */
export type BatchStatus = "active" | "expired" | "depleted" | "quarantine";

/** Serial number status lifecycle. */
export type SerialStatus = "available" | "issued" | "returned" | "scrapped";
