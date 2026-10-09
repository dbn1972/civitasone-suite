import { Masked } from "@/app/_components/ds";

/**
 * Visitor phone for the host queue and guard console (DPDP).
 *
 * GET /v1/visitor/visit-requests returns `visitorPhone` already MASKED
 * server-side (e.g. "*********0001"; the raw number never leaves the
 * service on the list path). A value that is already masked is shown verbatim:
 * re-masking it client-side would collapse it to a handful of placeholder
 * characters and lose the last digits the guard uses to verify the visitor.
 * Any value that is not already masked (e.g. a fixture or a future caller
 * holding a raw number) still goes through the client-side `Masked` so a raw
 * number is never printed.
 */
export function VisitorPhone({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  if (value.includes("*")) {
    return (
      <span style={{ fontFamily: "monospace" }} aria-label={ariaLabel}>
        {value}
      </span>
    );
  }
  return <Masked kind="phone" value={value} ariaLabel={ariaLabel} />;
}
