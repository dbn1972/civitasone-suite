/**
 * UAT b23: an employee record can have a blank name (name is optional at import). A link or table cell built from
 * `name` alone then has no accessible name, and the avatar initials are empty. Every place that shows an employee's
 * name as link or row text uses this to get a non-empty label: the name, else "Unnamed employee" with the employee
 * number so the row stays identifiable.
 */
export function employeeDisplayName(name: string | null | undefined, employeeNo?: string | null): string {
  const n = (name ?? "").trim();
  if (n) return n;
  const no = (employeeNo ?? "").trim();
  return no ? `Unnamed employee (${no})` : "Unnamed employee";
}

/** Up to two initials for an avatar; "?" when the name is blank (never an empty string). */
export function employeeInitials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const ini = parts.map((p) => p.charAt(0)).join("").toUpperCase();
  return ini || "?";
}
