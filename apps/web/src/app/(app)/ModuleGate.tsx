import type { ReactNode } from "react";
import Link from "next/link";
import { getEnabledModules, isModuleEnabled } from "@/lib/moduleVisibility";
import { getSessionRoles } from "@/lib/auth/roleGuard";

interface ModuleGateProps {
  /** The module key to check (e.g. "finance", "hrms", "procurement"). */
  moduleKey: string;
  children: ReactNode;
}

/**
 * Server Component that blocks access to module routes when the tenant has
 * disabled the module. Renders a friendly fallback with a link to Tenant Admin
 * where the module can be re-enabled.
 *
 * Usage in a module layout:
 *   import { ModuleGate } from "../ModuleGate";
 *   export default function FinanceLayout({ children }) {
 *     return <ModuleGate moduleKey="finance">{children}</ModuleGate>;
 *   }
 */
export async function ModuleGate({ moduleKey, children }: ModuleGateProps) {
  const enabledModules = await getEnabledModules();

  // GAP2-SHELL-MODULEGATE-01: thread the session roles so the documented
  // super_admin / platform_admin bypass in isModuleEnabled actually applies at
  // the server-side module gate. Without this third argument a platform operator
  // hit the "Module Not Enabled" wall on a module their tenant has disabled, even
  // though the Sidebar/help surfaces (which do pass roles) let them through. Real
  // authorization is still enforced server-side; this only stops over-restricting
  // the highest-privilege operators.
  const roles = getSessionRoles();

  if (isModuleEnabled(enabledModules, moduleKey, roles)) {
    return <>{children}</>;
  }

  return (
    <div className="module-disabled" role="alert" aria-live="polite">
      <div className="module-disabled__card">
        <span className="module-disabled__icon" aria-hidden="true">🚫</span>
        <h1 className="module-disabled__title">Module Not Enabled</h1>
        <p className="module-disabled__desc">
          The <strong>{moduleKey}</strong> module is not enabled for your organisation.
          Contact your administrator or enable it from the Tenant Admin panel.
        </p>
        <div className="module-disabled__actions">
          <Link href="/tenant-admin" className="btn btn-primary">
            Go to Tenant Admin
          </Link>
          <Link href="/dashboard" className="btn btn-secondary">
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
