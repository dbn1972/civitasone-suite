"use client";

/**
 * StartOnboardingPicker — search any tenant employee and jump straight to
 * their onboarding-detail page, whether or not they already have tasks.
 *
 * GAP-HR-ONBOARDING-02 (fix step 3 of this catalog item; see this PR's
 * description for which step is deferred and why): the tracker only ever
 * listed employees who ALREADY had >=1 onboarding task, and the only entry
 * point ("+ Add New Joinee") created a brand-new employee record -- there
 * was no way to reach an EXISTING employee's onboarding page to give them
 * their first task. Reuses the same EntityPicker + searchEmployees/
 * resolveEmployees adapter EditEmployeeForm.tsx and the add-employee
 * wizard's Step3 already use for "pick an employee".
 */

import { useRouter } from "next/navigation";
import { EntityPicker } from "../../../../_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

export function StartOnboardingPicker() {
  const router = useRouter();

  return (
    <div style={{ maxWidth: 340, marginTop: 12, marginBottom: 4 }}>
      <EntityPicker
        value={null}
        onChange={(v) => {
          const id = Array.isArray(v) ? v[0] : v;
          if (id) router.push(`/hr/onboarding/${id}`);
        }}
        search={searchEmployees}
        resolve={resolveEmployees}
        placeholder="Find an employee to start onboarding…"
        aria-label="Find an employee to start onboarding"
      />
    </div>
  );
}
