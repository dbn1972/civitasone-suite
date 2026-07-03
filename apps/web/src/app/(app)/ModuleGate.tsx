import type { ReactNode } from "react";
import Link from "next/link";
import { getEnabledModules, isModuleEnabled } from "@/lib/moduleVisibility";

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

  if (isModuleEnabled(enabledModules, moduleKey)) {
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
