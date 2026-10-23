import type { ReactNode } from "react";
import { getCurrentTenantOrgType } from "@/app/_data/loaders";
import { tenantDpoEmail } from "@/lib/orgConfig";
import { DpoEmailProvider } from "./DpoEmailContext";

/**
 * GAP-CITIZEN-GRIEVANCES-NEW-06: the DPDP notice shows the DPO contact. It was
 * read only from the deploy-wide NEXT_PUBLIC_DPO_EMAIL, ignoring tenant
 * configuration; read the tenant record's `settings.dpoEmail` here (server-side,
 * any signed-in user of the tenant may read their own tenant) and fall back to
 * the global value when it is unset or the lookup fails.
 */
export default async function NewGrievanceLayout({ children }: { children: ReactNode }) {
  let dpo: string | null = null;
  try {
    const { data } = await getCurrentTenantOrgType();
    dpo = tenantDpoEmail(data.settings);
  } catch {
    dpo = null;
  }
  return <DpoEmailProvider value={dpo}>{children}</DpoEmailProvider>;
}
