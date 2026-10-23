import type { EstabDivisions } from "./useEstabDivisions";

/**
 * How a department field should render for a given divisions state.
 *  - "loading": still fetching, a disabled select.
 *  - "pick": a select of the enrolled divisions (a typo can never mint a department).
 *  - "blocked": the list failed to load for a reason that is not "your role cannot read it" (a network or
 *    server error), so the field stays a disabled select with a retry hint; typing a department by hand
 *    here would let a transient outage mint a mistyped one.
 *  - "typed": there is genuinely no pick-list to offer (no operators enrolled yet, or this role cannot
 *    read the directory), so there is no master to validate against and the department is typed.
 */
export type DeptFieldMode = "loading" | "pick" | "blocked" | "typed";

export function deptFieldMode(d: EstabDivisions): DeptFieldMode {
  if (!d.loaded) return "loading";
  if (d.divisions.length > 0) return "pick";
  if (d.failed && !d.forbidden) return "blocked";
  return "typed";
}
