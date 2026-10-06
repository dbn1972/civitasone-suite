import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { GRANTS_DISBURSE_ROLES } from "../roles";
import { getGrantInstallments } from "../../../_data/loaders";
import { InstallmentsTable } from "./InstallmentsTable";
import { ArrowLeft } from "lucide-react";

export default async function GrantInstallmentsPage({
  searchParams,
}: {
  searchParams?: { appId?: string };
}) {
  const { data: allInstallments, source } = await getGrantInstallments();

  // GAP-GRANTS-INSTALLMENTS-04: the applications detail "View installments" CTA
  // links here with ?appId=<grant id>. Filter the list to that grant so the
  // CTA lands on a filtered view instead of the unfiltered global list.
  const appId = searchParams?.appId?.trim() || undefined;
  const installments = appId ? allInstallments.filter((i) => i.grantId === appId) : allInstallments;

  // GAP-GRANTS-INSTALLMENTS-01: only maker roles may release; pass the flag so
  // the table hides the Release control for everyone else.
  const canRelease = hasAnyRole(getSessionRoles(), GRANTS_DISBURSE_ROLES);

  // GAP-GRANTS-INSTALLMENTS-05 (FAILMASK): a failed fetch must not read as an
  // empty schedule (0 / 0 / 0 / ₹0.00). When the load errored AND nothing came
  // back, show a real retry state.
  if (source === "error" && allInstallments.length === 0) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="back">
          <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
        </nav>
        <PageHeader title="Grant Installments" subtitle="Disbursement schedule and release status for all grants." />
        <RefreshErrorState
          error={toHumanError("load", { area: "installments" })}
          backHref="/grants"
          source={{ area: "installments" }}
        />
      </>
    );
  }

  // GAP-GRANTS-INSTALLMENTS-06: "Released" and "Utilised" are distinct states;
  // report them separately rather than merging. Sum amounts as BigInt so a
  // large portfolio (paise above 2^53) never loses precision.
  const released = installments.filter((i) => i.status === "released").length;
  const utilised = installments.filter((i) => i.status === "utilized").length;
  const pending = installments.filter((i) => i.status === "pending").length;
  const totalAmount = installments.reduce((s, i) => s + BigInt(Math.round(i.amount)), 0n);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
      </nav>
      <PageHeader title="Grant Installments" subtitle="Disbursement schedule and release status for all grants." />
      {appId ? (
        <p style={{ marginBottom: 12 }}>
          Filtered to one grant.{" "}
          <a href="/grants/installments" className="link">
            Clear filter
          </a>
        </p>
      ) : null}
      {/* UX-012: the data-source badge lives inside InstallmentsTable, driven by
          the same useSeededResource call that produces its rows. */}
      <div aria-label="Grant installments">
        <StatGrid>
          <StatCard icon="📋" iconBg="#f1f5f9" label="Total" value={installments.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Released" value={released} />
          <StatCard icon="📈" iconBg="#e0f2fe" label="Utilised" value={utilised} />
          <StatCard icon="⏳" iconBg="#fef3c7" label="Pending" value={pending} />
          <StatCard icon="💰" iconBg="#dbeafe" label="Total Amount" value={formatMoney(totalAmount)} />
        </StatGrid>
        <Card title="Installments">
          <InstallmentsTable installments={installments} source={source} canRelease={canRelease} />
        </Card>
      </div>
    </>
  );
}
