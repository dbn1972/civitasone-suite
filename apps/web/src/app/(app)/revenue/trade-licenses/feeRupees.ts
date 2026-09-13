import { minorToRupeesOrNull } from "@/lib/formatters";

/**
 * UX-018: feeMinor/feePaidMinor are typed as non-null strings, but the API can omit
 * them — and unlike Number(x), BigInt(null)/BigInt(undefined) THROWS, crashing the
 * whole table row (a worse failure mode than UX-006's ₹0.00 masking). Guard via the
 * shared type guard before ever calling BigInt, so a missing fee renders "—" instead.
 * Truncates to whole rupees to match the previous BigInt-division display exactly.
 *
 * Lives in its own module rather than being exported from page.tsx: Next.js's App
 * Router only allows a fixed set of named exports from a page file and rejects the
 * build otherwise ("<name> is not a valid Page export field").
 */
export function feeRupees(minor: string | null | undefined): string {
  const rupees = minorToRupeesOrNull(minor);
  return rupees === null ? "—" : Math.trunc(rupees).toString();
}
